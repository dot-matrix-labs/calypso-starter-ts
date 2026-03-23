import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { buildSslOptions } from './ssl';

export { buildSslOptions } from './ssl';

const DEFAULT_DATABASE_URLS = {
  app: 'postgres://app_rw:app_rw_password@localhost:5432/calypso_app',
  audit: 'postgres://audit_w:audit_w_password@localhost:5432/calypso_audit',
  analytics: 'postgres://analytics_w:analytics_w_password@localhost:5432/calypso_analytics',
} as const;

export interface DatabaseUrls {
  app: string;
  audit: string;
  analytics: string;
}

// Starter implementation note:
// This package currently exposes a single connection pool bound to calypso_app.
// The target blueprint posture splits transactional, analytics, and audit paths
// across separate roles / databases so business journals, analytics, and audit
// writes cannot be conflated at runtime.
function maskDbUrl(dbUrl: string): string {
  return dbUrl.replace(/:[^:@]+@/, ':***@');
}

export function resolveDatabaseUrls(env: NodeJS.ProcessEnv = process.env): DatabaseUrls {
  return {
    app: env.DATABASE_URL || DEFAULT_DATABASE_URLS.app,
    audit: env.AUDIT_DATABASE_URL || DEFAULT_DATABASE_URLS.audit,
    analytics: env.ANALYTICS_DATABASE_URL || DEFAULT_DATABASE_URLS.analytics,
  };
}

function createPool(databaseUrl: string, max: number) {
  console.log(`[db] Binding to PostgreSQL at: ${maskDbUrl(databaseUrl)}`);
  return postgres(databaseUrl, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: buildSslOptions(),
    connection: { client_min_messages: 'warning' },
  });
}

const databaseUrls = resolveDatabaseUrls();

export const sql = createPool(databaseUrls.app, 10);
export const auditSql = createPool(databaseUrls.audit, 5);
export const analyticsSql = createPool(databaseUrls.analytics, 3);

export interface MigrateOptions {
  databaseUrl?: string;
}

export interface MigrateAuditOptions {
  databaseUrl?: string;
}

/**
 * Split a SQL string into individual statements on top-level semicolons,
 * respecting dollar-quoted blocks ($$...$$) so PL/pgSQL function bodies
 * that contain semicolons are never split mid-body.
 *
 * This is intentionally minimal: it handles the common `$$` tag only.
 * Named dollar tags (e.g. $body$) are not needed for our schema.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let i = 0;

  while (i < sql.length) {
    // Check for $$ delimiter
    if (sql[i] === '$' && sql[i + 1] === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i += 2;
      continue;
    }

    if (!inDollarQuote && sql[i] === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i += 1;
      continue;
    }

    current += sql[i];
    i += 1;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

/**
 * Initializes the database tables by executing the native raw SQL schema.
 * This function should be called at server startup to ensure tables exist.
 *
 * Policy note:
 * This is a starter bootstrap migration path, not the final enterprise data
 * posture. Future work should separate graph schema setup from ledger / journal
 * migrations, audit-store setup, and digital-twin checkpoint infrastructure.
 */
export async function migrate(options: MigrateOptions = {}) {
  console.log('[db] Initializing PostgreSQL database schema...');
  const schemaSql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf-8');
  const databaseUrl = options.databaseUrl ?? databaseUrls.app;
  const migrationSql =
    options.databaseUrl === undefined
      ? sql
      : postgres(databaseUrl, {
          max: 1,
          idle_timeout: 10,
          connect_timeout: 10,
          connection: { client_min_messages: 'warning' },
        });

  try {
    // Remove single-line and block comments, then split by top-level semicolons.
    // Dollar-quoted blocks ($$...$$) are preserved intact so PL/pgSQL function
    // bodies are not split mid-body.
    const cleanSql = schemaSql
      .replace(/--.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

    const statements = splitSqlStatements(cleanSql).filter((s) => s.length > 0);

    // Execute sequentially
    for (const statement of statements) {
      await migrationSql.unsafe(statement);
    }
    console.log('[db] Schema migration complete.');
  } catch (err) {
    console.error('[db] Schema migration failed:', err);
    throw err;
  } finally {
    if (migrationSql !== sql) {
      await migrationSql.end({ timeout: 5 });
    }
  }
}

/**
 * Verifies connectivity to the audit database at server startup.
 *
 * The audit schema (audit_log table, indexes, grants) is created by
 * init-remote.ts running as a database admin at deploy time. Attempting to
 * re-run that DDL here as audit_w fails on PG 15+ because audit_w only holds
 * USAGE on the public schema, not CREATE. This function replaces the old
 * DDL-executing migration with a lightweight SELECT 1 connectivity probe so
 * that server startup succeeds and emitAuditEvent works on the first request.
 */
export async function migrateAudit(options: MigrateAuditOptions = {}) {
  console.log('[db] Verifying audit database connectivity...');
  const databaseUrl = options.databaseUrl ?? databaseUrls.audit;
  const connectSql =
    options.databaseUrl === undefined
      ? auditSql
      : postgres(databaseUrl, {
          max: 1,
          idle_timeout: 10,
          connect_timeout: 10,
          connection: { client_min_messages: 'warning' },
        });

  try {
    await connectSql`SELECT 1`;
    console.log('[db] Audit database connectivity verified.');
  } catch (err) {
    console.error('[db] Audit database connectivity check failed:', err);
    throw err;
  } finally {
    if (connectSql !== auditSql) {
      await connectSql.end({ timeout: 5 });
    }
  }
}
