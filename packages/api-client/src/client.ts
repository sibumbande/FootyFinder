export interface ApiErrorBody {
  error?: string;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken?: () => string | undefined,
  ) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken?.();
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
      throw new ApiError(
        response.status,
        body.error ?? 'Something went wrong. Please try again.',
        body.code,
        body.details,
      );
    }
    return response.json() as Promise<T>;
  }

  /** CEO touch-up batch 3.5, item 4: a file download (e.g. a CSV), with the name the server suggests. */
  async download(path: string, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
    const token = this.getToken?.();
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
      throw new ApiError(response.status, body.error ?? 'Something went wrong. Please try again.', body.code, body.details);
    }
    const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1];
    return { blob: await response.blob(), filename: name ?? fallbackName };
  }
}
