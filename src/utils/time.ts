export type WorkSession = {
  id: string
  userId: string
  checkIn: string
  checkOut?: string
}

export type RulesConfig = {
  expectedDailyHours: number
  overtimeWeeklyThresholdHours: number
  holidays: string[]
  hourlyRate: number
  overtimeMultiplier: number
  holidayMultiplier: number
  dailyOvertimeThresholdHours: number
  doubleTimeDailyThresholdHours: number
  doubleTimeMultiplier: number
  holidayPaidHoursCredit: number
}

export type RulesOverride = Partial<RulesConfig>

export type DaySummary = {
  date: string
  totalHours: number
  isHoliday: boolean
  isEarlyCheckout: boolean
}

export type WeekSummary = {
  weekStart: string
  totalHours: number
  overtimeHours: number
}

export type PaySummary = {
  weekStart: string
  regularHours: number
  overtimeHours: number
  weeklyOvertimeHours: number
  dailyOvertimeHours: number
  doubleTimeHours: number
  holidayHours: number
  holidayCreditHours: number
  regularPay: number
  overtimePay: number
  doubleTimePay: number
  holidayExtraPay: number
  totalPay: number
}

export const toYMD = (d: Date) => d.toISOString().slice(0, 10)

export function hoursBetween(startISO: string, endISO?: string) {
  if (!endISO) return 0
  const start = new Date(startISO).getTime()
  const end = new Date(endISO).getTime()
  return Math.max(0, (end - start) / (1000 * 60 * 60))
}

export function isHoliday(dateISO: string, holidays: string[]): boolean {
  return holidays.includes(dateISO)
}

export function summarizeDay(
  dateISO: string,
  sessions: WorkSession[],
  rules: RulesConfig,
): DaySummary {
  const totalHours = sessions
    .filter((s) => toYMD(new Date(s.checkIn)) === dateISO)
    .reduce((acc, s) => acc + hoursBetween(s.checkIn, s.checkOut), 0)
  const holiday = isHoliday(dateISO, rules.holidays)
  const early = !holiday && totalHours > 0 && totalHours < rules.expectedDailyHours
  return { date: dateISO, totalHours, isHoliday: holiday, isEarlyCheckout: early }
}

