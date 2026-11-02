'use strict';

// Destructive-capability integration tests are restricted to the hard-coded Neon test target.
// They create uniquely named synthetic users/ledger rows and leave those rows in the test branch.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { assertExpectedNeonTestEndpoint } = require('./test-db-safety');

const EXPECTED = {
  project: 'muddy-dew-45860324',
  branch: 'br-patient-recipe-b58ey3ge',
  endpoint: 'ep-withered-pond-b5xflte3',
  hostname: 'ep-withered-pond-b5xflte3-pooler.c-7.us-east-2.aws.neon.tech',
};

function assertTestTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required.');
  const host = new URL(url).hostname.toLowerCase();
  if (host !== EXPECTED.hostname) throw new Error('TEST_DATABASE_URL hostname mismatch; refusing connection.');
  assertExpectedNeonTestEndpoint(url, EXPECTED.endpoint);
  return url;
}

async function verifyIdentity(url) {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true }, options: '-c default_transaction_read_only=on' });
  await client.connect();
  try {
    const q = await client.query("SELECT current_setting('neon.project_id',true) project,current_setting('neon.branch_id',true) branch,current_setting('neon.endpoint_id',true) endpoint");
    assert.deepEqual(q.rows[0], { project: EXPECTED.project, branch: EXPECTED.branch, endpoint: EXPECTED.endpoint });
    const migration = await client.query("SELECT 1 FROM schema_migrations WHERE name='006_chicken_road_dash_real.sql'");
    assert.equal(migration.rowCount, 1, 'migration 006 must be recorded before integration tests');
    const objects = await client.query("SELECT to_regclass('public.chicken_road_dash_rounds') rounds,to_regclass('public.chicken_road_dash_actions') actions");
    assert.ok(objects.rows[0].rounds && objects.rows[0].actions, 'real-round tables must exist');
  } finally { await client.end(); }
}

