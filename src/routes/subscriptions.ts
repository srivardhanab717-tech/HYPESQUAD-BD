import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { upgradeToProTier } from '../services/subscriptions';

const router = Router();

/**
 * POST /subscriptions/upgrade
 * Upgrade the authenticated user to Pro tier.
 */
router.post(
  '/upgrade',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;

      const result = await upgradeToProTier(userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
