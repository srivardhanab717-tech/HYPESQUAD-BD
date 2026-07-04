import { getSupabaseClient } from '../lib/supabase';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  AppError,
} from '../lib/errors';
import { GoalRow } from '../types';
import { getTodayInTimezone, getPeriodStart, isDeadlinePassed } from '../utils/periods';

// ─── Goal Creation ───────────────────────────────────────────────────────────

export interface CreateGoalInput {
  category: string;
  description: string;
  deadline: string;
  cadence: 'daily' | 'weekly' | 'custom';
  target_checkins: number;
  visibility: 'public' | 'squad';
}

/**
 * Create a new goal with milestones and streak record.
 */
export async function createGoal(
  ownerId: string,
  input: CreateGoalInput
): Promise<GoalRow & { milestones: unknown[]; streak: unknown }> {
  const supabase = getSupabaseClient();

  // Validations
  if (!input.category || input.category.trim() === '') {
    throw new ValidationError('Category is required');
  }
  if (!input.deadline) {
    throw new ValidationError('Deadline is required');
  }

  const today = new Date().toISOString().split('T')[0];
  if (input.deadline <= today) {
    throw new ValidationError('Deadline must be a future date');
  }

  const validCadences = ['daily', 'weekly', 'custom'];
  if (!validCadences.includes(input.cadence)) {
    throw new ValidationError('Cadence must be one of: daily, weekly, custom');
  }

  if (!input.target_checkins || input.target_checkins < 1 || !Number.isInteger(input.target_checkins)) {
    throw new ValidationError('Target check-ins must be a positive integer');
  }

  const validVisibilities = ['public', 'squad'];
  if (!validVisibilities.includes(input.visibility)) {
    throw new ValidationError('Visibility must be one of: public, squad');
  }

  // Create goal record
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .insert({
      owner_id: ownerId,
      category: input.category,
      description: input.description,
      deadline: input.deadline,
      cadence: input.cadence,
      target_checkins: input.target_checkins,
      visibility: input.visibility,
      status: 'active',
    })
    .select()
    .single();

  if (goalError || !goal) {
    throw new AppError('Failed to create goal', 500, 'GOAL_CREATE_FAILED');
  }

  const goalData = goal as GoalRow;

  // Create 4 milestone records (25%, 50%, 75%, 100%)
  const milestoneData = [25, 50, 75, 100].map((percent) => ({
    goal_id: goalData.id,
    percent,
    achieved: false,
  }));

  const { data: milestones, error: milestoneError } = await supabase
    .from('milestones')
    .insert(milestoneData)
    .select();

  if (milestoneError) {
    console.error('Failed to create milestones:', milestoneError);
  }

  // Create streaks record
  const { data: streak, error: streakError } = await supabase
    .from('streaks')
    .insert({
      goal_id: goalData.id,
      current_streak: 0,
      longest_streak: 0,
    })
    .select()
    .single();

  if (streakError) {
    console.error('Failed to create streak record:', streakError);
  }

  return {
    ...goalData,
    milestones: milestones || [],
    streak: streak || { current_streak: 0, longest_streak: 0 },
  };
}

// ─── Goal Status Transition Logic ─────────────────────────────────────────────

/**
 * Check and update a goal's status based on completion or expiry.
 * Returns the updated status.
 */
export async function checkAndUpdateGoalStatus(
  goalId: string,
  ownerTimezone?: string
): Promise<'active' | 'complete' | 'expired'> {
  const supabase = getSupabaseClient();

  // Get the goal
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .single();

  if (goalError || !goal) {
    throw new NotFoundError('Goal not found');
  }

  const goalData = goal as GoalRow;

  // If not active, no state transition needed
  if (goalData.status !== 'active') {
    return goalData.status;
  }

  // Count checkins for this goal
  const { count: checkinCount } = await supabase
    .from('checkins')
    .select('*', { count: 'exact', head: true })
    .eq('goal_id', goalId);

  const totalCheckins = checkinCount || 0;

  // Check completion
  if (goalData.target_checkins && totalCheckins >= goalData.target_checkins) {
    await supabase.from('goals').update({ status: 'complete' }).eq('id', goalId);
    return 'complete';
  }

  // Check expiry
  if (goalData.deadline) {
    const timezone = ownerTimezone || 'Asia/Kolkata';
    if (isDeadlinePassed(goalData.deadline, timezone)) {
      await supabase.from('goals').update({ status: 'expired' }).eq('id', goalId);
      return 'expired';
    }
  }

  return 'active';
}

