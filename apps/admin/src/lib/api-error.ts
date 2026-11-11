export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message || `Request failed (${status})`);
    this.status = status;
    this.code = body.code || 'error';
    this.details = body.details ?? {};
  }
  /** Field the API flagged (`details.field`), for form error placement. */
  get field(): string | undefined {
    return typeof this.details.field === 'string' ? this.details.field : undefined;
  }
}

export async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const body = ((data as { error?: ApiErrorBody })?.error ?? data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, body);
  }
  return data as T;
}
