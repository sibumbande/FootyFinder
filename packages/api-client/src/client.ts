export interface ApiErrorBody { error?: string; code?: string; details?: unknown; }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string, public readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly getToken?: () => string | undefined) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken?.();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as ApiErrorBody;
      throw new ApiError(response.status, body.error ?? 'Something went wrong. Please try again.', body.code, body.details);
    }
    return response.json() as Promise<T>;
  }
}
