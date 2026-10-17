/**
 * Report scheduling (#1114).
 *
 * Schedules are declared in UTC so a report runs at the same wall-clock time
 * regardless of where the process is deployed. `nextReportRunAt` is pure: it
 * takes the current instant as a parameter and returns the next instant the
 * schedule fires, strictly after the supplied time.
 *
 * Supported cadences:
 *  - daily   -> every day at hourUtc:minuteUtc
 *  - weekly  -> dayOfWeek (0 = Sunday) at hourUtc:minuteUtc
 *  - monthly -> dayOfMonth (clamped to the last day of short months)
 */

export type ReportCadence = 'daily' | 'weekly' | 'monthly';

export interface ReportSchedule {
  cadence: ReportCadence;
  hourUtc: number;
  minuteUtc: number;
  /** Required for weekly cadences, 0 (Sunday) through 6 (Saturday). */
  dayOfWeek?: number;
  /** Required for monthly cadences, 1 through 31. */
  dayOfMonth?: number;
}

export class ReportScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportScheduleError';
  }
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export function validateReportSchedule(schedule: ReportSchedule): void {
  if (!schedule || typeof schedule !== 'object') {
    throw new ReportScheduleError('schedule must be an object');
  }

  if (!['daily', 'weekly', 'monthly'].includes(schedule.cadence)) {
    throw new ReportScheduleError(`unsupported cadence: ${String(schedule.cadence)}`);
  }

  if (!Number.isInteger(schedule.hourUtc) || schedule.hourUtc < 0 || schedule.hourUtc > 23) {
    throw new ReportScheduleError('hourUtc must be an integer between 0 and 23');
  }

  if (!Number.isInteger(schedule.minuteUtc) || schedule.minuteUtc < 0 || schedule.minuteUtc > 59) {
    throw new ReportScheduleError('minuteUtc must be an integer between 0 and 59');
  }

  if (schedule.cadence === 'weekly') {
    if (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek! < 0 || schedule.dayOfWeek! > 6) {
      throw new ReportScheduleError('dayOfWeek must be an integer between 0 and 6');
    }
  }

  if (schedule.cadence === 'monthly') {
    if (!Number.isInteger(schedule.dayOfMonth) || schedule.dayOfMonth! < 1 || schedule.dayOfMonth! > 31) {
      throw new ReportScheduleError('dayOfMonth must be an integer between 1 and 31');
    }
  }
}

/** The next instant this schedule fires, strictly after `fromMs` (UTC). */
export function nextReportRunAt(schedule: ReportSchedule, fromMs: number): number {
  validateReportSchedule(schedule);
  if (!Number.isFinite(fromMs)) {
    throw new ReportScheduleError('fromMs must be a finite epoch millisecond value');
  }

  switch (schedule.cadence) {
    case 'daily':
      return nextDaily(schedule, fromMs);
    case 'weekly':
      return nextWeekly(schedule, fromMs);
    case 'monthly':
      return nextMonthly(schedule, fromMs);
  }
}

function timeOfDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function startOfUtcDay(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function candidateForDay(dayStartMs: number, schedule: ReportSchedule): number {
  return dayStartMs + schedule.hourUtc * 60 * MINUTE_MS + schedule.minuteUtc * MINUTE_MS;
}

function nextDaily(schedule: ReportSchedule, fromMs: number): number {
  const today = startOfUtcDay(fromMs);
  const candidate = candidateForDay(today, schedule);
  if (candidate > fromMs && timeOfDay(new Date(fromMs)) !== timeOfDay(new Date(candidate))) {
    return candidate;
  }
  return candidate > fromMs ? candidate : candidateForDay(today + DAY_MS, schedule);
}

function nextWeekly(schedule: ReportSchedule, fromMs: number): number {
  for (let offset = 0; offset < 8; offset += 1) {
    const dayStart = startOfUtcDay(fromMs) + offset * DAY_MS;
    if (new Date(dayStart).getUTCDay() !== schedule.dayOfWeek) {
      continue;
    }
    const candidate = candidateForDay(dayStart, schedule);
    if (candidate > fromMs) {
      return candidate;
    }
  }
  throw new ReportScheduleError('weekly schedule did not resolve within eight days');
}

function nextMonthly(schedule: ReportSchedule, fromMs: number): number {
  const date = new Date(fromMs);
  const firstOfMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);

  // Walk forward month by month; short months clamp to their last day.
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const monthStart = new Date(firstOfMonth);
    monthStart.setUTCMonth(monthStart.getUTCMonth() + monthOffset);
    const year = monthStart.getUTCFullYear();
    const month = monthStart.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(schedule.dayOfMonth!, lastDay);
    const dayStart = Date.UTC(year, month, day);
    const candidate = candidateForDay(dayStart, schedule);
    if (candidate > fromMs) {
      return candidate;
    }
  }

  throw new ReportScheduleError('monthly schedule did not resolve within 24 months');
}
