import { getSupabaseClient } from '../lib/supabase';
import { ValidationError, ForbiddenError } from '../lib/errors';

// ============================================================
// Types
// ============================================================

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  name: string;
  handle: string | null;
  avatar_color: string | null;
  streak_total: number;
  hype_total: number;
}

export type LeaderboardScope = 'squad' | 'global';
export type LeaderboardMetric = 'streak' | 'hype';

// ============================================================
// Leaderboard Aggregation
// ============================================================

/**
 * Get leaderboard data.
 *
 * Streak total = MAX(current_streak) from streaks table across all ACTIVE goals for a user.
 * Hype total = COUNT of hypes received on all user's posts.
 *
 * Scope logic:
 * - global: all users
 * - squad: only members of the specified squad (validate user is a member)
 */
export async function getLeaderboard(
  userId: string,
  scope: LeaderboardScope,
  metric: LeaderboardMetric,
  squadId?: string
): Promise<LeaderboardEntry[]> {
  const supabase = getSupabaseClient();

  // Determine the user pool
  let userIds: string[] = [];

  if (scope === 'squad') {
    if (!squadId) {
      throw new ValidationError('squad_id is required when scope=squad');
    }

    // Validate the requesting user is a member
    const { data: membership, error: memError } = await supabase
      .from('squad_members')
      .select('user_id')
      .eq('squad_id', squadId)
      .eq('user_id', userId)
      .single();

    if (memError || !membership) {
      throw new ForbiddenError('You are not a member of this squad');
    }

    // Get all members of the squad
    const { data: members, error: membersError } = await supabase
      .from('squad_members')
      .select('user_id')
      .eq('squad_id', squadId);

    if (membersError || !members) {
      return [];
    }

    userIds = (members as Array<{ user_id: string }>).map((m) => m.user_id);
  } else {
    // Global: get all users with profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id')
      .limit(500); // Reasonable cap for v1

    if (profilesError || !profiles) {
      return [];
    }

    userIds = (profiles as Array<{ user_id: string }>).map((p) => p.user_id);
  }

  if (userIds.length === 0) {
    return [];
  }

  // Fetch profiles for all users
  const { data: profilesData } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .in('user_id', userIds);

  const profileMap = new Map<string, { name: string; handle: string | null; avatar_color: string | null }>();
  if (profilesData) {
    for (const p of profilesData as Array<{ user_id: string; name: string; handle: string | null; avatar_color: string | null }>) {
      profileMap.set(p.user_id, { name: p.name, handle: p.handle, avatar_color: p.avatar_color });
    }
  }

  // ─── Streak totals ───────────────────────────────────────────────────────
  // MAX(current_streak) across all ACTIVE goals per user
  // Get active goals for the user pool
  const { data: activeGoals } = await supabase
    .from('goals')
    .select('id, owner_id')
    .in('owner_id', userIds)
    .eq('status', 'active');

  const goalsByUser = new Map<string, string[]>();
  if (activeGoals) {
    for (const g of activeGoals as Array<{ id: string; owner_id: string }>) {
      const existing = goalsByUser.get(g.owner_id) || [];
      existing.push(g.id);
      goalsByUser.set(g.owner_id, existing);
    }
  }

  // Fetch streaks for all active goal IDs
  const allGoalIds = activeGoals
    ? (activeGoals as Array<{ id: string }>).map((g) => g.id)
    : [];

  const streakMap = new Map<string, number>(); // user_id -> max streak

  if (allGoalIds.length > 0) {
    const { data: streaks } = await supabase
      .from('streaks')
      .select('goal_id, current')
      .in('goal_id', allGoalIds);

    if (streaks) {
      // Build goal_id -> current streak map
      const goalStreakMap = new Map<string, number>();
      for (const s of streaks as Array<{ goal_id: string; current: number }>) {
        goalStreakMap.set(s.goal_id, s.current);
      }

      // For each user, find the max streak across their active goals
      for (const [uid, goalIds] of goalsByUser) {
        let maxStreak = 0;
        for (const gid of goalIds) {
          const streak = goalStreakMap.get(gid) || 0;
          if (streak > maxStreak) maxStreak = streak;
        }
        streakMap.set(uid, maxStreak);
      }
    }
  }

  // ─── Hype totals ─────────────────────────────────────────────────────────
  // COUNT of hypes received on all user's posts
  // Fetch posts by these users
  const { data: userPosts } = await supabase
    .from('posts')
    .select('id, author_id')
    .in('author_id', userIds);

  const hypeMap = new Map<string, number>(); // user_id -> hype count

  if (userPosts && (userPosts as Array<{ id: string; author_id: string }>).length > 0) {
    const postIds = (userPosts as Array<{ id: string; author_id: string }>).map((p) => p.id);
    const postAuthorMap = new Map<string, string>();
    for (const p of userPosts as Array<{ id: string; author_id: string }>) {
      postAuthorMap.set(p.id, p.author_id);
    }

    // Fetch hype counts
    const { data: hypes } = await supabase
      .from('hypes')
      .select('post_id')
      .in('post_id', postIds);

    if (hypes) {
      for (const h of hypes as Array<{ post_id: string }>) {
        const authorId = postAuthorMap.get(h.post_id);
        if (authorId) {
          hypeMap.set(authorId, (hypeMap.get(authorId) || 0) + 1);
        }
      }
    }
  }

  // ─── Assemble + sort ─────────────────────────────────────────────────────
  const entries: Omit<LeaderboardEntry, 'rank'>[] = userIds.map((uid) => {
    const profile = profileMap.get(uid);
    return {
      user_id: uid,
      name: profile?.name || 'Unknown',
      handle: profile?.handle || null,
      avatar_color: profile?.avatar_color || null,
      streak_total: streakMap.get(uid) || 0,
      hype_total: hypeMap.get(uid) || 0,
    };
  });

  // Sort by selected metric DESC
  entries.sort((a, b) => {
    if (metric === 'streak') {
      return b.streak_total - a.streak_total;
    }
    return b.hype_total - a.hype_total;
  });

  // Add ranks
  return entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}
