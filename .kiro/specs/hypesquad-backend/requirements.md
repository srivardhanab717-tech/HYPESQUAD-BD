[requirements.md](https://github.com/user-attachments/files/29662042/requirements.md)
# HypeSquad Backend — Requirements

## Context
HypeSquad is a consumer social-accountability app (positioned between Instagram and LinkedIn) for Gen Z, India-first. This spec covers the **backend** only — API, data model, real-time, AI, media, auth, and trust & safety — needed to serve the 23-screen mobile client. Frontend UX intent is treated as given; requirements below define what the backend must guarantee.

---

## 1. Authentication & Identity

**User Story:** As a new user, I want to sign up with my phone number, so that I can start using the app the way I already sign up for apps in India.

- WHEN a user submits a phone number THEN the system SHALL send an OTP via SMS and create a pending, unverified session.
- WHEN a user submits a valid OTP within its expiry window THEN the system SHALL create or resume the account and issue an auth session token.
- WHEN a user chooses Google or Apple sign-in THEN the system SHALL authenticate via OAuth and link or create the corresponding account.
- IF a user has no profile record after first authentication THEN the system SHALL flag the session as "needs setup" so the client routes to Setup.
- WHEN a session token expires or is revoked THEN the system SHALL reject subsequent requests with 401 and require re-authentication.

## 2. Profile & Setup

**User Story:** As a new user, I want to set my name, avatar, interests, and default visibility, so that I'm recognizable and my content defaults correctly.

- WHEN a user submits Setup (name, avatar colour, interest chips, default visibility) THEN the system SHALL persist this as the user's profile record, auto-generate a unique handle derived from the name (with numeric suffix on collision), and mark setup complete.
- WHEN a user edits their handle later from Settings THEN the system SHALL enforce uniqueness and reject the change if the requested handle is taken.
- IF name is missing or empty THEN the system SHALL reject the profile write with a validation error.
- WHEN any other screen reads user context THEN the system SHALL source name, avatar, interests, and default visibility from this profile record.
- WHEN a user edits their profile from Settings or Profile THEN the system SHALL update the record immediately without requiring a separate save/publish step.

## 3. Goals

**User Story:** As a user, I want to create a goal with a deadline and cadence, so that I have something concrete to check in against.

- WHEN a user submits a goal (category, description, deadline, cadence [daily/weekly/custom], target check-in count, visibility) THEN the system SHALL create a goal record owned by that user.
- WHEN a user requests an AI milestone plan for a goal in progress of being created THEN the system SHALL call the AI coaching service with the goal draft and return exactly three suggested checkpoints as free-text milestones (label + optional target date), persisted separately from the progress-based percentage markers described below.
- These AI-suggested checkpoints are distinct from the 25/50/75/100% progress markers used in Goal Detail: the former are qualitative and AI-authored at creation time; the latter are computed automatically from check-in progress and never touched by AI.
- WHEN a goal is successfully created THEN the system SHALL return confirmation data sufficient for the client to show a success state and route to the dashboard.
- WHEN the Goal Dashboard is requested THEN the system SHALL return all of the user's goals with current streak, progress percentage, and today's check-in availability state (available / done / goal complete).
- WHEN the Goal Detail screen is requested for a goal THEN the system SHALL return the goal, its full check-in log history, computed milestone checkpoints at 25/50/75/100%, and other users pursuing the same or a linked goal.
- WHEN a goal's check-in count reaches its target_checkins THEN the system SHALL mark the goal `complete` and reject further check-ins against it.
- WHEN a goal's deadline passes without reaching target_checkins THEN the system SHALL mark the goal `expired` and reject further check-ins against it. Goal status is computed/updated server-side only, never client-settable.
- "Other users pursuing the same or a linked goal" is defined as: users in a shared squad with an active goal in the same `category`, whose goal visibility permits the viewer to see it. There is no explicit goal-linking mechanism in v1 — this is a category-match heuristic, not a hard link.

## 4. Check-ins & Streaks (Integrity-Critical)

**User Story:** As a user, I want my streak to be trustworthy, so that leaderboard rankings and my own progress feel earned.

- WHEN a check-in request is received THEN the system SHALL validate server-side that no check-in has already been recorded for the current period in the user's timezone before accepting it. Period boundaries are computed entirely server-side from the goal's cadence and the user's stored timezone — the client sends no period data, only the goal id.
- IF a check-in is attempted for a period already checked in THEN the system SHALL reject it and return the existing state rather than double-counting.
- IF two check-in requests for the same period arrive concurrently (network retry, double-tap) THEN the database unique constraint SHALL be the final arbiter — the losing request SHALL be caught and treated as a duplicate (return existing state), never surfaced as a 500 error.
- WHEN a valid check-in is accepted THEN the system SHALL atomically increment the streak counter, advance progress toward the goal's target, and record a check-in log entry with server timestamp.
- WHEN a valid check-in is accepted THEN the system SHALL auto-generate a post referencing that check-in, respecting the goal's visibility setting.
- WHEN a user's local timezone changes THEN the system SHALL use the timezone on record at the time of the check-in request, not a cached value from account creation.
- IF a check-in period is missed entirely THEN the system SHALL reset the streak counter to zero at the start of the next period, and SHALL NOT allow retroactive check-ins to restore it.

## 5. Feed & Posts

**User Story:** As a user, I want to see my squad's activity and react instantly, so that the feed feels alive.

- WHEN the Home Feed is requested THEN the system SHALL return a paginated list of posts with author, linked goal, timestamp, post type (win/progress/needs-hype), hype count, whether the requesting viewer has already hyped it, and comment count.
- WHEN a user taps Hype on a post THEN the system SHALL record the hype idempotently (one hype per user per post) and return updated counts, while the client may optimistically render before confirmation.
- WHEN a user submits a new post (text, goal tag, type, media references, visibility) THEN the system SHALL create the post record with the authoring user and return it for immediate feed insertion.
- WHEN a user requests AI-assisted post drafting THEN the system SHALL generate draft text grounded in that user's actual active goals, not a generic template.
- WHEN feed pagination is requested with a cursor THEN the system SHALL return the next page in reverse-chronological order without duplicating or skipping posts already seen.

## 6. Discover & Search

**User Story:** As a user, I want to search across people, goals, and squads, so I can find what I'm looking for fast.

- WHEN Discover is requested THEN the system SHALL return recommended squads and trending tags as read-only recommendation data.
- WHEN a search query is submitted THEN the system SHALL return results grouped into People, Goals, and Squads sections, ranked within each group.
- WHEN no query has been entered yet THEN the system SHALL return trending tags so the screen is never a blank state.
- Search results SHALL respect the same visibility rules as the feed: squad-only goals and posts SHALL NOT appear in results for viewers outside that squad, and private squads SHALL only appear if the viewer is already a member or the squad is discoverable by design.

## 7. Squads & Membership

**User Story:** As a user, I want to create and join squads, so that I have an accountability group.

- WHEN a user submits Create Squad (emoji, name, category, visibility) THEN the system SHALL create the squad and automatically provision four default channels: general, check-ins, wins, accountability.
- WHEN a user requests their Squad Browser view THEN the system SHALL return the squads they belong to and a ranked list of suggested squads with member counts.
- WHEN a user taps Join on a public squad THEN the system SHALL add them as a member immediately; for a private squad THEN the system SHALL create a `squad_join_requests` row requiring owner/moderator approval before membership is granted.
- WHEN a squad owner or moderator approves or rejects a join request THEN the system SHALL update membership accordingly and notify the requesting user.
- Note on vocabulary: squad visibility uses `public`/`private`; goal, post, and profile visibility use `public`/`squad`. These are separate enums on separate entities — do not conflate them.
- WHEN Discover is requested THEN the system SHALL return recommended squads and trending tags as read-only recommendation data (no user-submitted content on this endpoint).

## 8. Squad Chat (Real-time)

**User Story:** As a squad member, I want real-time chat with inline check-ins, so that the group feels like a live accountability space.

- WHEN a user opens a channel THEN the system SHALL return recent message history and establish a real-time subscription for new messages.
- WHEN a message is sent to a channel THEN the system SHALL broadcast it to all subscribed channel members within the same latency budget regardless of channel size.
- WHEN a check-in occurs for a goal linked to squad members THEN the system SHALL emit an inline check-in event into the relevant channel(s) distinct from a plain text message, so clients can render it as a check-in card.
- WHEN a user switches channels THEN the system SHALL serve the new channel's history without requiring a full reconnect.
- IF a user is not a member of a squad THEN the system SHALL deny read/write access to that squad's channels.

## 9. Social Graph (Follow/Followers)

**User Story:** As a user, I want to follow others and see who follows me, so that I can build my network.

- WHEN a user requests Followers or Following THEN the system SHALL return each person with their current goal in progress, streak, and the viewer's follow state relative to them.
- WHEN a user taps Follow or Unfollow on a row THEN the system SHALL update the relationship immediately and reflect it in both users' counts.

## 10. Profile Page & Stats

- WHEN a Profile is requested (own or another's) THEN the system SHALL return avatar, name, handle, bio, streak/posts/followers/following counts, and the user's posts.
- IF the profile requested belongs to the viewer THEN the system SHALL indicate edit permission; ELSE THEN the system SHALL indicate follow/message affordances instead.

## 11. Notifications

**User Story:** As a user, I want to be notified of relevant activity, so that I return to the app.

- WHEN a hype, comment, new follower, squad join/invite, or milestone event occurs THEN the system SHALL create a notification record for the relevant recipient(s) and push it in real time if the recipient is connected.
- WHEN the Notifications screen is requested THEN the system SHALL return the combined real-time feed and historical notifications with read/unread state.
- WHEN a user views a notification THEN the system SHALL mark it read without requiring a separate action.

## 12. Leaderboard

- WHEN the Leaderboard is requested with a scope (squad or global) and metric (streak or hype) THEN the system SHALL return a ranked list of members with both streak totals and hype totals, ordered by the selected metric.
- A member's "streak total" for leaderboard purposes SHALL be defined as their single longest currently-active streak across all of their goals (not a sum across goals) — this is a fixed decision, not left to Kiro to infer.
- WHEN leaderboard data is computed THEN the system SHALL exclude check-ins that failed server-side validation from any ranking calculation.

## 13. AI Coach

**User Story:** As a user, I want to chat with an AI coach that knows my goals, so that responses feel personal.

- WHEN a user sends a message to AI Coach THEN the system SHALL call the AI service with that user's active goal context and persist both the user message and the AI response to conversation history.
- WHEN a user reopens AI Coach later THEN the system SHALL return prior conversation history so the thread persists across sessions.
- WHEN a quick-prompt chip is tapped THEN the system SHALL treat it as a normal user message with the corresponding preset text.
- IF the AI service call fails or times out THEN the system SHALL return a graceful error state rather than a silent hang, and SHALL NOT persist a corrupted/partial response.

## 14. Coach Marketplace & Monetization

- WHEN the Coach Marketplace is requested THEN the system SHALL return the coach catalog (name, AI/human badge, specialty, rating, price).
- WHEN a user books a human coach THEN the system SHALL initiate scheduling and payment flow and SHALL NOT confirm the booking until payment succeeds.
- WHEN a user upgrades to Pro from Settings THEN the system SHALL process the subscription payment and unlock Pro-gated features immediately on success.

## 15. Body Double Room

- WHEN a user joins a Body Double Room THEN the system SHALL share presence (who's in the room, focusing status) in real time to all participants.
- WHEN a user invites another user THEN the system SHALL notify the invitee with a joinable link/reference.
- Pomodoro timer state SHALL be treated as client-local and is NOT required to be synchronized server-side in this version.

## 16. Milestone Cards & Reels (Media)

- WHEN a user generates a Milestone Card THEN the system SHALL render an image combining the milestone/streak data, user name, and brand mark, and return a shareable asset.
- WHEN a user records or uploads a Reel THEN the system SHALL accept video up to the selected duration (15/30/60s), store it, link it to the specified goal, and make it available in the Reels Feed pagination once processed.
- WHEN the Reels Feed is requested THEN the system SHALL return a paginated list of reels with video URLs, captions, linked goal, author, and the viewer's hype state.

## 17. Trust & Safety

- WHEN any user-generated content (post, message, reel, profile field) is submitted THEN the system SHALL run it through a moderation check before it is visible to other users.
- IF content is flagged by moderation THEN the system SHALL withhold it from public visibility pending review rather than deleting it outright.
- WHEN a user is reported THEN the system SHALL record the report and make it available to a moderation workflow.

## 18. Non-functional Requirements

- All endpoints SHALL enforce row-level authorization so a user can only read/write data they are permitted to access.
- Check-in, hype, and follow actions SHALL be idempotent under retry (no double-counting on network retry).
- The system SHALL support push notification delivery for at least: hype received, comments, new followers, squad invites, milestone events. This requires a registered device token per user device — the client SHALL register its push token on login/app-open via a dedicated endpoint.
- The system SHALL rate-limit AI coach, post-drafting, AND goal milestone-plan endpoints per user to control cost and abuse (all three call the AI service).
- The system SHALL rate-limit OTP requests per phone number and per IP to prevent SMS-cost abuse.

## 19. Open Decisions — Confirm Before Kiro Builds

These are product calls, not engineering details — I have not decided them for you. Kiro will guess if left blank, so resolve before Wave 1:

1. **Un-hype**: Can a user remove a hype after tapping it? Neither the screens nor earlier sessions specify this. Default assumption if you don't answer: hypes are permanent (no `DELETE /posts/:id/hype` endpoint exists in this spec).
2. **Leave squad**: There's no "leave squad" endpoint in this spec — screens describe joining but not leaving. Confirm if this is in scope for v1.
3. **Comment deletion**: No delete/edit endpoint for comments exists. Confirm if authors (or moderators) can remove their own comments in v1.
4. **Session refresh**: Requirements state expired tokens are rejected, but no refresh-token flow is specified. Without one, users get hard-logged-out on every token expiry. Confirm whether refresh tokens are in scope for v1 or deferred.
5. **Squad ownership transfer / squad deletion**: Not covered — out of scope for v1 unless you say otherwise. Flagging so it's a deliberate omission, not an oversight.

If you don't answer these, tell Kiro explicitly to treat them as out-of-scope for v1 rather than letting it invent behavior — that alone will save you a re-work cycle.
