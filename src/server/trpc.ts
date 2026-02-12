import { initTRPC } from '@trpc/server';
import { transformer } from '../transformer';
import { Context } from './context';
import { context, reddit } from '@devvit/web/server';
import { countDecrement, countGet, countIncrement } from './core/count';
import { 
  getDailyWords, 
  getLeaderboard, 
  submitScore, 
  getUserBestScore,
  getTodayKey,
  getWordsFromComment,
  updateUserStats,
  getUserStats,
  getCategories,
  getWordsByCategory,
  getSubredditWords,
} from './core/game';
import { getLevelForPost } from './core/post';
import {
  submitTournamentScore,
  getTournamentLeaderboard,
  getUserTournamentStats,
  getCurrentWeekKey,
  getCurrentTournamentPostId,
  isTournamentPost,
  getTournamentDashboard,
} from './core/tournament';
import {
  getGalleryLevels,
  getFeaturedLevels,
  getLevel,
  rateLevel,
  getUserRating,
  recordPlay,
  getCreatorLeaderboard,
  getCreatorStats,
  getUgcLevelForPost,
  remixLevel,
  getLevelOfTheDay,
  getLevelsByCreator,
  createCustomLevel,
} from './core/levels';
import {
  createGoldenChallenge,
  getGoldenChallenge,
  claimReward,
  getUserVault,
  markVaultItemRedeemed,
  getActiveGoldenChallenges,
  getGoldenChallengeForPost,
  getGoldenChallengeAnalytics,
  recordGoldenPlay,
  getUserClaimedRewards,
  getTokenBalance,
  hasUserPlayedGolden,
  getCreatorDashboard,
  isGoldenCreator,
  trackBrandLinkClick,
  trackAffiliateLinkClick,
  TIER_LIMITS,
} from './core/golden';
import { z } from 'zod';

