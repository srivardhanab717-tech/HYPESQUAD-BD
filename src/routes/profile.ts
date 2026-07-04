import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { getProfile, updateProfile } from '../services/profile';

const router = Router();

/**
 * GET /profile/me
 * Returns the current user's profile.
 */
router.get(
  '/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const profile = await getProfile(userId);

      res.status(200).json({
        name: profile.name,
        avatar_color: profile.avatar_color,
        interests: profile.interests,
        default_visibility: profile.default_visibility,
        bio: profile.bio,
        handle: profile.handle,
        timezone: profile.timezone,
        setup_complete: profile.setup_complete,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /profile/me
 * Updates the current user's profile fields.
 */
router.patch(
  '/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { name, avatar_color, interests, default_visibility, bio, handle, timezone } = req.body;

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (avatar_color !== undefined) updates.avatar_color = avatar_color;
      if (interests !== undefined) updates.interests = interests;
      if (default_visibility !== undefined) updates.default_visibility = default_visibility;
      if (bio !== undefined) updates.bio = bio;
      if (handle !== undefined) updates.handle = handle;
      if (timezone !== undefined) updates.timezone = timezone;

      const profile = await updateProfile(userId, updates as Parameters<typeof updateProfile>[1]);

      res.status(200).json({
        name: profile.name,
        avatar_color: profile.avatar_color,
        interests: profile.interests,
        default_visibility: profile.default_visibility,
        bio: profile.bio,
        handle: profile.handle,
        timezone: profile.timezone,
        setup_complete: profile.setup_complete,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
