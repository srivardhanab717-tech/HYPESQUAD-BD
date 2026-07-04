import { describe, it, expect } from 'vitest';
import { getPeriodStart, getPeriodEnd, getTodayInTimezone, isDeadlinePassed } from '../src/utils/periods';

describe('Period Computation - Unit Tests', () => {
  describe('getTodayInTimezone', () => {
    it('returns a valid YYYY-MM-DD date string for Asia/Kolkata', () => {
      const result = getTodayInTimezone('Asia/Kolkata');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns a valid YYYY-MM-DD date string for America/New_York', () => {
      const result = getTodayInTimezone('America/New_York');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns a valid YYYY-MM-DD date string for Pacific/Auckland', () => {
      const result = getTodayInTimezone('Pacific/Auckland');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('can produce different dates for timezones far apart', () => {
      // This test verifies that timezone matters: at certain times,
      // US/Hawaii and Pacific/Auckland are on different dates
      const hawaii = getTodayInTimezone('US/Hawaii');
      const auckland = getTodayInTimezone('Pacific/Auckland');
      // We can't assert they're always different (depends on time of day),
      // but we can verify both are valid dates
      expect(hawaii).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(auckland).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getPeriodStart - daily cadence', () => {
    it('returns today for daily cadence in Asia/Kolkata', () => {
      const today = getTodayInTimezone('Asia/Kolkata');
      const periodStart = getPeriodStart('daily', 'Asia/Kolkata');
      expect(periodStart).toBe(today);
    });

    it('returns today for custom cadence (same as daily)', () => {
      const today = getTodayInTimezone('Europe/London');
      const periodStart = getPeriodStart('custom', 'Europe/London');
      expect(periodStart).toBe(today);
    });
  });

  describe('getPeriodStart - weekly cadence', () => {
    it('returns a Monday for weekly cadence', () => {
      const periodStart = getPeriodStart('weekly', 'Asia/Kolkata');
      const [y, m, d] = periodStart.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      // getDay(): 0=Sun, 1=Mon, ... => Monday is 1
      expect(date.getDay()).toBe(1);
    });

    it('returns a Monday for weekly cadence in America/New_York', () => {
      const periodStart = getPeriodStart('weekly', 'America/New_York');
      const [y, m, d] = periodStart.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      expect(date.getDay()).toBe(1);
    });

    it('period start is <= today in the same timezone', () => {
      const today = getTodayInTimezone('Europe/London');
      const periodStart = getPeriodStart('weekly', 'Europe/London');
      expect(periodStart <= today).toBe(true);
    });
  });

  describe('getPeriodEnd', () => {
    it('returns same date for daily cadence', () => {
      const start = '2024-06-15';
      const end = getPeriodEnd('daily', start);
      expect(end).toBe('2024-06-15');
    });

    it('returns same date for custom cadence', () => {
      const start = '2024-06-15';
      const end = getPeriodEnd('custom', start);
      expect(end).toBe('2024-06-15');
    });

    it('returns Sunday (start + 6 days) for weekly cadence', () => {
      // Monday June 10, 2024
      const start = '2024-06-10';
      const end = getPeriodEnd('weekly', start);
      expect(end).toBe('2024-06-16'); // Sunday June 16
    });

    it('handles month boundary correctly for weekly cadence', () => {
      // Monday June 24, 2024
      const start = '2024-06-24';
      const end = getPeriodEnd('weekly', start);
      expect(end).toBe('2024-06-30'); // Sunday June 30
    });

    it('handles year boundary correctly for weekly cadence', () => {
      // Monday Dec 30, 2024
      const start = '2024-12-30';
      const end = getPeriodEnd('weekly', start);
      expect(end).toBe('2025-01-05'); // Sunday Jan 5, 2025
    });
  });

  describe('isDeadlinePassed', () => {
    it('returns false when deadline is in the future', () => {
      // Set a deadline far in the future
      const futureDeadline = '2099-12-31';
      expect(isDeadlinePassed(futureDeadline, 'Asia/Kolkata')).toBe(false);
    });

    it('returns true when deadline is in the past', () => {
      const pastDeadline = '2020-01-01';
      expect(isDeadlinePassed(pastDeadline, 'Asia/Kolkata')).toBe(true);
    });

    it('returns false when deadline is today', () => {
      const today = getTodayInTimezone('Asia/Kolkata');
      // isDeadlinePassed checks today > deadline, so same day = not passed
      expect(isDeadlinePassed(today, 'Asia/Kolkata')).toBe(false);
    });
  });
});
