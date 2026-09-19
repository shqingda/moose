import { expect, it } from 'vitest';
import { calendarPreview, nextCalendar } from '../../shared/calendar';
const daily = { weekdays: [1, 2, 3, 4, 5, 6, 7], hour: 9, minute: 0 };
const iso = (value: number) => new Date(value).toISOString();
it('uses local weekdays across year boundaries and includes the preview start', () => {
  const rule = { ...daily, weekdays: [1] };
  const start = Date.parse('2027-01-03T23:59:00Z');
  const times = calendarPreview(rule, 'Asia/Shanghai', start);
  expect(times.map(iso)).toEqual([
    '2027-01-04T01:00:00.000Z',
    '2027-01-11T01:00:00.000Z',
    '2027-01-18T01:00:00.000Z',
  ]);
  expect(calendarPreview(rule, 'Asia/Shanghai', times[0])[0]).toBe(times[0]);
  expect(nextCalendar(rule, 'Asia/Shanghai', times[0])).toBe(times[1]);
});
it('skips spring gaps and uses only the first autumn overlap', () => {
  expect(
    iso(
      nextCalendar(
        { ...daily, hour: 2, minute: 30 },
        'America/New_York',
        Date.parse('2026-03-08T00:00Z'),
      ),
    ),
  ).toBe('2026-03-09T06:30:00.000Z');
  const rule = { ...daily, hour: 1, minute: 30 };
  const first = nextCalendar(rule, 'America/New_York', Date.parse('2026-11-01T00:00Z'));
  expect(iso(first)).toBe('2026-11-01T05:30:00.000Z');
  expect(iso(nextCalendar(rule, 'America/New_York', first))).toBe('2026-11-02T06:30:00.000Z');
  expect(iso(nextCalendar(rule, 'America/New_York', Date.parse('2026-11-01T06:00Z')))).toBe(
    '2026-11-02T06:30:00.000Z',
  );
});
it('handles fractional offsets and weekly daylight-saving gaps', () => {
  expect(iso(nextCalendar(daily, 'Asia/Kathmandu', Date.parse('2026-01-01T00:00Z')))).toBe(
    '2026-01-01T03:15:00.000Z',
  );
  expect(
    iso(
      nextCalendar(
        { ...daily, weekdays: [7], hour: 2, minute: 15 },
        'Australia/Lord_Howe',
        Date.parse('2026-10-03T00:00Z'),
      ),
    ),
  ).toBe('2026-10-10T15:15:00.000Z');
});
it('rejects invalid rules and timezones', () => {
  for (const rule of [
    { ...daily, weekdays: [] },
    { ...daily, weekdays: [0] },
    { ...daily, hour: 24 },
    { ...daily, minute: 60 },
  ])
    expect(() => nextCalendar(rule, 'UTC', 0)).toThrow();
  expect(() => nextCalendar(daily, 'No/Such_Zone', 0)).toThrow();
});
