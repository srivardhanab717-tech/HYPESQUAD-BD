import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { getNotifications, markNotificationRead } from '../services/notifications';

const router = Router();

/**
 * GET /notifications
 * Returns all notifications for the authenticated user, newest first (limit 50).
 */
router.get(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const notifications = await getNotifications(userId);

      res.status(200).json({
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          payload: n.payload,
          read: n.read,
          created_at: n.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /notifications/:id/read
 * Marks a notification as read.
 */
router.post(
  '/:id/read',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const notificationId = req.params.id;

      await markNotificationRead(notificationId, userId);

      res.status(200).json({ read: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
