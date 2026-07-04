import { getSupabaseClient } from '../lib/supabase';
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '../lib/errors';
import { broadcastMessage } from './realtime';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string | null;
  type: 'text' | 'checkin_card';
  checkin_id: string | null;
  created_at: string;
}

export interface MessageWithAuthor extends MessageRow {
  author: {
    name: string;
    handle: string | null;
    avatar_color: string | null;
  };
}

export interface MessagePage {
  messages: MessageWithAuthor[];
  next_cursor: string | null;
}

// ─── Cursor helpers ──────────────────────────────────────────────────────────

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ created_at: createdAt, id })).toString('base64');
}

export function decodeCursor(cursor: string): { created_at: string; id: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    if (decoded.created_at && decoded.id) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Membership check ────────────────────────────────────────────────────────

/**
 * Verify that a user is a member of the channel's squad.
 * Returns the channel's squad_id if valid, throws otherwise.
 */
export async function verifyChannelMembership(
  userId: string,
  channelId: string
): Promise<string> {
  const supabase = getSupabaseClient();

  // Get the channel and its squad_id
  const { data: channel, error: channelError } = await supabase
    .from('channels')
    .select('id, squad_id')
    .eq('id', channelId)
    .single();

  if (channelError || !channel) {
    throw new NotFoundError('Channel not found');
  }

  const squadId = (channel as { id: string; squad_id: string }).squad_id;

  // Check if user is a squad member
  const { data: membership, error: memError } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('squad_id', squadId)
    .eq('user_id', userId)
    .single();

  if (memError || !membership) {
    throw new ForbiddenError('You are not a member of this squad');
  }

  return squadId;
}

// ─── Message History (GET) ───────────────────────────────────────────────────

/**
 * Get messages for a channel (paginated, cursor-based, 50 per page).
 */
export async function getChannelMessages(
  channelId: string,
  cursor?: string
): Promise<MessagePage> {
  const supabase = getSupabaseClient();
  const pageSize = 50;

  let query = supabase
    .from('messages')
    .select('id, channel_id, author_id, body, type, checkin_id, created_at')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1); // fetch one extra for next_cursor detection

  if (cursor) {
    const cursorData = decodeCursor(cursor);
    if (cursorData) {
      query = query.or(
        `created_at.lt.${cursorData.created_at},and(created_at.eq.${cursorData.created_at},id.lt.${cursorData.id})`
      );
    }
  }

  const { data: messages, error } = await query;

  if (error || !messages) {
    return { messages: [], next_cursor: null };
  }

  const messageList = messages as MessageRow[];
  let nextCursor: string | null = null;

  if (messageList.length > pageSize) {
    const lastItem = messageList[pageSize - 1];
    nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
    messageList.splice(pageSize); // trim to pageSize
  }

  // Enrich with author info
  const enrichedMessages: MessageWithAuthor[] = [];
  const authorIds = [...new Set(messageList.map((m) => m.author_id))];

  // Batch fetch profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .in('user_id', authorIds);

  const profileMap = new Map(
    (profiles || []).map((p: { user_id: string; name: string; handle: string | null; avatar_color: string | null }) => [
      p.user_id,
      { name: p.name, handle: p.handle, avatar_color: p.avatar_color },
    ])
  );

  for (const msg of messageList) {
    enrichedMessages.push({
      ...msg,
      author: profileMap.get(msg.author_id) || { name: 'Unknown', handle: null, avatar_color: null },
    });
  }

  return { messages: enrichedMessages, next_cursor: nextCursor };
}

// ─── Send Message (POST) ─────────────────────────────────────────────────────

/**
 * Create a message in a channel and broadcast via Realtime.
 */
export async function sendMessage(
  channelId: string,
  authorId: string,
  squadId: string,
  body: string,
  type: 'text' | 'checkin_card' = 'text',
  checkinId?: string
): Promise<MessageWithAuthor> {
  const supabase = getSupabaseClient();

  if (!body || body.trim() === '') {
    throw new ValidationError('Message body is required');
  }

  // Insert message
  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      channel_id: channelId,
      author_id: authorId,
      body: body.trim(),
      type,
      checkin_id: checkinId || null,
    })
    .select()
    .single();

  if (error || !message) {
    throw new AppError('Failed to send message', 500, 'MESSAGE_SEND_FAILED');
  }

  const msgData = message as MessageRow;

  // Get author profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, handle, avatar_color')
    .eq('user_id', authorId)
    .single();

  const author = (profile as { name: string; handle: string | null; avatar_color: string | null }) || {
    name: 'Unknown',
    handle: null,
    avatar_color: null,
  };

  const fullMessage: MessageWithAuthor = {
    ...msgData,
    author,
  };

  // Fire-and-forget broadcast (don't block the API response)
  broadcastMessage(squadId, channelId, fullMessage).catch((err) => {
    console.error('Realtime broadcast failed:', err);
  });

  return fullMessage;
}

// ─── Emit Check-in Card ──────────────────────────────────────────────────────

/**
 * After a successful check-in, emit a check-in card message to all
 * squads the user belongs to that have a 'check-ins' channel.
 */
export async function emitCheckinCard(
  userId: string,
  checkinId: string,
  goalDescription: string
): Promise<void> {
  const supabase = getSupabaseClient();

  // Get all squads the user belongs to
  const { data: memberships } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('user_id', userId);

  if (!memberships || memberships.length === 0) return;

  const squadIds = memberships.map((m: { squad_id: string }) => m.squad_id);

  // For each squad, find the 'check-ins' channel
  const { data: channels } = await supabase
    .from('channels')
    .select('id, squad_id')
    .in('squad_id', squadIds)
    .eq('name', 'check-ins');

  if (!channels || channels.length === 0) return;

  // Send a check-in card to each channel (fire-and-forget)
  for (const channel of channels as { id: string; squad_id: string }[]) {
    sendMessage(
      channel.id,
      userId,
      channel.squad_id,
      goalDescription,
      'checkin_card',
      checkinId
    ).catch((err) => {
      console.error('Failed to emit check-in card:', err);
    });
  }
}
