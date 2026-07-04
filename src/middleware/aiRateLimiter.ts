import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from '../types';

/**
 * Shared rate limiter for all AI service endpoints (per user, per hour).
 * Applies to: POST /ai-coach/messages, POST /posts/draft-assist, POST /goals/:id/milestone-plan
 *
 * 10 AI requests per hour per user across all AI endpoints.
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 AI requests per hour per user
  keyGenerator: (req) => (req as AuthenticatedRequest).user?.sub || 'unknown',
  message: { error: 'AI rate limit exceeded', code: 'AI_RATE_LIMIT', statusCode: 429 },
  standardHeaders: true,
  legacyHeaders: false,
});
