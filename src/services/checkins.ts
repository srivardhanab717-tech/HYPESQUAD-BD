import { getSupabaseClient } from '../lib/supabase';
import { AppError, NotFoundError, ValidationError } from '../lib/errors';

/**
 * Result of a check-in operation.
 */
export interface CheckinResult {
  duplicate: boolean;
  checkin_id: string;
  period_start: string;
  period_end: string;
  message?: string;
  current_streak?: number;
  longest_streak?: number;
  checkin_count?: number;
  goal_status?: string;
}

/**
 * Perform a check-in by calling the SECURITY DEFINER function.
 * Handles the response (success vs duplicate vs error).
 */
export async function performCheckin(goalId: string, userId: string): Promise<CheckinResult> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc('perform_checkin', {
    p_goal_id: goalId,
    p_user_id: userId,
  });

  if (error) {
    throw new AppError('Check-in failed', 500, 'CHECKIN_FAILED');
  }

  const result = data as Record<string, unknown>;

  // Handle error from function
  if (result.error) {
    if (result.code === 'GOAL_NOT_FOUND') {
      throw new NotFoundError(result.error as string);
    }
    if (result.code === 'GOAL_NOT_ACTIVE') {
      throw new ValidationError(`Goal is ${result.status}: check-ins are no longer accepted`);
    }
    throw new AppError(result.error as string, 400, result.code as string);
  }

  // Handle duplicate (not an error — return existing state per requirements)
  if (result.duplicate) {
    return {
      duplicate: true,
      checkin_id: result.checkin_id as string,
      period_start: result.period_start as string,
      period_end: result.period_end as string,
      message: result.message as string,
    };
  }

  // Success
  return {
    duplicate: false,
    checkin_id: result.checkin_id as string,
    period_start: result.period_start as string,
    period_end: result.period_end as string,
    current_streak: result.current_streak as number,
    longest_streak: result.longest_streak as number,
    checkin_count: result.checkin_count as number,
    goal_status: result.goal_status as string,
  };
}
