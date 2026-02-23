# ⌨️ Typeers

A Reddit-powered speed typing game — type fast, beat the clock, and climb the leaderboard.

![Typeers Game](public/typeersicon.png)

## 🎮 What is Typeers?

Typeers is a retro arcade-style typing game built natively on Reddit using Devvit. Words come directly from Reddit — pulled from subreddit posts, comments, and community-created levels. It features community reward challenges, weekly tournaments, and a full creator economy.

### Core Features

- **Multiple Game Modes**
  - Daily Challenge with consistent word sets
  - Category-based levels (Reddit, Tech, Animals, Gaming, Space)
  - Community Words pulled from your subreddit's top posts
  - User-generated custom levels from posts and comments

- **Weekly Tournaments**
  - Automated Monday-to-Sunday competitive cycles
  - Auto-pinned tournament posts with distinguished styling
  - Full tournament dashboard with current + previous week stats
  - Cron-scheduled creation via Devvit scheduler

- **User-Generated Content**
  - Create custom levels from any post or comment via menu actions
  - In-game level editor with word list builder
  - Browse, play, rate, and remix community levels
  - Creator leaderboards, stats, and profile pages

- **Progression System**
  - Real-time daily leaderboards
  - Persistent stats (streaks, WPM, accuracy, all-time bests)
  - Combo multipliers (up to 5x) and time bonuses
  - Personal records and score sharing via comments

### ✨ Golden Challenges (Community Reward Events)

A tiered challenge system where creators embed hidden rewards inside typing challenges. Players type words to discover and claim rewards like coupons, secrets, giveaways, and messages.

- **Three Tiers:**
  - 🥇 Golden — 15 words, 3 rewards, 100 claims, 7-day duration
  - 💎 Diamond — 25 words, 6 rewards, 500 claims, 30 days
  - 🏆 Legendary — 30 words, 10 rewards, 2000 claims, 90 days, hidden reward count

- **Reward Types:** Coupons, secrets, giveaways, messages
- **Once-Per-User:** Each player can only play a golden challenge once
- **Reward Words:** Special words trigger particle effects and animations when typed
- **Shuffled Delivery:** Reward words are randomized each play for fairness
- **Player Vault:** Claimed rewards stored in a personal vault with redeem tracking

- **Creator Dashboard:** Challenge analytics (plays, completions, claims, claim rate)
- **Payment Bridge:** Reddit Gold purchases via `products.json` → token credits → challenge creation. Supports purchase, fulfillment, and refund flows.

### 🛡️ Mod Approval System

Golden challenges require moderator approval before going live. Approval uses Reddit's native menu actions (not in-game UI):

1. Creator purchases a tier token via Reddit Gold
2. Creator fills out the in-game creation form (title, name, words, rewards)
3. Challenge enters "pending" status
4. Moderators click "🛡️ Manage Golden Challenges" from the subreddit menu
5. A native Reddit form shows all pending/active challenges with approve/reject options
6. On approval, a custom post is auto-created for the challenge

### 📱 Mobile Support

- Keyboard timing fix: keyboard appears only when typing starts (after countdown), not during 3-2-1-GO
- `readOnly` input during countdown, switches to editable on `onCountdownComplete` callback
- Aggressive refocus interval to keep mobile keyboard open during gameplay
- Touch-friendly UI with appropriately sized tap targets

## 🚀 Installation

### For Moderators

