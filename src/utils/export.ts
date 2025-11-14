import { RulesConfig, RulesOverride, WorkSession, toYMD, hoursBetween, summarizeDay, summarizePayWeek, mergeRules } from './time'

export type ExportUser = { id: string; name: string; terms?: RulesOverride }

export function generateTimesheetCSV(sessions: WorkSession[], users: ExportUser[], baseRules: RulesConfig): string {
  const header = ['date', 'user', 'check_in', 'check_out', 'hours', 'holiday', 'early']
  const lines: string[] = []
  lines.push(header.join(','))
  for (const s of sessions) {
    const d = toYMD(new Date(s.checkIn))
    const h = hoursBetween(s.checkIn, s.checkOut)
    const user = users.find((u) => u.id === s.userId)
    const userRules = mergeRules(baseRules, user?.terms)
    const sum = summarizeDay(d, [s], userRules)
    lines.push([
      d,
      user?.name || s.userId,
      s.checkIn,
      s.checkOut || '',
      h.toFixed(2),
      sum.isHoliday ? 'yes' : 'no',
      sum.isEarlyCheckout ? 'yes' : 'no',
    ].join(','))
  }
  return lines.join('\n')
}

export function generatePayrollCSV(users: ExportUser[], sessions: WorkSession[], baseRules: RulesConfig): string {
  const header = ['user', 'regular_hours', 'overtime_hours', 'double_time_hours', 'holiday_hours', 'holiday_credit_hours', 'regular_pay', 'overtime_pay', 'double_time_pay', 'holiday_extra_pay', 'total_pay']
  const lines: string[] = []
  lines.push(header.join(','))
  for (const u of users) {
    const sForUser = sessions.filter((s) => s.userId === u.id)
    const userRules = mergeRules(baseRules, u.terms)
    const pay = summarizePayWeek(sForUser, userRules)
    lines.push([
      u.name,
      pay.regularHours.toFixed(2),
      pay.overtimeHours.toFixed(2),
      pay.doubleTimeHours.toFixed(2),
      pay.holidayHours.toFixed(2),
      pay.holidayCreditHours.toFixed(2),
      pay.regularPay.toFixed(2),
      pay.overtimePay.toFixed(2),
      pay.doubleTimePay.toFixed(2),
      pay.holidayExtraPay.toFixed(2),
      pay.totalPay.toFixed(2),
    ].join(','))
  }
  return lines.join('\n')
}
