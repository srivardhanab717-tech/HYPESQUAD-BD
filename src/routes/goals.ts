import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { createGoal, getGoalsDashboard, getGoalDetail, CreateGoalInput } from '../services/goals';
import { generateMilestonePlan } from '../services/ai/milestonePlan';
import { performCheckin } from '../services/checkins';
import { createAutoPost } from '../services/posts';
import { getSupabaseClient } from '../lib/supabase';
import { ValidationError } from '../lib/errors';

const router = Router();

// Rate limiter for AI milestone plan endpoint (per user)
const milestonePlanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 requests per hour per user
  keyGenerator: (req) => (req as AuthenticatedRequest).user?.sub || 'unknown',
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 },
});

/**
 * POST /goals
 * Create a new goal.
 */
router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { category, description, deadline, cadence, target_checkins, visibility } = req.body;

      const input: CreateGoalInput = {
        category,
        description,
        deadline,
        cadence,
        target_checkins,
        visibility,
      };

      const goal = await createGoal(userId, input);

      res.status(201).json(goal);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /goals/mine
 * Returns all goals owned by the authenticated user with dashboard data.
 */
router.get(
  '/mine',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;

      // Get user timezone from profile
      const supabase = getSupabaseClient();
      const { data: profile } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('user_id', userId)
        .single();

      const timezone = (profile as { timezone: string } | null)?.timezone || 'Asia/Kolkata';

      const goals = await getGoalsDashboard(userId, timezone);

      res.status(200).json({ goals });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /goals/:id
 * Returns the full detail of a specific goal.
 */
router.get(
  '/:id',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const goalId = req.params.id;

      if (!goalId) {
        throw new ValidationError('Goal ID is required');
      }

      const goalDetail = await getGoalDetail(goalId, userId);

      res.status(200).json(goalDetail);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /goals/:id/milestone-plan
 * Generate an AI milestone plan for a goal.
 */
router.post(
  '/:id/milestone-plan',
  authMiddleware,
  milestonePlanLimiter,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const goalId = req.params.id;

      if (!goalId) {
        throw new ValidationError('Goal ID is required');
      }

      const plan = await generateMilestonePlan(goalId, userId);

      res.status(201).json({ milestone_plan: plan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /goals/:id/checkins
 * Perform a check-in for a goal. Returns 200 for both success and duplicate (with duplicate flag).
 * Auto-generates a progress post on new check-ins (exempt from moderation).
 */
router.post(
  '/:id/checkins',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const goalId = req.params.id;

      if (!goalId) {
        throw new ValidationError('Goal ID is required');
      }

      const checkinResult = await performCheckin(goalId, userId);

      // Only generate auto-post for NEW check-ins (not duplicates)
      let autoPost = null;
      if (!checkinResult.duplicate && checkinResult.current_streak !== undefined) {
        autoPost = await createAutoPost(userId, goalId, checkinResult.current_streak);
      }

      res.status(200).json({
        ...checkinResult,
        post: autoPost,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
