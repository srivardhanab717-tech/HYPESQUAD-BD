-- 004_rls_policies.sql
-- Row Level Security policies for all tables per design.md §3

-- ============================================================
-- Enable RLS on ALL tables
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_milestone_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE squads ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper function: check if viewer shares a squad with a target user
-- ============================================================
CREATE OR REPLACE FUNCTION shares_squad_with(target_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM squad_members sm1
    JOIN squad_members sm2 ON sm1.squad_id = sm2.squad_id
    WHERE sm1.user_id = auth.uid()
      AND sm2.user_id = target_user_id
      AND sm1.user_id != sm2.user_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- USERS
-- ============================================================
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "users_select_public" ON users
  FOR SELECT USING (true);

-- ============================================================
-- PROFILES
-- ============================================================
-- Owner can always read/write their own profile
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Others can read profiles with public visibility or if they share a squad
CREATE POLICY "profiles_select_public" ON profiles
  FOR SELECT USING (
    default_visibility = 'public'
    OR shares_squad_with(user_id)
  );

-- ============================================================
-- GOALS
-- ============================================================
-- Owner always reads own goals
CREATE POLICY "goals_select_own" ON goals
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "goals_insert_own" ON goals
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "goals_update_own" ON goals
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "goals_delete_own" ON goals
  FOR DELETE USING (owner_id = auth.uid());

-- Others can read goals that are public or if viewer shares squad with owner
CREATE POLICY "goals_select_visible" ON goals
  FOR SELECT USING (
    visibility = 'public'
    OR shares_squad_with(owner_id)
  );

-- ============================================================
-- MILESTONES
-- ============================================================
-- Follows parent goal visibility
CREATE POLICY "milestones_select" ON milestones
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM goals
      WHERE goals.id = milestones.goal_id
        AND (goals.owner_id = auth.uid()
             OR goals.visibility = 'public'
             OR shares_squad_with(goals.owner_id))
    )
  );

CREATE POLICY "milestones_insert_own" ON milestones
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM goals WHERE goals.id = milestones.goal_id AND goals.owner_id = auth.uid()
    )
  );

CREATE POLICY "milestones_update_own" ON milestones
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM goals WHERE goals.id = milestones.goal_id AND goals.owner_id = auth.uid()
    )
  );

-- ============================================================
-- GOAL MILESTONE PLAN (same as parent goal)
-- ============================================================
CREATE POLICY "goal_milestone_plan_select" ON goal_milestone_plan
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM goals
      WHERE goals.id = goal_milestone_plan.goal_id
        AND (goals.owner_id = auth.uid()
             OR goals.visibility = 'public'
             OR shares_squad_with(goals.owner_id))
    )
  );

CREATE POLICY "goal_milestone_plan_insert_own" ON goal_milestone_plan
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM goals WHERE goals.id = goal_milestone_plan.goal_id AND goals.owner_id = auth.uid()
    )
  );

CREATE POLICY "goal_milestone_plan_update_own" ON goal_milestone_plan
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM goals WHERE goals.id = goal_milestone_plan.goal_id AND goals.owner_id = auth.uid()
    )
  );

-- ============================================================
-- CHECK-INS
-- ============================================================
-- Owner always reads own checkins
CREATE POLICY "checkins_select_own" ON checkins
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "checkins_insert_own" ON checkins
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Others can read checkins if the parent goal is visible
CREATE POLICY "checkins_select_visible" ON checkins
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM goals
      WHERE goals.id = checkins.goal_id
        AND (goals.visibility = 'public' OR shares_squad_with(goals.owner_id))
    )
  );

-- ============================================================
-- STREAKS
-- ============================================================
CREATE POLICY "streaks_select" ON streaks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM goals
      WHERE goals.id = streaks.goal_id
        AND (goals.owner_id = auth.uid()
             OR goals.visibility = 'public'
             OR shares_squad_with(goals.owner_id))
    )
  );

CREATE POLICY "streaks_insert_own" ON streaks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM goals WHERE goals.id = streaks.goal_id AND goals.owner_id = auth.uid()
    )
  );

CREATE POLICY "streaks_update_own" ON streaks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM goals WHERE goals.id = streaks.goal_id AND goals.owner_id = auth.uid()
    )
  );

-- ============================================================
-- OTP SESSIONS (service role only — no user-facing access)
-- ============================================================
-- No user-level policies; OTP sessions are managed by service role key

-- ============================================================
-- POSTS
-- ============================================================
CREATE POLICY "posts_select_own" ON posts
  FOR SELECT USING (author_id = auth.uid());

CREATE POLICY "posts_insert_own" ON posts
  FOR INSERT WITH CHECK (author_id = auth.uid());

CREATE POLICY "posts_select_visible" ON posts
  FOR SELECT USING (
    visibility = 'public'
    OR shares_squad_with(author_id)
  );

-- ============================================================
-- HYPES (inherit parent post visibility)
-- ============================================================
CREATE POLICY "hypes_select" ON hypes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = hypes.post_id
        AND (posts.author_id = auth.uid()
             OR posts.visibility = 'public'
             OR shares_squad_with(posts.author_id))
    )
  );

CREATE POLICY "hypes_insert" ON hypes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = hypes.post_id
        AND (posts.visibility = 'public' OR shares_squad_with(posts.author_id))
    )
  );

-- ============================================================
-- COMMENTS (inherit parent post visibility)
-- ============================================================
CREATE POLICY "comments_select" ON comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = comments.post_id
        AND (posts.author_id = auth.uid()
             OR posts.visibility = 'public'
             OR shares_squad_with(posts.author_id))
    )
  );

CREATE POLICY "comments_insert" ON comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = comments.post_id
        AND (posts.visibility = 'public' OR shares_squad_with(posts.author_id))
    )
  );

