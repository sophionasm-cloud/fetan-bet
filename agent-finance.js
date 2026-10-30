'use strict';

// Fetan Bet business rule: agents earn 25% of positive eligible net gaming
// revenue. Weekly boundaries are local to Ethiopia (Africa/Addis_Ababa).
const DEFAULT_COMMISSION_BPS = 2500;
const WEEK_TIME_ZONE = 'Africa/Addis_Ababa';
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

// Returns the UTC instants for Monday 00:00 through next Monday 00:00 in
// Addis Ababa local time. Ethiopia has a fixed UTC+3 offset, so this remains
// stable without a timezone database dependency.
function utcWeekBounds(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError('Invalid settlement date.');
  const eat = new Date(d.getTime() + EAT_OFFSET_MS);
  const localMidnightUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate());
  const daysSinceMonday = (new Date(localMidnightUtc).getUTCDay() + 6) % 7;
  const start = new Date(localMidnightUtc - daysSinceMonday * DAY_MS - EAT_OFFSET_MS);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  return { start: start.toISOString(), end: end.toISOString(), timeZone: WEEK_TIME_ZONE };
}

function completedWeekBounds(weekStartValue, now = new Date()) {
  const current = utcWeekBounds(now);
  const value = weekStartValue == null || weekStartValue === ''
    ? new Date(Date.parse(current.start) - 7 * DAY_MS).toISOString().slice(0, 10)
    : String(weekStartValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Week start must be an Addis Ababa date.');

  const [year, month, day] = value.split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(calendar.getTime()) ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCDay() !== 1
  ) {
    throw new TypeError('Week start must be a valid Monday in Africa/Addis_Ababa.');
  }

  const start = new Date(Date.parse(`${value}T00:00:00.000+03:00`));
  const end = new Date(start.getTime() + 7 * DAY_MS);
  if (end > new Date(current.start)) throw new RangeError('Settlement week must be complete.');
  return { start: start.toISOString(), end: end.toISOString(), timeZone: WEEK_TIME_ZONE };
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS);
}

module.exports = {
  DEFAULT_COMMISSION_BPS,
  WEEK_TIME_ZONE,
  commissionForWeek,
  utcWeekBounds,
  completedWeekBounds,
  addDays,
};
