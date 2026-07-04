import { getSupabaseClient } from '../lib/supabase';
import { AppError, ValidationError, NotFoundError, ForbiddenError } from '../lib/errors';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateSquadInput {
  emoji?: string;
  name: string;
  category?: string;
  visibility: 'public' | 'private';
}

export interface SquadRow {
  id: string;
  owner_id: string;
  emoji: string | null;
  name: string;
  category: string | null;
  visibility: 'public' | 'private';
  created_at: string;
}

export interface ChannelRow {
  id: string;
  squad_id: string;
  name: string;
  created_at: string;
}

export interface SquadWithChannels extends SquadRow {
  channels: ChannelRow[];
}

export interface MySquadItem {
  squad: Pick<SquadRow, 'id' | 'name' | 'emoji' | 'category' | 'visibility'>;
  member_count: number;
  user_role: string;
}

export interface SuggestedSquadItem extends Pick<SquadRow, 'id' | 'name' | 'emoji' | 'category' | 'visibility'> {
  member_count: number;
}

// ─── Default channels provisioned on squad creation ─────────────────────────

const DEFAULT_CHANNELS = ['general', 'check-ins', 'wins', 'accountability'];

// ─── Squad Creation ──────────────────────────────────────────────────────────

/**
 * Create a squad and auto-provision 4 default channels.
 */
export async function createSquad(
  ownerId: string,
  input: CreateSquadInput
): Promise<SquadWithChannels> {
  const supabase = getSupabaseClient();

  // Validations
  if (!input.name || input.name.trim() === '') {
    throw new ValidationError('Name is required');
  }

  const validVisibilities = ['public', 'private'];
  if (!validVisibilities.includes(input.visibility)) {
    throw new ValidationError('Visibility must be one of: public, private');
  }

  // 1. Create squad record
  const { data: squad, error: squadError } = await supabase
    .from('squads')
    .insert({
      owner_id: ownerId,
      emoji: input.emoji || null,
      name: input.name.trim(),
      category: input.category || null,
      visibility: input.visibility,
    })
    .select()
    .single();

  if (squadError || !squad) {
    throw new AppError('Failed to create squad', 500, 'SQUAD_CREATE_FAILED');
  }

  const squadData = squad as SquadRow;

  // 2. Create squad_members row with role='owner'
  const { error: memberError } = await supabase
    .from('squad_members')
    .insert({
      squad_id: squadData.id,
      user_id: ownerId,
      role: 'owner',
    });

  if (memberError) {
    console.error('Failed to create owner membership:', memberError);
  }

  // 3. Auto-provision 4 default channels
  const channelInserts = DEFAULT_CHANNELS.map((name) => ({
    squad_id: squadData.id,
    name,
  }));

  const { data: channels, error: channelError } = await supabase
    .from('channels')
    .insert(channelInserts)
    .select();

  if (channelError) {
    console.error('Failed to create default channels:', channelError);
  }

  return {
    ...squadData,
    channels: (channels as ChannelRow[]) || [],
  };
}

// ─── Squad Browser ───────────────────────────────────────────────────────────

/**
 * Get squads the user belongs to, with member_count and user_role.
 */
export async function getMySquads(userId: string): Promise<MySquadItem[]> {
  const supabase = getSupabaseClient();

  // Get all squad memberships for the user
  const { data: memberships, error: memError } = await supabase
    .from('squad_members')
    .select('squad_id, role')
    .eq('user_id', userId);

  if (memError || !memberships || memberships.length === 0) {
    return [];
  }

  const squadIds = memberships.map((m: { squad_id: string }) => m.squad_id);
  const roleMap = new Map(
    memberships.map((m: { squad_id: string; role: string }) => [m.squad_id, m.role])
  );

  // Get squad details
  const { data: squads, error: squadsError } = await supabase
    .from('squads')
    .select('id, name, emoji, category, visibility')
    .in('id', squadIds);

  if (squadsError || !squads) {
    return [];
  }

  // Get member counts per squad
  const results: MySquadItem[] = [];
  for (const squad of squads as Pick<SquadRow, 'id' | 'name' | 'emoji' | 'category' | 'visibility'>[]) {
    const { count } = await supabase
      .from('squad_members')
      .select('*', { count: 'exact', head: true })
      .eq('squad_id', squad.id);

    results.push({
      squad,
      member_count: count || 0,
      user_role: roleMap.get(squad.id) || 'member',
    });
  }

  return results;
}

