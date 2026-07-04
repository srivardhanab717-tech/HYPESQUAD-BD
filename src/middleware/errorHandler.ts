import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { ErrorResponse } from '../types';

/**
 * Global error handler middleware.
 * Catches all errors and returns consistent JSON responses.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle known operational errors
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Log unexpected errors
  console.error('Unexpected error:', err);

  // Return generic 500 for unexpected errors
  const response: ErrorResponse = {
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    statusCode: 500,
  };
  res.status(500).json(response);
}