-- ============================================================
-- FOLLOWS
-- ============================================================
CREATE POLICY "follows_select" ON follows
  FOR SELECT USING (
    follower_id = auth.uid() OR followee_id = auth.uid()
  );

CREATE POLICY "follows_insert" ON follows
  FOR INSERT WITH CHECK (follower_id = auth.uid());

CREATE POLICY "follows_delete" ON follows
  FOR DELETE USING (follower_id = auth.uid());

-- ============================================================
-- SQUADS
-- ============================================================
CREATE POLICY "squads_select_public" ON squads
  FOR SELECT USING (
    visibility = 'public'
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM squad_members WHERE squad_members.squad_id = squads.id AND squad_members.user_id = auth.uid()
    )
  );

CREATE POLICY "squads_insert" ON squads
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "squads_update_owner" ON squads
  FOR UPDATE USING (owner_id = auth.uid());

-- ============================================================
-- SQUAD MEMBERS
-- ============================================================
CREATE POLICY "squad_members_select" ON squad_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM squad_members sm WHERE sm.squad_id = squad_members.squad_id AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "squad_members_insert" ON squad_members
  FOR INSERT WITH CHECK (
    -- User can add themselves (join public) or owner/mod can add
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM squad_members sm
      WHERE sm.squad_id = squad_members.squad_id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner', 'moderator')
    )
  );

-- ============================================================
-- SQUAD JOIN REQUESTS
-- ============================================================
-- Requester can INSERT and SELECT their own
CREATE POLICY "squad_join_requests_insert_own" ON squad_join_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "squad_join_requests_select_own" ON squad_join_requests
  FOR SELECT USING (user_id = auth.uid());

-- Owner/moderator can SELECT/UPDATE for their squad
CREATE POLICY "squad_join_requests_select_squad" ON squad_join_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM squad_members sm
      WHERE sm.squad_id = squad_join_requests.squad_id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner', 'moderator')
    )
  );

CREATE POLICY "squad_join_requests_update_squad" ON squad_join_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM squad_members sm
      WHERE sm.squad_id = squad_join_requests.squad_id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner', 'moderator')
    )
  );

-- ============================================================
-- CHANNELS (only squad members of parent squad)
-- ============================================================
CREATE POLICY "channels_select" ON channels
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM squad_members sm WHERE sm.squad_id = channels.squad_id AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "channels_insert" ON channels
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM squad_members sm
      WHERE sm.squad_id = channels.squad_id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner', 'moderator')
    )
  );

-- ============================================================
-- MESSAGES (only squad members of parent squad)
-- ============================================================
CREATE POLICY "messages_select" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM channels c
      JOIN squad_members sm ON sm.squad_id = c.squad_id
      WHERE c.id = messages.channel_id AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "messages_insert" ON messages
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM channels c
      JOIN squad_members sm ON sm.squad_id = c.squad_id
      WHERE c.id = messages.channel_id AND sm.user_id = auth.uid()
    )
  );

-- ============================================================
-- NOTIFICATIONS (only recipient)
-- ============================================================
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (recipient_id = auth.uid());

-- ============================================================
-- DEVICE TOKENS (only owning user)
-- ============================================================
CREATE POLICY "device_tokens_select_own" ON device_tokens
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "device_tokens_insert_own" ON device_tokens
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "device_tokens_delete_own" ON device_tokens
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================
-- AI CONVERSATIONS (only owning user)
-- ============================================================
CREATE POLICY "ai_conversations_select_own" ON ai_conversations
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "ai_conversations_insert_own" ON ai_conversations
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============================================================
-- AI MESSAGES (only owning user via conversation)
-- ============================================================
CREATE POLICY "ai_messages_select_own" ON ai_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ai_conversations ac
      WHERE ac.id = ai_messages.conversation_id AND ac.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_messages_insert_own" ON ai_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations ac
      WHERE ac.id = ai_messages.conversation_id AND ac.user_id = auth.uid()
    )
  );

-- ============================================================
-- COACHES (publicly readable)
-- ============================================================
CREATE POLICY "coaches_select_all" ON coaches
  FOR SELECT USING (true);

-- ============================================================
-- BOOKINGS (only booking user)
-- ============================================================
CREATE POLICY "bookings_select_own" ON bookings
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "bookings_insert_own" ON bookings
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============================================================
-- REELS
-- ============================================================
-- Any authenticated user can read live reels
CREATE POLICY "reels_select_live" ON reels
  FOR SELECT USING (status = 'live');

-- Author can read own reels (including processing)
CREATE POLICY "reels_select_own" ON reels
  FOR SELECT USING (author_id = auth.uid());

-- Only author can insert/update
CREATE POLICY "reels_insert_own" ON reels
  FOR INSERT WITH CHECK (author_id = auth.uid());

CREATE POLICY "reels_update_own" ON reels
  FOR UPDATE USING (author_id = auth.uid());

-- ============================================================
-- MODERATION FLAGS
-- ============================================================
-- Regular users can only INSERT (report)
CREATE POLICY "moderation_flags_insert_all" ON moderation_flags
  FOR INSERT WITH CHECK (true);

-- Moderator/admin can read/write
CREATE POLICY "moderation_flags_select_mod" ON moderation_flags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('moderator', 'admin')
    )
  );

CREATE POLICY "moderation_flags_update_mod" ON moderation_flags
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('moderator', 'admin')
    )
  );

-- ============================================================
-- SUBSCRIPTIONS (only owning user)
-- ============================================================
CREATE POLICY "subscriptions_select_own" ON subscriptions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "subscriptions_update_own" ON subscriptions
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "subscriptions_insert_own" ON subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());
