-- 003_platform.sql
-- Platform tables: notifications, device_tokens, ai_conversations, ai_messages, coaches, bookings, reels, moderation_flags, subscriptions

-- Notifications
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Device Tokens
CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text CHECK (platform IN ('ios', 'android')),
  token text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(platform, token)
);

-- AI Conversations
CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- AI Messages
CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text CHECK (role IN ('user', 'assistant')),
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Coaches
CREATE TABLE coaches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  type text CHECK (type IN ('ai', 'human')),
  specialty text,
  rating numeric,
  price numeric,
  currency text
);

-- Bookings
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  coach_id uuid NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at timestamptz,
  payment_status text CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')) DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Reels
CREATE TABLE reels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
  video_url text,
  caption text,
  duration_seconds int,
  status text CHECK (status IN ('processing', 'live')),
  created_at timestamptz DEFAULT now()
);

-- Moderation Flags
CREATE TABLE moderation_flags (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  reason text,
  status text CHECK (status IN ('pending', 'cleared', 'removed')),
  created_at timestamptz DEFAULT now()
);

-- Subscriptions
CREATE TABLE subscriptions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier text CHECK (tier IN ('free', 'pro')) DEFAULT 'free',
  renews_at timestamptz,
  payment_provider text
);
