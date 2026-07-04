import { Router, Request, Response, NextFunction } from 'express';
import { requestOtp, verifyOtp } from '../services/auth/otp';
import { authenticateOAuth } from '../services/auth/oauth';
import { ValidationError } from '../lib/errors';
import { OtpRequestBody, OtpVerifyBody, OAuthBody } from '../types';

const router = Router();

/**
 * POST /auth/otp/request
 * Request an OTP for the given phone number.
 * Body: { phone: string }
 */
router.post('/otp/request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.body as OtpRequestBody;

    if (!phone) {
      throw new ValidationError('Phone number is required');
    }

    // Get client IP for rate limiting
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    const result = await requestOtp(phone, ip);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/otp/verify
 * Verify an OTP and get a session token.
 * Body: { phone: string, code: string }
 * Returns: { token: string, user: object, needsSetup: boolean }
 */
router.post('/otp/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, code } = req.body as OtpVerifyBody;

    if (!phone) {
      throw new ValidationError('Phone number is required');
    }
    if (!code) {
      throw new ValidationError('OTP code is required');
    }

    const result = await verifyOtp(phone, code);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/oauth/:provider
 * Authenticate via OAuth (Google or Apple).
 * Body: { idToken: string }
 * Returns: { token: string, user: object, needsSetup: boolean }
 */
router.post('/oauth/:provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = req.params.provider as 'google' | 'apple';

    if (provider !== 'google' && provider !== 'apple') {
      throw new ValidationError('Unsupported OAuth provider. Use "google" or "apple".');
    }

    const { idToken } = req.body as OAuthBody;

    if (!idToken) {
      throw new ValidationError('ID token is required');
    }

    const result = await authenticateOAuth(provider, idToken);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
