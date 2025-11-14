import { RulesConfig } from '../utils/time'

export const defaultRules: RulesConfig = {
  expectedDailyHours: 8,
  overtimeWeeklyThresholdHours: 40,
  holidays: ['2025-01-01', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25'],
  hourlyRate: 20,
  overtimeMultiplier: 1.5,
  holidayMultiplier: 2,
  dailyOvertimeThresholdHours: 8,
  doubleTimeDailyThresholdHours: 12,
  doubleTimeMultiplier: 2,
  holidayPaidHoursCredit: 8,
}