async function main() {
  const url = assertTestTarget();
  await verifyIdentity(url);
  process.env.NODE_ENV = 'test';
  process.env.FETAN_TEST_DATABASE_ONLY = '1';
  process.env.FETAN_TEST_DB_PREFLIGHT = 'passed';
  process.env.FETAN_EXPECTED_TEST_ENDPOINT_ID = EXPECTED.endpoint;
  process.env.FETAN_EXPECTED_TEST_PROJECT_ID = EXPECTED.project;
  process.env.FETAN_EXPECTED_TEST_BRANCH_ID = EXPECTED.branch;
  process.env.TEST_DATABASE_BRANCH_ID = EXPECTED.branch;
  const db = require('../db');
  const { createChickenRoadRealService } = require('../chicken-road-real-service');
  const { laneOutcomes, commitSeed, verifyProof } = require('../chicken-road-committed');
  const { ladderFor } = require('../chicken-road-demo-service');
  const service = createChickenRoadRealService({ query: db.query, withTx: db.withTx, ledger: db.postLedger });
  const results = [];

  async function account(balance = 500000) {
    const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 24);
    const id = await db.withTx(async c => {
      const inserted = await c.query("INSERT INTO users(name,phone,password_hash,role) VALUES($1,$2,$3,'user') RETURNING id", [`SYNTHETIC Chicken Dash ${marker}`, `+999${Date.now()}${Math.floor(Math.random()*1000)}`, 'synthetic-test-only']);
      const userId = Number(inserted.rows[0].id);
      await c.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [userId]);
      await db.postLedger({ client: c, userId, delta: balance, type: 'test_funding', refType: 'chicken_dash_integration', refId: userId });
      return userId;
    });
    return id;
  }

  async function reconcile(userId, expectedBalance) {
    const q = await db.query('SELECT w.balance,COALESCE(SUM(l.amount),0)::bigint ledger_total FROM wallets w LEFT JOIN ledger l ON l.user_id=w.user_id WHERE w.user_id=$1 GROUP BY w.balance', [userId]);
    assert.equal(Number(q.rows[0].balance), expectedBalance);
    assert.equal(Number(q.rows[0].ledger_total), expectedBalance);
  }

  function seedFor(roundId, difficulty, predicate) {
    for (let n = 0; n < 100000; n++) {
      const seed = Buffer.alloc(32); seed.writeUInt32BE(n, 28);
      const outcomes = laneOutcomes(seed, roundId, difficulty);
      if (predicate(outcomes)) return seed;
    }
    throw new Error(`Could not find deterministic synthetic seed for ${difficulty}.`);
  }

  async function newRound({ difficulty='easy', bet=5000, requireAllSafe=false, firstCollision=false, failWin=false } = {}) {
    const userId = await account();
    const roundId = crypto.randomUUID();
    const seed = seedFor(roundId, difficulty, outcomes => requireAllSafe
      ? outcomes.every(o => o.outcome === 'safe')
      : firstCollision ? outcomes[0].outcome === 'collision' : outcomes[0].outcome === 'safe');
    const g = failWin ? createChickenRoadRealService({ query: db.query, withTx: db.withTx,
      generateId: () => roundId, generateSeed: () => seed,
      ledger: async args => { const b=await db.postLedger(args); if(args.delta>0)throw Error('INJECTED_TEST_SETTLEMENT_FAILURE'); return b; },
    }) : createChickenRoadRealService({ query: db.query, withTx: db.withTx, ledger: db.postLedger,
      generateId: () => roundId, generateSeed: () => seed });
    const startKey=crypto.randomUUID();
    const round=await g.start(userId,{difficulty,bet_santim:bet,action_id:startKey});
    return {userId,roundId,seed,g,round,startKey,bet};
  }

  // Start debit, retry idempotency, key mismatch rejection and active recovery.
  console.log('Integration phase: start/idempotency/recovery');
  {
    console.log('  creating synthetic account and starting round');
    const x=await newRound();
    console.log('  retrying identical start key');
    assert.equal(x.round.balance_santim,500000-x.bet);
    assert.equal((await x.g.start(x.userId,{difficulty:'easy',bet_santim:x.bet,action_id:x.startKey})).id,x.roundId);
    await assert.rejects(x.g.start(x.userId,{difficulty:'medium',bet_santim:x.bet,action_id:x.startKey}),/STALE_ACTION/);
    console.log('  recovering round and reconciling');
    const restartedService=createChickenRoadRealService({query:db.query,withTx:db.withTx,ledger:db.postLedger});
    assert.equal((await restartedService.current(x.userId)).round.id,x.roundId);
    await reconcile(x.userId,500000-x.bet);
    results.push('start debit/idempotency/active recovery/reconciliation');
  }

  // Insufficient funds must roll back round creation and leave only the test-funding ledger row.
  console.log('Integration phase: insufficient balance');
  {
    const userId=await account(99);
    const roundId=crypto.randomUUID();
    const g=createChickenRoadRealService({query:db.query,withTx:db.withTx,ledger:db.postLedger,generateId:()=>roundId});
    await assert.rejects(g.start(userId,{difficulty:'easy',bet_santim:100,action_id:crypto.randomUUID()}),/INSUFFICIENT/);
    const rounds=await db.query('SELECT count(*)::int n FROM chicken_road_dash_rounds WHERE user_id=$1',[userId]);
    const ledger=await db.query('SELECT count(*)::int n FROM ledger WHERE user_id=$1',[userId]);
    assert.equal(rounds.rows[0].n,0);assert.equal(ledger.rows[0].n,1);
    await reconcile(userId,99);
    results.push('insufficient balance rejects without round, debit or ledger corruption');
  }

  // Each configured difficulty has server-generated committed outcomes; safe crossing and cash-out.
  console.log('Integration phase: difficulty/crossing/cashout/concurrency');
  for(const difficulty of ['easy','medium','hard']) {
    const x=await newRound({difficulty});
    const crossing=await x.g.cross(x.userId,x.roundId,crypto.randomUUID());
    assert.equal(crossing.outcome,'safe');
    assert.equal(crossing.step,1);
    const key=crypto.randomUUID();
    const [paid,retried]=await Promise.all([x.g.cashout(x.userId,x.roundId,key),x.g.cashout(x.userId,x.roundId,key)]);
    assert.deepEqual(retried,paid);
    assert.equal(paid.payout_santim,Math.round(x.bet*ladderFor(difficulty)[0]));
    assert.equal((await x.g.current(x.userId)).balance_santim,500000-x.bet+paid.payout_santim);
    await assert.rejects(x.g.cashout(x.userId,x.roundId,crypto.randomUUID()),/ROUND_SETTLED/);
    await reconcile(x.userId,500000-x.bet+paid.payout_santim);
  }
  results.push('Easy/Medium/Hard safe crossing, cash-out, concurrent duplicate settlement and ledger reconciliation');

  // Crash is a full stake loss with no payout ledger entry.
  console.log('Integration phase: crash/fairness');
  {
    const x=await newRound({firstCollision:true});
    const crashed=await x.g.cross(x.userId,x.roundId,crypto.randomUUID());
    assert.equal(crashed.crashed,true);assert.equal(crashed.payout_santim,0);
    const led=await db.query("SELECT count(*)::int n FROM ledger WHERE user_id=$1 AND ref_type='game_round'",[x.userId]);
    assert.equal(led.rows[0].n,1);
    const proof=await x.g.verify(x.userId,x.roundId);assert.equal(proof.seed_commit_valid,true);assert.equal(proof.outcomes_match_seed,true);assert.equal(proof.merkle_proofs_valid,true);
    await reconcile(x.userId,500000-x.bet);
    results.push('crash/no payout/fairness proof');
  }

  // Full finish applies exactly the existing final ladder × 1.5 rule.
  console.log('Integration phase: finish');
  {
    const x=await newRound({requireAllSafe:true,bet:2000});
    for(let lane=1;lane<=14;lane++){const r=await x.g.cross(x.userId,x.roundId,crypto.randomUUID());assert.equal(r.crashed,false);assert.equal(r.step,lane);}
    const finish=await x.g.cross(x.userId,x.roundId,crypto.randomUUID());
    const expected=Math.round(x.bet*ladderFor('easy')[13]*1.5);
    assert.equal(finish.outcome,'finish');assert.equal(finish.payout_santim,expected);
    const proof=await x.g.verify(x.userId,x.roundId);assert.equal(proof.seed_commit_valid,true);assert.equal(proof.merkle_proofs_valid,true);
    await reconcile(x.userId,500000-x.bet+expected);
    results.push('14 lanes + finish bonus + fairness verification + ledger reconciliation');
  }

  // Failure after a real postLedger credit must roll back wallet and ledger in the real tx.
  console.log('Integration phase: rollback');
  {
    const x=await newRound({failWin:true});
    await x.g.cross(x.userId,x.roundId,crypto.randomUUID());
    const before=await db.query('SELECT balance FROM wallets WHERE user_id=$1',[x.userId]);
    const ledgerBefore=await db.query('SELECT count(*)::int n FROM ledger WHERE user_id=$1',[x.userId]);
    await assert.rejects(x.g.cashout(x.userId,x.roundId,crypto.randomUUID()),/INJECTED_TEST_SETTLEMENT_FAILURE/);
    const after=await db.query('SELECT balance FROM wallets WHERE user_id=$1',[x.userId]);
    const ledgerAfter=await db.query('SELECT count(*)::int n FROM ledger WHERE user_id=$1',[x.userId]);
    assert.equal(after.rows[0].balance,before.rows[0].balance);assert.equal(ledgerAfter.rows[0].n,ledgerBefore.rows[0].n);
    assert.equal((await x.g.current(x.userId)).round.status,'active');
    await reconcile(x.userId,Number(before.rows[0].balance));
    results.push('actual PostgreSQL rollback after wallet+ledger posting');
  }

  console.log(JSON.stringify({ identity: EXPECTED, migration006: 'applied', tests: results, syntheticUsersCreated: 8 }, null, 2));
  await db.pool.end();
}

main().catch(error=>{console.error('Chicken Road PostgreSQL integration failed:',error.code||error.name||'error',String(error.message||''),String(error.stack||'').split('\n').slice(1,4).join('\n'));process.exitCode=1;});
