import { getSupabaseClient } from '../lib/supabase';

/**
 * Broadcast a message to all subscribers of a channel.
 * Channel naming: `squad:{squad_id}:channel:{channel_id}` per design.md §7
 */
export async function broadcastMessage(
  squadId: string,
  channelId: string,
  message: object
): Promise<void> {
  const supabase = getSupabaseClient();
  const channelName = `squad:${squadId}:channel:${channelId}`;

  const channel = supabase.channel(channelName);
  await channel.send({
    type: 'broadcast',
    event: 'new_message',
    payload: message,
  });
}
