import { getSupabaseClient } from '../lib/supabase';
import { sendPushNotification } from './push';

// ============================================================
// Types
// ============================================================

export type NotificationType =
  | 'hype'
  | 'comment'
  | 'new_follower'
  | 'squad_join'
  | 'squad_invite'
  | 'milestone';

export interface CreateNotificationInput {
  recipient_id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

// ============================================================
// Notification Creation
// ============================================================

/**
 * Create a notification record and push it in real time if recipient is connected.
 * Fire-and-forget — does not throw on failure.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    // 1. Insert notification record
    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        recipient_id: input.recipient_id,
        type: input.type,
        payload: input.payload,
      })
      .select('id, recipient_id, type, payload, read, created_at')
      .single();

    if (error || !notification) {
      console.error('Failed to create notification:', error);
      return;
    }

    // 2. Broadcast via Supabase Realtime to the recipient's personal channel
    const channelName = `notifications:${input.recipient_id}`;
    const channel = supabase.channel(channelName);
    await channel.send({
      type: 'broadcast',
      event: 'new_notification',
      payload: notification,
    });

    // 3. Fire-and-forget push delivery
    const title = getPushTitle(input.type);
    const body = getPushBody(input.type, input.payload);
    sendPushNotification(input.recipient_id, title, body, {
      type: input.type,
      notification_id: (notification as NotificationRow).id,
    }).catch((err) => {
      console.error('Push delivery failed:', err);
    });
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error('Notification creation error:', err);
  }
}

// ============================================================
// Notification Feed
// ============================================================

/**
 * Get notifications for a user (newest first, limit 50).
 */
export async function getNotifications(userId: string): Promise<NotificationRow[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('notifications')
    .select('id, recipient_id, type, payload, read, created_at')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) {
    return [];
  }

  return data as NotificationRow[];
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string
): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId)
    .eq('recipient_id', userId);

  return !error;
}

// ============================================================
// Push text helpers
// ============================================================

function getPushTitle(type: NotificationType): string {
  switch (type) {
    case 'hype':
      return 'New Hype!';
    case 'comment':
      return 'New Comment';
    case 'new_follower':
      return 'New Follower';
    case 'squad_join':
      return 'Squad Update';
    case 'squad_invite':
      return 'Squad Invite';
    case 'milestone':
      return 'Milestone Achieved!';
    default:
      return 'HypeSquad';
  }
}

function getPushBody(type: NotificationType, payload: Record<string, unknown>): string {
  const actorName = (payload.actor_name as string) || 'Someone';
  switch (type) {
    case 'hype':
      return `${actorName} hyped your post`;
    case 'comment':
      return `${actorName} commented on your post`;
    case 'new_follower':
      return `${actorName} started following you`;
    case 'squad_join':
      return 'Your squad join request was approved';
    case 'squad_invite':
      return `${actorName} invited you to a squad`;
    case 'milestone':
      return 'You hit a new milestone!';
    default:
      return 'You have a new notification';
  }
}