/**
 * Get suggested squads (public squads the user is NOT a member of),
 * ranked by member_count DESC, limit 20.
 */
export async function getSuggestedSquads(userId: string): Promise<SuggestedSquadItem[]> {
  const supabase = getSupabaseClient();

  // Get squads the user is already a member of
  const { data: memberships } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('user_id', userId);

  const memberSquadIds = (memberships || []).map((m: { squad_id: string }) => m.squad_id);

  // Get public squads, excluding user's squads
  let query = supabase
    .from('squads')
    .select('id, name, emoji, category, visibility')
    .eq('visibility', 'public');

  if (memberSquadIds.length > 0) {
    query = query.not('id', 'in', `(${memberSquadIds.join(',')})`);
  }

  const { data: squads, error } = await query;

  if (error || !squads) {
    return [];
  }

  // Get member counts and sort by count DESC
  const results: SuggestedSquadItem[] = [];
  for (const squad of squads as Pick<SquadRow, 'id' | 'name' | 'emoji' | 'category' | 'visibility'>[]) {
    const { count } = await supabase
      .from('squad_members')
      .select('*', { count: 'exact', head: true })
      .eq('squad_id', squad.id);

    results.push({
      ...squad,
      member_count: count || 0,
    });
  }

  // Sort by member_count DESC and limit to 20
  results.sort((a, b) => b.member_count - a.member_count);
  return results.slice(0, 20);
}

// ─── Join Flow ───────────────────────────────────────────────────────────────

/**
 * Join a squad (public: immediate, private: creates a join request).
 */
export async function joinSquad(
  userId: string,
  squadId: string
): Promise<{ joined: boolean; requested: boolean }> {
  const supabase = getSupabaseClient();

  // Get the squad
  const { data: squad, error: squadError } = await supabase
    .from('squads')
    .select('id, visibility')
    .eq('id', squadId)
    .single();

  if (squadError || !squad) {
    throw new NotFoundError('Squad not found');
  }

  const squadData = squad as { id: string; visibility: string };

  // Check if already a member (idempotent)
  const { data: existingMember } = await supabase
    .from('squad_members')
    .select('squad_id')
    .eq('squad_id', squadId)
    .eq('user_id', userId)
    .single();

  if (existingMember) {
    return { joined: true, requested: false };
  }

  if (squadData.visibility === 'public') {
    // Immediately add as member
    const { error: insertError } = await supabase
      .from('squad_members')
      .insert({
        squad_id: squadId,
        user_id: userId,
        role: 'member',
      });

    if (insertError) {
      // Handle unique constraint violation (race condition)
      if (insertError.code === '23505') {
        return { joined: true, requested: false };
      }
      throw new AppError('Failed to join squad', 500, 'JOIN_FAILED');
    }

    return { joined: true, requested: false };
  }

  // Private squad: check for existing pending request (idempotent)
  const { data: existingRequest } = await supabase
    .from('squad_join_requests')
    .select('id, status')
    .eq('squad_id', squadId)
    .eq('user_id', userId)
    .single();

  if (existingRequest) {
    const req = existingRequest as { id: string; status: string };
    if (req.status === 'pending') {
      return { joined: false, requested: true };
    }
    if (req.status === 'approved') {
      return { joined: true, requested: false };
    }
    // If rejected, allow re-request by updating status
    await supabase
      .from('squad_join_requests')
      .update({ status: 'pending', created_at: new Date().toISOString() })
      .eq('id', req.id);
    return { joined: false, requested: true };
  }

  // Create new join request
  const { error: reqError } = await supabase
    .from('squad_join_requests')
    .insert({
      squad_id: squadId,
      user_id: userId,
      status: 'pending',
    });

  if (reqError) {
    // Handle unique constraint (race condition)
    if (reqError.code === '23505') {
      return { joined: false, requested: true };
    }
    throw new AppError('Failed to create join request', 500, 'JOIN_REQUEST_FAILED');
  }

  return { joined: false, requested: true };
}

