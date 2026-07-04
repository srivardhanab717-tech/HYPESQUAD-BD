import { getSupabaseClient } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiscoverResponse {
  recommended_squads: unknown[];
  trending_tags: string[];
}

export interface SearchResponse {
  people: unknown[];
  goals: unknown[];
  squads: unknown[];
}

// ─── Discover ────────────────────────────────────────────────────────────────

/**
 * Get recommended squads (top public squads by member count, limit 10)
 * and trending tags (most common goal categories, limit 15).
 */
export async function getDiscover(): Promise<DiscoverResponse> {
  const supabase = getSupabaseClient();

  // Get public squads
  const { data: squads } = await supabase
    .from('squads')
    .select('id, name, emoji, category, visibility')
    .eq('visibility', 'public');

  // Get member counts for each squad
  const recommendedSquads: unknown[] = [];
  if (squads) {
    for (const squad of squads as { id: string; name: string; emoji: string | null; category: string | null; visibility: string }[]) {
      const { count } = await supabase
        .from('squad_members')
        .select('*', { count: 'exact', head: true })
        .eq('squad_id', squad.id);

      recommendedSquads.push({
        ...squad,
        member_count: count || 0,
      });
    }

    // Sort by member_count DESC and limit to 10
    recommendedSquads.sort((a: any, b: any) => b.member_count - a.member_count);
    recommendedSquads.splice(10);
  }

  // Get trending tags (most common goal categories)
  const { data: goals } = await supabase
    .from('goals')
    .select('category')
    .eq('status', 'active')
    .not('category', 'is', null);

  const categoryCount = new Map<string, number>();
  if (goals) {
    for (const g of goals as { category: string | null }[]) {
      if (g.category) {
        categoryCount.set(g.category, (categoryCount.get(g.category) || 0) + 1);
      }
    }
  }

  const trendingTags = [...categoryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);

  return { recommended_squads: recommendedSquads, trending_tags: trendingTags };
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Search across people, goals, and squads.
 * Visibility rules:
 * - People: ilike on name, handle
 * - Goals: ilike on description, category; only visible goals (public or squad-mate)
 * - Squads: ilike on name, category; only public squads OR squads user is a member of
 */
export async function search(
  query: string,
  userId: string
): Promise<SearchResponse> {
  const supabase = getSupabaseClient();
  const pattern = `%${query}%`;

  // 1. Search people (profiles)
  const { data: people } = await supabase
    .from('profiles')
    .select('user_id, name, handle, avatar_color')
    .or(`name.ilike.${pattern},handle.ilike.${pattern}`)
    .limit(20);

  // 2. Search goals (only visible ones)
  // Get squads the user belongs to for visibility check
  const { data: memberships } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('user_id', userId);

  const userSquadIds = (memberships || []).map((m: { squad_id: string }) => m.squad_id);

  // Get squad-mates user IDs for visibility
  let squadMateIds: string[] = [];
  if (userSquadIds.length > 0) {
    const { data: squadMates } = await supabase
      .from('squad_members')
      .select('user_id')
      .in('squad_id', userSquadIds)
      .neq('user_id', userId);

    squadMateIds = (squadMates || []).map((m: { user_id: string }) => m.user_id);
  }

  // Search goals matching query
  const { data: allGoals } = await supabase
    .from('goals')
    .select('id, owner_id, category, description, visibility, status')
    .or(`description.ilike.${pattern},category.ilike.${pattern}`)
    .eq('status', 'active')
    .limit(50);

  // Filter by visibility: public, or owner is a squad-mate, or user's own
  const visibleGoals = (allGoals || []).filter((g: any) => {
    if (g.owner_id === userId) return true;
    if (g.visibility === 'public') return true;
    if (g.visibility === 'squad' && squadMateIds.includes(g.owner_id)) return true;
    return false;
  }).slice(0, 20);

  // 3. Search squads
  // Public squads matching query OR squads the user is a member of matching query
  const { data: publicSquads } = await supabase
    .from('squads')
    .select('id, name, emoji, category, visibility')
    .eq('visibility', 'public')
    .or(`name.ilike.${pattern},category.ilike.${pattern}`)
    .limit(20);

  let memberPrivateSquads: unknown[] = [];
  if (userSquadIds.length > 0) {
    const { data: privateSquads } = await supabase
      .from('squads')
      .select('id, name, emoji, category, visibility')
      .eq('visibility', 'private')
      .in('id', userSquadIds)
      .or(`name.ilike.${pattern},category.ilike.${pattern}`)
      .limit(10);

    memberPrivateSquads = privateSquads || [];
  }

  // Combine and deduplicate squads
  const squadMap = new Map<string, unknown>();
  for (const s of (publicSquads || []) as { id: string }[]) {
    squadMap.set(s.id, s);
  }
  for (const s of memberPrivateSquads as { id: string }[]) {
    squadMap.set(s.id, s);
  }

  return {
    people: people || [],
    goals: visibleGoals,
    squads: [...squadMap.values()],
  };
}

/**
 * Get trending tags only (for empty search state).
 */
export async function getTrendingTags(): Promise<string[]> {
  const supabase = getSupabaseClient();

  const { data: goals } = await supabase
    .from('goals')
    .select('category')
    .eq('status', 'active')
    .not('category', 'is', null);

  const categoryCount = new Map<string, number>();
  if (goals) {
    for (const g of goals as { category: string | null }[]) {
      if (g.category) {
        categoryCount.set(g.category, (categoryCount.get(g.category) || 0) + 1);
      }
    }
  }

  return [...categoryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);
}
