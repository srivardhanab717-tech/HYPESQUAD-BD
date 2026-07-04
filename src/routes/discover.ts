import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { getDiscover, search, getTrendingTags } from '../services/discover';

const router = Router();

// ─── GET /discover ───────────────────────────────────────────────────────────

/**
 * Get recommended squads and trending tags.
 */
router.get(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // If mounted at /search, handle as search; if mounted at /discover, return discover data
      const q = (req.query.q as string || '').trim();

      // Check if this is being hit as /search?q=...
      // We use the baseUrl to distinguish
      if (req.baseUrl.endsWith('/search')) {
        const userId = req.user!.sub;
        if (!q) {
          const trending_tags = await getTrendingTags();
          res.status(200).json({ trending_tags });
          return;
        }
        const results = await search(q, userId);
        res.status(200).json(results);
        return;
      }

      // /discover
      const result = await getDiscover();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
