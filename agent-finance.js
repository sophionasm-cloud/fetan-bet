'use strict';

const DEFAULT_COMMISSION_BPS = 1000;
const WEEK_TIME_ZONE = 'UTC';

// Losses carry forward: commission is paid only on cumulative positive user loss.
function commissionForWeek(profitSantim, carriedLossSantim, rateBps = DEFAULT_COMMISSION_BPS) {
  for (const value of [profitSantim, carriedLossSantim, rateBps]) {
    if (!Number.isSafeInteger(value)) throw new TypeError('Settlement values must be safe integers.');
  }
  if (carriedLossSantim < 0 || rateBps < 0 || rateBps > 10000) throw new RangeError('Invalid settlement settings.');
  const profit = BigInt(profitSantim);
  const carry = BigInt(carriedLossSantim);
  const availableProfit = profit > carry ? profit - carry : 0n;
  const nextCarry = carry > profit ? carry - profit : 0n;
  const commission = (availableProfit * BigInt(rateBps)) / 10000n;
  if (commission > BigInt(Number.MAX_SAFE_INTEGER) || nextCarry > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Settlement result exceeds safe santim range.');
  }
  return {
    commissionSantim: Number(commission),
    carriedLossSantim: Number(nextCarry),
  };
}

function utcWeekBounds(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError('Invalid settlement date.');
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString(), timeZone: WEEK_TIME_ZONE };
}

function completedWeekBounds(weekStartValue, now = new Date()) {
  const current = utcWeekBounds(now);
  const value = weekStartValue == null || weekStartValue === ''
    ? new Date(Date.parse(current.start) - 7 * 86400000).toISOString().slice(0, 10)
    : String(weekStartValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Week start must be a UTC date.');
  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value || start.getUTCDay() !== 1) {
    throw new TypeError('Week start must be a valid UTC Monday.');
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  if (end > new Date(current.start)) throw new RangeError('Settlement week must be complete.');
  return { start: start.toISOString(), end: end.toISOString(), timeZone: WEEK_TIME_ZONE };
}

module.exports = { DEFAULT_COMMISSION_BPS, WEEK_TIME_ZONE, commissionForWeek, utcWeekBounds, completedWeekBounds };