// ─── Goal Dashboard Aggregation ────────────────────────────────────────────────

export interface DashboardGoal extends GoalRow {
  current_streak: number;
  progress_percent: number;
  checkin_state: 'available' | 'done' | 'goal_complete';
}

/**
 * Get all goals for the authenticated user with dashboard data.
 */
export async function getGoalsDashboard(
  userId: string,
  userTimezone: string
): Promise<DashboardGoal[]> {
  const supabase = getSupabaseClient();

  // Fetch all goals for the user
  const { data: goals, error: goalsError } = await supabase
    .from('goals')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  if (goalsError || !goals) {
    return [];
  }

  const result: DashboardGoal[] = [];

  for (const goal of goals as GoalRow[]) {
    // Lazy expiry check for active goals
    let currentStatus = goal.status;
    if (goal.status === 'active' && goal.deadline) {
      if (isDeadlinePassed(goal.deadline, userTimezone)) {
        // Check if target was met
        const { count: checkinCount } = await supabase
          .from('checkins')
          .select('*', { count: 'exact', head: true })
          .eq('goal_id', goal.id);

        if ((checkinCount || 0) < (goal.target_checkins || 0)) {
          await supabase.from('goals').update({ status: 'expired' }).eq('id', goal.id);
          currentStatus = 'expired';
        }
      }
    }

    // Get current streak
    const { data: streak } = await supabase
      .from('streaks')
      .select('current_streak')
      .eq('goal_id', goal.id)
      .single();

    // Get checkin count
    const { count: checkinCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('goal_id', goal.id);

    const totalCheckins = checkinCount || 0;
    const targetCheckins = goal.target_checkins || 1;
    const progressPercent = Math.min(Math.round((totalCheckins / targetCheckins) * 100), 100);

    // Determine checkin_state
    let checkinState: 'available' | 'done' | 'goal_complete' = 'available';
    if (currentStatus !== 'active') {
      checkinState = 'goal_complete';
    } else if (goal.cadence) {
      const periodStart = getPeriodStart(goal.cadence, userTimezone);
      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('goal_id', goal.id)
        .eq('user_id', userId)
        .eq('period_start', periodStart)
        .single();

      if (existingCheckin) {
        checkinState = 'done';
      }
    }

    result.push({
      ...goal,
      status: currentStatus,
      current_streak: (streak as { current_streak: number } | null)?.current_streak || 0,
      progress_percent: progressPercent,
      checkin_state: checkinState,
    });
  }

  // Sort: active goals first, then by created_at DESC
  result.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return result;
}

// ─── Goal Detail ───────────────────────────────────────────────────────────────

export interface GoalDetail extends GoalRow {
  checkin_log: unknown[];
  milestones: unknown[];
  milestone_plan: unknown[];
  related_users: unknown[];
}

/**
 * Get the full detail of a goal, including checkin log, milestones, milestone plan,
 * and related users.
 */
export async function getGoalDetail(
  goalId: string,
  viewerUserId: string
): Promise<GoalDetail> {
  const supabase = getSupabaseClient();

  // Get the goal
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .single();

  if (goalError || !goal) {
    throw new NotFoundError('Goal not found');
  }

  const goalData = goal as GoalRow;

  // Visibility check: user must own goal OR goal.visibility allows access
  if (goalData.owner_id !== viewerUserId) {
    if (goalData.visibility === 'squad') {
      // Check if viewer shares a squad with the goal owner
      const hasAccess = await checkSquadAccess(viewerUserId, goalData.owner_id);
      if (!hasAccess) {
        throw new ForbiddenError('You do not have access to this goal');
      }
    }
    // 'public' visibility allows any authenticated user to view
  }

  // Get checkin log
  const { data: checkinLog } = await supabase
    .from('checkins')
    .select('*')
    .eq('goal_id', goalId)
    .order('period_start', { ascending: false });

  // Get milestones and update achieved status based on progress
  const { count: checkinCount } = await supabase
    .from('checkins')
    .select('*', { count: 'exact', head: true })
    .eq('goal_id', goalId);

  const totalCheckins = checkinCount || 0;
  const targetCheckins = goalData.target_checkins || 1;
  const progressPercent = Math.round((totalCheckins / targetCheckins) * 100);

  // Update milestone achieved status
  const thresholds = [25, 50, 75, 100];
  for (const threshold of thresholds) {
    if (progressPercent >= threshold) {
      await supabase
        .from('milestones')
        .update({ achieved: true, achieved_at: new Date().toISOString() })
        .eq('goal_id', goalId)
        .eq('percent', threshold)
        .eq('achieved', false);
    }
  }

  // Re-fetch milestones after updates
  const { data: milestones } = await supabase
    .from('milestones')
    .select('*')
    .eq('goal_id', goalId)
    .order('percent', { ascending: true });

  // Get milestone plan (AI-generated)
  const { data: milestonePlan } = await supabase
    .from('goal_milestone_plan')
    .select('*')
    .eq('goal_id', goalId)
    .order('order_index', { ascending: true });

  // Get related users (squad members with active goal in same category)
  const relatedUsers = await getRelatedUsers(goalData, viewerUserId);

  return {
    ...goalData,
    checkin_log: checkinLog || [],
    milestones: milestones || [],
    milestone_plan: milestonePlan || [],
    related_users: relatedUsers,
  };
}

/**
 * Check if two users share at least one squad.
 */
async function checkSquadAccess(
  viewerUserId: string,
  ownerId: string
): Promise<boolean> {
  const supabase = getSupabaseClient();

  // Get squads the viewer belongs to
  const { data: viewerSquads } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('user_id', viewerUserId);

  if (!viewerSquads || viewerSquads.length === 0) return false;

  const squadIds = viewerSquads.map((s: { squad_id: string }) => s.squad_id);

  // Check if owner is in any of those squads
  const { data: ownerInSquad } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('user_id', ownerId)
    .in('squad_id', squadIds)
    .limit(1);

  return !!ownerInSquad && ownerInSquad.length > 0;
}

/**
 * Get related users: users in a shared squad with the viewer
 * who have an active goal in the same category.
 */
async function getRelatedUsers(
  goal: GoalRow,
  viewerUserId: string
): Promise<unknown[]> {
  const supabase = getSupabaseClient();

  if (!goal.category) return [];

  // Get squads the goal owner belongs to
  const { data: ownerSquads } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('user_id', goal.owner_id);

  if (!ownerSquads || ownerSquads.length === 0) return [];

  const squadIds = ownerSquads.map((s: { squad_id: string }) => s.squad_id);

  // Get all members of those squads (excluding the goal owner)
  const { data: squadMembers } = await supabase
    .from('squad_members')
    .select('user_id')
    .in('squad_id', squadIds)
    .neq('user_id', goal.owner_id);

  if (!squadMembers || squadMembers.length === 0) return [];

  const memberIds = [...new Set(squadMembers.map((m: { user_id: string }) => m.user_id))];

  // Get users with active goals in the same category
  const { data: relatedGoals } = await supabase
    .from('goals')
    .select('owner_id')
    .eq('category', goal.category)
    .eq('status', 'active')
    .in('owner_id', memberIds)
    .limit(10);

  if (!relatedGoals || relatedGoals.length === 0) return [];

  const relatedUserIds = [...new Set(relatedGoals.map((g: { owner_id: string }) => g.owner_id))];

  // Get user profiles and streaks
  const results: unknown[] = [];
  for (const uid of relatedUserIds.slice(0, 10)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id, name, avatar_color')
      .eq('user_id', uid)
      .single();

    // Get their active goal in the same category
    const { data: theirGoal } = await supabase
      .from('goals')
      .select('id, description')
      .eq('owner_id', uid)
      .eq('category', goal.category)
      .eq('status', 'active')
      .limit(1)
      .single();

    // Get their streak
    let currentStreak = 0;
    if (theirGoal) {
      const { data: streak } = await supabase
        .from('streaks')
        .select('current_streak')
        .eq('goal_id', (theirGoal as { id: string }).id)
        .single();
      currentStreak = (streak as { current_streak: number } | null)?.current_streak || 0;
    }

    if (profile) {
      results.push({
        user_id: (profile as { user_id: string }).user_id,
        name: (profile as { name: string }).name,
        avatar_color: (profile as { avatar_color: string | null }).avatar_color,
        goal_description: theirGoal ? (theirGoal as { description: string }).description : null,
        current_streak: currentStreak,
      });
    }
  }

  return results;
}
