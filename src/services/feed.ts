import { getSupabaseClient } from '../lib/supabase';
import { NotFoundError, ForbiddenError, ValidationError } from '../lib/errors';
import { createNotification } from './notifications';
import { moderateContent } from './moderation';

// ============================================================
// Types
// ============================================================

export interface FeedPost {
  id: string;
  author_id: string;
  goal_id: string | null;
  type: string;
  body: string | null;
  media_refs: unknown | null;
  visibility: string;
  created_at: string;
  author: {
    name: string;
    handle: string | null;
    avatar_color: string | null;
  };
  hype_count: number;
  viewer_has_hyped: boolean;
  comment_count: number;
}

export interface FeedPage {
  posts: FeedPost[];
  next_cursor: string | null;
}

export interface CursorData {
  created_at: string;
  id: string;
}

// ============================================================
// Cursor helpers
// ============================================================

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ created_at: createdAt, id })).toString('base64');
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    if (decoded.created_at && decoded.id) {
      return decoded as CursorData;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// Visibility check
// ============================================================

/**
 * Check if a viewer can see a specific post.
 * Rules:
 * - Viewer always sees their own posts
 * - Public posts visible to all
 * - Squad posts visible if viewer shares a squad with author
 */
export async function canViewerSeePost(
  postId: string,
  viewerId: string
): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { data: post, error } = await supabase
    .from('posts')
    .select('author_id, visibility')
    .eq('id', postId)
    .single();

  if (error || !post) {
    return false;
  }

  const postData = post as { author_id: string; visibility: string };

  // Own post
  if (postData.author_id === viewerId) {
    return true;
  }

  // Public post
  if (postData.visibility === 'public') {
    return true;
  }

  // Squad post — check if viewer shares a squad with author
  if (postData.visibility === 'squad') {
    return await sharesSquadWith(viewerId, postData.author_id);
  }

  return false;
}

/**
 * Check if two users share at least one squad.
 */
async function sharesSquadWith(userA: string, userB: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc('shares_squad_check', {
    user_a: userA,
    user_b: userB,
  });

  // If RPC doesn't exist, fall back to manual query
  if (error) {
    const { data: shared } = await supabase
      .from('squad_members')
      .select('squad_id')
      .eq('user_id', userA);

    if (!shared || shared.length === 0) return false;

    const squadIds = (shared as Array<{ squad_id: string }>).map((s) => s.squad_id);

    const { data: match } = await supabase
      .from('squad_members')
      .select('squad_id')
      .eq('user_id', userB)
      .in('squad_id', squadIds)
      .limit(1);

    return !!(match && match.length > 0);
  }

  return !!data;
}

// ============================================================
// Feed pagination
// ============================================================

const PAGE_SIZE = 20;

/**
 * Get paginated feed for a viewer.
 * Returns posts they can see (own + public + squad-visible), newest first.
 * Cursor-based pagination using created_at + id.
 */
