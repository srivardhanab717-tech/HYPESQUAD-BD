import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { getLeaderboard, LeaderboardScope, LeaderboardMetric } from '../services/leaderboard';
import { ValidationError } from '../lib/errors';

const router = Router();

/**
 * GET /leaderboard?scope=&metric=&squad_id=
 * Returns a ranked list of users with streak and hype totals.
 *
 * Query params:
 *   scope: 'squad' | 'global'
 *   metric: 'streak' | 'hype'
 *   squad_id: required when scope=squad
 */
router.get(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const scope = req.query.scope as string;
      const metric = req.query.metric as string;
      const squadId = req.query.squad_id as string | undefined;

      // Validate scope
      if (!scope || !['squad', 'global'].includes(scope)) {
        throw new ValidationError('scope must be "squad" or "global"');
      }

      // Validate metric
      if (!metric || !['streak', 'hype'].includes(metric)) {
        throw new ValidationError('metric must be "streak" or "hype"');
      }

      const leaderboard = await getLeaderboard(
        userId,
        scope as LeaderboardScope,
        metric as LeaderboardMetric,
        squadId
      );

      res.status(200).json({ leaderboard });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
