import { getSupabaseClient } from '../lib/supabase';
import { AppError, NotFoundError } from '../lib/errors';

export interface Coach {
  id: string;
  name: string;
  type: 'ai' | 'human';
  specialty: string | null;
  rating: number | null;
  price: number | null;
  currency: string | null;
}

/**
 * Get the full coach catalog.
 */
export async function getCoachCatalog(): Promise<Coach[]> {
  const supabase = getSupabaseClient();

  const { data: coaches, error } = await supabase
    .from('coaches')
    .select('id, name, type, specialty, rating, price, currency');

  if (error) {
    throw new AppError('Failed to fetch coach catalog', 500, 'COACH_FETCH_FAILED');
  }

  return (coaches || []) as Coach[];
}

/**
 * Get a single coach by ID. Throws NotFoundError if not found.
 */
export async function getCoachById(coachId: string): Promise<Coach> {
  const supabase = getSupabaseClient();

  const { data: coach, error } = await supabase
    .from('coaches')
    .select('id, name, type, specialty, rating, price, currency')
    .eq('id', coachId)
    .single();

  if (error || !coach) {
    throw new NotFoundError('Coach not found');
  }

  return coach as Coach;
}
