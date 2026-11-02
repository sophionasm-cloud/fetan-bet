'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { assertExpectedNeonTestEndpoint } = require('./test-db-safety');

const BASE = 'http://127.0.0.1:3001';
const ENDPOINT_ID = 'ep-withered-pond-b5xflte3';

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
  const endpoint = assertExpectedNeonTestEndpoint(process.env.TEST_DATABASE_URL, ENDPOINT_ID);
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const users = await client.query("SELECT id FROM users WHERE name='Chicken Road Dash API smoke test' ORDER BY id DESC LIMIT 1");
    if (!users.rowCount) throw new Error('No synthetic API smoke-test user is available.');
    const userId = Number(users.rows[0].id);
    const cookie = `token=${jwt.sign({ uid: userId }, process.env.JWT_SECRET || 'dev-secret-change-me', { expiresIn: '10m' })}`;
    async function request(path, method = 'GET', body) {
      const response = await fetch(`${BASE}${path}`, {
        method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(`${method} ${path} returned HTTP ${response.status}: ${payload.error || 'unknown'}`);
      return payload;
    }

    const mode = process.argv[2];
    if (mode === 'prepare') {
      let current = await request('/api/games/chicken-road-dash/demo');
      let roundId = current.round?.active ? current.round.id : null;
      for (let attempt = 0; attempt < 20 && !roundId; attempt++) {
        const round = await request('/api/games/chicken-road-dash/demo/start', 'POST', { difficulty: 'easy', bet_santim: 100 });
        for (let lane = 0; lane < 15; lane++) {
          const result = await request('/api/games/chicken-road-dash/demo/cross', 'POST', {
            round_id: round.id, action_id: crypto.randomUUID(),
          });
          if (result.crashed || result.finished) break;
          roundId = round.id;
          break;
        }
      }
      if (!roundId) throw new Error('Could not create an active round with at least one safe crossing.');
      current = await request('/api/games/chicken-road-dash/demo');
      if (current.round?.id !== roundId || !current.round.active || Number(current.round.step) < 1) {
        throw new Error('Prepared recovery round is not active at the expected progress.');
      }
      console.log(JSON.stringify({ phase: 'prepare', endpointId: endpoint.endpointId, userId, roundId, step: current.round.step, commitment: current.round.commitment }));
      return;
    }

    if (mode === 'resume' && process.argv[3]) {
      const expectedRoundId = process.argv[3];
      const current = await request('/api/games/chicken-road-dash/demo');
      if (current.round?.id !== expectedRoundId || !current.round.active || Number(current.round.step) < 1) {
        throw new Error('Active round did not recover unchanged after the local server restart.');
      }
      const result = await request('/api/games/chicken-road-dash/demo/cashout', 'POST', {
        round_id: expectedRoundId, action_id: crypto.randomUUID(),
      });
      const proof = await request(`/api/games/chicken-road-dash/demo/verify/${expectedRoundId}`);
      if (!proof.seed_commit_valid || !proof.outcomes_match_seed || !proof.merkle_proofs_valid) {
        throw new Error('Recovered round verification failed after cash-out.');
      }
      console.log(JSON.stringify({ phase: 'resume', endpointId: endpoint.endpointId, roundRecovered: true,
        sameRoundId: current.round.id === expectedRoundId, stepRecovered: current.round.step,
        cashoutPayoutSantim: result.payout_santim, proofValid: true }));
      return;
    }
    throw new Error('Usage: prepare OR resume <round-id>.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Chicken Road Dash restart-recovery check failed: ${error.message}`);
  process.exitCode = 1;
});
