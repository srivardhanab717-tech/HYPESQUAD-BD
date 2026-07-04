import { getSupabaseClient } from '../lib/supabase';
import { ValidationError, ConflictError, NotFoundError } from '../lib/errors';
import { ProfileRow } from '../types';
import { moderateContent } from './moderation';

/**
 * Get the current user's profile.
 */
export async function getProfile(userId: string): Promise<ProfileRow> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new NotFoundError('Profile not found');
  }

  return data as ProfileRow;
}

/**
 * Generate a unique handle from a name.
 * Algorithm:
 * 1. Lowercase, strip spaces and non-alphanumeric chars
 * 2. Try inserting as-is
 * 3. On collision, append incrementing numeric suffix
 * 4. Max 5 retries
 */
export async function generateHandle(name: string): Promise<string> {
  const supabase = getSupabaseClient();
  const baseHandle = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!baseHandle) {
    // Fallback if name has no alphanumeric chars
    return `user${Date.now() % 100000}`;
  }

  // Try the base handle first
  const { data: existing } = await supabase
    .from('profiles')
    .select('handle')
    .eq('handle', baseHandle)
    .single();

  if (!existing) {
    return baseHandle;
  }

  // Try with numeric suffix
  for (let i = 1; i <= 5; i++) {
    const candidate = `${baseHandle}${i}`;
    const { data: exists } = await supabase
      .from('profiles')
      .select('handle')
      .eq('handle', candidate)
      .single();

    if (!exists) {
      return candidate;
    }
  }

  // Final fallback with timestamp
  return `${baseHandle}${Date.now() % 100000}`;
}

/**
 * Update the current user's profile.
 * Handles initial setup (auto-generate handle, set setup_complete = true)
 * and subsequent edits.
 */
export async function updateProfile(
  userId: string,
  updates: Partial<{
    name: string;
    avatar_color: string;
    interests: string[];
    default_visibility: 'public' | 'squad';
    bio: string;
    handle: string;
    timezone: string;
  }>
): Promise<ProfileRow> {
  const supabase = getSupabaseClient();

  // Validate name if provided
  if (updates.name !== undefined && updates.name.trim() === '') {
    throw new ValidationError('Name must not be empty');
  }

  // Check current profile state
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  const isInitialSetup = !currentProfile || !(currentProfile as ProfileRow).setup_complete;

  // Handle uniqueness check for explicit handle changes
  if (updates.handle !== undefined) {
    const { data: handleCheck } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('handle', updates.handle)
      .single();

    if (handleCheck && (handleCheck as { user_id: string }).user_id !== userId) {
      throw new ConflictError('Handle is already taken');
    }
  }

  // Build the update payload
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };

  // On initial setup: auto-generate handle from name if not explicitly provided
  if (isInitialSetup) {
    if (!updates.handle && updates.name) {
      payload.handle = await generateHandle(updates.name);
    }
    payload.setup_complete = true;
  }

  let result;

  if (!currentProfile) {
    // No profile exists yet — insert
    const insertPayload = {
      user_id: userId,
      name: updates.name || 'User',
      timezone: updates.timezone || 'Asia/Kolkata',
      ...payload,
    };

    const { data, error } = await supabase
      .from('profiles')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // Check for unique constraint violation on handle
      if (error.code === '23505' && error.message?.includes('handle')) {
        throw new ConflictError('Handle is already taken');
      }
      throw new Error(`Failed to create profile: ${error.message}`);
    }
    result = data;
  } else {
    // Profile exists — update
    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505' && error.message?.includes('handle')) {
        throw new ConflictError('Handle is already taken');
      }
      throw new Error(`Failed to update profile: ${error.message}`);
    }
    result = data;
  }

  const profileResult = result as ProfileRow;

  // Moderate name and bio fields (async — flags but does not block)
  if (updates.name) {
    moderateContent('profile', userId, updates.name).catch((err) => {
      console.error('Profile name moderation failed:', err);
    });
  }
  if (updates.bio) {
    moderateContent('profile', userId, updates.bio).catch((err) => {
      console.error('Profile bio moderation failed:', err);
    });
  }

  return profileResult;
}
