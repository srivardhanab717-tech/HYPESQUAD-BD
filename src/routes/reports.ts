import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { submitReport } from '../services/moderation';

const router = Router();

/**
 * POST /reports
 * Submit a content report. Creates a moderation_flags record.
 */
router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { content_type, content_id, reason } = req.body;

      const result = await submitReport(userId, content_type, content_id, reason);

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
