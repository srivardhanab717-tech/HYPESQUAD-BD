import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { registerDevice } from '../services/push';
import { ValidationError } from '../lib/errors';

const router = Router();

/**
 * POST /devices/register
 * Register a device token for push notifications.
 * Body: { platform: 'ios' | 'android', token: string }
 * Upserts the device token (ON CONFLICT on platform+token).
 */
router.post(
  '/register',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { platform, token } = req.body;

      // Validate platform
      if (!platform || !['ios', 'android'].includes(platform)) {
        throw new ValidationError('platform must be "ios" or "android"');
      }

      // Validate token
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        throw new ValidationError('token is required');
      }

      const result = await registerDevice(userId, platform, token.trim());

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