export async function getFeedPage(
  viewerId: string,
  cursor?: string
): Promise<FeedPage> {
  const supabase = getSupabaseClient();

  // Get squads the viewer belongs to
  const { data: viewerSquads } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('user_id', viewerId);

  const viewerSquadIds = (viewerSquads as Array<{ squad_id: string }> | null)?.map(
    (s) => s.squad_id
  ) || [];

  // Get users who share a squad with the viewer
  let squadMateIds: string[] = [];
  if (viewerSquadIds.length > 0) {
    const { data: squadMates } = await supabase
      .from('squad_members')
      .select('user_id')
      .in('squad_id', viewerSquadIds)
      .neq('user_id', viewerId);

    squadMateIds = (squadMates as Array<{ user_id: string }> | null)?.map(
      (s) => s.user_id
    ) || [];
    // Deduplicate
    squadMateIds = [...new Set(squadMateIds)];
  }

  // Build query: fetch posts the viewer can see
  // Strategy: fetch all public posts + own posts + squad posts from squad mates
  // Use an OR filter approach
  let query = supabase
    .from('posts')
    .select('id, author_id, goal_id, type, body, media_refs, visibility, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);

  // Apply cursor if provided
  const cursorData = cursor ? decodeCursor(cursor) : null;
  if (cursorData) {
    // Posts older than cursor (created_at < cursor.created_at OR same time but id < cursor.id)
    query = query.or(
      `created_at.lt.${cursorData.created_at},and(created_at.eq.${cursorData.created_at},id.lt.${cursorData.id})`
    );
  }

  // Visibility filter:
  // Show public posts OR viewer's own posts OR squad posts from squad mates
  if (squadMateIds.length > 0) {
    query = query.or(
      `visibility.eq.public,author_id.eq.${viewerId},and(visibility.eq.squad,author_id.in.(${squadMateIds.join(',')}))`
    );
  } else {
    query = query.or(`visibility.eq.public,author_id.eq.${viewerId}`);
  }

  const { data: posts, error } = await query;

  if (error) {
    console.error('Feed query error:', error);
    return { posts: [], next_cursor: null };
  }

  if (!posts || posts.length === 0) {
    return { posts: [], next_cursor: null };
  }

  const postsData = posts as Array<{
    id: string;
    author_id: string;
    goal_id: string | null;
    type: string;
    body: string | null;
    media_refs: unknown | null;
    visibility: string;
    created_at: string;
  }>;

  // Collect unique author IDs
  const authorIds = [...new Set(postsData.map((p) => p.author_id))];
  const postIds = postsData.map((p) => p.id);

  // Fetch author profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .in('user_id', authorIds);

  const profileMap = new Map<string, { name: string; handle: string | null; avatar_color: string | null }>();
  if (profiles) {
    for (const p of profiles as Array<{ user_id: string; name: string; handle: string | null; avatar_color: string | null }>) {
      profileMap.set(p.user_id, { name: p.name, handle: p.handle, avatar_color: p.avatar_color });
    }
  }

  // Fetch hype counts
  const { data: hypeCounts } = await supabase
    .from('hypes')
    .select('post_id')
    .in('post_id', postIds);

  const hypeCountMap = new Map<string, number>();
  if (hypeCounts) {
    for (const h of hypeCounts as Array<{ post_id: string }>) {
      hypeCountMap.set(h.post_id, (hypeCountMap.get(h.post_id) || 0) + 1);
    }
  }

  // Fetch viewer's hypes
  const { data: viewerHypes } = await supabase
    .from('hypes')
    .select('post_id')
    .eq('user_id', viewerId)
    .in('post_id', postIds);

  const viewerHypedSet = new Set<string>();
  if (viewerHypes) {
    for (const h of viewerHypes as Array<{ post_id: string }>) {
      viewerHypedSet.add(h.post_id);
    }
  }

  // Fetch comment counts
  const { data: commentCounts } = await supabase
    .from('comments')
    .select('post_id')
    .in('post_id', postIds);

  const commentCountMap = new Map<string, number>();
  if (commentCounts) {
    for (const c of commentCounts as Array<{ post_id: string }>) {
      commentCountMap.set(c.post_id, (commentCountMap.get(c.post_id) || 0) + 1);
    }
  }

  // Assemble feed posts
  const feedPosts: FeedPost[] = postsData.map((post) => ({
    id: post.id,
    author_id: post.author_id,
    goal_id: post.goal_id,
    type: post.type,
    body: post.body,
    media_refs: post.media_refs,
    visibility: post.visibility,
    created_at: post.created_at,
    author: profileMap.get(post.author_id) || { name: 'Unknown', handle: null, avatar_color: null },
    hype_count: hypeCountMap.get(post.id) || 0,
    viewer_has_hyped: viewerHypedSet.has(post.id),
    comment_count: commentCountMap.get(post.id) || 0,
  }));

  // Compute next_cursor
  const nextCursor =
    postsData.length === PAGE_SIZE
      ? encodeCursor(postsData[postsData.length - 1].created_at, postsData[postsData.length - 1].id)
      : null;

  return { posts: feedPosts, next_cursor: nextCursor };
}

// ============================================================
// Hype a post
// ============================================================

export interface HypeResult {
  hype_count: number;
  viewer_has_hyped: boolean;
}

/**
 * Hype a post (idempotent). Returns current hype count.
 */
export async function hypePost(postId: string, userId: string): Promise<HypeResult> {
  const supabase = getSupabaseClient();

  // Verify viewer can see the post
  const canSee = await canViewerSeePost(postId, userId);
  if (!canSee) {
    throw new NotFoundError('Post not found');
  }

  // INSERT with ON CONFLICT DO NOTHING
  await supabase
    .from('hypes')
    .upsert(
      { post_id: postId, user_id: userId },
      { onConflict: 'post_id,user_id', ignoreDuplicates: true }
    );

  // Get current hype count
  const { count } = await supabase
    .from('hypes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  // Notify the post author (unless self-hype) — fire-and-forget
  const { data: postRow } = await supabase
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .single();

  if (postRow && (postRow as { author_id: string }).author_id !== userId) {
    // Fetch hype actor's name
    const { data: actorProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('user_id', userId)
      .single();

    createNotification({
      recipient_id: (postRow as { author_id: string }).author_id,
      type: 'hype',
      payload: {
        actor_id: userId,
        actor_name: (actorProfile as { name: string } | null)?.name || 'Someone',
        post_id: postId,
      },
    }).catch(() => {}); // fire-and-forget
  }

  return {
    hype_count: count || 0,
    viewer_has_hyped: true,
  };
}

// ============================================================
// Comments
// ============================================================

export interface CommentData {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: {
    name: string;
    handle: string | null;
    avatar_color: string | null;
  };
}

/**
 * Get all comments for a post (ordered by created_at ASC).
 */
export async function getComments(postId: string, viewerId: string): Promise<CommentData[]> {
  // Verify viewer can see the post
  const canSee = await canViewerSeePost(postId, viewerId);
  if (!canSee) {
    throw new NotFoundError('Post not found');
  }

  const supabase = getSupabaseClient();

  const { data: comments, error } = await supabase
    .from('comments')
    .select('id, author_id, body, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error || !comments) {
    return [];
  }

  const commentsData = comments as Array<{
    id: string;
    author_id: string;
    body: string;
    created_at: string;
  }>;

  if (commentsData.length === 0) return [];

  // Fetch author profiles
  const authorIds = [...new Set(commentsData.map((c) => c.author_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .in('user_id', authorIds);

  const profileMap = new Map<string, { name: string; handle: string | null; avatar_color: string | null }>();
  if (profiles) {
    for (const p of profiles as Array<{ user_id: string; name: string; handle: string | null; avatar_color: string | null }>) {
      profileMap.set(p.user_id, { name: p.name, handle: p.handle, avatar_color: p.avatar_color });
    }
  }

  return commentsData.map((c) => ({
    id: c.id,
    author_id: c.author_id,
    body: c.body,
    created_at: c.created_at,
    author: profileMap.get(c.author_id) || { name: 'Unknown', handle: null, avatar_color: null },
  }));
}

/**
 * Create a comment on a post.
 */
export async function createComment(
  postId: string,
  userId: string,
  body: string
): Promise<CommentData> {
  if (!body || body.trim().length === 0) {
    throw new ValidationError('Comment body must not be empty');
  }

  // Verify viewer can see the post
  const canSee = await canViewerSeePost(postId, userId);
  if (!canSee) {
    throw new NotFoundError('Post not found');
  }

  const supabase = getSupabaseClient();

  const { data: comment, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, author_id: userId, body: body.trim() })
    .select('id, author_id, body, created_at')
    .single();

  if (error || !comment) {
    throw new ForbiddenError('Failed to create comment');
  }

  const commentData = comment as { id: string; author_id: string; body: string; created_at: string };

  // Fetch author profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .eq('user_id', userId)
    .single();

  const profileData = profile as { user_id: string; name: string; handle: string | null; avatar_color: string | null } | null;

  // Notify the post author (unless self-comment) — fire-and-forget
  const { data: postForNotif } = await supabase
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .single();

  if (postForNotif && (postForNotif as { author_id: string }).author_id !== userId) {
    createNotification({
      recipient_id: (postForNotif as { author_id: string }).author_id,
      type: 'comment',
      payload: {
        actor_id: userId,
        actor_name: profileData?.name || 'Someone',
        post_id: postId,
        comment_id: commentData.id,
      },
    }).catch(() => {}); // fire-and-forget
  }

  return {
    id: commentData.id,
    author_id: commentData.author_id,
    body: commentData.body,
    created_at: commentData.created_at,
    author: profileData
      ? { name: profileData.name, handle: profileData.handle, avatar_color: profileData.avatar_color }
      : { name: 'Unknown', handle: null, avatar_color: null },
  };
}

// ============================================================
// Post creation
// ============================================================

export interface CreatePostInput {
  body: string;
  goal_id?: string;
  type: string;
  media_refs?: unknown;
  visibility: string;
}

export interface CreatedPost {
  id: string;
  author_id: string;
  goal_id: string | null;
  type: string;
  body: string;
  media_refs: unknown | null;
  visibility: string;
  created_at: string;
}

/**
 * Create a new post.
 */
export async function createPost(
  userId: string,
  input: CreatePostInput
): Promise<CreatedPost> {
  const { body, goal_id, type, media_refs, visibility } = input;

  // Validations
  if (!body || body.trim().length === 0) {
    throw new ValidationError('Post body must not be empty');
  }

  const validTypes = ['win', 'progress', 'needs_hype'];
  if (!validTypes.includes(type)) {
    throw new ValidationError(`type must be one of: ${validTypes.join(', ')}`);
  }

  const validVisibilities = ['public', 'squad'];
  if (!validVisibilities.includes(visibility)) {
    throw new ValidationError(`visibility must be one of: ${validVisibilities.join(', ')}`);
  }

  const supabase = getSupabaseClient();

  // If goal_id provided, verify it exists and user can see it
  if (goal_id) {
    const { data: goal, error: goalError } = await supabase
      .from('goals')
      .select('id, owner_id, visibility')
      .eq('id', goal_id)
      .single();

    if (goalError || !goal) {
      throw new ValidationError('Goal not found');
    }

    const goalData = goal as { id: string; owner_id: string; visibility: string };

    // User must own the goal or it must be visible to them
    if (goalData.owner_id !== userId) {
      if (goalData.visibility === 'squad') {
        const canSee = await sharesSquadWith(userId, goalData.owner_id);
        if (!canSee) {
          throw new ValidationError('Goal not found');
        }
      }
      // Public goals are visible to all, so that's fine
    }
  }

  // Create post (insert first, then moderate async — v1 flags but does not block)
  const { data: post, error } = await supabase
    .from('posts')
    .insert({
      author_id: userId,
      goal_id: goal_id || null,
      type,
      body: body.trim(),
      media_refs: media_refs || null,
      visibility,
    })
    .select('id, author_id, goal_id, type, body, media_refs, visibility, created_at')
    .single();

  if (error || !post) {
    throw new ForbiddenError('Failed to create post');
  }

  const createdPost = post as CreatedPost;

  // Moderate body text (async — creates flag if needed, does NOT block insertion)
  // Note: auto-posts from check-ins use createAutoPost() which is EXEMPT from moderation
  moderateContent('post', createdPost.id, body.trim()).catch((err) => {
    console.error('Post moderation failed:', err);
  });

  return createdPost;
}
