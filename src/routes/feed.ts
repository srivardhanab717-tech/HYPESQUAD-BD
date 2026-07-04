import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { aiRateLimiter } from '../middleware/aiRateLimiter';
import { AuthenticatedRequest } from '../types';
import { ValidationError } from '../lib/errors';
import {
  getFeedPage,
  hypePost,
  getComments,
  createComment,
  createPost,
  CreatePostInput,
} from '../services/feed';
import { generatePostDraft } from '../services/ai/postDraft';

const router = Router();

// ============================================================
// GET /feed — Paginated feed
// ============================================================

router.get(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const cursor = req.query.cursor as string | undefined;

      const feedPage = await getFeedPage(userId, cursor);

      res.status(200).json(feedPage);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// POST /posts — Create a new post
// ============================================================

router.post(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const { body, goal_id, type, media_refs, visibility } = req.body;

      const input: CreatePostInput = {
        body,
        goal_id,
        type,
        media_refs,
        visibility,
      };

      const post = await createPost(userId, input);

      res.status(201).json(post);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// POST /posts/draft-assist — AI-assisted post drafting
// ============================================================

router.post(
  '/draft-assist',
  authMiddleware,
  aiRateLimiter,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;

      const draftText = await generatePostDraft(userId);

      res.status(200).json({ draft_text: draftText });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// POST /posts/:id/hype — Hype a post (idempotent)
// ============================================================

router.post(
  '/:id/hype',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const postId = req.params.id;

      if (!postId) {
        throw new ValidationError('Post ID is required');
      }

      const result = await hypePost(postId, userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// GET /posts/:id/comments — Get comments for a post
// ============================================================

router.get(
  '/:id/comments',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const postId = req.params.id;

      if (!postId) {
        throw new ValidationError('Post ID is required');
      }

      const comments = await getComments(postId, userId);

      res.status(200).json({ comments });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// POST /posts/:id/comments — Create a comment on a post
// ============================================================

router.post(
  '/:id/comments',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const postId = req.params.id;
      const { body } = req.body;

      if (!postId) {
        throw new ValidationError('Post ID is required');
      }

      const comment = await createComment(postId, userId, body);

      res.status(201).json(comment);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
