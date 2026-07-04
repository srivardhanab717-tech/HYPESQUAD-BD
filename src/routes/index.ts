import { Router, Request, Response } from 'express';
import authRoutes from './auth';
import profileRoutes from './profile';
import goalRoutes from './goals';
import feedRoutes from './feed';
import socialRoutes from './social';

const router = Router();

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Auth routes
router.use('/auth', authRoutes);

// Profile routes
router.use('/profile', profileRoutes);

// Goal routes
router.use('/goals', goalRoutes);

// Feed routes (GET /feed for feed pagination)
router.use('/feed', feedRoutes);

// Posts routes (POST /posts, POST /posts/:id/hype, GET/POST /posts/:id/comments, POST /posts/draft-assist)
router.use('/posts', feedRoutes);

// Social routes (POST/DELETE /users/:id/follow, GET /users/:id/followers, GET /users/:id/following)
router.use('/users', socialRoutes);

export default router;
