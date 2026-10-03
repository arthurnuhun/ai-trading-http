export type ErrorCode =
  | 'TRADINGVIEW_CONNECTION_ERROR'
  | 'INVALID_SYMBOL'
  | 'INVALID_TIMEFRAME'
  | 'INVALID_INPUT'
  | 'DATA_QUALITY_ERROR'
  | 'STALE_DATA'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type ErrorResponse = {
  ok: false;
  error: { code: ErrorCode; message: string; retryable: boolean };
};

export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message, retryable: err.retryable } };
  }
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal error', retryable: false } };
}
