'use strict';

require('dotenv').config();
const { Client } = require('pg');
const { assertExpectedNeonTestEndpoint } = require('./test-db-safety');

const expected = {
  projectId: 'muddy-dew-45860324',
  branchId: 'br-patient-recipe-b58ey3ge',
  endpointId: 'ep-withered-pond-b5xflte3',
};

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
  const target = assertExpectedNeonTestEndpoint(process.env.TEST_DATABASE_URL, expected.endpointId);
  // Do not log or inspect any other database URL. This connection is built
  // exclusively from TEST_DATABASE_URL after the endpoint check above.
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const migration = await client.query("SELECT 1 FROM schema_migrations WHERE name='005_chicken_road_dash_demo.sql'");
    const tables = await client.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN (
        'chicken_road_dash_demo_balances','chicken_road_dash_demo_rounds','chicken_road_dash_demo_actions'
      ) ORDER BY table_name`);
    const triggers = await client.query(`SELECT count(*)::int AS count FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN (
        'trg_chicken_road_dash_demo_commitment_immutable','trg_chicken_road_dash_demo_actions_immutable'
      )`);
    const result = {
      projectId: expected.projectId,
      branchId: expected.branchId,
      endpointId: target.endpointId,
      migration005Applied: migration.rowCount === 1,
      demoTables: tables.rows.map((row) => row.table_name),
      requiredDemoTablesPresent: tables.rowCount === 3,
      immutabilityTriggers: Number(triggers.rows[0].count),
    };
    console.log(JSON.stringify(result));
    if (!result.migration005Applied || !result.requiredDemoTablesPresent || result.immutabilityTriggers !== 2) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Test branch schema verification failed (${error.code || 'configuration'}).`);
  process.exitCode = 1;
});
