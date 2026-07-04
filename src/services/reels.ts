import { getSupabaseClient } from '../lib/supabase';
import { ValidationError, NotFoundError } from '../lib/errors';
import { encodeCursor, decodeCursor } from '../services/feed';
import { moderateContent } from './moderation';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateReelInput {
  goal_id: string;
  caption?: string;
  duration_seconds: number;
  video_url: string;
}

export interface ReelRow {
  id: string;
  author_id: string;
  goal_id: string | null;
  video_url: string | null;
  caption: string | null;
  duration_seconds: number | null;
  status: string | null;
  created_at: string;
}

export interface ReelFeedItem {
  id: string;
  author_id: string;
  goal_id: string | null;
  video_url: string | null;
  caption: string | null;
  duration_seconds: number | null;
  status: string | null;
  created_at: string;
  author: {
    name: string;
    handle: string | null;
    avatar_color: string | null;
  };
  goal: {
    category: string | null;
    description: string | null;
  } | null;
  hype_count: number;
  viewer_has_hyped: boolean;
}

export interface ReelFeedPage {
  reels: ReelFeedItem[];
  next_cursor: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_DURATIONS = [15, 30, 60];
const FEED_PAGE_SIZE = 20;

// ─── Reel Creation ──────────────────────────────────────────────────────────

/**
 * Create a new reel.
 * - Validates duration_seconds is one of 15/30/60
 * - Validates goal_id exists and is owned by user
 * - Validates video_url is non-empty
 * - Creates reel with status='processing', then immediately sets to 'live' (v1 mock)
 */
export async function createReel(
  userId: string,
  input: CreateReelInput
): Promise<ReelRow> {
  const supabase = getSupabaseClient();

  // Validate duration_seconds
  if (!VALID_DURATIONS.includes(input.duration_seconds)) {
    throw new ValidationError(
      `duration_seconds must be one of: ${VALID_DURATIONS.join(', ')}`
    );
  }

  // Validate video_url
  if (!input.video_url || input.video_url.trim() === '') {
    throw new ValidationError('video_url must be non-empty');
  }

  // Validate goal_id exists and is owned by user
  if (!input.goal_id || input.goal_id.trim() === '') {
    throw new ValidationError('goal_id is required');
  }

  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .select('id, owner_id')
    .eq('id', input.goal_id)
    .single();

  if (goalError || !goal) {
    throw new NotFoundError('Goal not found');
  }

  const goalData = goal as { id: string; owner_id: string };
  if (goalData.owner_id !== userId) {
    throw new NotFoundError('Goal not found');
  }

  // Create reel with status='processing'
  const { data: reel, error: reelError } = await supabase
    .from('reels')
    .insert({
      author_id: userId,
      goal_id: input.goal_id,
      video_url: input.video_url.trim(),
      caption: input.caption?.trim() || null,
      duration_seconds: input.duration_seconds,
      status: 'processing',
    })
    .select()
    .single();

  if (reelError || !reel) {
    throw new Error('Failed to create reel');
  }

  const reelData = reel as ReelRow;

  // v1: immediately update status to 'live' (no actual processing pipeline)
  const { data: updatedReel, error: updateError } = await supabase
    .from('reels')
    .update({ status: 'live' })
    .eq('id', reelData.id)
    .select()
    .single();

  if (updateError || !updatedReel) {
    // Return the processing reel even if update fails
    return reelData;
  }

  const finalReel = updatedReel as ReelRow;

  // Moderate caption text (async — flags but does not block)
  if (finalReel.caption) {
    moderateContent('reel', finalReel.id, finalReel.caption).catch((err) => {
      console.error('Reel caption moderation failed:', err);
    });
  }

  return finalReel;
}

// ─── Reels Feed Pagination ──────────────────────────────────────────────────

/**
 * Get paginated reels feed (status='live' only).
 * Cursor-based, 20 per page, reverse-chronological.
 * Reel hypes are placeholder (0/false) since schema has no reel_hypes table.
 */
export async function getReelsFeed(
  viewerId: string,
  cursor?: string
): Promise<ReelFeedPage> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('reels')
    .select('id, author_id, goal_id, video_url, caption, duration_seconds, status, created_at')
    .eq('status', 'live')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(FEED_PAGE_SIZE);

  // Apply cursor if provided
  const cursorData = cursor ? decodeCursor(cursor) : null;
  if (cursorData) {
    query = query.or(
      `created_at.lt.${cursorData.created_at},and(created_at.eq.${cursorData.created_at},id.lt.${cursorData.id})`
    );
  }

  const { data: reels, error } = await query;

  if (error || !reels) {
    return { reels: [], next_cursor: null };
  }

  const reelsData = reels as ReelRow[];

  if (reelsData.length === 0) {
    return { reels: [], next_cursor: null };
  }

  // Collect unique author IDs and goal IDs
  const authorIds = [...new Set(reelsData.map((r) => r.author_id))];
  const goalIds = [...new Set(reelsData.filter((r) => r.goal_id).map((r) => r.goal_id!))];

  // Fetch author profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .in('user_id', authorIds);

  const profileMap = new Map<
    string,
    { name: string; handle: string | null; avatar_color: string | null }
  >();
  if (profiles) {
    for (const p of profiles as Array<{
      user_id: string;
      name: string;
      handle: string | null;
      avatar_color: string | null;
    }>) {
      profileMap.set(p.user_id, {
        name: p.name,
        handle: p.handle,
        avatar_color: p.avatar_color,
      });
    }
  }

  // Fetch goals for linked reels
  const goalMap = new Map<
    string,
    { category: string | null; description: string | null }
  >();
  if (goalIds.length > 0) {
    const { data: goals } = await supabase
      .from('goals')
      .select('id, category, description')
      .in('id', goalIds);

    if (goals) {
      for (const g of goals as Array<{
        id: string;
        category: string | null;
        description: string | null;
      }>) {
        goalMap.set(g.id, { category: g.category, description: g.description });
      }
    }
  }

  // Assemble feed items
  const feedItems: ReelFeedItem[] = reelsData.map((reel) => ({
    id: reel.id,
    author_id: reel.author_id,
    goal_id: reel.goal_id,
    video_url: reel.video_url,
    caption: reel.caption,
    duration_seconds: reel.duration_seconds,
    status: reel.status,
    created_at: reel.created_at,
    author: profileMap.get(reel.author_id) || {
      name: 'Unknown',
      handle: null,
      avatar_color: null,
    },
    goal: reel.goal_id ? goalMap.get(reel.goal_id) || null : null,
    // Placeholder values — schema has no reel_hypes table
    hype_count: 0,
    viewer_has_hyped: false,
  }));

  // Compute next cursor
  const nextCursor =
    reelsData.length === FEED_PAGE_SIZE
      ? encodeCursor(
          reelsData[reelsData.length - 1].created_at,
          reelsData[reelsData.length - 1].id
        )
      : null;

  return { reels: feedItems, next_cursor: nextCursor };
}
