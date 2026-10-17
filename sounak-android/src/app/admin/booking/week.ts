// src/app/admin/booking/week.ts
//
// The week as the admin screens show it: Monday first, the way a clinic's
// board reads, although the database stores 0=Sunday..6=Saturday (the JS
// Date.getDay() convention — see schema_doctors_tests.sql).
import { DoctorScheduleSlot } from '../../core/medical-center.service';

export const WEEK: { dayOfWeek: number; short: string; long: string }[] = [
  { dayOfWeek: 1, short: 'Mon', long: 'Monday' },
  { dayOfWeek: 2, short: 'Tue', long: 'Tuesday' },
  { dayOfWeek: 3, short: 'Wed', long: 'Wednesday' },
  { dayOfWeek: 4, short: 'Thu', long: 'Thursday' },
  { dayOfWeek: 5, short: 'Fri', long: 'Friday' },
  { dayOfWeek: 6, short: 'Sat', long: 'Saturday' },
  { dayOfWeek: 0, short: 'Sun', long: 'Sunday' },
];

/** "Mon, Wed, Fri" — which days a doctor sits, for a one-line summary. */
export function daysSummary(schedule: DoctorScheduleSlot[]): string {
  const days = new Set(schedule.map((slot) => slot.day_of_week));
  return WEEK.filter((d) => days.has(d.dayOfWeek)).map((d) => d.short).join(', ');
}

/** "17:00:00" -> "17:00". */
export const hhmm = (time: string): string => time.slice(0, 5);
