import { Router, Request, Response } from 'express';
import authRoutes from './auth';

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

export default router;
