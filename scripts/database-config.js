'use strict';

function resolveRuntimeConnectionString(env = process.env, sanitize = (value) => value) {
  if (env.NODE_ENV === 'production') {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production.');
    }
    return sanitize(env.DATABASE_URL);
  }

  return sanitize(env.DATABASE_URL || env.TEST_DATABASE_URL || '');
}

function postgresSslOptions() {
  // Node verifies the PostgreSQL server certificate against its trusted CA store.
  // Neon endpoints use standard TLS certificates and remain compatible with this.
  return { rejectUnauthorized: true };
}

module.exports = { resolveRuntimeConnectionString, postgresSslOptions };
