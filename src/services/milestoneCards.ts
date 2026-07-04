import { getSupabaseClient } from '../lib/supabase';
import { ValidationError, NotFoundError } from '../lib/errors';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateMilestoneCardInput {
  goal_id: string;
  milestone_percent?: number;
  streak_count?: number;
}

export interface MilestoneCardData {
  user_name: string;
  milestone_text: string;
  streak: number;
  brand_mark: string;
  goal_description: string | null;
}

export interface MilestoneCardResult {
  card_url: string;
  card_data: MilestoneCardData;
}

// ─── Milestone Card Generation ──────────────────────────────────────────────

/**
 * Generate a milestone card.
 * In v1, returns structured JSON data for client-side rendering.
 * A placeholder card_url is returned (actual image generation is a future feature).
 */
export async function generateMilestoneCard(
  userId: string,
  input: CreateMilestoneCardInput
): Promise<MilestoneCardResult> {
  const supabase = getSupabaseClient();

  // Validate goal_id
  if (!input.goal_id || input.goal_id.trim() === '') {
    throw new ValidationError('goal_id is required');
  }

  // Fetch goal details
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .select('id, owner_id, category, description')
    .eq('id', input.goal_id)
    .single();

  if (goalError || !goal) {
    throw new NotFoundError('Goal not found');
  }

  const goalData = goal as {
    id: string;
    owner_id: string;
    category: string | null;
    description: string | null;
  };

  // Verify ownership
  if (goalData.owner_id !== userId) {
    throw new NotFoundError('Goal not found');
  }

  // Fetch user profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name')
    .eq('user_id', userId)
    .single();

  if (profileError || !profile) {
    throw new NotFoundError('Profile not found');
  }

  const profileData = profile as { name: string };

  // Get current streak if not provided
  let streak = input.streak_count ?? 0;
  if (input.streak_count === undefined) {
    const { data: streakData } = await supabase
      .from('streaks')
      .select('current_streak')
      .eq('goal_id', input.goal_id)
      .single();

    if (streakData) {
      streak = (streakData as { current_streak: number }).current_streak;
    }
  }

  // Determine milestone text
  let milestoneText: string;
  if (input.milestone_percent !== undefined) {
    milestoneText = `${input.milestone_percent}% milestone reached!`;
  } else if (streak > 0) {
    milestoneText = `${streak}-day streak!`;
  } else {
    milestoneText = 'Goal in progress';
  }

  // Build card data
  const cardData: MilestoneCardData = {
    user_name: profileData.name,
    milestone_text: milestoneText,
    streak,
    brand_mark: 'HypeSquad',
    goal_description: goalData.description,
  };

  // In v1, card_url is a placeholder. Image generation handled client-side or via future service.
  const cardUrl = `https://placeholder.hypesquad.app/cards/${input.goal_id}`;

  return {
    card_url: cardUrl,
    card_data: cardData,
  };
}
