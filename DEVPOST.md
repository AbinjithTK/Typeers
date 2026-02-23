# Typeers

## Inspiration

We wanted a typing game that feels like it belongs on Reddit — where the community doesn't just play, but shapes the experience. The idea: what if the words you type came from the subreddits, posts, and comments you already love? Typeers blends fast-paced arcade gameplay with Reddit's endless user-generated content.

## What It Does

Typeers is a retro-styled typing game that lives natively inside Reddit as a Devvit app. Words appear one at a time, and players race against a draining clock to type them correctly.

### Core Mechanics

- **20-second clock** that drains at 1.4x real time — constant pressure
- **Complete a word** → gain time back (+2s base, +100ms per letter, +300ms combo bonus)
- **Wrong keystroke** → lose 1 second, break your combo, lose 10 points, screen shakes
- **Scoring** → 50 base + 15/letter + speed bonus (up to ~100 for sub-3s completions) + combo multiplier (up to 8x)
- **25-second cap** — you can never bank too far ahead
- Tracks accuracy, WPM, max combo, and total score

### Game Modes

- **Daily Challenge** — 10 words seeded by date, same for everyone, daily leaderboard reset
- **Category Levels** — 5 themed packs: Reddit, Tech, Animals, Gaming, Space (10 random words each)
- **Community Words** — Pulled from the subreddit's top posts, filtered and cached daily
- **User-Generated Levels** — Create 3–15 word challenges via in-app editor, or instantly turn any post/comment into a level via context menu. Browse, play, rate (1–5 stars), and remix in the gallery
- **Weekly Tournaments** — Auto-created every Monday, pinned by the bot, final results posted as a comment. Compete for the weekly crown
- **Golden Challenges** — Premium community challenges with hidden rewards. Creators craft a custom message, attach secret rewards to specific words, and the community plays to discover them. Three tiers with escalating features. Mod-approved, once-per-user, with a personal reward vault

### Golden Challenges — Community Reward Events

Golden Challenges are a way for community members, moderators, and creators to run interactive reward events inside their subreddit. Think of them as treasure hunts built into the typing game.

A creator writes a custom message — it could be a riddle, a community announcement, a fun fact, a trivia question, or anything they want the community to engage with. The message gets split into words that players type. Hidden among those words are rewards: secret codes, giveaway entries, exclusive messages, or coupon codes. Players discover rewards as they type, and each reward goes into their personal vault.

Every challenge is mod-approved before going live, enforced to one play per user, and rewards shuffle positions each play so no one can cheat by sharing positions.

**Three tiers make each challenge unique:**

| | ✨ Golden | 💎 Diamond | 🔥 Legendary |
|---|---|---|---|
| Message Length | Up to 15 words | Up to 25 words | Up to 30 words |
| Hidden Rewards | Up to 3 | Up to 6 | Up to 10 |
| Community Reach | 100 players | 500 players | 2,000 players |
| Duration | 7 days | 30 days | 90 days |
| Creator Link | ✗ | ✓ | ✓ |
| Reward Links | ✗ | ✗ | ✓ |
| Mystery Mode | ✗ | ✗ | ✓ (hides reward count) |

Golden tier is perfect for quick community giveaways — a mod drops a 7-day challenge with 3 hidden discount codes. Diamond scales up for bigger events — longer messages, more rewards, a full month of engagement, and a link back to the creator's profile or project. Legendary is the full experience — up to 30 words, 10 rewards, 2,000 players, reward-specific links, and Mystery Mode where players see "??? rewards" instead of the count, driving curiosity and sharing.

Creators get a real-time analytics dashboard showing plays, completion rates, and reward claims. The weighted shuffle algorithm places ~70% of rewards in the latter half of the message, so players engage with the full content before finding treasures.

## How We Built It

### Client

- **Phaser 3** — single scene (`FastTyperGame`) handles word display, circular timer ring, HUD, countdown animations, particle bursts, and golden reward explosions. Lazy-loaded for fast initial splash
- **React 19 + TypeScript + Tailwind** — all UI outside the canvas: menus, gallery, level creator, challenge creator, tournament dashboard, vault, results. Retro pixel aesthetic with "Press Start 2P" font
- **Mobile** — hidden input field keeps virtual keyboard active; focus triggered during user gesture for reliable keyboard popup

