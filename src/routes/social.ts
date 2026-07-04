import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { ValidationError } from '../lib/errors';
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
} from '../services/social';

const router = Router();

// ============================================================
// POST /users/:id/follow — Follow a user
// ============================================================

router.post(
  '/:id/follow',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const targetId = req.params.id;

      if (!targetId) {
        throw new ValidationError('User ID is required');
      }

      const result = await followUser(userId, targetId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// DELETE /users/:id/follow — Unfollow a user
// ============================================================

router.delete(
  '/:id/follow',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const targetId = req.params.id;

      if (!targetId) {
        throw new ValidationError('User ID is required');
      }

      const result = await unfollowUser(userId, targetId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// GET /users/:id/followers — List a user's followers
// ============================================================

router.get(
  '/:id/followers',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const viewerId = req.user!.sub;
      const targetId = req.params.id;

      if (!targetId) {
        throw new ValidationError('User ID is required');
      }

      const followers = await getFollowers(targetId, viewerId);

      res.status(200).json({ followers });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// GET /users/:id/following — List who a user follows
// ============================================================

router.get(
  '/:id/following',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const viewerId = req.user!.sub;
      const targetId = req.params.id;

      if (!targetId) {
        throw new ValidationError('User ID is required');
      }

      const following = await getFollowing(targetId, viewerId);

      res.status(200).json({ following });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
