import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { updateSettings } from '../services/settings';

const router = Router();

/**
 * PATCH /settings
 * Update user settings (toggles persist immediately).
 * Allowed fields: default_visibility, timezone.
 * Returns the full current settings state.
 */
router.patch(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const updates = req.body;

      const settings = await updateSettings(userId, updates);

      res.status(200).json(settings);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
