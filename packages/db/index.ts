import postgres from 'postgres';
import { join } from 'path';
import { readFileSync } from 'fs';

// Initialize PostgreSQL database connection pool
const dbUrl =
  process.env.DATABASE_URL || 'postgres://app_rw:app_rw_password@localhost:5432/calypso_app';
console.log(`[db] Binding to PostgreSQL at: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`); // Redact password in logs

export const sql = postgres(dbUrl, {
  max: 10, // Max number of connections
  idle_timeout: 20, // Idle connection timeout in seconds
  connect_timeout: 10, // Connect timeout in seconds
});

/**
 * Initializes the database tables by executing the native raw SQL schema.
 * This function should be called at server startup to ensure tables exist.
 */
export async function migrate() {
  console.log('[db] Initializing PostgreSQL database schema...');
  const schemaSql = readFileSync(join(import.meta.dir, 'schema.sql'), 'utf-8');

  try {
    // Remove comments and split by semicolon
    const cleanSql = schemaSql
      .replace(/--.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

    const statements = cleanSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Execute sequentially
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
    console.log('[db] Schema migration complete.');
  } catch (err) {
    console.error('[db] Schema migration failed:', err);
    throw err;
  }
}
