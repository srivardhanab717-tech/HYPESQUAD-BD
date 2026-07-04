import { getSupabaseClient } from '../lib/supabase';
import { ValidationError } from '../lib/errors';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ContentType = 'post' | 'message' | 'reel' | 'profile' | 'user';

export interface ModerationFlag {
  id: string;
  content_type: string;
  content_id: string;
  reason: string;
  status: string;
  created_at: string;
}

// ─── Blocklist (v1 keyword-based) ────────────────────────────────────────────

const BLOCKLIST: string[] = [
  'hate',
  'kill',
  'violence',
  'spam',
  'scam',
  'phishing',
  'abuse',
  'harassment',
  'threat',
  'explicit',
];

// ─── Core Moderation Logic ───────────────────────────────────────────────────

/**
 * Run content through moderation check.
 * v1: simple keyword/regex check against a blocklist.
 * Returns true if content is clean, false if flagged.
 *
 * In production: would call an AI-based content moderation API.
 */
export async function moderateContent(
  contentType: ContentType,
  contentId: string,
  text: string
): Promise<boolean> {
  if (!text || text.trim() === '') {
    return true; // Empty text is not flagged
  }

  const lowerText = text.toLowerCase();
  const isFlagged = BLOCKLIST.some((word) => lowerText.includes(word));

  if (isFlagged) {
    // Create a moderation_flags record with status='pending'
    await createModerationFlag(contentType, contentId, 'auto_flagged');
    return false; // Content is flagged
  }

  return true; // Content is clean
}

/**
 * Create a moderation flag record in the database.
 * Used by both auto-moderation and user reports.
 */
export async function createModerationFlag(
  contentType: ContentType | string,
  contentId: string,
  reason: string
): Promise<ModerationFlag> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('moderation_flags')
    .insert({
      content_type: contentType,
      content_id: contentId,
      reason,
      status: 'pending',
    })
    .select()
    .single();

  if (error || !data) {
    // Log but don't fail the parent operation
    console.error('Failed to create moderation flag:', error);
    // Return a stub so callers can continue
    return {
      id: 'unknown',
      content_type: contentType,
      content_id: contentId,
      reason,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
  }

  return data as ModerationFlag;
}

// ─── Report (user-submitted) ─────────────────────────────────────────────────

/**
 * Submit a user report. Creates a moderation_flags record.
 * Validates inputs before insertion.
 */
export async function submitReport(
  reporterId: string,
  contentType: string,
  contentId: string,
  reason: string
): Promise<{ reported: true; flag_id: string }> {
  // Validate content_type
  const validContentTypes = ['post', 'message', 'reel', 'profile', 'user'];
  if (!validContentTypes.includes(contentType)) {
    throw new ValidationError(
      `content_type must be one of: ${validContentTypes.join(', ')}`
    );
  }

  // Validate content_id (uuid format)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!contentId || !uuidRegex.test(contentId)) {
    throw new ValidationError('content_id must be a valid UUID');
  }

  // Validate reason
  if (!reason || reason.trim() === '') {
    throw new ValidationError('reason is required and must be non-empty');
  }

  const flag = await createModerationFlag(
    contentType as ContentType,
    contentId,
    `user_report:${reporterId}:${reason.trim()}`
  );

  return { reported: true, flag_id: flag.id };
}
