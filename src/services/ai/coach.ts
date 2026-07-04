import { getSupabaseClient } from '../../lib/supabase';
import { AppError } from '../../lib/errors';
import { GoalRow } from '../../types';
import { callClaude, ClaudeMessage } from './client';
import { getCoachPersona } from '../../config/coachPersonas';

const MAX_CONVERSATION_HISTORY = 20;

interface AiMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  body: string;
  created_at: string;
}

interface AiConversation {
  id: string;
  user_id: string;
  created_at: string;
}

interface CoachResponse {
  message_id: string;
  role: 'assistant';
  body: string;
  conversation_id: string;
}

/**
 * Get or create the user's AI conversation.
 */
async function getOrCreateConversation(userId: string): Promise<string> {
  const supabase = getSupabaseClient();

  // Try to get existing conversation
  const { data: existing } = await supabase
    .from('ai_conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    return (existing as AiConversation).id;
  }

  // Create new conversation
  const { data: newConvo, error } = await supabase
    .from('ai_conversations')
    .insert({ user_id: userId })
    .select('id')
    .single();

  if (error || !newConvo) {
    throw new AppError('Failed to create AI conversation', 500, 'CONVERSATION_CREATE_FAILED');
  }

  return (newConvo as AiConversation).id;
}

/**
 * Assemble the user's goal context for the AI coach.
 * Includes active goals with category, description, deadline, cadence,
 * current streak, and recent check-in history.
 */
async function assembleGoalContext(userId: string): Promise<string> {
  const supabase = getSupabaseClient();

  // Get user's active goals
  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('owner_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (!goals || goals.length === 0) {
    return 'The user currently has no active goals.';
  }

  const goalContexts: string[] = [];

  for (const goal of goals as GoalRow[]) {
    // Get streak data
    const { data: streak } = await supabase
      .from('streaks')
      .select('current_streak, longest_streak')
      .eq('goal_id', goal.id)
      .single();

    const currentStreak = (streak as { current_streak: number } | null)?.current_streak || 0;
    const longestStreak = (streak as { longest_streak: number } | null)?.longest_streak || 0;

    // Get recent check-ins (last 7)
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('period_start, created_at')
      .eq('goal_id', goal.id)
      .order('created_at', { ascending: false })
      .limit(7);

    // Get check-in count for progress
    const { count: checkinCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('goal_id', goal.id);

    const totalCheckins = checkinCount || 0;
    const targetCheckins = goal.target_checkins || 1;
    const progressPercent = Math.min(Math.round((totalCheckins / targetCheckins) * 100), 100);

    const checkinHistory = recentCheckins
      ? recentCheckins.map((c: { period_start: string; created_at: string }) => c.period_start).join(', ')
      : 'none';

    goalContexts.push(
      `- Goal: ${goal.description || goal.category || 'Unnamed goal'}
  Category: ${goal.category || 'unspecified'}
  Deadline: ${goal.deadline || 'none'}
  Cadence: ${goal.cadence || 'not set'}
  Progress: ${totalCheckins}/${targetCheckins} check-ins (${progressPercent}%)
  Current streak: ${currentStreak} | Longest streak: ${longestStreak}
  Recent check-in dates: ${checkinHistory}`
    );
  }

  return `User's active goals:\n${goalContexts.join('\n\n')}`;
}

/**
 * Get the primary goal category for persona selection.
 * Uses the user's most recent active goal's category.
 */
async function getPrimaryGoalCategory(userId: string): Promise<string | null> {
  const supabase = getSupabaseClient();

  const { data: goal } = await supabase
    .from('goals')
    .select('category')
    .eq('owner_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return (goal as { category: string | null } | null)?.category || null;
}

/**
 * Get recent conversation history (last 20 turns) for context.
 */
async function getConversationHistory(conversationId: string): Promise<ClaudeMessage[]> {
  const supabase = getSupabaseClient();

  const { data: messages } = await supabase
    .from('ai_messages')
    .select('role, body')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(MAX_CONVERSATION_HISTORY);

  if (!messages || messages.length === 0) {
    return [];
  }

  return (messages as AiMessage[]).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.body,
  }));
}

/**
 * Send a message to the AI coach and get a response.
 * Full flow:
 * 1. Get or create conversation
 * 2. Persist user message
 * 3. Assemble context (goals + history + persona)
 * 4. Call Claude API
 * 5. Persist assistant response
 * 6. Return response
 *
 * On AI failure: return 503, do NOT persist partial response.
 */
export async function sendCoachMessage(
  userId: string,
  messageText: string
): Promise<CoachResponse> {
  const supabase = getSupabaseClient();

  // 1. Get or create conversation
  const conversationId = await getOrCreateConversation(userId);

  // 2. Persist the user message
  const { data: userMsg, error: userMsgError } = await supabase
    .from('ai_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      body: messageText,
    })
    .select('id')
    .single();

  if (userMsgError || !userMsg) {
    throw new AppError('Failed to persist user message', 500, 'MESSAGE_PERSIST_FAILED');
  }

  // 3. Assemble context
  const [goalContext, primaryCategory, history] = await Promise.all([
    assembleGoalContext(userId),
    getPrimaryGoalCategory(userId),
    getConversationHistory(conversationId),
  ]);

  // Get per-category persona
  const persona = getCoachPersona(primaryCategory);

  // Build system prompt with goal context
  const systemPrompt = `${persona.systemPrompt}

--- USER CONTEXT ---
${goalContext}
--- END CONTEXT ---

Use this context to personalize your responses. Reference specific goals, streaks, and progress when relevant.`;

  // Build messages array: recent history + current message
  const messages: ClaudeMessage[] = [
    ...history,
    { role: 'user', content: messageText },
  ];

  // 4. Call Claude API
  let assistantText: string;
  try {
    assistantText = await callClaude({
      system: systemPrompt,
      messages,
      maxTokens: 512,
    });
  } catch (error) {
    // On failure: delete the user message we just persisted to avoid orphaned messages
    await supabase
      .from('ai_messages')
      .delete()
      .eq('id', (userMsg as { id: string }).id);

    throw error; // Re-throw — will be 503 from the client module
  }

  // 5. Persist the assistant response
  const { data: assistantMsg, error: assistantMsgError } = await supabase
    .from('ai_messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      body: assistantText,
    })
    .select('id')
    .single();

  if (assistantMsgError || !assistantMsg) {
    throw new AppError('Failed to persist assistant message', 500, 'MESSAGE_PERSIST_FAILED');
  }

  // 6. Return response
  return {
    message_id: (assistantMsg as { id: string }).id,
    role: 'assistant',
    body: assistantText,
    conversation_id: conversationId,
  };
}

/**
 * Get all messages from the user's most recent conversation.
 * Returns empty array if no conversation exists.
 */
export async function getConversationHistoryForUser(
  userId: string
): Promise<{ id: string; role: string; body: string; created_at: string }[]> {
  const supabase = getSupabaseClient();

  // Get most recent conversation
  const { data: conversation } = await supabase
    .from('ai_conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!conversation) {
    return [];
  }

  const conversationId = (conversation as AiConversation).id;

  // Get all messages in order
  const { data: messages } = await supabase
    .from('ai_messages')
    .select('id, role, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return (messages || []) as { id: string; role: string; body: string; created_at: string }[];
}
