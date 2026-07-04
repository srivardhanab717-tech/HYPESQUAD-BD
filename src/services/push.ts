import { getSupabaseClient } from '../lib/supabase';

// ============================================================
// Push Delivery Service (v1 stub — logs payload, no actual FCM/APNs)
// ============================================================

interface DeviceToken {
  id: string;
  user_id: string;
  platform: 'ios' | 'android';
  token: string;
}

/**
 * Send a push notification to all registered devices for a user.
 * v1: logs the push payload (actual FCM/APNs integration is stubbed).
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  const supabase = getSupabaseClient();

  // 1. Fetch all device_tokens for the user
  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('id, user_id, platform, token')
    .eq('user_id', userId);

  if (error || !tokens || tokens.length === 0) {
    return; // No registered devices, nothing to do
  }

  const deviceTokens = tokens as DeviceToken[];

  // 2. For each token, call FCM (Android) or APNs (iOS)
  // v1: log the push payload (actual integration is stubbed)
  for (const device of deviceTokens) {
    console.log(`[PUSH] ${device.platform.toUpperCase()} → user=${userId} token=${device.token.slice(0, 8)}...`, {
      title,
      body,
      data,
    });

    // In production, this would call:
    // - FCM HTTP API for Android tokens
    // - APNs HTTP/2 API for iOS tokens
  }
}

// ============================================================
// Device Registration
// ============================================================

/**
 * Register (upsert) a device token for a user.
 * ON CONFLICT on (platform, token) — updates user_id.
 */
export async function registerDevice(
  userId: string,
  platform: 'ios' | 'android',
  token: string
): Promise<{ registered: boolean }> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { user_id: userId, platform, token },
      { onConflict: 'platform,token' }
    );

  if (error) {
    console.error('Device registration failed:', error);
    return { registered: false };
  }

  return { registered: true };
}
