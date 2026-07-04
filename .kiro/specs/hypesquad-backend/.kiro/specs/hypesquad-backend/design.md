[design.md](https://github.com/user-attachments/files/29662064/design.md)
# HypeSquad Backend — Design

## 1. Architecture Overview

```
Mobile (React Native/Expo)
        │
        ▼
   API Gateway (REST + WebSocket)
        │
   ┌────┴─────────────────────────────┐
   │                                   │
Node.js/TypeScript API        Supabase Realtime (chat, presence)
   │                                   │
   ├── Auth service (phone OTP, OAuth)
   ├── Goals/Check-ins service (integrity-critical)
   ├── Feed/Posts service
   ├── Squads/Chat service
   ├── AI Coach service ── Claude API
   ├── Media service ── object storage (reels, milestone cards)
   ├── Notifications service ── push (FCM/APNs)
   ├── Payments service ── Stripe/Razorpay (India-first)
   └── Trust & Safety (moderation pipeline)
        │
        ▼
PostgreSQL (via Supabase) + Row-Level Security
```

**Stack decisions (carried over from existing build — do not re-derive):**
- Runtime: Node.js + TypeScript
- DB: PostgreSQL via Supabase, with RLS policies as the primary authorization layer
- Realtime: Supabase Realtime channels for chat + presence (Body Double rooms)
- Media storage: Supabase Storage (or S3-compatible) for reels/images, with async processing pipeline
- AI: Claude API for AI Coach, milestone-plan generation, and post-drafting
- Push: FCM (Android) / APNs (iOS)
- Payments: Stripe or Razorpay — India-first means Razorpay should be primary; Stripe for UK/Europe expansion
- CI/CD: existing pipeline retained (build → test → migrate → deploy)

## 2. Data Model (core tables)

```sql
users (
  id uuid pk, phone text unique, email text, auth_provider text,
  role text check in ('user','moderator','admin') default 'user',
  created_at timestamptz
)

profiles (
  user_id uuid pk fk->users, name text not null, avatar_color text,
  interests text[], default_visibility text check in ('public','squad'),
  bio text, handle text unique, timezone text not null,
  setup_complete boolean default false, updated_at timestamptz
)

goals (
  id uuid pk, owner_id uuid fk->users, category text, description text,
  deadline date, cadence text check in ('daily','weekly','custom'),
  target_checkins int, visibility text check in ('public','squad'),
  status text check in ('active','complete','expired') default 'active',
  -- status computed server-side: 'complete' when checkin count >= target_checkins;
  -- 'expired' when deadline passed without reaching target — check-ins are rejected
  -- once status != 'active'. Never client-settable.
  created_at timestamptz
)

milestones (
  -- computed progress markers only; never AI-authored, never free-text
  id uuid pk, goal_id uuid fk->goals, percent int check in (25,50,75,100),
  achieved boolean default false, achieved_at timestamptz,
  unique(goal_id, percent)
)

goal_milestone_plan (
  -- the 3 AI-suggested checkpoints generated at goal creation; qualitative, not tied to %
  id uuid pk, goal_id uuid fk->goals, order_index int check in (1,2,3),
  label text, target_date date nullable, created_at timestamptz,
  unique(goal_id, order_index)
)

checkins (
  -- period_start/period_end are ALWAYS computed server-side from goal.cadence +
  -- current server time in the user's stored timezone. Never accepted from the
  -- client request body — accepting client-supplied periods would defeat the
  -- entire one-check-in-per-period guarantee.
  id uuid pk, goal_id uuid fk->goals, user_id uuid fk->users,
  period_start date, period_end date, created_at timestamptz,
  unique(goal_id, user_id, period_start)   -- enforces one check-in per user per period
)

streaks (
  goal_id uuid pk fk->goals, current_streak int default 0,
  longest_streak int default 0, last_checkin_at timestamptz
)

posts (
  id uuid pk, author_id uuid fk->users, goal_id uuid fk->goals nullable,
  type text check in ('win','progress','needs_hype'), body text,
  media_refs jsonb, visibility text check in ('public','squad'), created_at timestamptz
)

hypes (
  post_id uuid fk->posts, user_id uuid fk->users, created_at timestamptz,
  primary key(post_id, user_id)   -- enforces idempotency
)

comments (
  id uuid pk, post_id uuid fk->posts, author_id uuid fk->users,
  body text, created_at timestamptz
)

follows (
  follower_id uuid fk->users, followee_id uuid fk->users,
  created_at timestamptz, primary key(follower_id, followee_id),
  check (follower_id != followee_id)   -- prevents self-follow
)

squads (
  -- owner_id is a denormalized cache of the squad_members row with role='owner',
  -- kept only for fast lookups. squad_members.role is the single source of truth;
  -- ownership transfer updates squad_members first, then this column, atomically.
  id uuid pk, owner_id uuid fk->users, emoji text, name text,
  category text, visibility text check in ('public','private'), created_at timestamptz
)

squad_members (
  squad_id uuid fk->squads, user_id uuid fk->users, role text check in ('owner','moderator','member'),
  joined_at timestamptz, primary key(squad_id, user_id)
)

channels (
  -- v1 scope: exactly the 4 default channels, created only at squad-creation time.
  -- No user-facing "create channel" endpoint in this spec.
  id uuid pk, squad_id uuid fk->squads, name text,   -- general/check-ins/wins/accountability
  created_at timestamptz, unique(squad_id, name)
)

squad_join_requests (
  -- required for private-squad join flow described in requirements.md §7
  id uuid pk, squad_id uuid fk->squads, user_id uuid fk->users,
  status text check in ('pending','approved','rejected') default 'pending',
  created_at timestamptz, unique(squad_id, user_id)
)

messages (
  id uuid pk, channel_id uuid fk->channels, author_id uuid fk->users,
  body text, type text check in ('text','checkin_card'), checkin_id uuid nullable fk->checkins,
  created_at timestamptz
)

notifications (
  id uuid pk, recipient_id uuid fk->users, type text, payload jsonb,
  read boolean default false, created_at timestamptz
)

device_tokens (
  -- required for push delivery (FCM/APNs); missing from earlier draft
  id uuid pk, user_id uuid fk->users, platform text check in ('ios','android'),
  token text not null, created_at timestamptz, unique(platform, token)
)

ai_conversations (
  id uuid pk, user_id uuid fk->users, created_at timestamptz
)

ai_messages (
  id uuid pk, conversation_id uuid fk->ai_conversations, role text check in ('user','assistant'),
  body text, created_at timestamptz
)

coaches (
  id uuid pk, name text, type text check in ('ai','human'), specialty text,
  rating numeric, price numeric, currency text
)

bookings (
  id uuid pk, coach_id uuid fk->coaches, user_id uuid fk->users,
  scheduled_at timestamptz,
  payment_status text check in ('pending','paid','failed','refunded') default 'pending',
  created_at timestamptz
)

reels (
  -- always public once live in v1 — no per-reel visibility control (matches
  -- screen spec; revisit if squad-private reels are ever needed)
  id uuid pk, author_id uuid fk->users, goal_id uuid fk->goals,
  video_url text, caption text, duration_seconds int, status text check in ('processing','live'),
  created_at timestamptz
)

moderation_flags (
  id uuid pk, content_type text, content_id uuid, reason text,
  status text check in ('pending','cleared','removed'), created_at timestamptz
)

subscriptions (
  user_id uuid pk fk->users, tier text check in ('free','pro'),
  renews_at timestamptz, payment_provider text
)
```

## 3. Row-Level Security Strategy

- `profiles`, `goals`, `checkins`: readable by owner always; readable by others only when `visibility = 'public'` or viewer shares a squad with the owner (for squad-only visibility).
- `posts`: same visibility rule as goals; `hypes`/`comments` inherit the parent post's visibility for read.
- `messages`/`channels`: readable/writable only by `squad_members` of the parent squad.
- `squad_join_requests`: the requesting user can INSERT and SELECT their own row; squad owner/moderators can SELECT and UPDATE (approve/reject) rows for their squad.
- `device_tokens`: readable/writable only by the owning `user_id`; write path is server-issued on app registration, not arbitrary client PATCH.
- `notifications`: readable only by `recipient_id = auth.uid()`.
- `ai_conversations`/`ai_messages`: readable only by the owning user — never cross-user.
- All check-in writes go through a `SECURITY DEFINER` function that enforces the one-per-period constraint and timezone logic server-side, never trusting client-computed period boundaries.
- `reels`: readable by any authenticated user once `status = 'live'` (public feed by default, per screen spec); writable only by `author_id`.
- `goal_milestone_plan`: same visibility as the parent goal (owner always; others per goal visibility).
- `moderation_flags`: readable/writable only by users with `role IN ('moderator','admin')`; regular users can only INSERT via the report endpoint, never SELECT.
- `coaches`: publicly readable catalog; `bookings`: readable only by the booking's `user_id` or the coach's associated admin.
- `subscriptions`: readable/writable only by the owning user; payment-status transitions are written only by the payments service, never directly by client requests.

## 4. API Surface (REST, representative)

```
POST   /auth/otp/request
POST   /auth/otp/verify
POST   /auth/oauth/:provider

GET    /profile/me
PATCH  /profile/me

POST   /goals
GET    /goals/mine
GET    /goals/:id
POST   /goals/:id/milestone-plan        (AI-generated 3 checkpoints)
POST   /goals/:id/checkins              (server-validated, idempotent)

GET    /feed?cursor=
POST   /posts
POST   /posts/:id/hype
GET    /posts/:id/comments
POST   /posts/:id/comments
POST   /posts/draft-assist              (AI-assisted post writing)

GET    /discover
GET    /search?q=

GET    /squads/mine
GET    /squads/suggested
POST   /squads
POST   /squads/:id/join
POST   /squads/:id/join-requests/:reqId/approve
POST   /squads/:id/join-requests/:reqId/reject
GET    /squads/:id/join-requests          (owner/moderator only)

GET    /channels/:id/messages
POST   /channels/:id/messages
WS     /realtime/squads/:id

GET    /users/:id/followers
GET    /users/:id/following
POST   /users/:id/follow
DELETE /users/:id/follow

GET    /notifications
POST   /notifications/:id/read

GET    /leaderboard?scope=&metric=   (streak metric = longest currently-active streak per user, per requirements.md §12)

POST   /ai-coach/messages
GET    /ai-coach/history

GET    /coaches
POST   /coaches/:id/book

WS     /realtime/body-double/:roomId

POST   /milestone-cards
POST   /reels
GET    /reels/feed?cursor=

PATCH  /settings
POST   /subscriptions/upgrade
POST   /devices/register              (register push token on login/app-open)
```

## 5. AI Coach Context Assembly

Every AI Coach / milestone-plan / post-draft call SHALL assemble context server-side before calling Claude:
1. User's active goals (title, category, deadline, cadence, current streak, recent check-in history)
2. Recent conversation history (last N turns) for AI Coach specifically
3. A per-feature system prompt (coach persona vs. milestone-planner vs. post-drafter) — this is the defensible product differentiation (niche-specific coach personas), so prompt templates per goal category should be a first-class, versioned config, not inline strings.

## 6. Trust & Safety Pipeline

All UGC (posts, messages, reels, profile fields) passes through an async moderation check before becoming visible beyond the author. Flagged content is withheld (status `pending`), not deleted, pending human review. Reports create `moderation_flags` rows regardless of automated outcome.

## 7. Real-time & Presence

- Squad chat and Body Double presence both use Supabase Realtime channels.
- Channel naming convention: `squad:{squad_id}:channel:{channel_id}` and `bodydouble:{room_id}`.
- Presence payloads are ephemeral (not persisted) except for chat messages, which are persisted to `messages`.

## 8. CI/CD

Retain existing pipeline: lint/typecheck → unit tests → migration dry-run against a shadow DB → deploy → smoke test on critical paths (auth, check-in idempotency, hype idempotency).
