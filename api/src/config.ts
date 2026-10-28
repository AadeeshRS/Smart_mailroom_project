export type Config = { databaseUrl: string; pepper: string; demo: boolean; environment: string; origins: string[] };
export function config(): Config {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) throw new Error('A PostgreSQL DATABASE_URL is required.');
  const pepper = process.env.CREDENTIAL_PEPPER ?? '';
  if (pepper.length < 32 || pepper.includes('CHANGE_ME')) throw new Error('Set a strong persistent CREDENTIAL_PEPPER (at least 32 bytes).');
  const environment = process.env.NODE_ENV ?? 'development';
  const demo = process.env.DEMO_ENABLED === 'true' && ['development', 'test'].includes(environment);
  return { databaseUrl, pepper, demo, environment, origins: (process.env.CORS_ORIGINS ?? 'http://127.0.0.1:8081,http://localhost:8081').split(',') };
}
export function dedicatedDataset(url: string) {
  if (!/^smart_mailroom_(dev|test)$/.test(new URL(url).pathname.slice(1))) throw new Error('Seed/reset requires the dedicated smart_mailroom_dev or smart_mailroom_test database.');
}
