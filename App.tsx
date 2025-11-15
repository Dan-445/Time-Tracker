import { StatusBar } from 'expo-status-bar'
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  SafeAreaView,
  TextInput,
  Alert,
  Platform,
  ScrollView,
  StatusBar as RNStatusBar,
  FlatList,
  Dimensions,
  Share,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
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
type TabRoute = 'dashboard' | 'settings' | 'schedule' | 'myteam' | 'directory' | 'whosin' | 'pto' | 'timecards' | 'profile'
type FeatherIconName = ComponentProps<typeof Feather>['name']
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
  department?: string
}
type Assignment = { shift: string; location: string; assigneeId?: string; assigneeName?: string }
type PTORequest = {
  id: string
  employeeId: string
  type: 'Vacation' | 'Sick' | 'Personal'
  startDate: string
  endDate: string
  hours: number
  note?: string
  status: 'Pending' | 'Approved' | 'Denied'
}

const TAB_ITEMS: { key: TabRoute; label: string; icon: FeatherIconName; adminOnly?: boolean }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { key: 'settings', label: 'Settings', icon: 'sliders', adminOnly: true },
  { key: 'schedule', label: 'Schedule', icon: 'calendar', adminOnly: true },
  { key: 'myteam', label: 'My Team', icon: 'users', adminOnly: true },
  { key: 'directory', label: 'Directory', icon: 'book', adminOnly: true },
  { key: 'whosin', label: "Who's In", icon: 'clock', adminOnly: true },
  { key: 'pto', label: 'PTO', icon: 'umbrella', adminOnly: true },
  { key: 'timecards', label: 'Time Cards', icon: 'file-text', adminOnly: true },
]

