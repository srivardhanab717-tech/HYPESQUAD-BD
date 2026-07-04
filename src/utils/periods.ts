/**
 * Period computation helpers for timezone-aware date math.
 * Used to determine check-in period boundaries based on goal cadence and user timezone.
 */

/**
 * Get today's date in the user's timezone as a YYYY-MM-DD string.
 */
export function getTodayInTimezone(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // returns YYYY-MM-DD
}

/**
 * Get the period start date for a given cadence and timezone.
 * - Daily: today in user's timezone
 * - Weekly: Monday of the current week in user's timezone
 * - Custom: treated same as daily for v1
 */
export function getPeriodStart(
  cadence: 'daily' | 'weekly' | 'custom',
  timezone: string
): string {
  const todayStr = getTodayInTimezone(timezone);

  if (cadence === 'daily' || cadence === 'custom') {
    return todayStr;
  }

  // Weekly: find Monday of the current week
  const [year, month, day] = todayStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setDate(date.getDate() - daysToMonday);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the period end date for a given cadence (period_start based).
 * - Daily/Custom: same as period_start (single day)
 * - Weekly: Sunday of the same week
 */
export function getPeriodEnd(
  cadence: 'daily' | 'weekly' | 'custom',
  periodStart: string
): string {
  if (cadence === 'daily' || cadence === 'custom') {
    return periodStart;
  }

  // Weekly: period_start is Monday, period_end is Sunday (+6 days)
  const [year, month, day] = periodStart.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 6);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check if a deadline date has passed in the given timezone.
 */
export function isDeadlinePassed(deadline: string, timezone: string): boolean {
  const today = getTodayInTimezone(timezone);
  return today > deadline;
}
