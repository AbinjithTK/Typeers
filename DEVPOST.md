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
- **Golden Challenges** — Brand-sponsored challenges where creators purchase tokens ($25/$100/$500 via Reddit Gold), write a message split into words, and attach hidden rewards (coupons, secrets, giveaways) to specific positions. Reward positions shuffle each play to prevent cheating. Requires mod approval, once-per-user play, with a personal reward vault

## Golden Challenges — Gamified Marketing That Actually Works

Traditional digital advertising is dying. Banner blindness is real. People scroll past ads, skip pre-rolls, and install blockers. The marketing industry has oversaturated every channel — pop-ups, sponsored posts, influencer deals — until audiences are numb to all of it. When everyone is shouting, nobody listens.

Golden Challenges flip the script entirely. Instead of interrupting users, brands become part of the game. A brand writes a message — their tagline, a product name, a campaign slogan — and it gets split into the words players type. Hidden among those words are real rewards: discount codes, giveaway entries, secret links. Players don't skip the message. They type every single word of it, letter by letter, under time pressure, with full focus. That's not an impression — that's deep engagement.

### Why This Works

The psychology is simple: people remember what they actively do, not what they passively see. Typing a brand's message word by word at speed creates muscle memory and cognitive imprinting that no banner ad can match. Players aren't just exposed to the message — they physically reproduce it. And because rewards are hidden at random positions (weighted toward the end via our shuffle algorithm), players are motivated to complete the entire challenge, not just skim the first few words.

### Targeting Communities, Not Demographics

Reddit is organized by interest. Subreddits are self-selected communities of passionate people. A gaming peripheral brand can drop a Golden Challenge in r/MechanicalKeyboards. A coffee brand can target r/Coffee. A coding bootcamp can reach r/learnprogramming. This isn't broad demographic targeting — it's precision community engagement where the audience already cares about the product category.

### The Tier System

Golden Challenges come in three tiers, purchased with Reddit Gold:

| | Golden ($0.99) | Diamond ($4.99) | Legendary ($19.99) |
|---|---|---|---|
| Words | Up to 15 | Up to 25 | Up to 30 |
| Rewards | Up to 3 | Up to 6 | Up to 10 |
| Max Claims | 100 | 500 | 2,000 |
| Duration | 7 days | 30 days | 90 days |
| Brand Link | ✗ | ✓ | ✓ |
| Affiliate Links | ✗ | ✗ | ✓ |
| Hide Reward Count | ✗ | ✗ | ✓ |

Legendary tier unlocks the ability to hide how many rewards exist — players see "??? rewards" and are driven to play and share because the mystery itself becomes the hook. Affiliate links on rewards enable direct conversion tracking.

### How Communities Benefit

This isn't just brands extracting attention. Communities grow through sponsorship. A brand running a Golden Challenge in a subreddit brings visibility, engagement, and real value (discounts, giveaways) to that community's members. Moderators approve every challenge before it goes live, keeping quality high and spam out. The community stays in control.

### Built-In Analytics

Creators get a full dashboard: total plays, completion rates, reward claims, brand link clicks, affiliate conversions — all tracked with UTM parameters. This isn't guesswork marketing. Every interaction is measurable, and the data flows back to the creator in real time.

### The Weighted Shuffle

Reward positions aren't purely random. Our algorithm places ~70% of rewards in the back half of the word sequence and ~30% in the front. This means players type through most of the brand message before finding rewards — maximizing message exposure while keeping the game fair and exciting. Combined with once-per-user play enforcement, every play is genuine engagement.

### The Bigger Picture

Gamified marketing through community games is the next evolution. As traditional methods lose effectiveness, brands need to earn attention instead of buying it. Golden Challenges turn advertising into entertainment, messages into gameplay, and passive viewers into active participants. The brand gets deep engagement. The player gets rewards. The community gets sponsored content that's actually fun. Everyone wins.

## How We Built It

### Client