export default function App() {
  const [sessions, setSessions] = useState<WorkSession[]>([])
  const [active, setActive] = useState<WorkSession | null>(null)
  const [todaySummary, setTodaySummary] = useState<DaySummary | null>(null)
  const [rules, setRules] = useState<RulesConfig>(defaultRules)
  const [auth, setAuth] = useState<AuthState>(null)
  const [users, setUsers] = useState<User[]>([])
  const [booting, setBooting] = useState(true)
  const [scheduleAssignments, setScheduleAssignments] = useState<Record<string, Assignment>>({})
  const [ptoRequests, setPtoRequests] = useState<PTORequest[]>([])
  const [profileFocus, setProfileFocus] = useState<'details' | 'requests'>('details')
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
  const [tab, setTab] = useState<TabRoute>('dashboard')

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
          { id: 'admin-1', empNo: '0001', name: 'Lei, Nicky', username: 'nicky.lei', role: 'admin', status: 'active', department: 'Administration' },
          { id: 'u-9016', empNo: '9016', name: 'Acevedo, Elkin', username: 'acevedoelkin764@gmail.com', role: 'user', manager: 'Lei, Nicky', status: 'active', code: 'EA', department: 'Operations' },
          { id: 'u-9017', empNo: '9017', name: 'Acevedo, Felipe', username: 'felipeacevedo142@gmail.com', role: 'user', manager: 'Lei, Nicky', status: 'active', code: 'FA', department: 'Operations' },
          { id: 'u-9002', empNo: '9002', name: 'Bonilla, Sandra', username: 'bonilla.sandra', role: 'user', manager: 'Lei, Nicky', status: 'active', code: 'SB', department: 'Finance' },
        ]
        setUsers(us ? JSON.parse(us) : defaultUsers)
        if (!us) await AsyncStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(defaultUsers))
      } catch (e) {
        setSessions([])
        setActive(null)
        setRules(defaultRules)
        setAuth(null)
        setUsers([])
      } finally {
        setBooting(false)
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

  useEffect(() => {
    if (users.length === 0 || ptoRequests.length > 0) return
    const sampleUser = users.find((u) => u.role === 'user')
    if (sampleUser) {
      setPtoRequests([
        { id: 'pto-sample', employeeId: sampleUser.id, type: 'Vacation', startDate: weekDaysAgo(2), endDate: weekDaysAgo(1), hours: 16, status: 'Approved', note: 'Family trip' },
      ])
    }
  }, [users, ptoRequests.length])

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
    const dayLabel = new Date(item.checkIn).toLocaleDateString(undefined, { weekday: 'short' })
    const sum = summarizeDay(date, [item], resolveRulesForUser(item.userId))
    return (
      <View key={item.id} style={styles.sessionRow}>
        <Text style={styles.sessionDate}>
          {dayLabel} • {date}
        </Text>
        <Text style={styles.sessionHours}>{sum.totalHours.toFixed(2)}h</Text>
        {sum.isHoliday && <Text style={styles.badgeHoliday}>Holiday</Text>}
        {sum.isEarlyCheckout && <Text style={styles.badgeEarly}>Early</Text>}
      </View>
    )
  }

  const isHolidayToday = todaySummary?.isHoliday
  const checkedIn = !!active && (!!auth?.userId ? active.userId === auth.userId : true)
  const isAdmin = auth?.role === 'admin'
  const currentTab = isAdmin ? tab : tab === 'profile' ? 'profile' : 'dashboard'
  const baseNavItems = useMemo(() => {
    if (isAdmin) return TAB_ITEMS
    return [
      { key: 'dashboard', label: 'Dashboard', icon: 'grid' as FeatherIconName },
      { key: 'profile', label: 'Profile', icon: 'user' as FeatherIconName },
    ]
  }, [isAdmin])
  const bottomNavItems = useMemo(() => baseNavItems.filter((item) => (item.adminOnly ? isAdmin : true)), [baseNavItems, isAdmin])
  const scrollPaddingBottom = useMemo(() => (Platform.OS === 'ios' ? 200 : 160), [])
  const todayKey = toYMD(new Date())
  const viewerAssignment = useMemo(() => {
    if (!auth || auth.role !== 'user') return null
    const assign = scheduleAssignments[todayKey]
    if (assign?.assigneeId === auth.userId) return assign
    return null
  }, [auth, scheduleAssignments, todayKey])
  const viewerAssignmentName = viewerAssignment?.assigneeId ? users.find((u) => u.id === viewerAssignment.assigneeId)?.name : viewerAssignment?.assigneeName
  const handleTabSelect = useCallback(
    (nextTab: TabRoute, focus: 'details' | 'requests' = 'details') => {
      if (!isAdmin && nextTab === 'profile') {
        setProfileFocus(focus)
      }
      setTab(nextTab)
    },
    [isAdmin],
  )

  useEffect(() => {
    if (isAdmin && !TAB_ITEMS.find((item) => item.key === tab)) {
      setTab('dashboard')
    } else if (!isAdmin && tab !== 'dashboard' && tab !== 'profile') {
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
    const [editingDate, setEditingDate] = useState<string | null>(null)
    const [assignForm, setAssignForm] = useState<Assignment>({ shift: '', location: '', assigneeId: undefined, assigneeName: '' })
    const [lastPublishedAt, setLastPublishedAt] = useState<string | null>(null)
    const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    const employeeList = users.filter((u) => u.role === 'user')

    const handleAssign = (date: string) => {
      const existing = scheduleAssignments[date] ?? { shift: '', location: '', assigneeId: undefined, assigneeName: '' }
      setAssignForm(existing)
      setEditingDate(date)
    }

    const saveAssignment = () => {
      if (!editingDate) return
      setScheduleAssignments((prev) => ({ ...prev, [editingDate]: assignForm }))
      setEditingDate(null)
      setAssignForm({ shift: '', location: '', assigneeId: undefined, assigneeName: '' })
    }

    const shareSchedule = async () => {
      const lines = weekDays.map((date) => {
        const entry = scheduleAssignments[date]
        const assignee = entry?.assigneeId ? users.find((u) => u.id === entry.assigneeId)?.name : entry?.assigneeName || 'Unassigned'
        const summary = entry ? `${entry.shift || 'Unassigned'} • ${entry.location || 'No location'} • ${assignee}` : 'Unassigned'
        return `${formatDate(date)}: ${summary}`
      })
      try {
        await Share.share({ message: `Weekly schedule\n\n${lines.join('\n')}` })
      } catch (err) {
        Alert.alert('Unable to share', 'Please try again later.')
      }
    }

    const publishWeek = () => {
      setLastPublishedAt(new Date().toLocaleString())
      Alert.alert('Schedule published', 'Week shared internally.')
    }

    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Weekly Schedule</Text>
          <Text style={styles.cardSubtitle}>Publish shifts and keep everyone aligned.</Text>
          <View style={styles.scheduleActions}>
            <Pressable style={[styles.btnCheckin, styles.scheduleActionSpacer]} onPress={publishWeek}>
              <Text style={styles.btnText}>Publish Week</Text>
            </Pressable>
            <Pressable style={styles.outlineBtn} onPress={shareSchedule}>
              <Text style={styles.outlineBtnText}>Share to Team</Text>
            </Pressable>
          </View>
          {lastPublishedAt && <Text style={styles.schedulePublished}>Last published {lastPublishedAt}</Text>}
          <View>
            {weekDays.map((date) => {
              const entry = scheduleAssignments[date]
              const assigneeName = entry?.assigneeId ? users.find((u) => u.id === entry.assigneeId)?.name : entry?.assigneeName
              return (
                <View key={date} style={styles.scheduleRow}>
                  <View style={styles.scheduleDate}>
                    <Text style={styles.scheduleDay}>{formatDate(date)}</Text>
                    <Text style={styles.scheduleMeta}>{entry?.location || 'Tap assign to build schedule'}</Text>
                  </View>
                  <View style={styles.scheduleDetails}>
                    <Text style={styles.scheduleShift}>{entry?.shift || 'Unassigned'}</Text>
                    <Text style={styles.scheduleMeta}>{assigneeName ? `Assigned to ${assigneeName}` : 'No assignee yet'}</Text>
                  </View>
                  <Pressable style={styles.scheduleAssignBtn} onPress={() => handleAssign(date)}>
                    <Text style={styles.scheduleAssignText}>Assign</Text>
                  </Pressable>
                  {editingDate === date && (
                    <View style={styles.assignForm}>
                      <TextInput style={styles.formInput} placeholder="Shift (e.g. 8a-4p)" value={assignForm.shift} onChangeText={(text) => setAssignForm((prev) => ({ ...prev, shift: text }))} />
                      <TextInput style={styles.formInput} placeholder="Location / job site" value={assignForm.location} onChangeText={(text) => setAssignForm((prev) => ({ ...prev, location: text }))} />
                      <TextInput
                        style={styles.formInput}
                        placeholder="Assignee name"
                        value={assignForm.assigneeName}
                        onChangeText={(text) => setAssignForm((prev) => ({ ...prev, assigneeName: text, assigneeId: undefined }))}
                      />
                      {employeeList.length > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assignChips}>
                          {employeeList.map((emp) => (
                            <Pressable
                              key={emp.id}
                              style={[styles.chip, assignForm.assigneeId === emp.id && styles.chipActive]}
                              onPress={() => setAssignForm((prev) => ({ ...prev, assigneeId: emp.id, assigneeName: emp.name }))}
                            >
                              <Text style={[styles.chipText, assignForm.assigneeId === emp.id && styles.chipTextActive]}>{emp.name}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      )}
                      <View style={styles.assignActions}>
                        <Pressable style={[styles.outlineBtn, styles.assignActionSpacer]} onPress={() => setEditingDate(null)}>
                          <Text style={styles.outlineBtnText}>Cancel</Text>
                        </Pressable>
                        <Pressable style={styles.btnCheckin} onPress={saveAssignment}>
                          <Text style={styles.btnText}>Save Assignment</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        </View>
      </View>
    )
  }

  function ProfileView({ focus }: { focus: 'details' | 'requests' }) {
    if (!auth || auth.role !== 'user') return null
    const me = users.find((u) => u.id === auth.userId)
    const [leaveType, setLeaveType] = useState('Vacation')
    const [leaveDescription, setLeaveDescription] = useState('')
    const [leaveStart, setLeaveStart] = useState('')
    const [leaveEnd, setLeaveEnd] = useState('')
    const [leaveHours, setLeaveHours] = useState('')
    const [leaveError, setLeaveError] = useState<string | null>(null)
    const myRequests = ptoRequests.filter((r) => r.employeeId === auth.userId)
    const upcomingAssignments = useMemo(() => {
      return Object.entries(scheduleAssignments)
        .filter(([_, assignment]) => assignment.assigneeId === auth.userId)
        .sort(([a], [b]) => (a > b ? 1 : -1))
    }, [scheduleAssignments, auth.userId])

    const submitLeaveRequest = () => {
      if (!leaveStart || !leaveEnd || (!leaveHours && leaveType.toLowerCase() === 'break')) {
        setLeaveError('Please provide start/end dates and hours for short breaks.')
        return
      }
      const hoursValue = Number(leaveHours) || 0
      const request: PTORequest = {
        id: `user-pto-${Date.now()}`,
        employeeId: auth.userId!,
        type: (leaveType as PTORequest['type']) || 'Vacation',
        startDate: leaveStart,
        endDate: leaveEnd,
        hours: hoursValue,
        note: leaveDescription,
        status: 'Pending',
      }
      setPtoRequests((prev) => [...prev, request])
      setLeaveType('Vacation')
      setLeaveDescription('')
      setLeaveStart('')
      setLeaveEnd('')
      setLeaveHours('')
      setLeaveError(null)
      Alert.alert('Request submitted', 'Your manager will review this PTO request.')
    }

    if (!me) {
      return (
        <View style={styles.settingsContainer}>
          <View style={styles.contentCard}>
            <Text style={styles.cardTitle}>My Profile</Text>
            <Text style={styles.subBrand}>We could not load your profile details yet.</Text>
          </View>
        </View>
      )
    }

    const leaveTypes = ['Vacation', 'Sick', 'Personal', 'Off Time', 'Break']
    const profileCards = [
      <View key="details" style={styles.contentCard}>
        <Text style={styles.cardTitle}>My Profile</Text>
        <Text style={styles.cardSubtitle}>Details visible to your managers.</Text>
        <View style={styles.profileInfoRow}>
          <Text style={styles.profileLabel}>Name</Text>
          <Text style={styles.profileValue}>{me?.name || 'Unknown'}</Text>
        </View>
        <View style={styles.profileInfoRow}>
          <Text style={styles.profileLabel}>Employee #</Text>
          <Text style={styles.profileValue}>{me?.empNo || '—'}</Text>
        </View>
        <View style={styles.profileInfoRow}>
          <Text style={styles.profileLabel}>Username</Text>
          <Text style={styles.profileValue}>{me?.username || '—'}</Text>
        </View>
        <View style={styles.profileInfoRow}>
          <Text style={styles.profileLabel}>Manager</Text>
          <Text style={styles.profileValue}>{me?.manager || 'Unassigned'}</Text>
        </View>
        <View style={styles.profileInfoRow}>
          <Text style={styles.profileLabel}>Role</Text>
          <Text style={styles.profileValue}>{me?.role || '—'}</Text>
        </View>
        <View style={styles.profileInfoRow}>
          <Text style={styles.profileLabel}>Department</Text>
          <Text style={styles.profileValue}>{me?.department || (me.role === 'admin' ? 'Administration' : 'Operations')}</Text>
        </View>
        <View style={styles.profileInfoRow}>
          <Text style={styles.profileLabel}>Employee Code</Text>
          <Text style={styles.profileValue}>{me?.code || '—'}</Text>
        </View>
      </View>,
      <View key="schedule" style={styles.contentCard}>
        <Text style={styles.cardTitle}>My Schedule</Text>
        {upcomingAssignments.length === 0 ? (
          <Text style={styles.subBrand}>No assignments saved yet.</Text>
        ) : (
          upcomingAssignments.map(([date, entry]) => (
            <View key={date} style={styles.profileAssignmentRow}>
              <Text style={styles.profileAssignmentDate}>{date}</Text>
              <Text style={styles.profileAssignmentText}>
                {entry.shift || 'Shift TBD'} • {entry.location || 'Location TBD'}
              </Text>
            </View>
          ))
        )}
      </View>,
      <View key="request" style={styles.contentCard}>
        <Text style={styles.cardTitle}>Request Time Off</Text>
        <Text style={styles.cardSubtitle}>Send a PTO or break request to your manager.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assignChips}>
          {leaveTypes.map((type) => (
            <Pressable key={type} style={[styles.chip, leaveType === type && styles.chipActive]} onPress={() => setLeaveType(type)}>
              <Text style={[styles.chipText, leaveType === type && styles.chipTextActive]}>{type}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.formGrid}>
          <View style={styles.formField}>
            <Text style={styles.formLabel}>Start Date</Text>
            <TextInput style={styles.formInput} placeholder="YYYY-MM-DD" value={leaveStart} onChangeText={setLeaveStart} />
          </View>
          <View style={styles.formField}>
            <Text style={styles.formLabel}>End Date</Text>
            <TextInput style={styles.formInput} placeholder="YYYY-MM-DD" value={leaveEnd} onChangeText={setLeaveEnd} />
          </View>
          <View style={styles.formField}>
            <Text style={styles.formLabel}>Hours (optional)</Text>
            <TextInput style={styles.formInput} placeholder="4" keyboardType="numeric" value={leaveHours} onChangeText={setLeaveHours} />
          </View>
        </View>
        <View style={styles.formFieldFull}>
          <Text style={styles.formLabel}>Reason / Description</Text>
          <TextInput
            multiline
            style={[styles.formInput, styles.leaveReasonInput]}
            placeholder="Why do you need time off?"
            value={leaveDescription}
            onChangeText={setLeaveDescription}
          />
        </View>
        {leaveError && <Text style={styles.roleWarningText}>{leaveError}</Text>}
        <Pressable style={[styles.btnCheckin, styles.ptoRequestSubmit]} onPress={submitLeaveRequest}>
          <Text style={styles.btnText}>Submit Request</Text>
        </Pressable>
      </View>,
      <View key="myrequests" style={styles.contentCard}>
        <Text style={styles.cardTitle}>My Requests</Text>
        {myRequests.length === 0 ? (
          <Text style={styles.subBrand}>You have not logged any PTO requests.</Text>
        ) : (
          myRequests
            .slice()
            .reverse()
            .map((req) => (
              <View key={req.id} style={styles.ptoRequestRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ptoRequestName}>{req.type}</Text>
                  <Text style={styles.ptoRequestMeta}>
                    {req.startDate} → {req.endDate} • {req.hours}h
                  </Text>
                  {!!req.note && <Text style={styles.ptoRequestMeta}>{req.note}</Text>}
                </View>
                <Text style={[styles.ptoStatusPill, styles[`pto${req.status}` as const]]}>{req.status}</Text>
              </View>
            ))
        )}
      </View>,
    ]

    const orderedCards = focus === 'requests' ? [profileCards[2], profileCards[3], profileCards[0], profileCards[1]] : profileCards

    return <View style={styles.settingsContainer}>{orderedCards}</View>
  }

  function PTOView() {
    const employeeList = users.filter((u) => u.role === 'user')
    const [requestForm, setRequestForm] = useState({ employeeId: employeeList[0]?.id || '', type: 'Vacation', startDate: '', endDate: '', hours: '' })

    const addRequest = () => {
      if (!requestForm.employeeId || !requestForm.startDate || !requestForm.endDate || !requestForm.hours) {
        Alert.alert('Missing info', 'Please complete all fields before logging PTO.')
        return
      }
      const next: PTORequest = {
        id: `pto-${Date.now()}`,
        employeeId: requestForm.employeeId,
        type: (requestForm.type as PTORequest['type']) || 'Vacation',
        startDate: requestForm.startDate,
        endDate: requestForm.endDate,
        hours: Number(requestForm.hours),
        status: 'Pending',
      }
      setPtoRequests((prev) => [...prev, next])
      setRequestForm((prev) => ({ ...prev, startDate: '', endDate: '', hours: '' }))
    }

    const updateStatus = (id: string, status: PTORequest['status']) => setPtoRequests((prev) => prev.map((req) => (req.id === id ? { ...req, status } : req)))

    const pending = ptoRequests.filter((r) => r.status === 'Pending')
    const approvalRate = ptoRequests.length ? Math.round((ptoRequests.filter((r) => r.status === 'Approved').length / ptoRequests.length) * 100) : 0

    return (
      <View style={styles.settingsContainer}>
        <View style={styles.contentCard}>
          <Text style={styles.cardTitle}>Paid Time Off</Text>
          <Text style={styles.cardSubtitle}>Log requests, track balances, and keep managers aligned.</Text>
          <View style={styles.ptoSummaryGrid}>
            <View style={styles.ptoSummaryCard}>
              <Text style={styles.statLabel}>Open Requests</Text>
              <Text style={styles.statValue}>{pending.length}</Text>
              <Text style={styles.statMeta}>Awaiting approval</Text>
            </View>
            <View style={styles.ptoSummaryCard}>
              <Text style={styles.statLabel}>Approval Rate</Text>
              <Text style={styles.statValue}>{approvalRate}%</Text>
              <Text style={styles.statMeta}>Year to date</Text>
            </View>
          </View>
          <View style={styles.ptoRequestForm}>
            <Text style={styles.formLabel}>New Request</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assignChips}>
              {employeeList.map((u) => (
                <Pressable key={u.id} style={[styles.chip, requestForm.employeeId === u.id && styles.chipActive]} onPress={() => setRequestForm((prev) => ({ ...prev, employeeId: u.id }))}>
                  <Text style={[styles.chipText, requestForm.employeeId === u.id && styles.chipTextActive]}>{u.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.formGrid}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Type</Text>
                <TextInput style={styles.formInput} value={requestForm.type} onChangeText={(text) => setRequestForm((prev) => ({ ...prev, type: text }))} placeholder="Vacation" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Start Date</Text>
                <TextInput style={styles.formInput} placeholder="YYYY-MM-DD" value={requestForm.startDate} onChangeText={(text) => setRequestForm((prev) => ({ ...prev, startDate: text }))} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>End Date</Text>
                <TextInput style={styles.formInput} placeholder="YYYY-MM-DD" value={requestForm.endDate} onChangeText={(text) => setRequestForm((prev) => ({ ...prev, endDate: text }))} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Hours</Text>
                <TextInput style={styles.formInput} placeholder="8" keyboardType="numeric" value={requestForm.hours} onChangeText={(text) => setRequestForm((prev) => ({ ...prev, hours: text }))} />
              </View>
            </View>
            <Pressable style={[styles.btnCheckin, styles.ptoRequestSubmit]} onPress={addRequest}>
              <Text style={styles.btnText}>Log Request</Text>
            </Pressable>
          </View>
          <View style={styles.ptoRequestList}>
            {ptoRequests.map((req) => {
              const employee = users.find((u) => u.id === req.employeeId)
              return (
                <View key={req.id} style={styles.ptoRequestRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ptoRequestName}>{employee?.name || 'Team member'}</Text>
                    <Text style={styles.ptoRequestMeta}>
                      {req.type} • {req.startDate} → {req.endDate} • {req.hours}h
                    </Text>
                  </View>
                  <View style={styles.ptoRequestStatus}>
                    <Text style={[styles.ptoStatusPill, styles[`pto${req.status}` as const]]}>{req.status}</Text>
                    {req.status === 'Pending' && (
                      <View style={styles.ptoRequestActions}>
                        <Pressable style={styles.linkBtn} onPress={() => updateStatus(req.id, 'Approved')}>
                          <Text style={styles.linkBtnText}>Approve</Text>
                        </Pressable>
                        <Pressable style={styles.linkBtn} onPress={() => updateStatus(req.id, 'Denied')}>
                          <Text style={styles.linkBtnText}>Deny</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              )
            })}
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
                    const punchStart = new Date(s.checkIn)
                    const punchLabel = `${punchStart.toLocaleDateString(undefined, { weekday: 'short' })} • ${punchStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    return (
                      <View key={`open-${s.id}`} style={styles.activityRow}>
                        <View>
                          <Text style={styles.activityName}>{u?.name || s.userId}</Text>
                          <Text style={styles.activityMeta}>{punchLabel}</Text>
                        </View>
                        <Text style={styles.activityBadge}>IN</Text>
                      </View>
                    )
                  })
              )}
              {recentPunches.map((s) => {
                const u = users.find((x) => x.id === s.userId)
                const punchDate = new Date(s.checkIn)
                const dateLabel = `${punchDate.toLocaleDateString(undefined, { weekday: 'short' })} • ${toYMD(punchDate)}`
                return (
                  <View key={s.id} style={styles.activityRow}>
                    <View>
                      <Text style={styles.activityName}>{u?.name || s.userId}</Text>
                      <Text style={styles.activityMeta}>{dateLabel}</Text>
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

  function BottomNavigation() {
    if (bottomNavItems.length === 0) return null
    const isIOS = Platform.OS === 'ios'
    const showInfiniteNav = isAdmin && bottomNavItems.length > 1
    const windowWidth = Dimensions.get('window').width
    const chipWidth = 140
    const chipSpacing = 12
    const itemWidth = chipWidth + chipSpacing
    const horizontalPadding = Math.max((windowWidth - chipWidth) / 2, 12)
    if (!showInfiniteNav) {
      if (bottomNavItems.length <= 3) {
        return (
          <View style={[styles.bottomNav, isIOS ? styles.bottomNavIOS : styles.bottomNavAndroid]}>
            <View style={styles.bottomNavStaticRow}>
              {bottomNavItems.map((item) => {
                const focused = currentTab === item.key
                return (
                  <Pressable
                    key={item.key}
                    style={[styles.bottomNavChip, focused && styles.bottomNavChipActive]}
                    accessibilityRole="button"
                    accessibilityState={focused ? { selected: true } : undefined}
                    onPress={() => handleTabSelect(item.key as TabRoute)}
                  >
                    <Feather name={item.icon} size={20} color={focused ? colors.white : colors.dirPrimary} style={styles.bottomNavChipIcon} />
                    <Text style={[styles.bottomNavChipText, focused && styles.bottomNavChipTextActive]}>{item.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      }
      return (
        <View style={[styles.bottomNav, isIOS ? styles.bottomNavIOS : styles.bottomNavAndroid]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.bottomNavScroll, { paddingHorizontal: horizontalPadding }]}
            keyboardShouldPersistTaps="handled"
          >
            {bottomNavItems.map((item) => {
              const focused = currentTab === item.key
              return (
                <Pressable
                  key={item.key}
                  style={[styles.bottomNavChip, focused && styles.bottomNavChipActive]}
                  accessibilityRole="button"
                  accessibilityState={focused ? { selected: true } : undefined}
                  onPress={() => handleTabSelect(item.key as TabRoute)}
                >
                  <Feather name={item.icon} size={20} color={focused ? colors.white : colors.dirPrimary} style={styles.bottomNavChipIcon} />
                  <Text style={[styles.bottomNavChipText, focused && styles.bottomNavChipTextActive]}>{item.label}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )
    }
    const extendedTabs = useMemo(() => {
      if (bottomNavItems.length === 0) return []
      const first = bottomNavItems[0]
      const last = bottomNavItems[bottomNavItems.length - 1]
      return [last, ...bottomNavItems, first]
    }, [bottomNavItems])
    const selectedIndex = Math.max(bottomNavItems.findIndex((item) => item.key === currentTab), 0)
    const listRef = useRef<FlatList<typeof bottomNavItems[0]> | null>(null)
    const centerOnIndex = useCallback(
      (index: number, animated: boolean) => {
        if (!listRef.current || extendedTabs.length === 0) return
        listRef.current.scrollToOffset({ offset: index * itemWidth, animated })
      },
      [extendedTabs.length, itemWidth],
    )

    useEffect(() => {
      if (extendedTabs.length === 0) return
      centerOnIndex(selectedIndex + 1, false)
    }, [extendedTabs.length, selectedIndex, centerOnIndex])

    const handleMomentumEnd = useCallback(
      (event: any) => {
        if (bottomNavItems.length === 0 || extendedTabs.length === 0) return
        const offsetX = event.nativeEvent.contentOffset.x
        const rawIndex = Math.round(offsetX / itemWidth)
        let normalizedIndex = rawIndex - 1
        if (rawIndex <= 0) {
          normalizedIndex = bottomNavItems.length - 1
          centerOnIndex(bottomNavItems.length, false)
        } else if (rawIndex >= extendedTabs.length - 1) {
          normalizedIndex = 0
          centerOnIndex(1, false)
        }
        if (normalizedIndex < 0) normalizedIndex = 0
        if (normalizedIndex >= bottomNavItems.length) normalizedIndex = bottomNavItems.length - 1
        const nextTab = bottomNavItems[normalizedIndex]
        if (nextTab && nextTab.key !== currentTab) {
          handleTabSelect(nextTab.key as TabRoute)
        }
      },
      [bottomNavItems, currentTab, itemWidth, centerOnIndex, extendedTabs.length, handleTabSelect],
    )

    return (
      <View style={[styles.bottomNav, isIOS ? styles.bottomNavIOS : styles.bottomNavAndroid]}>
        <View style={styles.bottomNavCarousel}>
          <FlatList
            ref={listRef}
            horizontal
            data={extendedTabs}
            keyExtractor={(_, index) => `nav-${index}`}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            decelerationRate="fast"
            snapToInterval={itemWidth}
            snapToAlignment="center"
            contentContainerStyle={[styles.bottomNavScroll, { paddingHorizontal: horizontalPadding }]}
            getItemLayout={(_, index) => ({ length: itemWidth, offset: itemWidth * index, index })}
            initialScrollIndex={selectedIndex + 1}
            onMomentumScrollEnd={handleMomentumEnd}
            renderItem={({ item, index }) => {
              const isSentinel = index === 0 || index === extendedTabs.length - 1
              if (isSentinel) {
                return <View style={[styles.bottomNavChip, { width: chipWidth, opacity: 0 }]} pointerEvents="none" />
              }
              const actualIndex = index - 1
              const focused = currentTab === item.key
              return (
                <Pressable
                  style={[styles.bottomNavChip, focused && styles.bottomNavChipActive, { width: chipWidth }]}
                  accessibilityRole="button"
                  accessibilityState={focused ? { selected: true } : undefined}
                  onPress={() => {
                    handleTabSelect(item.key as TabRoute)
                    centerOnIndex(actualIndex + 1, true)
                  }}
                >
                  <Feather name={item.icon} size={20} color={focused ? colors.white : colors.dirPrimary} style={styles.bottomNavChipIcon} />
                  <Text style={[styles.bottomNavChipText, focused && styles.bottomNavChipTextActive]}>{item.label}</Text>
                </Pressable>
              )
            }}
          />
        </View>
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
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Time Cards</Text>
              <Text style={styles.cardSubtitle}>Weekly breakdown of hours, premiums, and punches.</Text>
            </View>
            <Pressable style={[styles.outlineBtn, styles.cardHeaderAction]} onPress={exportCSV}>
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
            <Text style={styles.signatureTitle}>Digital Certification</Text>
            <Text style={styles.signatureText}>This record was generated by Babylon Tracker and reflects the latest punches and overrides. No wet signature required.</Text>
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

  if (booting) {
    return <SplashScreen />
  }

  if (!auth) {
    return <LoginView users={users} onAdminLogin={() => loginAs('admin')} onUserLogin={loginAsUser} />
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appShell}>
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
            <Pressable style={styles.navLogout} onPress={logout}>
              <Text style={styles.btnText}>Logout</Text>
            </Pressable>
          </View>
        </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollPaddingBottom }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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

      {viewerAssignment && (
        <View style={styles.assignmentCard}>
          <Text style={styles.assignmentTitle}>Today's Assignment</Text>
          <Text style={styles.assignmentText}>
            {viewerAssignment.shift || 'Shift TBD'} • {viewerAssignment.location || 'Location pending'}
          </Text>
          {viewerAssignmentName && <Text style={styles.assignmentMeta}>Assigned to {viewerAssignmentName}</Text>}
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
          <View style={[styles.ctaRow, styles.exportActionRow]}>
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
          <View style={styles.sessionsList}>{sessionsForCurrentUser.map((item) => renderSession(item))}</View>
        </>
      ) : !isAdmin && currentTab === 'profile' ? (
        <ProfileView focus={profileFocus} />
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
      </View>
      <BottomNavigation />
      <StatusBar style="light" />
    </SafeAreaView>
  )
}

function SplashScreen() {
  return (
    <SafeAreaView style={styles.splashContainer}>
      <View style={styles.splashLogo}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoBadgeText}>BT</Text>
        </View>
        <View>
          <Text style={styles.splashTitle}>Babylon Tracker</Text>
          <Text style={styles.splashSubtitle}>Loading your workspace...</Text>
        </View>
      </View>
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
  appShell: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 20 : (RNStatusBar.currentHeight ?? 20) + 8,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: colors.card,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  logoBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.dirPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  logoBadgeText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 18,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navLogout: {
    backgroundColor: colors.dirPrimary,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    minWidth: 104,
    alignItems: 'center',
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
    marginBottom: 16,
  },
  exportActionRow: {
    marginTop: 16,
    marginBottom: 20,
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
    minWidth: 160,
    alignItems: 'center',
  },
  btnCheckout: {
    backgroundColor: colors.dirPrimary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
    minWidth: 160,
    alignItems: 'center',
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
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
    gap: 12,
  },
  addUserActionSpacer: {
    marginRight: 0,
  },
  sectionTitle: {
    marginTop: 16,
  },
  signatureBlock: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
  },
  signatureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  signatureText: {
    color: colors.muted,
    marginTop: 4,
    lineHeight: 20,
  },
  assignmentCard: {
    backgroundColor: '#EEF2FF',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
  },
  assignmentTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.dirPrimary,
  },
  assignmentText: {
    marginTop: 4,
    color: colors.textDark,
  },
  assignmentMeta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
  },
  profileInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  profileLabel: {
    color: colors.muted,
  },
  profileValue: {
    color: colors.textDark,
    fontWeight: '600',
    flexShrink: 0,
  },
  leaveReasonInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  profileAssignmentRow: {
    paddingVertical: 6,
  },
  profileAssignmentDate: {
    fontSize: 12,
    color: colors.muted,
  },
  profileAssignmentText: {
    fontWeight: '600',
    color: colors.textDark,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  bottomNav: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    paddingTop: 16,
    overflow: 'hidden',
  },
  bottomNavIOS: {
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
    paddingBottom: 24,
  },
  bottomNavAndroid: {
    borderTopWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
    paddingBottom: 20,
  },
  bottomNavScroll: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  bottomNavStaticRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingVertical: 12,
    gap: 12,
  },
  bottomNavCarousel: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#EEF2FF',
    marginHorizontal: 8,
  },
  bottomNavChipActive: {
    backgroundColor: colors.dirPrimary,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  bottomNavChipIcon: {
    marginRight: 8,
  },
  bottomNavChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.dirPrimary,
  },
  bottomNavChipTextActive: {
    color: colors.white,
  },
  bottomNavSingle: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  splashTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textDark,
  },
  splashSubtitle: {
    color: colors.muted,
    marginTop: 4,
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
    gap: 16,
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },
  contentCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
    marginTop: 16,
    width: '100%',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 220,
  },
  cardHeaderAction: {
    alignSelf: 'flex-start',
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
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  schedulePublished: {
    color: colors.muted,
    marginBottom: 12,
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
  assignForm: {
    marginTop: 12,
    width: '100%',
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 10,
  },
  assignChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
  },
  assignActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  assignActionSpacer: {
    marginRight: 0,
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
  ptoSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  ptoSummaryCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    padding: 16,
  },
  ptoCard: {
    width: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  ptoRequestForm: {
    marginBottom: 16,
    gap: 8,
  },
  ptoRequestSubmit: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  ptoRequestList: {
    gap: 12,
  },
  ptoRequestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
  },
  ptoRequestName: {
    fontWeight: '600',
    color: colors.textDark,
  },
  ptoRequestMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  ptoRequestStatus: {
    alignItems: 'flex-end',
  },
  ptoRequestActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  ptoStatusPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    color: colors.white,
    fontWeight: '600',
  },
  ptoPending: {
    backgroundColor: '#F59E0B',
  },
  ptoApproved: {
    backgroundColor: colors.dirPrimary,
  },
  ptoDenied: {
    backgroundColor: colors.early,
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

function weekDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
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