function getMonday(date: Date) {
  const day = date.getDay() || 7
  const diff = date.getDate() - day + 1
  const monday = new Date(date)
  monday.setDate(diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export function summarizeWeek(sessions: WorkSession[], rules: RulesConfig): WeekSummary {
  const today = new Date()
  const monday = getMonday(today)
  const weekStartISO = toYMD(monday)
  const weekEnd = new Date(monday)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const totalHours = sessions
    .filter((s) => {
      const ci = new Date(s.checkIn)
      return ci >= monday && ci < weekEnd
    })
    .reduce((acc, s) => acc + hoursBetween(s.checkIn, s.checkOut), 0)

  const overtimeHours = Math.max(0, totalHours - rules.overtimeWeeklyThresholdHours)
  return { weekStart: weekStartISO, totalHours, overtimeHours }
}

export function summarizePayWeek(
  sessions: WorkSession[],
  rules: RulesConfig,
): PaySummary {
  const today = new Date()
  const monday = getMonday(today)
  const weekStartISO = toYMD(monday)
  const weekEnd = new Date(monday)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const perDay: Record<string, number> = {}
  for (const s of sessions) {
    const ci = new Date(s.checkIn)
    if (ci < monday || ci >= weekEnd) continue
    const d = toYMD(ci)
    const h = hoursBetween(s.checkIn, s.checkOut)
    perDay[d] = (perDay[d] || 0) + h
  }

  let holidayHours = 0
  let holidayCreditHours = 0
  let dailyRegularHours = 0
  let dailyOvertimeHours = 0
  let doubleTimeHours = 0

  for (let i = 0; i < 7; i++) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    const dISO = toYMD(day)
    const worked = perDay[dISO] || 0
    const holiday = isHoliday(dISO, rules.holidays)
    if (holiday) {
      holidayHours += worked
      if (worked === 0 && rules.holidayPaidHoursCredit > 0) {
        holidayCreditHours += rules.holidayPaidHoursCredit
      }
      continue
    }
    const otStart = rules.dailyOvertimeThresholdHours
    const dtStart = rules.doubleTimeDailyThresholdHours
    const regular = Math.min(worked, otStart)
    const dailyOT = Math.min(Math.max(worked - otStart, 0), Math.max(dtStart - otStart, 0))
    const dailyDT = Math.max(worked - dtStart, 0)
    dailyRegularHours += regular
    dailyOvertimeHours += dailyOT
    doubleTimeHours += dailyDT
  }

  const totalHours = holidayHours + dailyRegularHours + dailyOvertimeHours + doubleTimeHours
  const weeklyExcess = Math.max(0, totalHours - rules.overtimeWeeklyThresholdHours)
  const weeklyOvertimeHours = Math.min(weeklyExcess, dailyRegularHours)
  const regularHours = Math.max(0, dailyRegularHours - weeklyOvertimeHours)
  const overtimeHours = weeklyOvertimeHours + dailyOvertimeHours

  const regularPay = (regularHours + holidayCreditHours) * rules.hourlyRate
  const overtimePay = overtimeHours * rules.hourlyRate * rules.overtimeMultiplier
  const doubleTimePay = doubleTimeHours * rules.hourlyRate * rules.doubleTimeMultiplier
  const holidayExtraPay = holidayHours * rules.hourlyRate * Math.max(0, rules.holidayMultiplier - 1)
  const totalPay = regularPay + overtimePay + doubleTimePay + holidayExtraPay

  return {
    weekStart: weekStartISO,
    regularHours,
    overtimeHours,
    weeklyOvertimeHours,
    dailyOvertimeHours,
    doubleTimeHours,
    holidayHours,
    holidayCreditHours,
    regularPay,
    overtimePay,
    doubleTimePay,
    holidayExtraPay,
    totalPay,
  }
}

export type DayBreakdown = {
  date: string
  total: number
  reg: number
  ot1: number
  ot2: number
  ot3: number
  vac: number
  hol: number
  sic: number
  per: number
  pbr: number
  ubr: number
  in?: string
  out?: string
}

export function getWeekDays(base?: Date): string[] {
  const ref = base ? new Date(base) : new Date()
  const monday = getMonday(ref)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    days.push(toYMD(d))
  }
  return days
}

export function dayBreakdown(dateISO: string, sessions: WorkSession[], rules: RulesConfig): DayBreakdown {
  const workedSessions = sessions.filter((s) => toYMD(new Date(s.checkIn)) === dateISO)
  const total = workedSessions.reduce((acc, s) => acc + hoursBetween(s.checkIn, s.checkOut), 0)
  const holiday = isHoliday(dateISO, rules.holidays)
  const otStart = rules.dailyOvertimeThresholdHours
  const dtStart = rules.doubleTimeDailyThresholdHours
  const reg = holiday ? 0 : Math.min(total, otStart)
  const ot1 = holiday ? 0 : Math.min(Math.max(total - otStart, 0), Math.max(dtStart - otStart, 0))
  const ot2 = holiday ? 0 : Math.max(total - dtStart, 0)
  const hol = holiday ? total : 0
  const vac = 0
  const sic = 0
  const per = 0
  const pbr = 0
  const ubr = 0
  let firstIn: string | undefined
  let lastOut: string | undefined
  if (workedSessions.length > 0) {
    const sorted = [...workedSessions].sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())
    firstIn = sorted[0].checkIn
    const lastCompleted = sorted.filter((s) => s.checkOut).sort((a, b) => new Date(a.checkOut!).getTime() - new Date(b.checkOut!).getTime())
    lastOut = lastCompleted.length ? lastCompleted[lastCompleted.length - 1].checkOut : undefined
  }
  return { date: dateISO, total, reg, ot1, ot2, ot3: 0, vac, hol, sic, per, pbr, ubr, in: firstIn, out: lastOut }
}

export function mergeRules(base: RulesConfig, override?: RulesOverride): RulesConfig {
  if (!override) return base
  return {
    ...base,
    ...override,
    holidays: override.holidays ?? base.holidays,
  }
}
