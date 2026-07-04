[tasks.md](https://github.com/user-attachments/files/29662078/tasks.md)
# HypeSquad Backend — Implementation Tasks

Organized in dependency waves. Tasks within a wave have no dependencies on each other and can run in parallel; each wave depends on the prior wave's completion.

## Wave 1 — Foundation
- [ ] 1.1 Set up Postgres schema via Supabase migrations: `users`, `profiles`, `goals`, `milestones`, `checkins`, `streaks`
- [ ] 1.2 Set up remaining schema: `posts`, `hypes`, `comments`, `follows`, `squads`, `squad_members`, `squad_join_requests`, `channels`, `messages`
- [ ] 1.3 Set up remaining schema: `notifications`, `device_tokens`, `ai_conversations`, `ai_messages`, `coaches`, `bookings`, `reels`, `moderation_flags`, `subscriptions`
- [ ] 1.4 Implement phone OTP auth flow (request + verify) with SMS provider integration, rate-limited per phone number and per IP
- [ ] 1.5 Implement OAuth (Google, Apple) sign-in and account linking
- [ ] 1.6 Write RLS policies for all tables per design.md §3
- [ ] 1.7 Scaffold API service (TypeScript/Node.js), request logging, error handling middleware

## Wave 2 — Core Identity & Goals
- [ ] 2.1 Profile endpoints: `GET/PATCH /profile/me`, setup-completion flag
- [ ] 2.2 Goal creation endpoint with validation (category, deadline, cadence, target, visibility)
- [ ] 2.3 AI milestone-plan endpoint (`POST /goals/:id/milestone-plan`) — Claude call returning exactly 3 checkpoints, persisted to `goal_milestone_plan` (distinct from the computed 25/50/75/100% `milestones` table)
- [ ] 2.4 Goal Dashboard aggregation endpoint (`GET /goals/mine`) — streak, progress %, today's check-in state, server-computed status (active/complete/expired)
- [ ] 2.5 Goal Detail endpoint — full log history, milestone checkpoints at 25/50/75/100%, related squadmates (category-match heuristic per requirements.md §3)
- [ ] 2.6 Goal status transition logic: mark `complete` on target reached, `expired` on deadline passed without target — reject check-ins against non-active goals

## Wave 3 — Check-ins (Integrity-Critical)
- [ ] 3.1 Implement `SECURITY DEFINER` check-in function enforcing one-per-period (server-computed period, never client-supplied) + timezone correctness + graceful handling of concurrent duplicate requests (catch unique-violation, return existing state, never 500)
- [ ] 3.2 Streak increment/reset logic, atomic with check-in write
- [ ] 3.3 Auto-post generation on successful check-in, respecting goal visibility
- [ ] 3.4 Unit + property-based tests: no double check-in on retry, streak resets correctly on missed period, timezone edge cases (DST, midnight boundary)

## Wave 4 — Feed & Social
- [ ] 4.1 Feed pagination endpoint with hype counts, viewer-hype-state, comment counts
- [ ] 4.2 Hype endpoint — idempotent (primary key on `post_id, user_id`)
- [ ] 4.3 Comments endpoints (create, list)
- [ ] 4.4 Post creation endpoint with media reference handling
- [ ] 4.5 AI-assisted post drafting endpoint, grounded in user's active goals
- [ ] 4.6 Follow/unfollow endpoints + followers/following list endpoints with per-row goal+streak context

## Wave 5 — Squads & Real-time Chat
- [ ] 5.1 Squad creation with auto-provisioned default channels (general, check-ins, wins, accountability)
- [ ] 5.2 Squad browser endpoints (mine + suggested with member counts)
- [ ] 5.3 Join flow — immediate for public; for private, create `squad_join_requests` row + owner/moderator approve/reject endpoints + notification on decision
- [ ] 5.4 Message send/history endpoints per channel
- [ ] 5.5 Realtime channel wiring (Supabase Realtime) for live message delivery
- [ ] 5.6 Inline check-in card event emission into linked squad channels
- [ ] 5.7 Discover endpoint (recommended squads, trending tags) and Search endpoint (people/goals/squads), enforcing the same visibility rules as feed — no squad-only content leaking to non-members

## Wave 6 — AI Coach & Marketplace
- [ ] 6.1 AI Coach message endpoint with goal-context assembly (design.md §5) and persisted conversation history
- [ ] 6.2 Conversation history retrieval endpoint
- [ ] 6.3 Per-goal-category coach persona prompt templates (versioned config, not inline strings)
- [ ] 6.4 Coach Marketplace catalog endpoint
- [ ] 6.5 Booking + payment flow for human coaches (Razorpay primary, Stripe for UK/EU)
- [ ] 6.6 Pro subscription upgrade flow + entitlement gating

## Wave 7 — Media: Reels & Milestone Cards
- [ ] 7.1 Reel upload endpoint (record or gallery), duration validation (15/30/60s), async processing to `live` status
- [ ] 7.2 Reels feed pagination endpoint with hype state
- [ ] 7.3 Milestone card generation (server-side image render) endpoint
- [ ] 7.4 Media storage integration (Supabase Storage / S3) with CDN-backed delivery

## Wave 8 — Notifications, Leaderboard, Body Double
- [ ] 8.1 Notification creation triggers on: hype, comment, new follower, squad join/invite, milestone
- [ ] 8.2 Push delivery integration (FCM/APNs) + `POST /devices/register` endpoint for client token registration
- [ ] 8.3 Notifications feed endpoint (realtime + historical, read/unread)
- [ ] 8.4 Leaderboard aggregation endpoint (scope: squad/global, metric: streak/hype — streak = longest currently-active streak per user)
- [ ] 8.5 Body Double presence channel (Supabase Realtime) + invite endpoint

## Wave 9 — Trust & Safety, Hardening
- [ ] 9.1 Async moderation pipeline for all UGC (posts, messages, reels, profile fields)
- [ ] 9.2 Report endpoint + `moderation_flags` workflow
- [ ] 9.3 Rate limiting on AI Coach, post-drafting, AND goal milestone-plan endpoints (all three call the AI service)
- [ ] 9.4 Settings endpoints (toggles persist immediately, no save button)
- [ ] 9.5 Load/property-based tests on hype and check-in idempotency at scale
- [ ] 9.6 CI/CD pipeline: lint/typecheck → unit tests → migration dry-run → deploy → smoke tests on auth/check-in/hype

## Definition of Done (per task)
- Automated reasoning check passed against requirements.md (no contradictions/gaps)
- Property-based tests pass where behavior is stated as an invariant (idempotency, one-check-in-per-period)
- RLS verified: a non-authorized user cannot read/write the resource
- Endpoint documented in API surface (design.md §4) matches actual implementation
