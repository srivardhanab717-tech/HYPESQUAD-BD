import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { generateMilestoneCard } from '../services/milestoneCards';

const router = Router();

// ============================================================
// POST /milestone-cards — Generate a milestone card
// ============================================================

router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { goal_id, milestone_percent, streak_count } = req.body;

      const result = await generateMilestoneCard(userId, {
        goal_id,
        milestone_percent,
        streak_count,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
