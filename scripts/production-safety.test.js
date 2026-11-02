'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveRuntimeConnectionString, postgresSslOptions } = require('./database-config');
const { createHealthHandler } = require('../health-check');

assert.equal(resolveRuntimeConnectionString({ NODE_ENV: 'production', DATABASE_URL: 'postgres://production' }), 'postgres://production');
assert.throws(() => resolveRuntimeConnectionString({ NODE_ENV: 'production', TEST_DATABASE_URL: 'postgres://test' }), /DATABASE_URL is required/);
assert.equal(resolveRuntimeConnectionString({ NODE_ENV: 'development', TEST_DATABASE_URL: 'postgres://test' }), 'postgres://test');
assert.deepEqual(postgresSslOptions(), { rejectUnauthorized: true });

async function testHealthHandler() {
  const secretMessage = 'password=never-log-this host=private-db.example';
  const logged = [];
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const handler = createHealthHandler({
    query: async () => { const error = new Error(secretMessage); error.code = '08006'; throw error; },
    logger: { error: (...args) => logged.push(args) },
  });

  await handler({}, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, status: 'unhealthy' });
  assert.equal(JSON.stringify(logged).includes(secretMessage), false);
  assert.deepEqual(logged[0][1], { code: '08006' });

  const yaml = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
  assert.match(yaml, /healthCheckPath:\s*\/health/);

  const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const migrationSource = fs.readFileSync(path.join(__dirname, 'run-migrations.js'), 'utf8');
  assert.match(dbSource, /ssl:\s*postgresSslOptions\(\)/);
  assert.match(migrationSource, /ssl:\s*postgresSslOptions\(\)/);
  assert.doesNotMatch(dbSource + migrationSource, /rejectUnauthorized:\s*false/);
}

testHealthHandler().then(() => {
  console.log('production-safety.test.js: production DB, TLS, health and Render checks passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
