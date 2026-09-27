import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { DEFAULT_ERROR_MESSAGES, type ApiErrorBody, type ApiErrorCode } from '@birdle/shared';
import type { Logger } from './runtime';

const DEFAULT_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  BAD_DATE: 400,
  NOT_IN_WORD_LIST: 422,
  HARD_MODE: 422,
  INVALID_GUESS: 422,
  GAME_OVER: 409,
  HINT_UNAVAILABLE: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
};

/**
 * An error that becomes a `{ error: { code, message } }` response. The shared
 * error-code union has no server-failure code, so 5xx responses use BAD_REQUEST
 * with a 5xx status; clients should branch on the HTTP status for those.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string = DEFAULT_ERROR_MESSAGES[code], status: number = DEFAULT_STATUS[code]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function sendError(res: Response, status: number, code: ApiErrorCode, message: string): void {
  const body: ApiErrorBody = { error: { code, message } };
  res.status(status).json(body);
}

/** Final handler for unknown /api routes. */
export const apiNotFound: RequestHandler = (_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'No such API route');
};

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function clientErrorMessage(error: unknown, status: number): string {
  const type = (error as { type?: unknown }).type;
  if (status === 413) return 'Request body too large';
  if (type === 'entity.parse.failed') return 'Malformed JSON body';
  if (status === 415) return 'Unsupported request encoding';
  return DEFAULT_ERROR_MESSAGES.BAD_REQUEST;
}

/**
 * Turns anything thrown by a route into the API error format. Client errors
 * raised by Express itself (malformed JSON, body too large, bad URL encoding)
 * keep their 4xx status; everything else is logged and becomes a 500.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      sendError(res, error.status, error.code, error.message);
      return;
    }
    const status = httpStatusOf(error);
    if (status !== undefined && status >= 400 && status < 500) {
      sendError(res, status, 'BAD_REQUEST', clientErrorMessage(error, status));
      return;
    }
    logger.error(`Unhandled error on ${req.method} ${req.path}:`, error);
    sendError(res, 500, 'BAD_REQUEST', 'Something went wrong on our side. Please try again.');
  };
}
