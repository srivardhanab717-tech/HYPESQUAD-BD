import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { getCoachCatalog, getCoachById } from '../services/coaches';
import { createPaymentOrder } from '../services/payments';
import { getSupabaseClient } from '../lib/supabase';
import { ValidationError, AppError } from '../lib/errors';

const router = Router();

/**
 * GET /coaches
 * Returns the coach catalog.
 */
router.get(
  '/',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const coaches = await getCoachCatalog();
      res.status(200).json({ coaches });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /coaches/:id/book
 * Book a human coach. Initiates payment flow.
 * Body: { scheduled_at: string (ISO datetime) }
 */
router.post(
  '/:id/book',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const coachId = req.params.id;
      const { scheduled_at } = req.body;

      if (!scheduled_at || typeof scheduled_at !== 'string') {
        throw new ValidationError('scheduled_at is required and must be an ISO datetime string');
      }

      // Validate ISO date format
      const scheduledDate = new Date(scheduled_at);
      if (isNaN(scheduledDate.getTime())) {
        throw new ValidationError('scheduled_at must be a valid ISO datetime');
      }

      // Verify coach exists and is type 'human'
      const coach = await getCoachById(coachId);

      if (coach.type !== 'human') {
        throw new ValidationError('Only human coaches can be booked');
      }

      const supabase = getSupabaseClient();

      // Create booking record with payment_status='pending'
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          coach_id: coachId,
          user_id: userId,
          scheduled_at,
          payment_status: 'pending',
        })
        .select('id')
        .single();

      if (bookingError || !booking) {
        throw new AppError('Failed to create booking', 500, 'BOOKING_CREATE_FAILED');
      }

      const bookingId = (booking as { id: string }).id;

      // Initiate payment with Razorpay
      const amount = coach.price || 0;
      const currency = coach.currency || 'INR';

      const paymentOrder = await createPaymentOrder(amount, currency, {
        booking_id: bookingId,
        coach_id: coachId,
        user_id: userId,
      });

      res.status(201).json({
        booking_id: bookingId,
        payment_order_id: paymentOrder.order_id,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
