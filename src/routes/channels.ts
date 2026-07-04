import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { ValidationError } from '../lib/errors';
import {
  getChannelMessages,
  sendMessage,
  verifyChannelMembership,
} from '../services/messages';

const router = Router();

// ─── GET /channels/:id/messages ──────────────────────────────────────────────

/**
 * Get message history for a channel (paginated, cursor-based, 50 per page).
 */
router.get(
  '/:id/messages',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const channelId = req.params.id;
      const cursor = req.query.cursor as string | undefined;

      // Verify user is a member of the channel's squad
      await verifyChannelMembership(userId, channelId);

      const page = await getChannelMessages(channelId, cursor);

      res.status(200).json(page);
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST /channels/:id/messages ─────────────────────────────────────────────

/**
 * Send a message to a channel.
 */
router.post(
  '/:id/messages',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const channelId = req.params.id;
      const { body, type } = req.body;

      if (!body || (typeof body === 'string' && body.trim() === '')) {
        throw new ValidationError('Message body is required');
      }

      // Verify user is a member of the channel's squad
      const squadId = await verifyChannelMembership(userId, channelId);

      const messageType = type === 'checkin_card' ? 'checkin_card' : 'text';
      const message = await sendMessage(channelId, userId, squadId, body, messageType);

      res.status(201).json(message);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
