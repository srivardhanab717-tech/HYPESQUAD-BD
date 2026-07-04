import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { ValidationError } from '../lib/errors';
import {
  createSquad,
  getMySquads,
  getSuggestedSquads,
  joinSquad,
  approveJoinRequest,
  rejectJoinRequest,
  getJoinRequests,
  CreateSquadInput,
} from '../services/squads';

const router = Router();

// ─── POST /squads ────────────────────────────────────────────────────────────

/**
 * Create a new squad with auto-provisioned channels.
 */
router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { emoji, name, category, visibility } = req.body;

      if (!name || (typeof name === 'string' && name.trim() === '')) {
        throw new ValidationError('Name is required');
      }

      if (!visibility || !['public', 'private'].includes(visibility)) {
        throw new ValidationError('Visibility must be one of: public, private');
      }

      const input: CreateSquadInput = {
        emoji,
        name,
        category,
        visibility,
      };

      const squad = await createSquad(userId, input);

      res.status(201).json(squad);
    } catch (error) {
      next(error);
    }
  }
);

// ─── GET /squads/mine ────────────────────────────────────────────────────────

/**
 * Get squads the authenticated user belongs to.
 */
router.get(
  '/mine',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const squads = await getMySquads(userId);
      res.status(200).json({ squads });
    } catch (error) {
      next(error);
    }
  }
);

// ─── GET /squads/suggested ───────────────────────────────────────────────────

/**
 * Get suggested squads with member counts.
 */
router.get(
  '/suggested',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const squads = await getSuggestedSquads(userId);
      res.status(200).json({ squads });
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST /squads/:id/join ───────────────────────────────────────────────────

/**
 * Join a squad (public: immediate, private: creates join request).
 */
router.post(
  '/:id/join',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const squadId = req.params.id;

      const result = await joinSquad(userId, squadId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST /squads/:id/join-requests/:reqId/approve ───────────────────────────

/**
 * Approve a join request (owner/moderator only).
 */
router.post(
  '/:id/join-requests/:reqId/approve',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const squadId = req.params.id;
      const requestId = req.params.reqId;

      const result = await approveJoinRequest(userId, squadId, requestId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST /squads/:id/join-requests/:reqId/reject ────────────────────────────

/**
 * Reject a join request (owner/moderator only).
 */
router.post(
  '/:id/join-requests/:reqId/reject',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const squadId = req.params.id;
      const requestId = req.params.reqId;

      const result = await rejectJoinRequest(userId, squadId, requestId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ─── GET /squads/:id/join-requests ───────────────────────────────────────────

/**
 * Get pending join requests for a squad (owner/moderator only).
 */
router.get(
  '/:id/join-requests',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const squadId = req.params.id;

      const requests = await getJoinRequests(userId, squadId);

      res.status(200).json({ requests });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