const t = initTRPC.context<Context>().create({
  transformer,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// ── Rate Limiting ──────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max actions per window

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Score bounds — prevents impossible/cheated scores
const MAX_SCORE = 999_999;
const MAX_WPM = 300;
const MAX_COMBO = 100;

export const appRouter = t.router({
  init: t.router({
    get: publicProcedure.query(async () => {
      const [count, username] = await Promise.all([
        countGet(),
        reddit.getCurrentUsername(),
      ]);

      return {
        count,
        postId: context.postId,
        username,
      };
    }),
  }),
  
  counter: t.router({
    increment: publicProcedure
      .input(z.number().optional())
      .mutation(async ({ input }) => {
        const { postId } = context;
        return {
          count: await countIncrement(input),
          postId,
          type: 'increment',
        };
      }),
    decrement: publicProcedure
      .input(z.number().optional())
      .mutation(async ({ input }) => {
        const { postId } = context;
        return {
          count: await countDecrement(input),
          postId,
          type: 'decrement',
        };
      }),
    get: publicProcedure.query(async () => {
      return await countGet();
    }),
  }),

  game: t.router({
    // Get daily challenge words
    getDaily: publicProcedure.query(async () => {
      const words = await getDailyWords();
      const date = getTodayKey();
      return { words, date };
    }),

    // Get available word categories
    getCategories: publicProcedure.query(() => {
      return getCategories();
    }),

    // Get words for a specific category
    getWordsByCategory: publicProcedure
      .input(z.object({ categoryId: z.string() }))
      .query(({ input }) => {
        const words = getWordsByCategory(input.categoryId);
        return { words };
      }),

    // Get words from the subreddit's top posts
    getCommunityWords: publicProcedure.query(async () => {
      return await getSubredditWords();
    }),

    // Get leaderboard
    getLeaderboard: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(10) }).optional())
      .query(async ({ input }) => {
        return await getLeaderboard(input?.limit ?? 10);
      }),

    // Submit score
    submitScore: publicProcedure
      .input(z.object({ score: z.number().min(0).max(MAX_SCORE).int() }))
      .mutation(async ({ input }) => {
        return await submitScore(input.score);
      }),

    // Get user's best score for today
    getUserBest: publicProcedure.query(async () => {
      return { score: await getUserBestScore() };
    }),

    // Submit game stats (called alongside submitScore)
    submitStats: publicProcedure
      .input(z.object({
        score: z.number().min(0).max(MAX_SCORE).int(),
        wordsTyped: z.number().min(0).max(100).int(),
        accuracy: z.number().min(0).max(100),
        maxCombo: z.number().min(0).max(MAX_COMBO).int(),
        wpm: z.number().min(0).max(MAX_WPM),
      }))
      .mutation(async ({ input }) => {
        await updateUserStats(input);
        return { success: true };
      }),

    // Get persistent user stats
    getStats: publicProcedure.query(async () => {
      return await getUserStats();
    }),

    // Get current user info
    getCurrentUser: publicProcedure.query(async () => {
      const username = await reddit.getCurrentUsername();
      return { username };
    }),

    // Get words from a comment (for UGC levels)
    getWordsFromComment: publicProcedure
      .input(z.object({ commentId: z.string() }))
      .query(async ({ input }) => {
        const words = await getWordsFromComment(input.commentId);
        return { words };
      }),

    // Get level words for a specific post (UGC levels)
    getLevelForPost: publicProcedure
      .input(z.object({ postId: z.string() }))
      .query(async ({ input }) => {
        const words = await getLevelForPost(input.postId);
        return { words, isCustomLevel: words !== null };
      }),

    // Share score as a comment
    shareScore: publicProcedure
      .input(z.object({ 
        score: z.number(), 
        wordsTyped: z.number(),
        totalWords: z.number(),
        completed: z.boolean()
      }))
      .mutation(async ({ input }) => {
        const { postId } = context;
        if (!postId) return { success: false };

        const username = await reddit.getCurrentUsername();
        if (!username) return { success: false };

        const emoji = input.completed ? '🎉' : '⏰';
        const status = input.completed ? 'completed the challenge' : 'ran out of time';
        
        const commentText = `${emoji} **${input.score} points!** I ${status} typing ${input.wordsTyped}/${input.totalWords} words. Can you beat my score? Play now! ⌨️`;

        try {
          await reddit.submitComment({
            id: postId as `t3_${string}`,
            text: commentText,
          });
          return { success: true };
        } catch (err) {
          console.error('Failed to post comment:', err);
          return { success: false };
        }
      }),
  }),

  tournament: t.router({
    // Get current tournament info
    getInfo: publicProcedure.query(async () => {
      const weekKey = getCurrentWeekKey();
      const postId = await getCurrentTournamentPostId();
      const stats = await getUserTournamentStats();
      return { weekKey, postId, userStats: stats };
    }),

    // Get tournament leaderboard
    getLeaderboard: publicProcedure
      .input(z.object({
        weekKey: z.string().optional(),
        limit: z.number().min(1).max(50).default(10),
      }).optional())
      .query(async ({ input }) => {
        return await getTournamentLeaderboard(input?.weekKey, input?.limit ?? 10);
      }),

    // Submit tournament score (called alongside regular score submit)
    submitScore: publicProcedure
      .input(z.object({ score: z.number().min(0).max(MAX_SCORE).int() }))
      .mutation(async ({ input }) => {
        return await submitTournamentScore(input.score);
      }),

    // Check if current post is a tournament post
    isTournamentPost: publicProcedure
      .input(z.object({ postId: z.string() }))
      .query(async ({ input }) => {
        const weekKey = await isTournamentPost(input.postId);
        return { isTournament: weekKey !== null, weekKey };
      }),

    // Full tournament dashboard with current + previous week data
    getDashboard: publicProcedure.query(async () => {
      return await getTournamentDashboard();
    }),
  }),

  levels: t.router({
    // Browse the level gallery
    getGallery: publicProcedure
      .input(z.object({
        sortBy: z.enum(['plays', 'rating']).default('plays'),
        offset: z.number().min(0).default(0),
        limit: z.number().min(1).max(20).default(10),
      }).optional())
      .query(async ({ input }) => {
        return await getGalleryLevels(
          input?.sortBy ?? 'plays',
          input?.offset ?? 0,
          input?.limit ?? 10
        );
      }),

    // Get featured levels
    getFeatured: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(10).default(5) }).optional())
      .query(async ({ input }) => {
        return await getFeaturedLevels(input?.limit ?? 5);
      }),

    // Get a specific level
    getLevel: publicProcedure
      .input(z.object({ levelId: z.string() }))
      .query(async ({ input }) => {
        return await getLevel(input.levelId);
      }),

    // Get UGC level for a post
    getForPost: publicProcedure
      .input(z.object({ postId: z.string() }))
      .query(async ({ input }) => {
        const level = await getUgcLevelForPost(input.postId);
        return { level, hasLevel: level !== null };
      }),

    // Record a play
    recordPlay: publicProcedure
      .input(z.object({ levelId: z.string() }))
      .mutation(async ({ input }) => {
        await recordPlay(input.levelId);
        return { success: true };
      }),

    // Rate a level
    rate: publicProcedure
      .input(z.object({ levelId: z.string(), rating: z.number().min(1).max(5) }))
      .mutation(async ({ input }) => {
        return await rateLevel(input.levelId, input.rating);
      }),

    // Get user's rating for a level
    getUserRating: publicProcedure
      .input(z.object({ levelId: z.string() }))
      .query(async ({ input }) => {
        const rating = await getUserRating(input.levelId);
        return { rating };
      }),

    // Remix a level
    remix: publicProcedure
      .input(z.object({
        originalLevelId: z.string(),
        newWords: z.array(z.string().min(2).max(14).regex(/^[a-zA-Z]+$/)).min(3).max(15),
      }))
      .mutation(async ({ input }) => {
        const username = await reddit.getCurrentUsername();
        if (!username) return { success: false, message: 'Not logged in' };
        if (!checkRateLimit(`remix:${username}`)) {
          return { success: false, message: 'Too many remixes. Please wait a minute.' };
        }
        return await remixLevel(input.originalLevelId, input.newWords);
      }),

    // Creator leaderboard
    getCreatorLeaderboard: publicProcedure
      .input(z.object({
        sortBy: z.enum(['plays', 'ratings']).default('plays'),
        limit: z.number().min(1).max(20).default(10),
      }).optional())
      .query(async ({ input }) => {
        return await getCreatorLeaderboard(input?.sortBy ?? 'plays', input?.limit ?? 10);
      }),

    // Get creator stats
    getCreatorStats: publicProcedure
      .input(z.object({ username: z.string() }))
      .query(async ({ input }) => {
        return await getCreatorStats(input.username);
      }),

    // Get level of the day
    getLevelOfTheDay: publicProcedure.query(async () => {
      return await getLevelOfTheDay();
    }),

    // Get levels by a specific creator
    getLevelsByCreator: publicProcedure
      .input(z.object({ username: z.string(), limit: z.number().min(1).max(20).default(10) }))
      .query(async ({ input }) => {
        return await getLevelsByCreator(input.username, input.limit);
      }),

    // Create a custom level from in-app editor
    createCustom: publicProcedure
      .input(z.object({
        title: z.string().min(1).max(60),
        words: z.array(z.string().min(2).max(14).regex(/^[a-zA-Z]+$/)).min(3).max(15),
      }))
      .mutation(async ({ input }) => {
        const username = await reddit.getCurrentUsername();
        if (!username) return { success: false, message: 'Not logged in' };
        if (!checkRateLimit(`create:${username}`)) {
          return { success: false, message: 'Too many levels created. Please wait a minute.' };
        }
        return await createCustomLevel(input);
      }),
  }),
  golden: t.router({
    // Create a golden challenge (mod/creator)
    create: publicProcedure
      .input(z.object({
        title: z.string().min(1).max(80),
        brandName: z.string().min(1).max(40),
        message: z.string().min(5).max(500),
        rewards: z.array(z.object({
          wordIndex: z.number().int().min(0),
          type: z.enum(['coupon', 'secret', 'giveaway', 'message']),
          value: z.string().min(1).max(200),
          description: z.string().min(1).max(100),
          affiliateLink: z.string().url().max(500).optional(),
        })).min(1).max(10),
        tier: z.enum(['golden', 'diamond', 'legendary']).default('golden'),
        maxClaims: z.number().int().min(1).max(10000).default(100),
        durationDays: z.number().int().min(1).max(90).default(7),
        brandLink: z.string().url().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const username = await reddit.getCurrentUsername();
        if (!username) return { success: false, message: 'Not logged in' };
        if (!checkRateLimit(`golden:create:${username}`)) {
          return { success: false, message: 'Too many challenges created. Please wait.' };
        }
        const subredditName = context.subredditName ?? 'unknown';
        return await createGoldenChallenge({ ...input, subredditName });
      }),

    // Get a specific golden challenge (safe — strips reward values for non-creators)
    get: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ input }) => {
        const challenge = await getGoldenChallenge(input.challengeId);
        if (!challenge) return null;
        // Strip reward values — players shouldn't see them until claimed
        const safeRewardWords: Record<number, { id: string; type: string; description: string }> = {};
        for (const [idx, reward] of Object.entries(challenge.rewardWords)) {
          safeRewardWords[Number(idx)] = { id: reward.id, type: reward.type, description: reward.description };
        }
        return {
          ...challenge,
          rewardWords: safeRewardWords,
        };
      }),

    // Get golden challenge for a post
    getForPost: publicProcedure
      .input(z.object({ postId: z.string() }))
      .query(async ({ input }) => {
        const challenge = await getGoldenChallengeForPost(input.postId);
        if (!challenge) return { challenge: null, isGolden: false, hasPlayed: false };

        // Check if user already played this challenge (once-per-user)
        const alreadyPlayed = await hasUserPlayedGolden(challenge.id);

        // Original reward indices from the challenge creator
        const originalRewardIndices = Object.keys(challenge.rewardWords).map(Number);
        const rewardCount = originalRewardIndices.length;

        // Shuffle: pick `rewardCount` random positions from all word indices each play.
        const allIndices = challenge.words.map((_, i) => i);
        const shuffled = [...allIndices].sort(() => Math.random() - 0.5);
        const shuffledRewardIndices = shuffled.slice(0, rewardCount);

        const rewardMap: Record<number, number> = {};
        shuffledRewardIndices.forEach((shuffledIdx, i) => {
          rewardMap[shuffledIdx] = originalRewardIndices[i]!;
        });

        return {
          challenge: {
            id: challenge.id,
            title: challenge.title,
            brandName: challenge.brandName,
            words: challenge.words,
            tier: challenge.tier,
            rewardIndices: shuffledRewardIndices,
            rewardMap,
            fullMessage: challenge.words.join(' '),
            status: challenge.status,
            brandLink: challenge.brandLink ?? null,
          },
          isGolden: true,
          hasPlayed: alreadyPlayed,
        };
      }),

    // List active golden challenges
    listActive: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(20).default(10) }).optional())
      .query(async ({ input }) => {
        return await getActiveGoldenChallenges(input?.limit ?? 10);
      }),

    // Claim a reward when player types a reward word
    claimReward: publicProcedure
      .input(z.object({
        challengeId: z.string(),
        wordIndex: z.number().int().min(0),
        originalWordIndex: z.number().int().min(0), // the original reward index (from rewardMap)
      }))
      .mutation(async ({ input }) => {
        // Use the originalWordIndex to claim the actual reward
        return await claimReward(input.challengeId, input.originalWordIndex);
      }),

    // Get user's vault
    getVault: publicProcedure.query(async () => {
      return await getUserVault();
    }),

    // Mark a vault item as redeemed
    redeemVaultItem: publicProcedure
      .input(z.object({ itemId: z.string() }))
      .mutation(async ({ input }) => {
        const success = await markVaultItemRedeemed(input.itemId);
        return { success };
      }),

    // Get user's claimed rewards for a challenge (to know which words are already claimed)
    getClaimedRewards: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ input }) => {
        return await getUserClaimedRewards(input.challengeId);
      }),

    // Record a golden challenge play (analytics)
    recordPlay: publicProcedure
      .input(z.object({ challengeId: z.string(), completed: z.boolean() }))
      .mutation(async ({ input }) => {
        await recordGoldenPlay(input.challengeId, input.completed);
        return { success: true };
      }),

    // Get analytics for a challenge
    getAnalytics: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ input }) => {
        return await getGoldenChallengeAnalytics(input.challengeId);
      }),

    // Get user's token balance (purchased via Reddit Gold)
    getTokenBalance: publicProcedure.query(async () => {
      const username = await reddit.getCurrentUsername();
      if (!username) return { golden: 0, diamond: 0, legendary: 0 };
      return await getTokenBalance(username);
    }),

    // Check if current user is a golden challenge creator
    isCreator: publicProcedure.query(async () => {
      return { isCreator: await isGoldenCreator() };
    }),

    // Creator dashboard — only returns data for the calling user's own challenges
    getCreatorDashboard: publicProcedure.query(async () => {
      return await getCreatorDashboard();
    }),

    // Check if user has already played a golden challenge
    hasPlayed: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ input }) => {
        return { hasPlayed: await hasUserPlayedGolden(input.challengeId) };
      }),

    // Track brand link click (diamond + legendary)
    trackBrandClick: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .mutation(async ({ input }) => {
        const url = await trackBrandLinkClick(input.challengeId);
        return { url };
      }),

    // Track affiliate link click (legendary)
    trackAffiliateClick: publicProcedure
      .input(z.object({ challengeId: z.string(), rewardId: z.string() }))
      .mutation(async ({ input }) => {
        const url = await trackAffiliateLinkClick(input.challengeId, input.rewardId);
        return { url };
      }),

    // Get tier limits (for client-side form validation)
    getTierLimits: publicProcedure.query(() => {
      return TIER_LIMITS;
    }),
  }),
});

export type AppRouter = typeof appRouter;
