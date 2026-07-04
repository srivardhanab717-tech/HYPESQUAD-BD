import { Request, Response, NextFunction } from 'express';

/**
 * Request logging middleware.
 * Logs method, path, status code, and response duration.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  // Listen for response finish to log complete request
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLine = `${req.method} ${req.path} ${res.statusCode} ${duration}ms`;

    if (res.statusCode >= 500) {
      console.error(logLine);
    } else if (res.statusCode >= 400) {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }
  });

  next();
}
