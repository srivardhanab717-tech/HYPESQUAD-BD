-- 001_core_identity.sql
-- Core identity tables: users, profiles, goals, milestones, goal_milestone_plan, checkins, streaks, otp_sessions

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone text UNIQUE,
  email text,
  auth_provider text,
  role text CHECK (role IN ('user', 'moderator', 'admin')) DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

-- Profiles
CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  avatar_color text,
  interests text[],
  default_visibility text CHECK (default_visibility IN ('public', 'squad')),
  bio text,
  handle text UNIQUE,
  timezone text NOT NULL,
  setup_complete boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- Goals
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text,
  description text,
  deadline date,
  cadence text CHECK (cadence IN ('daily', 'weekly', 'custom')),
  target_checkins int,
  visibility text CHECK (visibility IN ('public', 'squad')),
  status text CHECK (status IN ('active', 'complete', 'expired')) DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- Milestones (computed progress markers, never AI-authored)
CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  percent int CHECK (percent IN (25, 50, 75, 100)),
  achieved boolean DEFAULT false,
  achieved_at timestamptz,
  UNIQUE(goal_id, percent)
);

-- Goal Milestone Plan (AI-suggested 3 checkpoints)
CREATE TABLE goal_milestone_plan (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  order_index int CHECK (order_index IN (1, 2, 3)),
  label text,
  target_date date,
  created_at timestamptz DEFAULT now(),
  UNIQUE(goal_id, order_index)
);

-- Check-ins
CREATE TABLE checkins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(goal_id, user_id, period_start)
);

-- Streaks
CREATE TABLE streaks (
  goal_id uuid PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  current_streak int DEFAULT 0,
  longest_streak int DEFAULT 0,
  last_checkin_at timestamptz
);

-- OTP Sessions (for phone auth)
CREATE TABLE otp_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_otp_sessions_phone ON otp_sessions(phone, created_at DESC);
