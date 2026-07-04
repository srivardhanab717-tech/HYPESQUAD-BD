import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { getPeriodStart, getPeriodEnd, getTodayInTimezone, isDeadlinePassed } from '../src/utils/periods';

/**
 * Property-based tests for check-in period computation.
 *
 * **Validates: Requirements 4.1** (period boundaries computed server-side from cadence + timezone)
 * **Validates: Requirements 4.6** (timezone on record used at check-in time)
 */
describe('Check-in period properties', () => {
  const timezones = [
    'Asia/Kolkata',
    'America/New_York',
    'Europe/London',
    'Pacific/Auckland',
    'US/Hawaii',
    'Asia/Tokyo',
    'Australia/Sydney',
    'America/Los_Angeles',
    'Europe/Berlin',
    'Africa/Nairobi',
  ];
  const cadences = ['daily', 'weekly', 'custom'] as const;

  it('period_start is always a valid YYYY-MM-DD date for any timezone', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...timezones),
        fc.constantFrom(...cadences),
        (tz, cadence) => {
          const result = getPeriodStart(cadence, tz);
          expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      )
    );
  });

  it('weekly period_start is always a Monday', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...timezones),
        (tz) => {
          const periodStart = getPeriodStart('weekly', tz);
          const [y, m, d] = periodStart.split('-').map(Number);
          const date = new Date(y, m - 1, d);
          expect(date.getDay()).toBe(1); // Monday
        }
      )
    );
  });

  it('period_end >= period_start for all cadences', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...cadences),
        fc.constantFrom(...timezones),
        (cadence, tz) => {
          const start = getPeriodStart(cadence, tz);
          const end = getPeriodEnd(cadence, start);
          expect(end >= start).toBe(true);
        }
      )
    );
  });

  it('weekly period spans exactly 7 days (6-day difference from Monday to Sunday)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...timezones),
        (tz) => {
          const start = getPeriodStart('weekly', tz);
          const end = getPeriodEnd('weekly', start);
          const [sy, sm, sd] = start.split('-').map(Number);
          const [ey, em, ed] = end.split('-').map(Number);
          const startDate = new Date(sy, sm - 1, sd);
          const endDate = new Date(ey, em - 1, ed);
          const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
          expect(diffDays).toBe(6); // Monday to Sunday = 6 days difference
        }
      )
    );
  });

  it('daily/custom period_start equals period_end (single day period)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('daily' as const, 'custom' as const),
        fc.constantFrom(...timezones),
        (cadence, tz) => {
          const start = getPeriodStart(cadence, tz);
          const end = getPeriodEnd(cadence, start);
          expect(end).toBe(start);
        }
      )
    );
  });

  it('getTodayInTimezone always produces a valid date for any IANA timezone', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...timezones),
        (tz) => {
          const result = getTodayInTimezone(tz);
          expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          // Verify it parses to a valid date
          const [y, m, d] = result.split('-').map(Number);
          const date = new Date(y, m - 1, d);
          expect(date.getFullYear()).toBe(y);
          expect(date.getMonth() + 1).toBe(m);
          expect(date.getDate()).toBe(d);
        }
      )
    );
  });

  it('isDeadlinePassed is monotonic: past deadlines are always passed, far future never', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...timezones),
        (tz) => {
          // A deadline far in the past should always be passed
          expect(isDeadlinePassed('2000-01-01', tz)).toBe(true);
          // A deadline far in the future should never be passed
          expect(isDeadlinePassed('2099-12-31', tz)).toBe(false);
        }
      )
    );
  });

  it('DST boundary handling: period computation around March/November produces valid dates', () => {
    // Test with dates around typical DST transitions
    const dstDates = [
      // US DST: March second Sunday, November first Sunday
      '2024-03-10', '2024-03-11', '2024-11-03', '2024-11-04',
      // EU DST: last Sunday of March, last Sunday of October
      '2024-03-31', '2024-10-27',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...dstDates),
        fc.constantFrom(...cadences),
        fc.constantFrom(...timezones),
        (dateStr, cadence, tz) => {
          // We can't directly set "now" but we can verify getPeriodEnd with arbitrary start dates
          const end = getPeriodEnd(cadence, dateStr);
          expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(end >= dateStr).toBe(true);

          if (cadence === 'weekly') {
            const [sy, sm, sd] = dateStr.split('-').map(Number);
            const [ey, em, ed] = end.split('-').map(Number);
            const startDate = new Date(sy, sm - 1, sd);
            const endDate = new Date(ey, em - 1, ed);
            const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
            expect(diffDays).toBe(6);
          } else {
            expect(end).toBe(dateStr);
          }
        }
      )
    );
  });
});