- **Phaser 3** — single scene (`FastTyperGame`) handles word display, circular timer ring, HUD, countdown animations, particle bursts, and golden reward explosions. Lazy-loaded for fast initial splash
- **React 19 + TypeScript + Tailwind** — all UI outside the canvas: menus, gallery, level creator, golden challenge creator, tournament dashboard, vault, results. Retro pixel aesthetic with "Press Start 2P" font
- **Mobile** — hidden input field keeps virtual keyboard active with 50ms debounce

### Server

- **Hono + tRPC** — type-safe API with Zod validation on every input. Score bounds enforced server-side (max 999,999 pts, 300 WPM, 100 combo)
- **Redis** (Devvit built-in) — sorted sets for daily/weekly leaderboards with TTL, hashes for user stats, JSON blobs for UGC levels, gallery rankings, golden challenge data, claim tracking, token balances, and creator leaderboards
- **SuperJSON** for serialization through the tRPC transformer layer

### Reddit Integration

- **5 context menu actions**: Create Typeers Post (mod), Create Level from Comment, Create Level from Post, Start Weekly Tournament (mod), Approve Golden Challenge (mod)
- **`onAppInstall` trigger** — auto-creates first game post and tournament post
- **Weekly cron** (Monday 00:00 UTC) — creates new tournament post, pins it, unstickies previous week, posts final results as a comment
- **Score sharing** — post results as formatted Reddit comments from the results screen
- **Payments** — Reddit Gold for golden challenge tokens with idempotent fulfillment/refund via order ID tracking

### Audio

All sounds are procedurally generated via Web Audio API — zero audio files. Typing cycles through 5 key-click variations (bandpass-filtered noise at 1600–2200 Hz). Wrong keys get a harsh sawtooth buzz. Word completion triggers a multi-tone success sound. Golden rewards play an ascending C5→E5→G5→C6 chime. Everything degrades gracefully if audio is unavailable.

## Challenges We Ran Into

- **Content filtering** — extracting quality words from Reddit content meant stripping markdown, URLs, special chars, filtering stop words, and enforcing 2–14 char alphabetic constraints while keeping interesting vocabulary
- **Game balance** — the drain rate, time rewards, penalties, and combo multipliers all interact tightly. Small tweaks shift the feel from impossible to too easy
- **Leaderboard management** — daily boards with 7-day TTL, tournament boards with 14-day TTL, auto-creation via cron, and posting final results to previous week's thread
- **Golden challenge fairness** — reward shuffling per play, once-per-user enforcement, claim limits, and mod approval all had to work together
- **Procedural audio** — learning noise buffers, bandpass filters, oscillator layering, and decay envelopes to get satisfying retro sounds from pure code

## Accomplishments We're Proud Of

- A complete, polished typing game with multiple modes running entirely on Devvit — no external servers or databases
- A self-sustaining UGC ecosystem: create, rate, remix, and compete on creator leaderboards. Levels auto-feature at 10+ plays and 4+ avg rating
- Smooth 60fps with pixel particle effects, screen shake, combo animations, and a color-shifting timer ring (green → orange → red)
- One-click level creation from any post or comment via context menu
- End-to-end type safety from React through tRPC to server with Zod validation
- A full brand integration system (Golden Challenges) with purchases, mod approval, reward shuffling, analytics dashboards, and a personal vault
- Every sound generated in real-time from code — zero audio assets

## What We Learned

- **Phaser + Devvit** — lazy loading the engine, managing create/destroy cycles between React screens and the game canvas, handling mobile virtual keyboards through hidden inputs
- **Redis patterns** — sorted sets with TTL resets, atomic hash increments, JSON blobs for complex data, careful key naming across daily/weekly/UGC/golden/creator namespaces
- **Content filtering** — building a robust extraction pipeline for Reddit's diverse content while preserving fun community vocabulary
- **Game balance** — every number (drain rate, time rewards, combo multipliers) went through multiple playtesting rounds
- **Bundle optimization** — code-splitting Phaser from the splash screen keeps initial load instant while the engine loads in background

## What's Next

- Multiplayer races (real-time head-to-head)
- Power-ups and challenge modifiers
- Achievement and badge system
- Mobile-optimized controls
- Advanced in-game level editor
- Social features (challenge friends, share to DMs)
- Seasonal events and themed word packs
