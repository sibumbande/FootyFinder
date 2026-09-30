/**
 * Safety lock for the dev mock world (docs/DEV_MOCK_WORLD.md). The mock-world scripts run only
 * against the local development database `footy_finder`: never production, never the disposable
 * smoke database `footy_finder_test`, and never with a real email provider.
 */
export const DEV_MOCK_DATABASE = 'footy_finder';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function devMockRefusal(env: { DATABASE_URL?: string; NODE_ENV?: string; EMAIL_PROVIDER?: string }): string | null {
  if (env.NODE_ENV === 'production') return 'NODE_ENV is production.';
  if (env.EMAIL_PROVIDER === 'postmark') return 'EMAIL_PROVIDER is postmark; the mock world runs only with the console or test mailer.';
  if (!env.DATABASE_URL) return 'DATABASE_URL is not set.';
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    return 'DATABASE_URL is not a valid URL.';
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) return 'DATABASE_URL is not a PostgreSQL URL.';
  if (!LOCAL_HOSTS.has(url.hostname)) return `DATABASE_URL points to ${url.hostname}, not localhost.`;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database !== DEV_MOCK_DATABASE) return `The database is "${database}", not exactly "${DEV_MOCK_DATABASE}".`;
  return null;
}

export function assertDevMockTarget(env: NodeJS.ProcessEnv = process.env) {
  const refusal = devMockRefusal(env);
  if (refusal) {
    console.error(`Refusing to run the dev mock world: ${refusal}`);
    process.exit(2);
  }
}
