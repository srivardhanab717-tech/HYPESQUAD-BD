import { updateProfile } from './profile';
import { ValidationError } from '../lib/errors';
import { ProfileRow } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SettingsUpdate {
  default_visibility?: 'public' | 'squad';
  timezone?: string;
}

export interface SettingsResponse {
  default_visibility: 'public' | 'squad' | null;
  timezone: string;
}

// ─── Allowed fields ──────────────────────────────────────────────────────────

const ALLOWED_SETTINGS_FIELDS = ['default_visibility', 'timezone'] as const;
type SettingsField = (typeof ALLOWED_SETTINGS_FIELDS)[number];

// ─── Settings Service ────────────────────────────────────────────────────────

/**
 * Update user settings. This is a thin wrapper around the profile update,
 * scoped to settings-like fields only.
 *
 * Returns the full current settings state.
 */
export async function updateSettings(
  userId: string,
  updates: Record<string, unknown>
): Promise<SettingsResponse> {
  // Filter to only allowed settings fields
  const filteredUpdates: Partial<{
    default_visibility: 'public' | 'squad';
    timezone: string;
  }> = {};

  for (const field of ALLOWED_SETTINGS_FIELDS) {
    if (updates[field] !== undefined) {
      if (field === 'default_visibility') {
        const val = updates[field] as string;
        if (val !== 'public' && val !== 'squad') {
          throw new ValidationError("default_visibility must be 'public' or 'squad'");
        }
        filteredUpdates.default_visibility = val;
      } else if (field === 'timezone') {
        const val = updates[field] as string;
        if (!val || typeof val !== 'string' || val.trim() === '') {
          throw new ValidationError('timezone must be a non-empty string');
        }
        filteredUpdates.timezone = val.trim();
      }
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new ValidationError(
      `At least one setting field must be provided. Allowed fields: ${ALLOWED_SETTINGS_FIELDS.join(', ')}`
    );
  }

  // Delegate to profile update service
  const profile: ProfileRow = await updateProfile(userId, filteredUpdates);

  return {
    default_visibility: profile.default_visibility,
    timezone: profile.timezone,
  };
}
