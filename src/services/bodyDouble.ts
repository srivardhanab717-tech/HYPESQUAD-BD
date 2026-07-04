import { getSupabaseClient } from '../lib/supabase';
import { createNotification } from './notifications';

// ============================================================
// Types
// ============================================================

export interface BodyDoubleJoinResult {
  channel_name: string;
  current_participants: string[];
}

// ============================================================
// Body Double Presence
// ============================================================

/**
 * Join a Body Double room.
 * Registers the user's presence and returns the channel info.
 *
 * Channel naming: `bodydouble:{roomId}` per design.md §7
 * Presence is ephemeral (NOT persisted) per design.md §7
 * Uses Supabase Realtime presence tracking.
 *
 * The actual WebSocket connection is handled client-side;
 * this endpoint provides the channel info and registers intent.
 */
export async function joinBodyDoubleRoom(
  userId: string,
  roomId: string
): Promise<BodyDoubleJoinResult> {
  const supabase = getSupabaseClient();
  const channelName = `bodydouble:${roomId}`;

  // Track presence via Supabase Realtime
  const channel = supabase.channel(channelName, {
    config: { presence: { key: userId } },
  });

  // Track the user's presence
  await channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ user_id: userId, joined_at: new Date().toISOString() });
    }
  });

  // Get current presence state (other participants)
  const presenceState = channel.presenceState();
  const participants: string[] = [];

  for (const key of Object.keys(presenceState)) {
    if (key !== userId) {
      participants.push(key);
    }
  }
  // Always include the joining user
  participants.push(userId);

  return {
    channel_name: channelName,
    current_participants: participants,
  };
}

/**
 * Invite a user to a Body Double room.
 * Creates a notification for the invitee with a joinable reference.
 */
export async function inviteToBodyDouble(
  inviterId: string,
  inviteeId: string,
  roomId: string
): Promise<{ invited: boolean }> {
  const supabase = getSupabaseClient();

  // Fetch inviter's name for the notification
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('user_id', inviterId)
    .single();

  const inviterName = (profile as { name: string } | null)?.name || 'Someone';

  // Create notification for the invitee
  await createNotification({
    recipient_id: inviteeId,
    type: 'squad_invite', // Re-use squad_invite type for body double invites
    payload: {
      actor_id: inviterId,
      actor_name: inviterName,
      room_id: roomId,
      channel_name: `bodydouble:${roomId}`,
      invite_type: 'body_double',
    },
  });

  return { invited: true };
}
