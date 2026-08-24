type LogMetadata = Record<string, string | number | boolean | null | undefined>;

const serializeError = (error: unknown) => {
  if (!(error instanceof Error)) return { errorType: 'UnknownError' };
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  return { errorType: error.name, errorCode: code };
};

export const logInfo = (event: string, metadata: LogMetadata = {}) =>
  console.log(JSON.stringify({ level: 'info', event, ...metadata }));

export const logError = (event: string, error: unknown, metadata: LogMetadata = {}) =>
  console.error(JSON.stringify({ level: 'error', event, ...metadata, ...serializeError(error) }));
