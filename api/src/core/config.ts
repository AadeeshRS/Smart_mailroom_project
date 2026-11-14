export type Config = {
  databaseUrl: string;
  pepper: string;
  environment: string;
  origins: string[];
  /** Lowercase college domains members may register with, e.g. ['college.edu']. */
  allowedDomains: string[];
  resendApiKey: string;
  mailFrom: string;
  /** Fastify trustProxy: false, true, a CIDR list, or a hop-count check. */
  trustProxy: boolean | string | ((address: string, hop: number) => boolean);
};

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

export function config(env = process.env): Config {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://'))
    throw new Error('A PostgreSQL DATABASE_URL is required.');
  const pepper = env.CREDENTIAL_PEPPER ?? '';
  if (pepper.length < 32 || pepper.includes('CHANGE_ME'))
    throw new Error('Set a strong persistent CREDENTIAL_PEPPER (at least 32 bytes).');
  const environment = env.NODE_ENV ?? 'development';
  const trust = env.TRUST_PROXY ?? '';
  const result: Config = {
    databaseUrl,
    pepper,
    environment,
    origins: (env.CORS_ORIGINS ?? 'http://127.0.0.1:8081,http://localhost:8081').split(','),
    allowedDomains: list(env.ALLOWED_EMAIL_DOMAINS),
    resendApiKey: env.RESEND_API_KEY ?? '',
    mailFrom: env.MAIL_FROM ?? '',
    trustProxy: !trust
      ? false
      : trust === 'true'
        ? true
        : /^\d+$/.test(trust)
          ? (_address, hop) => hop < Number(trust)
          : trust,
  };
  if (environment === 'production') {
    const missing = ['RESEND_API_KEY', 'MAIL_FROM', 'ALLOWED_EMAIL_DOMAINS'].filter(name => !env[name]?.trim());
    if (missing.length) throw new Error(`Production requires ${missing.join(', ')}.`);
  }
  return result;
}

/** Seeding and test resets only ever touch the dedicated local databases. */
export function dedicatedDataset(url: string) {
  if (!/^smart_mailroom_(dev|test)$/.test(new URL(url).pathname.slice(1)))
    throw new Error('Seed/reset requires the dedicated smart_mailroom_dev or smart_mailroom_test database.');
}
