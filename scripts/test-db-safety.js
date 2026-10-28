'use strict';

function databaseIdentity(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new Error('Database connection string is missing.');
  }
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Database connection string is invalid.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error('Database connection string must identify a PostgreSQL database.');
  }

  let host = parsed.hostname.toLowerCase();
  // Neon pooled and direct URLs point at the same branch; don't treat pooler as isolation.
  host = host.replace(/-pooler(?=\.)/i, '');
  return {
    host,
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}

function formatIdentity(identity) {
  return `${identity.host}:${identity.port}/${identity.database}`;
}

function assertSeparateTestDatabase(env = process.env) {
  if (!env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required; refusing to start integration tests.');
  }
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to verify test-database separation; refusing to start integration tests.');
  }

  const test = databaseIdentity(env.TEST_DATABASE_URL);
  const application = databaseIdentity(env.DATABASE_URL);
  if (test.host === application.host && test.port === application.port && test.database === application.database) {
    throw new Error(`Refusing integration tests: test and application URLs identify the same database (${formatIdentity(test)}).`);
  }
  return { test, application };
}

module.exports = { databaseIdentity, formatIdentity, assertSeparateTestDatabase };