### Server

- **Hono + tRPC** — type-safe API with Zod validation on every input. Score bounds enforced server-side (max 999,999 pts, 300 WPM, 100 combo)
- **Redis** (Devvit built-in) — sorted sets for daily/weekly leaderboards with TTL, hashes for user stats, JSON blobs for UGC levels, gallery rankings, challenge data, claim tracking, token balances, and creator leaderboards
- **SuperJSON** for serialization through the tRPC transformer layer

### Reddit Integration

- **5 context menu actions**: Create Typeers Post (mod), Create Level from Comment, Create Level from Post, Start Weekly Tournament (mod), Manage Golden Challenges (mod)
- **`onAppInstall` trigger** — auto-creates first game post and tournament post
- **Weekly cron** (Monday 00:00 UTC) — creates new tournament post, pins it, unstickies previous week, posts final results as a comment
- **Score sharing** — post results as formatted Reddit comments from the results screen
- **Payments** — Reddit Gold for challenge tokens with idempotent fulfillment/refund via order ID tracking

### Audio

All sounds are procedurally generated via Web Audio API — zero audio files. Typing cycles through 5 key-click variations (bandpass-filtered noise at 1600–2200 Hz). Wrong keys get a harsh sawtooth buzz. Word completion triggers a multi-tone success sound. Golden rewards play an ascending C5→E5→G5→C6 chime. Everything degrades gracefully if audio is unavailable.

## Challenges We Ran Into

- **Content filtering** — extracting quality words from Reddit content meant stripping markdown, URLs, special chars, filtering stop words, and enforcing 2–14 char alphabetic constraints while keeping interesting vocabulary
- **Game balance** — the drain rate, time rewards, penalties, and combo multipliers all interact tightly. Small tweaks shift the feel from impossible to too easy
- **Leaderboard management** — daily boards with 7-day TTL, tournament boards with 14-day TTL, auto-creation via cron, and posting final results to previous week's thread
- **Challenge fairness** — reward shuffling per play, once-per-user enforcement, claim limits, and mod approval all had to work together without race conditions
- **Procedural audio** — learning noise buffers, bandpass filters, oscillator layering, and decay envelopes to get satisfying retro sounds from pure code
- **Mobile keyboards** — getting virtual keyboards to reliably appear inside a Phaser canvas embedded in a Devvit webview required focus timing during user gestures and careful readOnly toggling

## Accomplishments We're Proud Of

- A complete, polished typing game with multiple modes running entirely on Devvit — no external servers or databases
- A self-sustaining UGC ecosystem: create, rate, remix, and compete on creator leaderboards. Levels auto-feature at 10+ plays and 4+ avg rating
- Smooth 60fps with pixel particle effects, screen shake, combo animations, and a color-shifting timer ring (green → orange → red)
- One-click level creation from any post or comment via context menu
- End-to-end type safety from React through tRPC to server with Zod validation
- A tiered community challenge system with purchases, mod approval, reward shuffling, analytics dashboards, and a personal vault
- Every sound generated in real-time from code — zero audio assets
- Weekly tournaments that fully automate themselves — post creation, pinning, result posting, and rotation

## What We Learned

- **Phaser + Devvit** — lazy loading the engine, managing create/destroy cycles between React screens and the game canvas, handling mobile virtual keyboards through hidden inputs
- **Redis patterns** — sorted sets with TTL resets, atomic hash increments, JSON blobs for complex data, careful key naming across daily/weekly/UGC/golden/creator namespaces
- **Content filtering** — building a robust extraction pipeline for Reddit's diverse content while preserving fun community vocabulary
- **Game balance** — every number (drain rate, time rewards, combo multipliers) went through multiple playtesting rounds
- **Bundle optimization** — code-splitting Phaser from the splash screen keeps initial load instant while the engine loads in background
- **Payment flows** — idempotent fulfillment, refund handling, and token balance management with Redis required careful atomic operations

## What's Next

- Multiplayer races (real-time head-to-head typing battles)
- Power-ups and challenge modifiers (slow time, double points, shield)
- Achievement and badge system
- Advanced in-game level editor with themes
- Social features (challenge friends, share to DMs)
- Seasonal events and themed word packs
- Community challenge leaderboards (most creative challenges, most played)
