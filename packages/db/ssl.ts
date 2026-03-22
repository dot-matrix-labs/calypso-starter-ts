import postgres from 'postgres';

export function buildSslOptions(): NonNullable<Parameters<typeof postgres>[1]>['ssl'] {
  const mode = process.env.DB_SSL;
  if (!mode || mode === 'disable') return undefined;
  if (mode === 'verify-full') {
    return { rejectUnauthorized: true, ca: process.env.DB_CA_CERT };
  }
  return { rejectUnauthorized: false };
}
