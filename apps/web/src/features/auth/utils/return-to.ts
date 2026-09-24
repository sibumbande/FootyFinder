export function safeReturnTo(value: string | null, fallback = '/') {
  if (!value) return fallback;

  let candidate = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      !candidate.startsWith('/') ||
      candidate.startsWith('//') ||
      candidate.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(candidate)
    )
      return fallback;

    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return value;
      candidate = decoded;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function loginPathFor(location: {
  pathname: string;
  search: string;
  hash: string;
}) {
  const returnTo = safeReturnTo(`${location.pathname}${location.search}${location.hash}`);
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
