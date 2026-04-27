/**
 * Trading day utilities shared across chart components.
 *
 * Previously duplicated in MiniSparkline.tsx and PriceChart.tsx; now a
 * single source of truth. Also fixes a prior bug where US market holidays
 * were not skipped, causing forecast lines to land on closed-market dates
 * around Christmas, Thanksgiving, etc.
 */

/**
 * US stock market holidays through 2027.
 * Source: NYSE holiday schedule.
 * Update annually or replace with a live API call if needed.
 */
const US_MARKET_HOLIDAYS = new Set([
  // 2025
  "2025-01-01", // New Year's Day
  "2025-01-20", // MLK Day
  "2025-02-17", // Presidents' Day
  "2025-04-18", // Good Friday
  "2025-05-26", // Memorial Day
  "2025-06-19", // Juneteenth
  "2025-07-04", // Independence Day
  "2025-09-01", // Labor Day
  "2025-11-27", // Thanksgiving
  "2025-12-25", // Christmas
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // MLK Day
  "2027-02-15", // Presidents' Day
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed)
  "2027-07-05", // Independence Day (observed)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving
  "2027-12-24", // Christmas (observed)
]);

/**
 * Returns true if the given YYYY-MM-DD date is a US market trading day
 * (i.e. not a weekend and not a known NYSE holiday).
 */
export function isTradingDay(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false; // weekend
  if (US_MARKET_HOLIDAYS.has(dateStr)) return false;
  return true;
}

/**
 * Advance a YYYY-MM-DD date by N trading days, skipping weekends and
 * US NYSE holidays.
 *
 * Previously each component had its own copy that skipped only weekends.
 * This version also skips known market holidays so projected price lines
 * land on actual trading dates.
 */
export function addTradingDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (isTradingDay(iso)) added++;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Format a YYYY-MM-DD date string as "Mar 20".
 */
export function formatTradingDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
