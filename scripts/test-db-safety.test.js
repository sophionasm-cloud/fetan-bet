'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { databaseIdentity, assertSeparateTestDatabase } = require('./test-db-safety');

const pooled = 'postgresql://app:secret@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
const direct = 'postgresql://test:other@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require';
assert.deepEqual(databaseIdentity(pooled), databaseIdentity(direct));
assert.throws(() => assertSeparateTestDatabase({ DATABASE_URL: pooled, TEST_DATABASE_URL: direct }), /same database/);
assert.throws(() => assertSeparateTestDatabase({ DATABASE_URL: pooled }), /TEST_DATABASE_URL is required/);
assert.throws(() => assertSeparateTestDatabase({ TEST_DATABASE_URL: direct }), /DATABASE_URL is required/);
assert.doesNotThrow(() => assertSeparateTestDatabase({
  DATABASE_URL: pooled,
  TEST_DATABASE_URL: 'postgresql://test:secret@ep-isolated.us-east-2.aws.neon.tech/fetan_test?sslmode=require',
}));

const project = path.resolve(__dirname, '..');
const launcher = fs.readFileSync(path.join(__dirname, 'run-integration-tests.js'), 'utf8');
const database = fs.readFileSync(path.join(project, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(project, 'server.js'), 'utf8');
const suite = fs.readFileSync(path.join(project, 'test.js'), 'utf8');
assert.doesNotMatch(server, /pass\s*===\s*['"]admin(?:123)?['"]/,
  'admin login must not accept hardcoded default passwords');
assert.match(launcher, /process\.env\.TEST_DATABASE_URL/);
assert.match(launcher, /--check/);
assert.doesNotMatch(launcher, /runMigrations\s*\(/);
assert.match(database, /integrationTestMode[\s\S]*process\.env\.TEST_DATABASE_URL/);
assert.match(server, /FETAN_INTEGRATION_TEST !== '1'[\s\S]*seed\(\)/);
assert.match(suite, /FETAN_TEST_DB_PREFLIGHT !== 'passed'[\s\S]*const app = require\('\.\/server'\)/);
for (const name of ['synthetic agent fixture can log in', 'concurrent duplicate Road Dash cashouts settle once',
  'concurrent duplicate Mines cashouts settle once', 'transaction rollback restores wallet',
  'unversioned active Road Dash round', 'unversioned active Mines round', 'unversioned active Bingo round']) {
  assert.ok(suite.includes(name), `integration suite includes ${name}`);
}

console.log('test-db-safety.test.js: fail-closed identity checks passed');
