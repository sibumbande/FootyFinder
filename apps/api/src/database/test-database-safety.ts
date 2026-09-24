export type DisposableTestDatabaseOptions = {
  databaseUrl: string | undefined;
  nodeEnv: string | undefined;
};

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres-test', 'postgres']);
const ALLOWED_DATABASE_NAME = /^footy_finder_(?:test|ci|manual_qa)(?:_[a-z0-9-]+)?$/;

function assertDisposableDatabase(
  { databaseUrl, nodeEnv }: DisposableTestDatabaseOptions,
  allowedNodeEnvironments: ReadonlySet<string>,
  environmentMessage: string,
): void {
  if (!nodeEnv || !allowedNodeEnvironments.has(nodeEnv)) {
    throw new Error(environmentMessage);
  }

  if (!databaseUrl) {
    throw new Error('Database test tooling requires DATABASE_URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Database test tooling requires a valid PostgreSQL DATABASE_URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Database test tooling requires a PostgreSQL DATABASE_URL.');
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Database test tooling may only use an approved local or CI database host.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
  if (!ALLOWED_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      'Database test tooling requires a disposable database named footy_finder_test, footy_finder_ci, or footy_finder_manual_qa (optionally with a worker suffix).',
    );
  }
}

/**
 * Rejects database-backed test tooling unless it points at an explicitly named,
 * disposable PostgreSQL database on a local/CI host. Never include the URL in
 * thrown errors because it may contain credentials.
 */
export function assertDisposableTestDatabase({
  databaseUrl,
  nodeEnv,
}: DisposableTestDatabaseOptions): void {
  assertDisposableDatabase(
    { databaseUrl, nodeEnv },
    new Set(['test']),
    'Database test tooling requires NODE_ENV=test.',
  );
}

export function assertDisposableDevelopmentOrTestDatabase(
  options: DisposableTestDatabaseOptions,
): void {
  assertDisposableDatabase(
    options,
    new Set(['development', 'test']),
    'Test-data tooling requires NODE_ENV=development or NODE_ENV=test.',
  );
}