/**
 * Approve a join request (caller must be owner or moderator).
 */
export async function approveJoinRequest(
  callerId: string,
  squadId: string,
  requestId: string
): Promise<unknown> {
  const supabase = getSupabaseClient();

  // Verify caller is owner or moderator
  await verifySquadModerator(callerId, squadId);

  // Get the join request
  const { data: request, error: reqError } = await supabase
    .from('squad_join_requests')
    .select('*')
    .eq('id', requestId)
    .eq('squad_id', squadId)
    .single();

  if (reqError || !request) {
    throw new NotFoundError('Join request not found');
  }

  const reqData = request as { id: string; user_id: string; status: string };

  // Update request to approved
  const { data: updatedReq, error: updateError } = await supabase
    .from('squad_join_requests')
    .update({ status: 'approved' })
    .eq('id', requestId)
    .select()
    .single();

  if (updateError) {
    throw new AppError('Failed to approve request', 500, 'APPROVE_FAILED');
  }

  // Add user as member
  await supabase
    .from('squad_members')
    .upsert({
      squad_id: squadId,
      user_id: reqData.user_id,
      role: 'member',
    });

  return updatedReq;
}

/**
 * Reject a join request (caller must be owner or moderator).
 */
export async function rejectJoinRequest(
  callerId: string,
  squadId: string,
  requestId: string
): Promise<unknown> {
  const supabase = getSupabaseClient();

  // Verify caller is owner or moderator
  await verifySquadModerator(callerId, squadId);

  // Get the join request
  const { data: request, error: reqError } = await supabase
    .from('squad_join_requests')
    .select('*')
    .eq('id', requestId)
    .eq('squad_id', squadId)
    .single();

  if (reqError || !request) {
    throw new NotFoundError('Join request not found');
  }

  // Update request to rejected
  const { data: updatedReq, error: updateError } = await supabase
    .from('squad_join_requests')
    .update({ status: 'rejected' })
    .eq('id', requestId)
    .select()
    .single();

  if (updateError) {
    throw new AppError('Failed to reject request', 500, 'REJECT_FAILED');
  }

  return updatedReq;
}

/**
 * Get pending join requests for a squad (caller must be owner/moderator).
 */
export async function getJoinRequests(
  callerId: string,
  squadId: string
): Promise<unknown[]> {
  const supabase = getSupabaseClient();

  // Verify caller is owner or moderator
  await verifySquadModerator(callerId, squadId);

  // Get pending requests with user profile info
  const { data: requests, error } = await supabase
    .from('squad_join_requests')
    .select('id, user_id, status, created_at')
    .eq('squad_id', squadId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error || !requests) {
    return [];
  }

  // Enrich with profile info
  const enriched: unknown[] = [];
  for (const req of requests as { id: string; user_id: string; status: string; created_at: string }[]) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, handle, avatar_color')
      .eq('user_id', req.user_id)
      .single();

    enriched.push({
      ...req,
      user: profile || { name: null, handle: null, avatar_color: null },
    });
  }

  return enriched;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verify that a user is an owner or moderator of a squad.
 * Throws ForbiddenError if not.
 */
async function verifySquadModerator(userId: string, squadId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: membership, error } = await supabase
    .from('squad_members')
    .select('role')
    .eq('squad_id', squadId)
    .eq('user_id', userId)
    .single();

  if (error || !membership) {
    throw new ForbiddenError('You are not a member of this squad');
  }

  const role = (membership as { role: string }).role;
  if (role !== 'owner' && role !== 'moderator') {
    throw new ForbiddenError('Only squad owners or moderators can perform this action');
  }
}
