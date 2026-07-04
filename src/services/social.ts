import { getSupabaseClient } from '../lib/supabase';
import { ValidationError, NotFoundError } from '../lib/errors';
import { createNotification } from './notifications';

// ============================================================
// Types
// ============================================================

export interface FollowerEntry {
  user_id: string;
  name: string;
  handle: string | null;
  avatar_color: string | null;
  current_goal: string | null;
  current_streak: number;
  viewer_is_following: boolean;
}

// ============================================================
// Follow / Unfollow
// ============================================================

/**
 * Follow a user. Idempotent (ON CONFLICT DO NOTHING).
 */
export async function followUser(
  followerId: string,
  followeeId: string
): Promise<{ following: boolean }> {
  if (followerId === followeeId) {
    throw new ValidationError('Cannot follow yourself');
  }

  const supabase = getSupabaseClient();

  // Verify followee exists
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('id', followeeId)
    .single();

  if (userError || !user) {
    throw new NotFoundError('User not found');
  }

  // Idempotent insert
  await supabase
    .from('follows')
    .upsert(
      { follower_id: followerId, followee_id: followeeId },
      { onConflict: 'follower_id,followee_id', ignoreDuplicates: true }
    );

  // Notify the followee — fire-and-forget
  const { data: followerProfile } = await supabase
    .from('profiles')
    .select('name')
    .eq('user_id', followerId)
    .single();

  createNotification({
    recipient_id: followeeId,
    type: 'new_follower',
    payload: {
      actor_id: followerId,
      actor_name: (followerProfile as { name: string } | null)?.name || 'Someone',
    },
  }).catch(() => {}); // fire-and-forget

  return { following: true };
}

/**
 * Unfollow a user.
 */
export async function unfollowUser(
  followerId: string,
  followeeId: string
): Promise<{ following: boolean }> {
  const supabase = getSupabaseClient();

  await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followee_id', followeeId);

  return { following: false };
}

// ============================================================
// Followers / Following Lists
// ============================================================

/**
 * Get a user's followers list.
 * Each entry includes: user_id, name, handle, avatar_color, current_goal, current_streak, viewer_is_following.
 */
export async function getFollowers(
  targetUserId: string,
  viewerId: string
): Promise<FollowerEntry[]> {
  const supabase = getSupabaseClient();

  // Get all follower_ids for the target user
  const { data: follows, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', targetUserId);

  if (error || !follows || follows.length === 0) {
    return [];
  }

  const followerIds = (follows as Array<{ follower_id: string }>).map((f) => f.follower_id);

  return await enrichUserList(followerIds, viewerId);
}

/**
 * Get a user's following list.
 * Each entry includes: user_id, name, handle, avatar_color, current_goal, current_streak, viewer_is_following.
 */
export async function getFollowing(
  targetUserId: string,
  viewerId: string
): Promise<FollowerEntry[]> {
  const supabase = getSupabaseClient();

  // Get all followee_ids for the target user
  const { data: follows, error } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', targetUserId);

  if (error || !follows || follows.length === 0) {
    return [];
  }

  const followeeIds = (follows as Array<{ followee_id: string }>).map((f) => f.followee_id);

  return await enrichUserList(followeeIds, viewerId);
}

// ============================================================
// Helper: Enrich user list with profile + goal data
// ============================================================

async function enrichUserList(
  userIds: string[],
  viewerId: string
): Promise<FollowerEntry[]> {
  if (userIds.length === 0) return [];

  const supabase = getSupabaseClient();

  // Fetch profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .in('user_id', userIds);

  const profileMap = new Map<string, { name: string; handle: string | null; avatar_color: string | null }>();
  if (profiles) {
    for (const p of profiles as Array<{ user_id: string; name: string; handle: string | null; avatar_color: string | null }>) {
      profileMap.set(p.user_id, { name: p.name, handle: p.handle, avatar_color: p.avatar_color });
    }
  }

  // Fetch most recent active goal for each user (for current_goal + current_streak)
  // We get all active goals and pick the most recent one per user
  const { data: goals } = await supabase
    .from('goals')
    .select('owner_id, description, id')
    .in('owner_id', userIds)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  // Map user -> most recent active goal description
  const goalMap = new Map<string, { description: string | null; goal_id: string }>();
  if (goals) {
    for (const g of goals as Array<{ owner_id: string; description: string | null; id: string }>) {
      if (!goalMap.has(g.owner_id)) {
        goalMap.set(g.owner_id, { description: g.description, goal_id: g.id });
      }
    }
  }

  // Fetch streaks for those goals
  const goalIdsForStreak = [...goalMap.values()].map((g) => g.goal_id);
  const streakMap = new Map<string, number>();

  if (goalIdsForStreak.length > 0) {
    const { data: streaks } = await supabase
      .from('streaks')
      .select('goal_id, current')
      .in('goal_id', goalIdsForStreak);

    if (streaks) {
      for (const s of streaks as Array<{ goal_id: string; current: number }>) {
        streakMap.set(s.goal_id, s.current);
      }
    }
  }

  // Fetch which of these users the viewer is following
  const { data: viewerFollows } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', viewerId)
    .in('followee_id', userIds);

  const viewerFollowingSet = new Set<string>();
  if (viewerFollows) {
    for (const f of viewerFollows as Array<{ followee_id: string }>) {
      viewerFollowingSet.add(f.followee_id);
    }
  }

  // Assemble entries
  return userIds.map((userId) => {
    const profile = profileMap.get(userId);
    const goalInfo = goalMap.get(userId);
    const streak = goalInfo ? (streakMap.get(goalInfo.goal_id) || 0) : 0;

    return {
      user_id: userId,
      name: profile?.name || 'Unknown',
      handle: profile?.handle || null,
      avatar_color: profile?.avatar_color || null,
      current_goal: goalInfo?.description || null,
      current_streak: streak,
      viewer_is_following: viewerFollowingSet.has(userId),
    };
  });
}
