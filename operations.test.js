'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_PERMISSIONS, hasPermission } = require('./permissions');
const { commissionForWeek, utcWeekBounds, completedWeekBounds } = require('./agent-finance');

// Pure, database-free checks for the role and agent settlement rules.
assert.equal(hasPermission('superadmin', 'money.decide'), true);
assert.equal(hasPermission('admin', 'admin.workspace'), true);
assert.equal(hasPermission('admin', 'audit.read'), true);
assert.equal(hasPermission('admin', 'money.decide'), false);
assert.equal(hasPermission('agent', 'support.assigned'), true);
assert.equal(hasPermission('user', 'support.own'), true);
assert.equal(hasPermission('agent', 'support.own'), false);
assert.equal(hasPermission('admin', 'support.reply'), true);
assert.equal(hasPermission('agent', 'money.decide'), false);
assert.equal(hasPermission('user', 'agent.workspace'), false);
assert.deepEqual(ROLE_PERMISSIONS.agent.includes('agents.manage'), false);

assert.deepEqual(commissionForWeek(10001, 0, 1000), { commissionSantim: 1000, carriedLossSantim: 0 });
assert.deepEqual(commissionForWeek(-500, 0, 1000), { commissionSantim: 0, carriedLossSantim: 500 });
assert.deepEqual(commissionForWeek(1000, 500, 1000), { commissionSantim: 50, carriedLossSantim: 0 });
assert.deepEqual(commissionForWeek(300, 500, 1000), { commissionSantim: 0, carriedLossSantim: 200 });
assert.deepEqual(commissionForWeek(1000, 0, 0), { commissionSantim: 0, carriedLossSantim: 0 });
assert.throws(() => commissionForWeek(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1000), /safe santim range/);
assert.throws(() => commissionForWeek(1.5, 0, 1000), /safe integers/);

const bounds = utcWeekBounds(new Date('2026-10-29T12:34:56Z'));
assert.equal(bounds.start, '2026-10-26T00:00:00.000Z');
assert.equal(bounds.end, '2026-11-02T00:00:00.000Z');
assert.equal(bounds.timeZone, 'UTC');
assert.deepEqual(completedWeekBounds('2026-10-19', new Date('2026-10-29T12:34:56Z')), {
  start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z', timeZone: 'UTC'
});
assert.throws(() => completedWeekBounds('2026-10-26', new Date('2026-10-29T12:34:56Z')), /complete/);
assert.throws(() => completedWeekBounds('2026-10-20', new Date('2026-10-29T12:34:56Z')), /Monday/);

const migration = fs.readFileSync(path.join(__dirname, 'migrations/003_agent_referrals_superadmin_settlements.sql'), 'utf8');
assert.match(migration, /LOWER\(promo_code\)/);
assert.match(migration, /support_messages_sender_role_check[\s\S]*'superadmin'/);
assert.match(migration, /trg_agent_weekly_settlements_immutable/);
assert.match(migration, /trg_staff_action_history_immutable/);

console.log('Operations checks passed (permissions, commission, UTC week boundaries, migration invariants).');
