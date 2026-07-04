import { Router, Request, Response } from 'express';
import authRoutes from './auth';
import profileRoutes from './profile';
import goalRoutes from './goals';

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

export default router;
