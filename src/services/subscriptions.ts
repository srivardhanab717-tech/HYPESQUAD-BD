import { getSupabaseClient } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { createPaymentOrder, PaymentOrder } from './payments';

export interface SubscriptionState {
  tier: 'free' | 'pro';
  renews_at: string | null;
}

export interface UpgradeResult {
  tier: 'pro';
  renews_at: string;
  payment_order: PaymentOrder;
}

// Pro subscription pricing
const PRO_PRICE = 499; // INR
const PRO_CURRENCY = 'INR';
const PRO_PERIOD_DAYS = 30;

/**
 * Get the current subscription state for a user.
 * Defaults to 'free' if no subscription record exists.
 */
export async function getSubscription(userId: string): Promise<SubscriptionState> {
  const supabase = getSupabaseClient();

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier, renews_at')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    return { tier: 'free', renews_at: null };
  }

  return {
    tier: (sub as { tier: string }).tier as 'free' | 'pro',
    renews_at: (sub as { renews_at: string | null }).renews_at,
  };
}

/**
 * Check if a user has Pro tier.
 */
export async function isPro(userId: string): Promise<boolean> {
  const subscription = await getSubscription(userId);
  return subscription.tier === 'pro';
}

/**
 * Upgrade a user to Pro tier.
 * If already Pro, returns the current state.
 * Otherwise initiates payment and (for v1) simulates success.
 */
export async function upgradeToProTier(userId: string): Promise<UpgradeResult | SubscriptionState> {
  const supabase = getSupabaseClient();

  // Check current subscription
  const current = await getSubscription(userId);

  if (current.tier === 'pro') {
    return current;
  }

  // Initiate payment
  const paymentOrder = await createPaymentOrder(PRO_PRICE, PRO_CURRENCY, {
    user_id: userId,
    type: 'subscription_upgrade',
    tier: 'pro',
  });

  // v1: simulate payment success immediately
  const renewsAt = new Date();
  renewsAt.setDate(renewsAt.getDate() + PRO_PERIOD_DAYS);
  const renewsAtStr = renewsAt.toISOString();

  // Upsert subscription record
  const { error: upsertError } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      tier: 'pro',
      renews_at: renewsAtStr,
      payment_provider: paymentOrder.provider,
    }, { onConflict: 'user_id' });

  if (upsertError) {
    throw new AppError('Failed to update subscription', 500, 'SUBSCRIPTION_UPDATE_FAILED');
  }

  return {
    tier: 'pro',
    renews_at: renewsAtStr,
    payment_order: paymentOrder,
  };
}
