import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  SafeAreaView,
  FlatList,
  TextInput,
  Alert,
  Platform,
  ScrollView,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { defaultRules } from './src/config/rules'
import { DaySummary, WorkSession, summarizeDay, summarizeWeek, toYMD, PaySummary, summarizePayWeek, RulesConfig, RulesOverride, hoursBetween, getWeekDays, dayBreakdown, DayBreakdown, mergeRules } from './src/utils/time'
import { generateTimesheetCSV, generatePayrollCSV } from './src/utils/export'

const STORAGE_KEY_SESSIONS = 'babylon.sessions'
const STORAGE_KEY_ACTIVE = 'babylon.activeSession'
const STORAGE_KEY_RULES = 'babylon.rules'
const STORAGE_KEY_AUTH = 'babylon.auth'
const STORAGE_KEY_USERS = 'babylon.users'

type Role = 'user' | 'admin'
type AuthState = { role: Role; userId?: string } | null
type User = {
  id: string
  empNo?: string
  name: string
  username?: string
  role: Role
  manager?: string
  status?: 'active' | 'inactive'
  code?: string
  terms?: RulesOverride
}

export default function App() {
  const [sessions, setSessions] = useState<WorkSession[]>([])
  const [active, setActive] = useState<WorkSession | null>(null)
  const [todaySummary, setTodaySummary] = useState<DaySummary | null>(null)
  const [rules, setRules] = useState<RulesConfig>(defaultRules)
  const [auth, setAuth] = useState<AuthState>(null)
  const [users, setUsers] = useState<User[]>([])
  const sessionsForCurrentUser = useMemo(
    () => (auth?.role === 'user' && auth.userId ? sessions.filter((s) => s.userId === auth.userId) : sessions),
    [sessions, auth],
  )
  const resolveRulesForUser = useCallback(
    (userId?: string | null) => {
      if (!userId) return rules
      const user = users.find((u) => u.id === userId)
      return mergeRules(rules, user?.terms)
    },
    [rules, users],
  )
  const viewerRules = useMemo(() => (auth?.role === 'user' ? resolveRulesForUser(auth.userId) : rules), [auth, resolveRulesForUser, rules])
  const weekSummary = useMemo(() => summarizeWeek(sessionsForCurrentUser, viewerRules), [sessionsForCurrentUser, viewerRules])
  const paySummary: PaySummary = useMemo(() => summarizePayWeek(sessionsForCurrentUser, viewerRules), [sessionsForCurrentUser, viewerRules])
  const [tab, setTab] = useState<'dashboard' | 'schedule' | 'settings' | 'myteam' | 'directory' | 'whosin' | 'pto' | 'timecards'>('dashboard')

  useEffect(() => {
    ;(async () => {
      try {
        const s = await AsyncStorage.getItem(STORAGE_KEY_SESSIONS)
        const a = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE)
        const r = await AsyncStorage.getItem(STORAGE_KEY_RULES)
        const au = await AsyncStorage.getItem(STORAGE_KEY_AUTH)
        const us = await AsyncStorage.getItem(STORAGE_KEY_USERS)
        setSessions(s ? JSON.parse(s) : [])
        setActive(a ? JSON.parse(a) : null)
        setRules(r ? normalizeRules(JSON.parse(r)) : defaultRules)
        setAuth(au ? JSON.parse(au) : null)
        const defaultUsers: User[] = [
          { id: 'admin-1', empNo: '0001', name: 'Lei, Nicky', username: 'nicky.lei', role: 'admin', status: 'active' },
          { id: 'u-9016', empNo: '9016', name: 'Acevedo, Elkin', username: 'acevedoelkin764@gmail.com', role: 'user', manager: 'Lei, Nicky', status: 'active', code: 'EA' },
          { id: 'u-9017', empNo: '9017', name: 'Acevedo, Felipe', username: 'felipeacevedo142@gmail.com', role: 'user', manager: 'Lei, Nicky', status: 'active', code: 'FA' },
          { id: 'u-9002', empNo: '9002', name: 'Bonilla, Sandra', username: 'bonilla.sandra', role: 'user', manager: 'Lei, Nicky', status: 'active', code: 'SB' },
        ]
        setUsers(us ? JSON.parse(us) : defaultUsers)
        if (!us) await AsyncStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(defaultUsers))
      } catch (e) {
        setSessions([])
        setActive(null)
        setRules(defaultRules)
        setAuth(null)
        setUsers([])
      }
    })()
  }, [])

  useEffect(() => {
    const today = toYMD(new Date())
    setTodaySummary(summarizeDay(today, sessionsForCurrentUser, viewerRules))
    globalSessionsRef.sessions = sessionsForCurrentUser
    globalSessionsRef.rules = rules
    globalSessionsRefAll.sessions = sessions
    globalSessionsRefAll.rules = rules
    globalUsersRef.users = users
  }, [sessions, sessionsForCurrentUser, users, active, rules, viewerRules])

  async function checkIn() {
    if (active) return
    if (auth?.role !== 'user' || !auth.userId) return
    const now = new Date().toISOString()
    const newActive: WorkSession = {
      id: `${Date.now()}`,
      userId: auth.userId,
      checkIn: now,
    }
    try {
      setActive(newActive)
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(newActive))
    } catch (e) {}
  }

  async function checkOut() {
    if (!active) return
    const now = new Date().toISOString()
    const completed: WorkSession = { ...active, checkOut: now }
    const newSessions = [completed, ...sessions]
    try {
      setSessions(newSessions)
      setActive(null)
      await AsyncStorage.multiSet([
        [STORAGE_KEY_SESSIONS, JSON.stringify(newSessions)],
        [STORAGE_KEY_ACTIVE, JSON.stringify(null)],
      ])
    } catch (e) {}
  }

  function renderSession(item: WorkSession) {
    const date = toYMD(new Date(item.checkIn))
    const sum = summarizeDay(date, [item], resolveRulesForUser(item.userId))
    return (
      <View style={styles.sessionRow}>
        <Text style={styles.sessionDate}>{date}</Text>
        <Text style={styles.sessionHours}>{sum.totalHours.toFixed(2)}h</Text>
        {sum.isHoliday && <Text style={styles.badgeHoliday}>Holiday</Text>}
        {sum.isEarlyCheckout && <Text style={styles.badgeEarly}>Early</Text>}
      </View>
    )
  }

  const isHolidayToday = todaySummary?.isHoliday
  const checkedIn = !!active && (!!auth?.userId ? active.userId === auth.userId : true)
  const isAdmin = auth?.role === 'admin'
  const currentTab = isAdmin ? tab : 'dashboard'

  useEffect(() => {
    if (!isAdmin && tab !== 'dashboard') {
      setTab('dashboard')
    }
  }, [isAdmin, tab])

  async function loginAs(role: Role) {
    const next: AuthState = { role }
    setAuth(next)
    await AsyncStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(next))
  }
  async function loginAsUser(userId: string) {
    const next: AuthState = { role: 'user', userId }
    setAuth(next)
    await AsyncStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(next))
  }

  async function logout() {
    setAuth(null)
    await AsyncStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(null))
  }

  function SettingsView() {
    const [hourlyRateInput, setHourlyRateInput] = useState(String(rules.hourlyRate))
    const [expectedDailyHoursInput, setExpectedDailyHoursInput] = useState(String(rules.expectedDailyHours))
    const [weeklyThresholdInput, setWeeklyThresholdInput] = useState(String(rules.overtimeWeeklyThresholdHours))
    const [dailyOTThresholdInput, setDailyOTThresholdInput] = useState(String(rules.dailyOvertimeThresholdHours))
    const [doubleTimeThresholdInput, setDoubleTimeThresholdInput] = useState(String(rules.doubleTimeDailyThresholdHours))
    const [otMultInput, setOtMultInput] = useState(String(rules.overtimeMultiplier))
    const [doubleTimeMultInput, setDoubleTimeMultInput] = useState(String(rules.doubleTimeMultiplier))
    const [holidayMultInput, setHolidayMultInput] = useState(String(rules.holidayMultiplier))
    const [holidayCreditHoursInput, setHolidayCreditHoursInput] = useState(String(rules.holidayPaidHoursCredit))
    const [holidayNew, setHolidayNew] = useState('')

    async function saveRules() {
      const next: RulesConfig = {
        hourlyRate: Number(hourlyRateInput) || rules.hourlyRate,
        expectedDailyHours: Number(expectedDailyHoursInput) || rules.expectedDailyHours,
        overtimeWeeklyThresholdHours: Number(weeklyThresholdInput) || rules.overtimeWeeklyThresholdHours,
        dailyOvertimeThresholdHours: Number(dailyOTThresholdInput) || rules.dailyOvertimeThresholdHours,
        doubleTimeDailyThresholdHours: Number(doubleTimeThresholdInput) || rules.doubleTimeDailyThresholdHours,
        overtimeMultiplier: Number(otMultInput) || rules.overtimeMultiplier,
        doubleTimeMultiplier: Number(doubleTimeMultInput) || rules.doubleTimeMultiplier,
        holidayMultiplier: Number(holidayMultInput) || rules.holidayMultiplier,
        holidayPaidHoursCredit: Number(holidayCreditHoursInput) || rules.holidayPaidHoursCredit,
        holidays: rules.holidays ?? [],
      }
      const normalized = normalizeRules(next)
      setRules(normalized)
      await AsyncStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(normalized))
    }

    async function addHoliday() {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayNew)) return
      const base = rules.holidays ?? []
      const list = Array.from(new Set([holidayNew, ...base])).sort()
      const next = normalizeRules({ ...rules, holidays: list })
      setRules(next)
      setHolidayNew('')
      await AsyncStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(next))
    }

    async function removeHoliday(date: string) {
      const base = rules.holidays ?? []
      const list = base.filter((d) => d !== date)
      const next = normalizeRules({ ...rules, holidays: list })
      setRules(next)
      await AsyncStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(next))
    }

    const holidays = rules.holidays ?? []

    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Pay &amp; Overtime Rules</Text>
          <Text style={styles.cardSubtitle}>Update base pay, overtime multipliers, and automatic credits.</Text>
          <View style={styles.formGrid}>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Hourly Rate</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={hourlyRateInput} onChangeText={setHourlyRateInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Expected Daily Hours</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={expectedDailyHoursInput} onChangeText={setExpectedDailyHoursInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Weekly OT Threshold</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={weeklyThresholdInput} onChangeText={setWeeklyThresholdInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Daily OT Threshold</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={dailyOTThresholdInput} onChangeText={setDailyOTThresholdInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Double-Time Threshold</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={doubleTimeThresholdInput} onChangeText={setDoubleTimeThresholdInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>OT Multiplier</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={otMultInput} onChangeText={setOtMultInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Double-Time Multiplier</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={doubleTimeMultInput} onChangeText={setDoubleTimeMultInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Holiday Multiplier</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={holidayMultInput} onChangeText={setHolidayMultInput} />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Holiday Credit Hours</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={holidayCreditHoursInput} onChangeText={setHolidayCreditHoursInput} />
            </View>
          </View>
          <View style={styles.cardActions}>
            <Pressable style={styles.btnCheckin} onPress={saveRules}>
              <Text style={styles.btnText}>Save Rules</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Company Holidays</Text>
          <Text style={styles.cardSubtitle}>Share the dates your team should plan around.</Text>
          <View style={styles.formRow}>
            <TextInput style={[styles.formInput, styles.holidayInput]} placeholder="YYYY-MM-DD" value={holidayNew} onChangeText={setHolidayNew} />
            <Pressable style={styles.outlineBtn} onPress={addHoliday}>
              <Text style={styles.outlineBtnText}>Add</Text>
            </Pressable>
          </View>
          <View style={styles.holidayList}>
            {holidays.map((d) => (
              <View key={d} style={styles.holidayRow}>
                <Text style={styles.holidayText}>{d}</Text>
                <Pressable style={styles.linkBtn} onPress={() => removeHoliday(d)}>
                  <Text style={styles.linkBtnText}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>


      </View>
    )
  }

  function ScheduleView() {
    const weekDays = getWeekDays()
    const schedule = weekDays.map((date) => ({
      date,
      shift: 'Unassigned',
      location: 'Select job site',
      note: 'Tap assign to build schedule',
    }))
    const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Weekly Schedule</Text>
          <Text style={styles.cardSubtitle}>Publish shifts and keep everyone aligned.</Text>
          <View style={styles.scheduleActions}>
            <Pressable style={[styles.btnCheckin, styles.scheduleActionSpacer]}>
              <Text style={styles.btnText}>Publish Week</Text>
            </Pressable>
            <Pressable style={styles.outlineBtn}>
              <Text style={styles.outlineBtnText}>Share to Team</Text>
            </Pressable>
          </View>
          <View>
            {schedule.map((entry) => (
              <View key={entry.date} style={styles.scheduleRow}>
                <View style={styles.scheduleDate}>
                  <Text style={styles.scheduleDay}>{formatDate(entry.date)}</Text>
                  <Text style={styles.scheduleMeta}>{entry.note}</Text>
                </View>
                <View style={styles.scheduleDetails}>
                  <Text style={styles.scheduleShift}>{entry.shift}</Text>
                  <Text style={styles.scheduleMeta}>{entry.location}</Text>
                </View>
                <Pressable style={styles.scheduleAssignBtn}>
                  <Text style={styles.scheduleAssignText}>Assign</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </View>
    )
  }

  function AdminView() {
    const employeeCount = users.filter((u) => u.role === 'user').length
    const activeEmployees = users.filter((u) => u.status !== 'inactive' && u.role === 'user').length
    const openPunches = sessions.filter((s) => !s.checkOut).length
    const recentPunches = sessions.slice(0, 5)
    return (
      <View style={styles.settingsContainer}>
        <View style={styles.cardGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Employees</Text>
            <Text style={styles.statValue}>{employeeCount}</Text>
            <Text style={styles.statMeta}>{activeEmployees} active</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Overtime</Text>
            <Text style={styles.statValue}>{weekSummary.overtimeHours.toFixed(1)}h</Text>
            <Text style={styles.statMeta}>Week-to-date</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>On the Clock</Text>
            <Text style={styles.statValue}>{openPunches}</Text>
            <Text style={styles.statMeta}>Live punches</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Payroll</Text>
            <Text style={styles.statValue}>${paySummary.totalPay.toFixed(0)}</Text>
            <Text style={styles.statMeta}>Projected</Text>
          </View>
        </View>

        <View style={styles.contentCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Live Punch Feed</Text>
              <Text style={styles.cardSubtitle}>Monitor who is currently working.</Text>
            </View>
            <Pressable style={styles.outlineBtn} onPress={exportPayrollCSV}>
              <Text style={styles.outlineBtnText}>Export Payroll</Text>
            </Pressable>
          </View>
          {openPunches === 0 && recentPunches.length === 0 ? (
            <Text style={styles.subBrand}>No punches yet this week.</Text>
          ) : (
            <>
              {openPunches === 0 ? (
                <Text style={styles.subBrand}>Nobody is clocked in right now.</Text>
              ) : (
                sessions
                  .filter((s) => !s.checkOut)
                  .map((s) => {
                    const u = users.find((x) => x.id === s.userId)
                    return (
                      <View key={`open-${s.id}`} style={styles.activityRow}>
                        <View>
                          <Text style={styles.activityName}>{u?.name || s.userId}</Text>
                          <Text style={styles.activityMeta}>Clocked in {new Date(s.checkIn).toLocaleTimeString()}</Text>
                        </View>
                        <Text style={styles.activityBadge}>IN</Text>
                      </View>
                    )
                  })
              )}
              {recentPunches.map((s) => {
                const u = users.find((x) => x.id === s.userId)
                return (
                  <View key={s.id} style={styles.activityRow}>
                    <View>
                      <Text style={styles.activityName}>{u?.name || s.userId}</Text>
                      <Text style={styles.activityMeta}>{toYMD(new Date(s.checkIn))}</Text>
                    </View>
                    <Text style={styles.activityValue}>{hoursBetween(s.checkIn, s.checkOut).toFixed(2)}h</Text>
                  </View>
                )
              })}
            </>
          )}
        </View>
      </View>
    )
  }

  function AdminSettingsTab() {
    return (
      <View style={styles.settingsContainer}>
        <SettingsView />
        <EmployeeOverrideCard />
      </View>
    )
  }

  function EmployeeOverrideCard() {
    const employeeOptions = users.filter((u) => u.role === 'user')
    const [selectedPayUserId, setSelectedPayUserId] = useState<string>(employeeOptions[0]?.id ?? '')
    const [overrideHourly, setOverrideHourly] = useState('')
    const [overrideExpectedDaily, setOverrideExpectedDaily] = useState('')
    const [overrideWeeklyOT, setOverrideWeeklyOT] = useState('')
    const [overrideDailyOT, setOverrideDailyOT] = useState('')
    const [overrideDoubleThreshold, setOverrideDoubleThreshold] = useState('')
    const [overrideOTMultiplier, setOverrideOTMultiplier] = useState('')
    const [overrideDoubleMultiplier, setOverrideDoubleMultiplier] = useState('')
    const [overrideHolidayMultiplier, setOverrideHolidayMultiplier] = useState('')
    const [overrideHolidayCredit, setOverrideHolidayCredit] = useState('')

    useEffect(() => {
      if (employeeOptions.length === 0) {
        setSelectedPayUserId('')
        return
      }
      if (!selectedPayUserId || !employeeOptions.some((u) => u.id === selectedPayUserId)) {
        setSelectedPayUserId(employeeOptions[0].id)
      }
    }, [employeeOptions, selectedPayUserId])

    const selectedPayUser = employeeOptions.find((u) => u.id === selectedPayUserId)

    useEffect(() => {
      if (!selectedPayUser) {
        setOverrideHourly('')
        setOverrideExpectedDaily('')
        setOverrideWeeklyOT('')
        setOverrideDailyOT('')
        setOverrideDoubleThreshold('')
        setOverrideOTMultiplier('')
        setOverrideDoubleMultiplier('')
        setOverrideHolidayMultiplier('')
        setOverrideHolidayCredit('')
        return
      }
      const t = selectedPayUser.terms || {}
      setOverrideHourly(t.hourlyRate !== undefined ? String(t.hourlyRate) : '')
      setOverrideExpectedDaily(t.expectedDailyHours !== undefined ? String(t.expectedDailyHours) : '')
      setOverrideWeeklyOT(t.overtimeWeeklyThresholdHours !== undefined ? String(t.overtimeWeeklyThresholdHours) : '')
      setOverrideDailyOT(t.dailyOvertimeThresholdHours !== undefined ? String(t.dailyOvertimeThresholdHours) : '')
      setOverrideDoubleThreshold(t.doubleTimeDailyThresholdHours !== undefined ? String(t.doubleTimeDailyThresholdHours) : '')
      setOverrideOTMultiplier(t.overtimeMultiplier !== undefined ? String(t.overtimeMultiplier) : '')
      setOverrideDoubleMultiplier(t.doubleTimeMultiplier !== undefined ? String(t.doubleTimeMultiplier) : '')
      setOverrideHolidayMultiplier(t.holidayMultiplier !== undefined ? String(t.holidayMultiplier) : '')
      setOverrideHolidayCredit(t.holidayPaidHoursCredit !== undefined ? String(t.holidayPaidHoursCredit) : '')
    }, [selectedPayUser])

    const parseOverride = (value: string) => {
      if (!value.trim()) return undefined
      const num = Number(value)
      return Number.isFinite(num) ? num : undefined
    }

    async function saveUserOverrides() {
      if (!selectedPayUser) return
      const overrides: RulesOverride = {}
      const maybeSet = (key: keyof RulesOverride, value: string) => {
        const parsed = parseOverride(value)
        if (parsed !== undefined) {
          overrides[key] = parsed as any
        }
      }
      maybeSet('hourlyRate', overrideHourly)
      maybeSet('expectedDailyHours', overrideExpectedDaily)
      maybeSet('overtimeWeeklyThresholdHours', overrideWeeklyOT)
      maybeSet('dailyOvertimeThresholdHours', overrideDailyOT)
      maybeSet('doubleTimeDailyThresholdHours', overrideDoubleThreshold)
      maybeSet('overtimeMultiplier', overrideOTMultiplier)
      maybeSet('doubleTimeMultiplier', overrideDoubleMultiplier)
      maybeSet('holidayMultiplier', overrideHolidayMultiplier)
      maybeSet('holidayPaidHoursCredit', overrideHolidayCredit)
      const cleaned = Object.keys(overrides).length ? overrides : undefined
      const updatedUser = { ...selectedPayUser, terms: cleaned }
      const nextUsers = users.map((u) => (u.id === updatedUser.id ? updatedUser : u))
      setUsers(nextUsers)
      await AsyncStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(nextUsers))
    }

    async function clearUserOverrides() {
      if (!selectedPayUser) return
      const updatedUser = { ...selectedPayUser, terms: undefined }
      const nextUsers = users.map((u) => (u.id === updatedUser.id ? updatedUser : u))
      setUsers(nextUsers)
      await AsyncStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(nextUsers))
      setOverrideHourly('')
      setOverrideExpectedDaily('')
      setOverrideWeeklyOT('')
      setOverrideDailyOT('')
      setOverrideDoubleThreshold('')
      setOverrideOTMultiplier('')
      setOverrideDoubleMultiplier('')
      setOverrideHolidayMultiplier('')
      setOverrideHolidayCredit('')
    }

    return (
      <View style={styles.contentCard}>
        <Text style={styles.cardTitle}>Employee Pay Overrides</Text>
        <Text style={styles.cardSubtitle}>Fine-tune hourly rates and overtime logic for a specific employee.</Text>
        {employeeOptions.length === 0 ? (
          <Text style={styles.subBrand}>Add an employee to begin configuring overrides.</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {employeeOptions.map((item) => (
                  <Pressable key={item.id} style={[styles.chip, item.id === selectedPayUserId && styles.chipActive]} onPress={() => setSelectedPayUserId(item.id)}>
                    <Text style={[styles.chipText, item.id === selectedPayUserId && styles.chipTextActive]}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <View style={styles.formGrid}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Hourly Rate</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideHourly} onChangeText={setOverrideHourly} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Expected Daily Hours</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideExpectedDaily} onChangeText={setOverrideExpectedDaily} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Weekly OT Threshold</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideWeeklyOT} onChangeText={setOverrideWeeklyOT} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Daily OT Threshold</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideDailyOT} onChangeText={setOverrideDailyOT} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Double-Time Threshold</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideDoubleThreshold} onChangeText={setOverrideDoubleThreshold} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>OT Multiplier</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideOTMultiplier} onChangeText={setOverrideOTMultiplier} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Double-Time Multiplier</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideDoubleMultiplier} onChangeText={setOverrideDoubleMultiplier} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Holiday Multiplier</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideHolidayMultiplier} onChangeText={setOverrideHolidayMultiplier} placeholder="Company default" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Holiday Credit Hours</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={overrideHolidayCredit} onChangeText={setOverrideHolidayCredit} placeholder="Company default" />
              </View>
            </View>
            <View style={styles.addUserActions}>
              <Pressable style={[styles.outlineBtn, styles.addUserActionSpacer]} onPress={clearUserOverrides}>
                <Text style={styles.outlineBtnText}>Reset to company rules</Text>
              </Pressable>
              <Pressable style={styles.btnCheckin} onPress={saveUserOverrides}>
                <Text style={styles.btnText}>Save Overrides</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    )
  }

  function WhosInView() {
    const [query, setQuery] = useState('')
    const activeUsers = [] as { name: string; inTime?: string }[]
    if (active) {
      const u = users.find((x) => x.id === active.userId)
      activeUsers.push({ name: u?.name || active.userId, inTime: active.checkIn })
    }
    const openSessions = sessions.filter((s) => !s.checkOut)
    for (const s of openSessions) {
      const u = users.find((x) => x.id === s.userId)
      activeUsers.push({ name: u?.name || s.userId, inTime: s.checkIn })
    }
    const filtered = activeUsers.filter((x) => x.name.toLowerCase().includes(query.toLowerCase()))
    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Who's In</Text>
          <Text style={styles.cardSubtitle}>Live list of employees currently on the clock.</Text>
          <View style={styles.formRow}>
            <TextInput style={styles.formInput} placeholder="Search employees..." value={query} onChangeText={setQuery} />
          </View>
          {filtered.length === 0 ? (
            <Text style={styles.subBrand}>No one is currently in.</Text>
          ) : (
            filtered.map((x, idx) => (
              <View key={`${x.name}-${idx}`} style={styles.activityRow}>
                <View>
                  <Text style={styles.activityName}>{x.name}</Text>
                  <Text style={styles.activityMeta}>{x.inTime ? new Date(x.inTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</Text>
                </View>
                <Text style={styles.activityBadge}>IN</Text>
              </View>
            ))
          )}
        </View>
      </View>
    )
  }

  function PTOView() {
    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Paid Time Off</Text>
          <Text style={styles.cardSubtitle}>Track balances, approve requests, and communicate blackout dates.</Text>
          <View style={styles.ptoGrid}>
            <View style={styles.ptoCard}>
              <Text style={styles.statLabel}>Requests</Text>
              <Text style={styles.statValue}>0</Text>
              <Text style={styles.statMeta}>Pending approval</Text>
            </View>
            <View style={styles.ptoCard}>
              <Text style={styles.statLabel}>Balances</Text>
              <Text style={styles.statValue}>Coming soon</Text>
              <Text style={styles.statMeta}>Sync payroll to enable</Text>
            </View>
          </View>
          <Text style={styles.subBrand}>Automated PTO workflows are in development.</Text>
        </View>
      </View>
    )
  }

  function TimeCardsView() {
    const defaultUser = users.find((u) => u.role === 'user')
    const initialSelection = auth?.role === 'user' ? auth.userId || defaultUser?.id || '' : defaultUser?.id || ''
    const [selectedUserId, setSelectedUserId] = useState(initialSelection)
    const weekDays = getWeekDays()
    const userSessions: WorkSession[] = sessions.filter((s) => s.userId === selectedUserId)
    const currentRules = resolveRulesForUser(selectedUserId)
    const rows: DayBreakdown[] = weekDays.map((d) => dayBreakdown(d, userSessions, currentRules))
    const totals = rows.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        reg: acc.reg + r.reg,
        ot1: acc.ot1 + r.ot1,
        ot2: acc.ot2 + r.ot2,
        ot3: acc.ot3 + r.ot3,
        vac: acc.vac + r.vac,
        hol: acc.hol + r.hol,
        sic: acc.sic + r.sic,
        per: acc.per + r.per,
        pbr: acc.pbr + r.pbr,
        ubr: acc.ubr + r.ubr,
      }),
      { total: 0, reg: 0, ot1: 0, ot2: 0, ot3: 0, vac: 0, hol: 0, sic: 0, per: 0, pbr: 0, ubr: 0 },
    )
    const dayName = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso).getDay()]
    const user = users.find((u) => u.id === selectedUserId)
    const formatHours = (value: number) => value.toFixed(2)
    const formatDate = (iso: string) => `${dayName(iso)} ${new Date(iso).toLocaleDateString()}`
    const formatTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')
    type Column = { key: string; label: string; width: number; footer?: string; render: (row: DayBreakdown) => string }
    const columns: Column[] = useMemo(
      () => [
        { key: 'date', label: 'Date', width: 180, render: (row) => formatDate(row.date), footer: 'Totals' },
        { key: 'total', label: 'TOTAL', width: 90, render: (row) => formatHours(row.total), footer: formatHours(totals.total) },
        { key: 'reg', label: 'REG', width: 90, render: (row) => formatHours(row.reg), footer: formatHours(totals.reg) },
        { key: 'ot1', label: 'OT1', width: 90, render: (row) => formatHours(row.ot1), footer: formatHours(totals.ot1) },
        { key: 'ot2', label: 'OT2', width: 90, render: (row) => formatHours(row.ot2), footer: formatHours(totals.ot2) },
        { key: 'ot3', label: 'OT3', width: 90, render: (row) => formatHours(row.ot3), footer: formatHours(totals.ot3) },
        { key: 'vac', label: 'VAC', width: 90, render: (row) => formatHours(row.vac), footer: formatHours(totals.vac) },
        { key: 'hol', label: 'HOL', width: 90, render: (row) => formatHours(row.hol), footer: formatHours(totals.hol) },
        { key: 'sic', label: 'SIC', width: 90, render: (row) => formatHours(row.sic), footer: formatHours(totals.sic) },
        { key: 'per', label: 'PER', width: 90, render: (row) => formatHours(row.per), footer: formatHours(totals.per) },
        { key: 'pbr', label: 'PBR', width: 90, render: (row) => formatHours(row.pbr), footer: formatHours(totals.pbr) },
        { key: 'ubr', label: 'UBR', width: 90, render: (row) => formatHours(row.ubr), footer: formatHours(totals.ubr) },
        { key: 'in', label: 'IN', width: 110, render: (row) => formatTime(row.in) },
        { key: 'out', label: 'OUT', width: 110, render: (row) => formatTime(row.out) },
        { key: 'mileage', label: 'Mileage', width: 110, render: () => '0.00', footer: '0.00' },
      ],
      [totals],
    )
    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Time Cards</Text>
              <Text style={styles.cardSubtitle}>Weekly breakdown of hours, premiums, and punches.</Text>
            </View>
            <Pressable style={styles.outlineBtn} onPress={exportCSV}>
              <Text style={styles.outlineBtnText}>Export CSV</Text>
            </Pressable>
          </View>
          <View style={styles.employeeFilterRow}>
            <Text style={styles.formLabel}>Employee</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {users
                  .filter((u) => u.role === 'user')
                  .map((item) => (
                    <Pressable key={item.id} style={[styles.chip, item.id === selectedUserId && styles.chipActive]} onPress={() => setSelectedUserId(item.id)}>
                      <Text style={[styles.chipText, item.id === selectedUserId && styles.chipTextActive]}>{item.name}</Text>
                    </Pressable>
                  ))}
              </View>
            </ScrollView>
          </View>
          <View style={styles.tableMetaRow}>
            <Text style={styles.subBrand}>{user ? `${user.name} (${user.code || user.empNo || 'ID'})` : 'Select a user to view the breakdown'}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
            <View style={styles.timecardTable}>
              <View style={styles.tableHeaderRow}>
                {columns.map((col) => (
                  <Text key={col.key} style={[styles.tableHeaderCell, { width: col.width }, col.key === 'date' && styles.tableDateCell]}>{col.label}</Text>
                ))}
              </View>
              {rows.map((r) => (
                <View key={r.date} style={styles.tableRow}>
                  {columns.map((col) => (
                    <Text key={`${r.date}-${col.key}`} style={[styles.tableCell, { width: col.width }, col.key === 'date' && styles.tableDateCell]}>{col.render(r)}</Text>
                  ))}
                </View>
              ))}
              <View style={[styles.tableRow, styles.tableTotalsRow]}>
                {columns.map((col) => (
                  <Text
                    key={`totals-${col.key}`}
                    style={[
                      styles.tableCell,
                      { width: col.width },
                      col.key === 'date' ? styles.tableTotalsLabel : undefined,
                      col.key === 'date' && styles.tableDateCell,
                    ]}
                  >
                    {col.footer || ''}
                  </Text>
                ))}
              </View>
            </View>
          </ScrollView>
          <View style={styles.signatureBlock}>
            <Text style={styles.listTitle}>Employee Signature</Text>
            <Text style={styles.subBrand}>I agree that this timecard is accurate and I have taken all required breaks.</Text>
          </View>
        </View>
      </View>
    )
  }

  function TeamDirectoryView() {
    const [query, setQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState<'All' | 'Employee' | 'Admin'>('All')
    const [statusFilter, setStatusFilter] = useState<'Active' | 'Inactive' | 'All'>('Active')
    const [managerFilter, setManagerFilter] = useState<string>('All')
    const managers = Array.from(new Set(users.map((u) => u.manager).filter(Boolean))) as string[]
    const roleLabel = (u: User) => (u.role === 'user' ? 'Employee' : 'Admin')
    const statusValue = (u: User) => u.status || 'active'
    const filtered = users.filter((u) => {
      const matchesQuery = [u.name, u.username, u.empNo].filter(Boolean).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
      const matchesRole = roleFilter === 'All' || roleLabel(u) === roleFilter
      const matchesManager = managerFilter === 'All' || u.manager === managerFilter
      const matchesStatus = statusFilter === 'All' || statusValue(u).toLowerCase() === statusFilter.toLowerCase()
      return matchesQuery && matchesRole && matchesManager && matchesStatus
    })
    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Team Directory</Text>
          <Text style={styles.cardSubtitle}>Search, filter, and audit your people data.</Text>
          <View style={styles.directoryRow}>
            <TextInput style={styles.dirInput} placeholder="Search employees..." value={query} onChangeText={setQuery} placeholderTextColor="#6B7280" />
          </View>
          <View style={styles.directoryFilters}>
            <View style={styles.directoryFilterGroup}>
              <Text style={styles.dirLabel}>Roles</Text>
              <View style={styles.dirFilterButtons}>
                {['All', 'Employee', 'Admin'].map((r) => (
                  <Pressable key={r} style={[styles.dirBtn, roleFilter === r ? styles.dirBtnActive : undefined]} onPress={() => setRoleFilter(r as any)}>
                    <Text style={styles.dirBtnText}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.directoryFilterGroup}>
              <Text style={styles.dirLabel}>Manager</Text>
              <View style={styles.dirFilterButtons}>
                <Pressable style={[styles.dirBtn, managerFilter === 'All' ? styles.dirBtnActive : undefined]} onPress={() => setManagerFilter('All')}>
                  <Text style={styles.dirBtnText}>All</Text>
                </Pressable>
                {managers.map((m) => (
                  <Pressable key={m} style={[styles.dirBtn, managerFilter === m ? styles.dirBtnActive : undefined]} onPress={() => setManagerFilter(m)}>
                    <Text style={styles.dirBtnText}>{m}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.directoryFilterGroup}>
              <Text style={styles.dirLabel}>Status</Text>
              <View style={styles.dirFilterButtons}>
                {['Active', 'Inactive', 'All'].map((s) => (
                  <Pressable key={s} style={[styles.dirBtn, statusFilter === s ? styles.dirBtnActive : undefined]} onPress={() => setStatusFilter(s as any)}>
                    <Text style={styles.dirBtnText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.directoryTableScroll}>
            <View>
              <View style={styles.directoryTableHeader}>
                <Text style={styles.dirHeaderCell}>Emp #</Text>
                <Text style={styles.dirHeaderCell}>Name</Text>
                <Text style={styles.dirHeaderCell}>Username</Text>
                <Text style={styles.dirHeaderCell}>Role</Text>
                <Text style={styles.dirHeaderCell}>Manager</Text>
                <Text style={styles.dirHeaderCell}>Code</Text>
              </View>
              {filtered.map((u) => (
                <View key={u.id} style={styles.directoryTableRow}>
                  <Text style={styles.dirCell}>{u.empNo || ''}</Text>
                  <Text style={styles.dirCell}>{u.name}</Text>
                  <Text style={styles.dirCell}>{u.username || ''}</Text>
                  <Text style={styles.dirCell}>{roleLabel(u)}</Text>
                  <Text style={styles.dirCell}>{u.manager || ''}</Text>
                  <Text style={styles.dirCell}>{u.code || ''}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    )
  }

  if (!auth) {
    return <LoginView users={users} onAdminLogin={() => loginAs('admin')} onUserLogin={loginAsUser} />
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.navBar}>
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>BT</Text>
          </View>
          <View>
            <Text style={styles.brand}>Babylon Tracker</Text>
            <Text style={styles.subBrand}>Time, Overtime, and Attendance</Text>
          </View>
        </View>
        <View style={styles.navActions}>
          <Text style={styles.navRole}>Role: {auth.role}</Text>
          <Pressable style={styles.navLogout} onPress={logout}>
            <Text style={styles.btnText}>Logout</Text>
          </Pressable>
        </View>
      </View>

        <View style={styles.navTabsBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navTabsScroll}>
            <View style={styles.tabsRow}>
            <Pressable style={[styles.tabBtn, currentTab === 'dashboard' ? styles.tabActive : undefined]} onPress={() => setTab('dashboard')}>
              <Text style={styles.tabText}>Dashboard</Text>
            </Pressable>
          {isAdmin && (
            <Pressable style={[styles.tabBtn, currentTab === 'settings' ? styles.tabActive : undefined]} onPress={() => setTab('settings')}>
              <Text style={styles.tabText}>Settings</Text>
            </Pressable>
          )}
          {isAdmin && (
            <Pressable style={[styles.tabBtn, currentTab === 'schedule' ? styles.tabActive : undefined]} onPress={() => setTab('schedule')}>
              <Text style={styles.tabText}>Schedule</Text>
            </Pressable>
          )}
          {isAdmin && (
            <Pressable style={[styles.tabBtn, currentTab === 'myteam' ? styles.tabActive : undefined]} onPress={() => setTab('myteam')}>
              <Text style={styles.tabText}>My Team</Text>
            </Pressable>
          )}
          {isAdmin && (
            <Pressable style={[styles.tabBtn, currentTab === 'directory' ? styles.tabActive : undefined]} onPress={() => setTab('directory')}>
              <Text style={styles.tabText}>Team Directory</Text>
            </Pressable>
          )}
          {isAdmin && (
            <Pressable style={[styles.tabBtn, currentTab === 'whosin' ? styles.tabActive : undefined]} onPress={() => setTab('whosin')}>
              <Text style={styles.tabText}>Who's In</Text>
            </Pressable>
          )}
          {isAdmin && (
            <Pressable style={[styles.tabBtn, currentTab === 'pto' ? styles.tabActive : undefined]} onPress={() => setTab('pto')}>
              <Text style={styles.tabText}>PTO</Text>
            </Pressable>
          )}
          {isAdmin && (
            <Pressable style={[styles.tabBtn, currentTab === 'timecards' ? styles.tabActive : undefined]} onPress={() => setTab('timecards')}>
              <Text style={styles.tabText}>Time Cards</Text>
            </Pressable>
            )}
            </View>
          </ScrollView>
        </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {currentTab === 'dashboard' && (
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>
          {checkedIn ? 'On the clock' : 'Off the clock'}
        </Text>
        {isHolidayToday && (
          <Text style={styles.holidayNote}>Today is a holiday</Text>
        )}
        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Today</Text>
            <Text style={styles.metricValue}>
              {(todaySummary?.totalHours ?? 0).toFixed(2)}h
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Week</Text>
            <Text style={styles.metricValue}>{weekSummary.totalHours.toFixed(2)}h</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Overtime</Text>
            <Text style={styles.metricValue}>
              {weekSummary.overtimeHours.toFixed(2)}h
            </Text>
          </View>
          {isAdmin && (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Pay</Text>
              <Text style={styles.metricValue}>
                ${paySummary.totalPay.toFixed(2)}
              </Text>
            </View>
          )}
        </View>
      </View>
      )}

      {isAdmin && currentTab === 'dashboard' && (
        <View style={styles.statusCard}>
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Regular</Text>
              <Text style={styles.metricValue}>{paySummary.regularHours.toFixed(2)}h</Text>
              <Text style={styles.metricLabel}>${paySummary.regularPay.toFixed(2)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>OT</Text>
              <Text style={styles.metricValue}>{paySummary.overtimeHours.toFixed(2)}h</Text>
              <Text style={styles.metricLabel}>${paySummary.overtimePay.toFixed(2)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Double</Text>
              <Text style={styles.metricValue}>{paySummary.doubleTimeHours.toFixed(2)}h</Text>
              <Text style={styles.metricLabel}>${paySummary.doubleTimePay.toFixed(2)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Holiday</Text>
              <Text style={styles.metricValue}>{paySummary.holidayHours.toFixed(2)}h</Text>
              <Text style={styles.metricLabel}>+${paySummary.holidayExtraPay.toFixed(2)}</Text>
            </View>
          </View>
          <View style={styles.ctaRow}>
            <Pressable style={styles.btnCheckin} onPress={exportCSV}>
              <Text style={styles.btnText}>Export CSV</Text>
            </Pressable>
          </View>
        </View>
      )}

      {currentTab === 'dashboard' && (
      <View style={styles.ctaRow}>
        {checkedIn ? (
          <Pressable style={styles.btnCheckout} onPress={checkOut}>
            <Text style={styles.btnText}>Check Out</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.btnCheckin} onPress={checkIn}>
            <Text style={styles.btnText}>Check In</Text>
          </Pressable>
        )}
      </View>
      )}

      {currentTab === 'dashboard' ? (
        <>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Recent Sessions</Text>
          </View>
          <FlatList
            data={sessionsForCurrentUser}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderSession(item)}
            contentContainerStyle={styles.sessionsList}
          />
        </>
      ) : isAdmin && currentTab === 'settings' ? (
        <AdminSettingsTab />
      ) : isAdmin && currentTab === 'schedule' ? (
        <ScheduleView />
      ) : isAdmin && currentTab === 'myteam' ? (
        <AdminView />
      ) : isAdmin && currentTab === 'directory' ? (
        <TeamDirectoryView />
      ) : isAdmin && currentTab === 'whosin' ? (
        <WhosInView />
      ) : isAdmin && currentTab === 'pto' ? (
        <PTOView />
      ) : isAdmin && currentTab === 'timecards' ? (
        <TimeCardsView />
      ) : null}
      
      </ScrollView>
      <StatusBar style="light" />
    </SafeAreaView>
  )
}

type LoginViewProps = {
  users: User[]
  onAdminLogin: () => void
  onUserLogin: (userId: string) => void
}

function LoginView({ users, onAdminLogin, onUserLogin }: LoginViewProps) {
  const [mode, setMode] = useState<Role>('user')
  const userOptions = users.filter((u) => u.role === 'user')
  const [selectedUser, setSelectedUser] = useState<string | null>(userOptions[0]?.id ?? null)

  useEffect(() => {
    if (userOptions.length === 0) {
      setSelectedUser(null)
      return
    }
    if (!selectedUser || !userOptions.find((u) => u.id === selectedUser)) {
      setSelectedUser(userOptions[0].id)
    }
  }, [userOptions, selectedUser])

  return (
    <SafeAreaView style={styles.loginContainer}>
      <View style={styles.loginHero}>
        <Text style={styles.brand}>Babylon Tracker</Text>
        <Text style={styles.loginSubtitle}>Welcome back. Choose how you would like to sign in.</Text>
      </View>
      <View style={styles.loginCard}>
        <View style={styles.loginTabs}>
          <Pressable style={[styles.loginTab, mode === 'user' && styles.loginTabActive]} onPress={() => setMode('user')}>
            <Text style={[styles.loginTabText, mode === 'user' && styles.loginTabTextActive]}>Team member</Text>
          </Pressable>
          <Pressable style={[styles.loginTab, mode === 'admin' && styles.loginTabActive]} onPress={() => setMode('admin')}>
            <Text style={[styles.loginTabText, mode === 'admin' && styles.loginTabTextActive]}>Admin</Text>
          </Pressable>
        </View>
        {mode === 'user' ? (
          <View style={styles.loginSection}>
            <Text style={styles.loginSectionTitle}>Clock in as a team member</Text>
            <Text style={styles.loginSectionDesc}>Pick your profile to start tracking hours.</Text>
            <ScrollView style={styles.loginList}>
              {userOptions.map((u) => (
                <Pressable
                  key={u.id}
                  style={[styles.loginUserRow, selectedUser === u.id && styles.loginUserSelected]}
                  onPress={() => setSelectedUser(u.id)}
                >
                  <Text style={styles.loginUserName}>{u.name}</Text>
                  <Text style={styles.loginUserMeta}>{u.code || u.empNo || 'Team member'}</Text>
                </Pressable>
              ))}
              {userOptions.length === 0 && <Text style={styles.subBrand}>No team members yet. Admins can add users from the console.</Text>}
            </ScrollView>
            <Pressable
              style={[styles.btnCheckin, styles.loginPrimaryBtn, (!selectedUser || userOptions.length === 0) && styles.btnDisabled]}
              disabled={!selectedUser || userOptions.length === 0}
              onPress={() => selectedUser && onUserLogin(selectedUser)}
            >
              <Text style={styles.btnText}>Enter Workspace</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loginSection}>
            <Text style={styles.loginSectionTitle}>Admin Console</Text>
            <Text style={styles.loginSectionDesc}>Review attendance, configure pay terms, and manage the team directory.</Text>
            <Pressable style={[styles.btnCheckin, styles.loginPrimaryBtn]} onPress={onAdminLogin}>
              <Text style={styles.btnText}>Enter Admin Mode</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const colors = {
  brand: '#2ECC71',
  brandDark: '#27AE60',
  accent: '#3498DB',
  bg: '#FFFFFF',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  holiday: '#F59E0B',
  early: '#EF4444',
  white: '#FFFFFF',
  textDark: '#111827',
  dirPrimary: '#262661',
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: colors.card,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.dirPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logoBadgeText: {
    color: colors.white,
    fontWeight: '700',
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navRole: {
    color: colors.muted,
    marginRight: 12,
  },
  navLogout: {
    backgroundColor: colors.brandDark,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  navTabsBar: {
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: colors.card,
  },
  navTabsScroll: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  brand: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  subBrand: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4,
  },
  statusCard: {
    backgroundColor: colors.card,
    margin: 20,
    padding: 16,
    borderRadius: 12,
    borderColor: '#E5E7EB',
    borderWidth: 1,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  statusValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 4,
  },
  holidayNote: {
    color: colors.holiday,
    fontSize: 12,
    marginTop: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  metric: {
    flex: 1,
    marginRight: 20,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  metricValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 2,
  },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  tabBtn: {
    backgroundColor: colors.dirPrimary,
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#1b1b57',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  tabText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  loginContainer: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginHero: {
    alignItems: 'center',
    marginBottom: 20,
  },
  loginSubtitle: {
    color: colors.muted,
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  loginCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  loginTabs: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    padding: 4,
    marginBottom: 20,
  },
  loginTab: {
    flex: 1,
    height: 42,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginTabActive: {
    backgroundColor: colors.dirPrimary,
  },
  loginTabText: {
    color: colors.text,
    fontWeight: '600',
  },
  loginTabTextActive: {
    color: colors.white,
  },
  loginSection: {
    marginTop: 4,
  },
  loginSectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  loginSectionDesc: {
    color: colors.muted,
    fontSize: 14,
    marginBottom: 4,
  },
  loginList: {
    maxHeight: 220,
    marginVertical: 12,
  },
  loginUserRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
  },
  loginUserSelected: {
    borderColor: colors.dirPrimary,
    backgroundColor: '#EEF2FF',
  },
  loginUserName: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 16,
  },
  loginUserMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  loginPrimaryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
  },
  btnCheckin: {
    backgroundColor: colors.dirPrimary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
  },
  btnCheckout: {
    backgroundColor: colors.dirPrimary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
  },
  btnText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  listHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  listTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  tableMetaRow: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  tableScroll: {
    marginTop: 16,
    paddingHorizontal: 20,
  },
  timecardTable: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  tableHeaderCell: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: colors.textDark,
    fontWeight: '700',
    fontSize: 13,
    borderRightWidth: 1,
    borderColor: '#E5E7EB',
    textAlign: 'center',
  },
  tableCell: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 13,
    borderRightWidth: 1,
    borderColor: '#E5E7EB',
    textAlign: 'center',
  },
  tableDateCell: {
    textAlign: 'left',
  },
  tableTotalsRow: {
    backgroundColor: '#F9FAFB',
  },
  tableTotalsLabel: {
    fontWeight: '700',
  },
  employeeFilterRow: {
    marginTop: 8,
    paddingHorizontal: 20,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    backgroundColor: colors.white,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: {
    backgroundColor: colors.dirPrimary,
    borderColor: colors.dirPrimary,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  chipText: {
    color: colors.text,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.white,
  },
  addUserActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  addUserActionSpacer: {
    marginRight: 12,
  },
  sectionTitle: {
    marginTop: 16,
  },
  signatureBlock: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  directoryContainer: {
    backgroundColor: colors.white,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
  },
  directoryTitle: {
    color: colors.textDark,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  directorySubtitle: {
    color: '#374151',
    fontSize: 13,
    marginBottom: 12,
  },
  directoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  dirLabel: {
    color: colors.textDark,
    marginRight: 8,
  },
  dirInput: {
    flex: 1,
    color: colors.textDark,
    backgroundColor: colors.white,
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dirBtn: {
    backgroundColor: colors.dirPrimary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginRight: 8,
    marginTop: 6,
  },
  dirBtnActive: {
    backgroundColor: '#1b1b57',
  },
  dirBtnText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  directoryTableHeader: {
    flexDirection: 'row',
    borderColor: '#E5E7EB',
    borderBottomWidth: 1,
    paddingVertical: 8,
    marginTop: 8,
  },
  directoryTableRow: {
    flexDirection: 'row',
    borderColor: '#F3F4F6',
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  dirHeaderCell: {
    color: colors.textDark,
    width: 120,
    fontWeight: '700',
  },
  dirCell: {
    color: colors.textDark,
    width: 120,
  },
  settingsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  contentCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
    marginTop: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  cardActions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  formField: {
    width: '48%',
    marginBottom: 16,
  },
  formFieldFull: {
    width: '100%',
    marginBottom: 16,
  },
  holidayInput: {
    flex: 1,
    marginRight: 12,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: colors.dirPrimary,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  outlineBtnText: {
    color: colors.dirPrimary,
    fontWeight: '600',
  },
  holidayList: {
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
  },
  holidayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
  },
  holidayText: {
    color: colors.text,
    fontWeight: '600',
  },
  linkBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  linkBtnText: {
    color: colors.dirPrimary,
    fontWeight: '600',
  },
  scheduleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  scheduleActionSpacer: {
    marginRight: 12,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
    paddingVertical: 14,
  },
  scheduleDate: {
    flex: 1.2,
  },
  scheduleDay: {
    fontWeight: '600',
    color: colors.text,
  },
  scheduleMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  scheduleDetails: {
    flex: 1.2,
  },
  scheduleShift: {
    color: colors.text,
    fontWeight: '600',
  },
  scheduleAssignBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.dirPrimary,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  scheduleAssignText: {
    color: colors.dirPrimary,
    fontWeight: '600',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginTop: 16,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  statValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginTop: 4,
  },
  statMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
  },
  activityName: {
    color: colors.text,
    fontWeight: '600',
  },
  activityMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  activityBadge: {
    backgroundColor: '#E0F2FE',
    color: colors.dirPrimary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: '600',
  },
  activityValue: {
    color: colors.text,
    fontWeight: '600',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
  },
  directoryFilters: {
    marginTop: 16,
  },
  directoryFilterGroup: {
    marginBottom: 16,
  },
  dirFilterButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  directoryTableScroll: {
    marginTop: 16,
  },
  ptoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  ptoCard: {
    width: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  formLabel: {
    color: colors.text,
    width: 180,
  },
  formInput: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.white,
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sessionsList: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 10,
    borderColor: '#E5E7EB',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  sessionDate: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },
  sessionHours: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    width: 80,
    textAlign: 'right',
  },
  badgeHoliday: {
    color: colors.holiday,
    fontSize: 12,
    marginLeft: 8,
    width: 70,
    textAlign: 'right',
  },
  badgeEarly: {
    color: colors.early,
    fontSize: 12,
    marginLeft: 8,
    width: 50,
    textAlign: 'right',
  },
})

async function exportCSV() {
  try {
    const csv = generateTimesheetCSV(globalSessionsRef.sessions, globalUsersRef.users, globalSessionsRef.rules)
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `timesheet_${Date.now()}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      await AsyncStorage.setItem('babylon.timesheet.csv', csv)
      Alert.alert('Exported', 'CSV saved to local storage key babylon.timesheet.csv')
    }
  } catch (e) {
    Alert.alert('Export failed', 'Unable to generate CSV')
  }
}

async function exportPayrollCSV() {
  try {
    const csv = generatePayrollCSV(globalUsersRef.users, globalSessionsRefAll.sessions, globalSessionsRefAll.rules)
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `payroll_${Date.now()}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      await AsyncStorage.setItem('babylon.payroll.csv', csv)
      Alert.alert('Exported', 'CSV saved to local storage key babylon.payroll.csv')
    }
  } catch (e) {
    Alert.alert('Export failed', 'Unable to generate payroll CSV')
  }
}

const globalSessionsRef: { sessions: WorkSession[]; rules: RulesConfig } = { sessions: [], rules: defaultRules }
const globalSessionsRefAll: { sessions: WorkSession[]; rules: RulesConfig } = { sessions: [], rules: defaultRules }
const globalUsersRef: { users: User[] } = { users: [] }

function normalizeRules(raw: any): RulesConfig {
  const ensureNumber = (value: any, fallback: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  const ensureArray = (value: any, fallback: string[]) => (Array.isArray(value) ? value : fallback)
  return {
    hourlyRate: ensureNumber(raw?.hourlyRate, defaultRules.hourlyRate),
    expectedDailyHours: ensureNumber(raw?.expectedDailyHours, defaultRules.expectedDailyHours),
    overtimeWeeklyThresholdHours: ensureNumber(raw?.overtimeWeeklyThresholdHours, defaultRules.overtimeWeeklyThresholdHours),
    dailyOvertimeThresholdHours: ensureNumber(raw?.dailyOvertimeThresholdHours, defaultRules.dailyOvertimeThresholdHours),
    doubleTimeDailyThresholdHours: ensureNumber(raw?.doubleTimeDailyThresholdHours, defaultRules.doubleTimeDailyThresholdHours),
    overtimeMultiplier: ensureNumber(raw?.overtimeMultiplier, defaultRules.overtimeMultiplier),
    doubleTimeMultiplier: ensureNumber(raw?.doubleTimeMultiplier, defaultRules.doubleTimeMultiplier),
    holidayMultiplier: ensureNumber(raw?.holidayMultiplier, defaultRules.holidayMultiplier),
    holidayPaidHoursCredit: ensureNumber(raw?.holidayPaidHoursCredit, defaultRules.holidayPaidHoursCredit),
    holidays: ensureArray(raw?.holidays, defaultRules.holidays),
  }
}
