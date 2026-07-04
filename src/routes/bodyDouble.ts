import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { joinBodyDoubleRoom, inviteToBodyDouble } from '../services/bodyDouble';
import { ValidationError } from '../lib/errors';

const router = Router();

/**
 * POST /realtime/body-double/:roomId/join
 * Registers the user's presence in the room.
 * Returns: { channel_name, current_participants }
 */
router.post(
  '/:roomId/join',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { roomId } = req.params;

      if (!roomId || roomId.trim().length === 0) {
        throw new ValidationError('roomId is required');
      }

      const result = await joinBodyDoubleRoom(userId, roomId);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /realtime/body-double/:roomId/invite
 * Invites another user to the body double room.
 * Body: { invitee_id: string }
 * Returns: { invited: true }
 */
router.post(
  '/:roomId/invite',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { roomId } = req.params;
      const { invitee_id } = req.body;

      if (!roomId || roomId.trim().length === 0) {
        throw new ValidationError('roomId is required');
      }

      if (!invitee_id || typeof invitee_id !== 'string') {
        throw new ValidationError('invitee_id is required');
      }

      const result = await inviteToBodyDouble(userId, invitee_id, roomId);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
