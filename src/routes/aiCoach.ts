import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { aiRateLimiter } from '../middleware/aiRateLimiter';
import { AuthenticatedRequest } from '../types';
import { sendCoachMessage, getConversationHistoryForUser } from '../services/ai/coach';
import { ValidationError } from '../lib/errors';

const router = Router();

/**
 * POST /ai-coach/messages
 * Send a message to the AI coach and get a response.
 */
router.post(
  '/messages',
  authMiddleware,
  aiRateLimiter,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { message } = req.body;

      if (!message || typeof message !== 'string' || message.trim() === '') {
        throw new ValidationError('Message is required and must be a non-empty string');
      }

      const response = await sendCoachMessage(userId, message.trim());

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /ai-coach/history
 * Returns all messages from the user's most recent conversation.
 */
router.get(
  '/history',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;

      const messages = await getConversationHistoryForUser(userId);

      res.status(200).json({ messages });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
