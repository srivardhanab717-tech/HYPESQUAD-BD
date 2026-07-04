import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { createReel, getReelsFeed } from '../services/reels';

const router = Router();

// ============================================================
// POST /reels — Upload a new reel
// ============================================================

router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { goal_id, caption, duration_seconds, video_url } = req.body;

      const reel = await createReel(userId, {
        goal_id,
        caption,
        duration_seconds,
        video_url,
      });

      res.status(201).json(reel);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// GET /reels/feed — Paginated reels feed
// ============================================================

router.get(
  '/feed',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const cursor = req.query.cursor as string | undefined;

      const feedPage = await getReelsFeed(userId, cursor);

      res.status(200).json(feedPage);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
