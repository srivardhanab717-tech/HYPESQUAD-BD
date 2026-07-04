import { getSupabaseClient } from '../../lib/supabase';
import { AppError } from '../../lib/errors';
import { callClaude } from './client';

const SYSTEM_PROMPT = `You are a social media post writer for a goal-accountability app. Given the user's goals and progress, write a short, engaging post (1-3 sentences). Match the vibe: Gen Z, encouraging, emoji-friendly. Return only the post text, no JSON wrapper.`;

/**
 * Generate an AI-assisted post draft grounded in the user's actual active goals.
 * Returns the draft text string.
 */
export async function generatePostDraft(userId: string): Promise<string> {
  const supabase = getSupabaseClient();

  // Fetch user's active goals with relevant context
  const { data: goals, error: goalsError } = await supabase
    .from('goals')
    .select('id, category, description, cadence, target_checkins, created_at')
    .eq('owner_id', userId)
    .eq('status', 'active');

  if (goalsError) {
    throw new AppError('Failed to fetch goals for draft', 500, 'DRAFT_GOALS_FETCH_FAILED');
  }

  const goalsData = (goals || []) as Array<{
    id: string;
    category: string | null;
    description: string | null;
    cadence: string | null;
    target_checkins: number | null;
    created_at: string;
  }>;

  if (goalsData.length === 0) {
    throw new AppError('No active goals to generate a draft from', 400, 'NO_ACTIVE_GOALS');
  }

  // Fetch streaks for active goals
  const goalIds = goalsData.map((g) => g.id);
  const { data: streaks } = await supabase
    .from('streaks')
    .select('goal_id, current')
    .in('goal_id', goalIds);

  const streakMap = new Map<string, number>();
  if (streaks) {
    for (const s of streaks as Array<{ goal_id: string; current: number }>) {
      streakMap.set(s.goal_id, s.current);
    }
  }

  // Fetch recent check-in counts (last 7 days) for each goal
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('goal_id')
    .eq('user_id', userId)
    .in('goal_id', goalIds)
    .gte('checked_at', sevenDaysAgo);

  const recentCheckinMap = new Map<string, number>();
  if (recentCheckins) {
    for (const c of recentCheckins as Array<{ goal_id: string }>) {
      recentCheckinMap.set(c.goal_id, (recentCheckinMap.get(c.goal_id) || 0) + 1);
    }
  }

  // Build context message
  const goalSummaries = goalsData.map((g) => {
    const streak = streakMap.get(g.id) || 0;
    const recentCount = recentCheckinMap.get(g.id) || 0;
    return `- Category: ${g.category || 'General'}, Description: ${g.description || 'No description'}, Current streak: ${streak} days, Recent check-ins (7d): ${recentCount}`;
  });

  const userMessage = `Here are my active goals and progress:\n${goalSummaries.join('\n')}\n\nWrite me an engaging social post about my progress.`;

  try {
    const draftText = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 256,
    });

    return draftText.trim();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('AI service unavailable', 503, 'AI_SERVICE_ERROR');
  }
}
