export function safeReturnTo(value: string | null, fallback = '/') {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
}