1. Visit the [Devvit Apps Directory](https://developers.reddit.com/apps)
2. Search for "Typeers"
3. Click "Install" and select your subreddit
4. The app creates an initial game post and tournament automatically

### Direct Install

```bash
devvit install typeers <your-subreddit>
```

## 📖 How to Use

### Playing

1. Click any Typeers post in your subreddit
2. Hit "PLAY NOW"
3. Type the words as fast as you can
4. Build combos for bonus points and extra time
5. Complete all words before time runs out

### Creating Custom Levels

- **From a Comment:** Three dots menu → "🎮 Create Typeers Level"
- **From a Post:** Three dots menu → "⌨️ Create Typeers Level from Post"
- **In-Game Editor:** Use the level creator to build custom word lists

### Golden Challenges

1. Open the game menu → "✨ CREATE GOLDEN CHALLENGE"
2. Purchase a tier token (Golden/Diamond/Legendary) via Reddit Gold
3. Fill in title, creator name, words, reward words with descriptions
4. Submit for mod approval → once approved, a post is created automatically

### Moderator Actions

- **Create Typeers Post** — Create a new game post (subreddit menu, mod-only)
- **Start Weekly Tournament** — Create and pin a tournament post (subreddit menu, mod-only)
- **Manage Golden Challenges** — Review, approve, or reject golden challenges (subreddit menu, mod-only)
- **Create Level from Comment/Post** — Turn any content into a typing challenge (available to all users)

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| [Devvit](https://developers.reddit.com/) | Reddit's developer platform |
| [Phaser 3](https://phaser.io/) | Game engine (rendering, particles, animations) |
| [React](https://react.dev/) | UI components and state management |
| [TypeScript](https://www.typescriptlang.org/) | Type safety across client and server |
| [Hono](https://hono.dev/) | Backend HTTP routing |
| [tRPC](https://trpc.io/) | Type-safe API layer |
| [Redis](https://redis.io/) | Leaderboards, game state, analytics |
| [Vite](https://vite.dev/) | Build tooling |
| [Vitest](https://vitest.dev/) | Testing |

## 🎯 Game Mechanics

- **Starting Time:** 10 seconds
- **Time per Word:** +3 seconds (scales with word length)
- **Combo System:** Chain correct words for 2x → 3x → 4x → 5x multipliers
- **Time Bonus:** Extra points for fast completions
- **Accuracy:** Mistakes break combos and cost time
- **Reward Words:** Golden challenge words trigger particle effects and reward claims

## 🏗️ Project Structure

```
typeers/
├── src/
│   ├── game.tsx              # Main game UI (React)
│   ├── splash.tsx            # Splash/loading screen
│   ├── game/
│   │   ├── FastTyperGame.ts  # Phaser game logic
│   │   ├── config.ts         # Phaser configuration
│   │   └── index.ts          # Game module entry
│   ├── server/
│   │   ├── index.ts          # Hono server setup
│   │   ├── trpc.ts           # tRPC router (all API routes)
│   │   ├── context.ts        # Request context
│   │   ├── core/
│   │   │   ├── game.ts       # Word generation, scoring, stats
│   │   │   ├── golden.ts     # Golden challenges, rewards, payments
│   │   │   ├── tournament.ts # Weekly tournaments
│   │   │   ├── levels.ts     # UGC levels, gallery, ratings
│   │   │   ├── post.ts       # Post creation
│   │   │   └── count.ts      # Counter utilities
│   │   └── routes/
│   │       ├── menu.ts       # Menu actions + mod approval forms
│   │       ├── payments.ts   # Reddit Gold fulfill/refund handlers
│   │       ├── scheduler.ts  # Cron tasks (weekly tournament)
│   │       └── triggers.ts   # App install trigger
│   ├── products.json         # Reddit Gold product definitions
│   ├── trpc.ts               # Client-side tRPC setup
│   └── transformer.ts        # SuperJSON transformer
├── devvit.json               # Devvit app configuration
├── public/                   # Static assets
└── tools/                    # TypeScript configs
```

## 🔧 Development

### Prerequisites

- Node.js 22+
- Reddit account on [Reddit Developers](https://developers.reddit.com/)

### Setup

```bash
git clone https://github.com/AbinjithTK/Typeers.git
cd typeers
npm install
npx devvit login
npm run dev
```

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start playtest server |
| `npm run build` | Build client and server |
| `npm run type-check` | TypeScript validation |
| `npm run test` | Run test suite |
| `npm run lint` | Lint code |
| `npx devvit upload` | Upload new version |
| `npx devvit publish` | Publish to Reddit |

## 📄 License

BSD-3-Clause

## 📋 Legal

- [Terms & Conditions](TERMS.md)
- [Privacy Policy](PRIVACY.md)

## 🔗 Links

- [Devvit Documentation](https://developers.reddit.com/docs)
- [Devvit Community](https://www.reddit.com/r/Devvit)
- [GitHub Repository](https://github.com/AbinjithTK/Typeers)
- [Report Issues](https://github.com/AbinjithTK/Typeers/issues)

---

**Made with ❤️ for Reddit communities**
