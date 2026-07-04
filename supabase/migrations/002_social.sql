-- 002_social.sql
-- Social tables: posts, hypes, comments, follows, squads, squad_members, squad_join_requests, channels, messages

-- Posts
CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
  type text CHECK (type IN ('win', 'progress', 'needs_hype')),
  body text,
  media_refs jsonb,
  visibility text CHECK (visibility IN ('public', 'squad')),
  created_at timestamptz DEFAULT now()
);

-- Hypes (idempotent: PK on post_id + user_id)
CREATE TABLE hypes (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY(post_id, user_id)
);

-- Comments
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Follows (self-follow prevented by CHECK)
CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY(follower_id, followee_id),
  CHECK (follower_id != followee_id)
);

-- Squads
CREATE TABLE squads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text,
  name text NOT NULL,
  category text,
  visibility text CHECK (visibility IN ('public', 'private')),
  created_at timestamptz DEFAULT now()
);

-- Squad Members
CREATE TABLE squad_members (
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text CHECK (role IN ('owner', 'moderator', 'member')),
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY(squad_id, user_id)
);

-- Squad Join Requests
CREATE TABLE squad_join_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  UNIQUE(squad_id, user_id)
);

-- Channels (v1: only 4 defaults per squad, no user-facing create)
CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(squad_id, name)
);

-- Messages
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text,
  type text CHECK (type IN ('text', 'checkin_card')),
  checkin_id uuid REFERENCES checkins(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
