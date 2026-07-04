import { getSupabaseClient } from '../../lib/supabase';
import { NotFoundError, ForbiddenError, AppError } from '../../lib/errors';
import { GoalRow } from '../../types';
import { callClaudeForJson } from './client';

export interface MilestonePlanCheckpoint {
  order_index: number;
  label: string;
  target_date: string | null;
}

const SYSTEM_PROMPT = `You are a goal-planning assistant. Given the user's goal, suggest exactly 3 checkpoints they should aim for. Return JSON: [{"order_index": 1, "label": "...", "target_date": "YYYY-MM-DD" or null}, {"order_index": 2, "label": "...", "target_date": "YYYY-MM-DD" or null}, {"order_index": 3, "label": "...", "target_date": "YYYY-MM-DD" or null}]`;

/**
 * Generate an AI milestone plan for a goal.
 * Calls Claude with goal context, persists 3 checkpoints.
 * If a plan already exists, replaces it (delete + re-insert).
 */
export async function generateMilestonePlan(
  goalId: string,
  userId: string
): Promise<MilestonePlanCheckpoint[]> {
  const supabase = getSupabaseClient();

  // Fetch the goal
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .single();

  if (goalError || !goal) {
    throw new NotFoundError('Goal not found');
  }

  const goalData = goal as GoalRow;

  // Verify ownership
  if (goalData.owner_id !== userId) {
    throw new ForbiddenError('You do not own this goal');
  }

  // Build user message with goal context
  const userMessage = `My goal:
- Category: ${goalData.category}
- Description: ${goalData.description || 'No description provided'}
- Deadline: ${goalData.deadline || 'No deadline'}
- Cadence: ${goalData.cadence || 'Not specified'}
- Target check-ins: ${goalData.target_checkins || 'Not specified'}

Please suggest 3 checkpoints for this goal.`;

  // Call Claude
  const checkpoints = await callClaudeForJson<MilestonePlanCheckpoint[]>({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 512,
  });

  // Validate response structure
  if (!Array.isArray(checkpoints) || checkpoints.length !== 3) {
    throw new AppError('AI returned invalid milestone plan format', 503, 'AI_INVALID_FORMAT');
  }

  for (const cp of checkpoints) {
    if (!cp.order_index || !cp.label) {
      throw new AppError('AI returned incomplete milestone plan', 503, 'AI_INVALID_FORMAT');
    }
  }

  // Delete existing plan if any
  await supabase
    .from('goal_milestone_plan')
    .delete()
    .eq('goal_id', goalId);

  // Insert new plan
  const planRows = checkpoints.map((cp) => ({
    goal_id: goalId,
    order_index: cp.order_index,
    label: cp.label,
    target_date: cp.target_date || null,
  }));

  const { data: insertedPlan, error: insertError } = await supabase
    .from('goal_milestone_plan')
    .insert(planRows)
    .select();

  if (insertError) {
    throw new AppError('Failed to persist milestone plan', 500, 'PLAN_PERSIST_FAILED');
  }

  return (insertedPlan || []) as MilestonePlanCheckpoint[];
}
