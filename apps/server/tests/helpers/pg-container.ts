// Re-export from the shared db package so tests use the same implementation.
export { startPostgres, type PgContainer } from '../../../../packages/db/pg-container';
