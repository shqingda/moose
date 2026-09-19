import { Temporal } from '@js-temporal/polyfill';
export interface CalendarRule {
  /** ISO weekdays: Monday=1, Sunday=7. */
  weekdays: number[];
  hour: number;
  minute: number;
}
/** Strictly after the given instant. Gaps are skipped; overlaps use the first occurrence only. */
export function nextCalendar(rule: CalendarRule, timezone: string, after: number): number {
  if (
    !rule.weekdays.length ||
    rule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    !Number.isInteger(rule.hour) ||
    rule.hour < 0 ||
    rule.hour > 23 ||
    !Number.isInteger(rule.minute) ||
    rule.minute < 0 ||
    rule.minute > 59
  )
    throw new Error('Invalid calendar rule');
  let date = Temporal.Instant.fromEpochMilliseconds(after)
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  for (let i = 0; i < 15; i++, date = date.add({ days: 1 })) {
    if (!rule.weekdays.includes(date.dayOfWeek)) continue;
    const candidate = Temporal.ZonedDateTime.from(
      {
        timeZone: timezone,
        year: date.year,
        month: date.month,
        day: date.day,
        hour: rule.hour,
        minute: rule.minute,
      },
      { overflow: 'reject', disambiguation: 'earlier' },
    );
    if (
      candidate.toPlainDate().equals(date) &&
      candidate.hour === rule.hour &&
      candidate.minute === rule.minute &&
      candidate.epochMilliseconds > after
    )
      return candidate.epochMilliseconds;
  }
  throw new Error('No calendar occurrence found');
}
export function calendarPreview(
  rule: CalendarRule,
  timezone: string,
  from: number,
  count = 3,
): number[] {
  const times: number[] = [];
  let after = from - 1;
  for (let i = 0; i < count; i++) {
    after = nextCalendar(rule, timezone, after);
    times.push(after);
  }
  return times;
}
