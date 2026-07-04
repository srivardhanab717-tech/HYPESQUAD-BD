-- 005_checkin_function.sql
-- SECURITY DEFINER check-in function enforcing:
-- 1. One check-in per period (server-computed, NEVER client-supplied)
-- 2. Timezone correctness (uses user's stored timezone)
-- 3. Graceful handling of concurrent duplicate requests (catch unique-violation, return existing state)
-- 4. Goal must be in 'active' status

CREATE OR REPLACE FUNCTION perform_checkin(
  p_goal_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal RECORD;
  v_profile RECORD;
  v_period_start date;
  v_period_end date;
  v_checkin_id uuid;
  v_existing_checkin RECORD;
  v_checkin_count int;
  v_new_streak int;
  v_longest_streak int;
BEGIN
  -- 1. Fetch the goal and verify ownership + status
  SELECT * INTO v_goal FROM goals WHERE id = p_goal_id AND owner_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Goal not found or not owned by user', 'code', 'GOAL_NOT_FOUND');
  END IF;

  IF v_goal.status != 'active' THEN
    RETURN jsonb_build_object('error', 'Goal is not active', 'code', 'GOAL_NOT_ACTIVE', 'status', v_goal.status);
  END IF;

  -- 2. Get user's timezone
  SELECT timezone INTO v_profile FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    v_profile.timezone := 'Asia/Kolkata'; -- default
  END IF;

  -- 3. Compute period boundaries server-side
  v_period_start := (now() AT TIME ZONE COALESCE(v_profile.timezone, 'Asia/Kolkata'))::date;

  IF v_goal.cadence = 'weekly' THEN
    -- Monday of current week
    v_period_start := v_period_start - ((EXTRACT(ISODOW FROM v_period_start) - 1) || ' days')::interval;
    v_period_end := v_period_start + '6 days'::interval;
  ELSE
    -- daily/custom: single day
    v_period_end := v_period_start;
  END IF;

  -- 4. Attempt insert (catch unique violation for idempotency)
  BEGIN
    INSERT INTO checkins (goal_id, user_id, period_start, period_end)
    VALUES (p_goal_id, p_user_id, v_period_start, v_period_end)
    RETURNING id INTO v_checkin_id;
  EXCEPTION WHEN unique_violation THEN
    -- Already checked in for this period — return existing state
    SELECT * INTO v_existing_checkin FROM checkins
    WHERE goal_id = p_goal_id AND user_id = p_user_id AND period_start = v_period_start;

    RETURN jsonb_build_object(
      'duplicate', true,
      'checkin_id', v_existing_checkin.id,
      'period_start', v_existing_checkin.period_start,
      'period_end', v_existing_checkin.period_end,
      'message', 'Already checked in for this period'
    );
  END;

  -- 5. Atomically update streak
  DECLARE
    v_prev_period_start date;
    v_prev_checkin_exists boolean;
    v_current_streak int;
  BEGIN
    IF v_goal.cadence = 'weekly' THEN
      v_prev_period_start := v_period_start - '7 days'::interval;
    ELSE
      v_prev_period_start := v_period_start - '1 day'::interval;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM checkins
      WHERE goal_id = p_goal_id AND user_id = p_user_id AND period_start = v_prev_period_start
    ) INTO v_prev_checkin_exists;

    -- Get current streak state
    SELECT current_streak, longest_streak INTO v_current_streak, v_longest_streak
    FROM streaks WHERE goal_id = p_goal_id;

    IF NOT FOUND THEN
      v_current_streak := 0;
      v_longest_streak := 0;
    END IF;

    IF v_prev_checkin_exists THEN
      v_new_streak := v_current_streak + 1;
    ELSE
      -- Streak was broken (missed period) or first checkin
      v_new_streak := 1;
    END IF;

    IF v_new_streak > v_longest_streak THEN
      v_longest_streak := v_new_streak;
    END IF;

    -- Upsert streak
    INSERT INTO streaks (goal_id, current_streak, longest_streak, last_checkin_at)
    VALUES (p_goal_id, v_new_streak, v_longest_streak, now())
    ON CONFLICT (goal_id) DO UPDATE SET
      current_streak = v_new_streak,
      longest_streak = GREATEST(streaks.longest_streak, v_longest_streak),
      last_checkin_at = now();
  END;

  -- 6. Check if goal is now complete
  SELECT COUNT(*) INTO v_checkin_count FROM checkins WHERE goal_id = p_goal_id;
  IF v_goal.target_checkins IS NOT NULL AND v_checkin_count >= v_goal.target_checkins THEN
    UPDATE goals SET status = 'complete' WHERE id = p_goal_id;
  END IF;

  -- 7. Return success
  RETURN jsonb_build_object(
    'success', true,
    'checkin_id', v_checkin_id,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'current_streak', v_new_streak,
    'longest_streak', v_longest_streak,
    'checkin_count', v_checkin_count,
    'goal_status', CASE WHEN v_goal.target_checkins IS NOT NULL AND v_checkin_count >= v_goal.target_checkins THEN 'complete' ELSE 'active' END
  );
END;
$$;
