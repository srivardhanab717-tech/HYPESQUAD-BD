import { getSupabaseClient } from '../lib/supabase';
import { AppError } from '../lib/errors';

export interface PostRow {
  id: string;
  author_id: string;
  goal_id: string | null;
  type: 'win' | 'progress' | 'needs_hype';
  body: string | null;
  media_refs: unknown | null;
  visibility: 'public' | 'squad';
  created_at: string;
}

/**
 * Create an auto-generated post after a successful check-in.
 * System-generated auto-posts are EXEMPT from moderation pipeline.
 *
 * Only called for NEW check-ins (not duplicates).
 */
export async function createAutoPost(
  userId: string,
  goalId: string,
  currentStreak: number
): Promise<PostRow | null> {
  const supabase = getSupabaseClient();

  // Get the goal details (category, description, visibility)
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .select('description, category, visibility')
    .eq('id', goalId)
    .single();

  if (goalError || !goal) {
    // Don't throw — auto-post failure shouldn't block check-in
    console.error('Failed to fetch goal for auto-post:', goalError);
    return null;
  }

  const goalData = goal as { description: string | null; category: string | null; visibility: string };
  const goalLabel = goalData.description || goalData.category || 'my goal';

  // Generate auto-post body
  const streakText = currentStreak > 1
    ? `🔥 Day ${currentStreak} streak`
    : '🔥 Streak started!';
  const body = `Checked in on ${goalLabel}! ${streakText}`;

  // Create post — system-generated, exempt from moderation
  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      author_id: userId,
      goal_id: goalId,
      type: 'progress',
      body,
      visibility: goalData.visibility || 'public',
    })
    .select()
    .single();

  if (postError || !post) {
    // Don't throw — auto-post failure shouldn't block check-in
    console.error('Failed to create auto-post:', postError);
    return null;
  }

  return post as PostRow;
}
