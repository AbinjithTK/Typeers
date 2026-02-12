import { redis, reddit } from '@devvit/web/server';

// Get the current tournament week key (ISO week-based: YYYY-Www)
export function getCurrentWeekKey(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Get the previous tournament week key
export function getPreviousWeekKey(): string {
  const now = new Date();
  const lastWeek = new Date(now.getTime() - 7 * 86400000);
  const jan1 = new Date(lastWeek.getFullYear(), 0, 1);
  const days = Math.floor((lastWeek.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${lastWeek.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function tournamentLeaderboardKey(weekKey: string): string {
  return `tournament:${weekKey}`;
}

function tournamentPostKey(weekKey: string): string {
  return `tournament:${weekKey}:postId`;
}

// Submit or update a player's best tournament score for the week
export async function submitTournamentScore(
  score: number
): Promise<{ weekKey: string; rank: number | null; isNewBest: boolean }> {
  const weekKey = getCurrentWeekKey();
  const key = tournamentLeaderboardKey(weekKey);

  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return { weekKey, rank: null, isNewBest: false };

    const currentScore = await redis.zScore(key, username);
    let isNewBest = false;

    if (currentScore === undefined || score > currentScore) {
      await redis.zAdd(key, { member: username, score });
      await redis.expire(key, 60 * 60 * 24 * 14); // 14 days TTL
      isNewBest = true;
    }

    const totalPlayers = await redis.zCard(key);
    const rankFromBottom = await redis.zRank(key, username);
    const rank = rankFromBottom !== undefined ? totalPlayers - rankFromBottom : null;

    return { weekKey, rank, isNewBest };
  } catch (err) {
    console.error('Failed to submit tournament score:', err);
    return { weekKey, rank: null, isNewBest: false };
  }
}

// Get tournament leaderboard for a given week
export async function getTournamentLeaderboard(
  weekKey?: string,
  limit: number = 10
): Promise<{ username: string; score: number }[]> {
  const key = tournamentLeaderboardKey(weekKey ?? getCurrentWeekKey());

  try {
    const entries = await redis.zRange(key, 0, limit - 1, { by: 'rank', reverse: true });
    return entries.map((entry) => ({
      username: entry.member,
      score: entry.score,
    }));
  } catch (err) {
    console.error('Failed to get tournament leaderboard:', err);
    return [];
  }
}

// Get a user's tournament stats for the current week
export async function getUserTournamentStats(): Promise<{
  weekKey: string;
  bestScore: number | null;
  rank: number | null;
  totalPlayers: number;
} | null> {
  const weekKey = getCurrentWeekKey();
  const key = tournamentLeaderboardKey(weekKey);

  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return null;

    const bestScore = await redis.zScore(key, username);
    const totalPlayers = await redis.zCard(key);
    const rankFromBottom = await redis.zRank(key, username);
    const rank = rankFromBottom !== undefined ? totalPlayers - rankFromBottom : null;

    return {
      weekKey,
      bestScore: bestScore ?? null,
      rank,
      totalPlayers,
    };
  } catch (err) {
    console.error('Failed to get user tournament stats:', err);
    return null;
  }
}

// Create the weekly tournament post and sticky it
export async function createTournamentPost(): Promise<{ postId: string } | null> {
  const weekKey = getCurrentWeekKey();
  const postIdKey = tournamentPostKey(weekKey);

  try {
    // Check if we already created a post for this week
    const existingPostId = await redis.get(postIdKey);
    if (existingPostId) {
      console.log(`Tournament post already exists for ${weekKey}: ${existingPostId}`);
      return { postId: existingPostId };
    }

    // Step 1: Create the new tournament post FIRST (most important step)
    console.log(`Creating tournament post for ${weekKey}...`);
    const post = await reddit.submitCustomPost({
      title: `🏆 Weekly Tournament — ${weekKey} — Compete for the top spot!`,
      entry: 'default',
    });
    console.log(`Tournament post created: ${post.id}`);

    // Step 2: Store the post ID immediately so we don't create duplicates
    await redis.set(postIdKey, post.id);
    await redis.expire(postIdKey, 60 * 60 * 24 * 14);

    // Step 3: Store that this post is a tournament post
    await redis.set(`post:${post.id}:tournament`, weekKey);

    // Step 4: Try to sticky and distinguish (non-critical — failures won't break anything)
    try {
      await post.sticky(1);
      console.log('Tournament post stickied');
    } catch (e) {
      console.error('Failed to sticky tournament post (non-critical):', e);
    }

    try {
      await post.distinguish();
      console.log('Tournament post distinguished');
    } catch (e) {
      console.error('Failed to distinguish tournament post (non-critical):', e);
    }

    // Step 5: Handle previous week's post (non-critical)
    try {
      const prevWeekKey = getPreviousWeekKey();
      const prevPostId = await redis.get(tournamentPostKey(prevWeekKey));
      if (prevPostId) {
        try {
          const prevPost = await reddit.getPostById(prevPostId as `t3_${string}`);
          await prevPost.unsticky();
          console.log(`Previous tournament post ${prevPostId} unstickied`);
        } catch (e) {
          console.error('Failed to unsticky previous tournament post (non-critical):', e);
        }

        // Post final results as a comment on the previous post
        try {
          const finalLeaderboard = await getTournamentLeaderboard(prevWeekKey, 10);
          if (finalLeaderboard.length > 0) {
            const lines = finalLeaderboard.map(
              (e, i) => `${i + 1}. u/${e.username} — ${e.score} pts`
            );
            await reddit.submitComment({
              id: prevPostId as `t3_${string}`,
              text: `🏆 **Final Results for ${prevWeekKey}**\n\n${lines.join('\n')}\n\nCongrats to the winners! A new tournament has started.`,
            });
          }
        } catch (e) {
          console.error('Failed to post final results comment (non-critical):', e);
        }
      }
    } catch (e) {
      console.error('Failed to handle previous week post (non-critical):', e);
    }

    return { postId: post.id };
  } catch (err) {
    console.error('Failed to create tournament post:', err);
    return null;
  }
}

// Check if a post is a tournament post
export async function isTournamentPost(postId: string): Promise<string | null> {
  try {
    return (await redis.get(`post:${postId}:tournament`)) ?? null;
  } catch {
    return null;
  }
}

// Get the current week's tournament post ID
export async function getCurrentTournamentPostId(): Promise<string | null> {
  const weekKey = getCurrentWeekKey();
  try {
    return (await redis.get(tournamentPostKey(weekKey))) ?? null;
  } catch {
    return null;
  }
}


// ── Tournament Dashboard ───────────────────────────────────────────────────

export interface TournamentDashboard {
  currentWeek: {
    weekKey: string;
    postId: string | null;
    leaderboard: { username: string; score: number }[];
    totalPlayers: number;
    userStats: {
      bestScore: number | null;
      rank: number | null;
    } | null;
  };
  previousWeek: {
    weekKey: string;
    leaderboard: { username: string; score: number }[];
    totalPlayers: number;
    userStats: {
      bestScore: number | null;
      rank: number | null;
    } | null;
  };
}

export async function getTournamentDashboard(): Promise<TournamentDashboard | null> {
  try {
    const username = await reddit.getCurrentUsername();
    const currentWeekKey = getCurrentWeekKey();
    const prevWeekKey = getPreviousWeekKey();

    const currentKey = tournamentLeaderboardKey(currentWeekKey);
    const prevKey = tournamentLeaderboardKey(prevWeekKey);

    // Current week data
    const currentLb = await getTournamentLeaderboard(currentWeekKey, 20);
    const currentTotal = await redis.zCard(currentKey);
    const currentPostId = await getCurrentTournamentPostId();

    let currentUserStats: { bestScore: number | null; rank: number | null } | null = null;
    if (username) {
      const score = await redis.zScore(currentKey, username);
      const rankFromBottom = await redis.zRank(currentKey, username);
      const rank = rankFromBottom !== undefined ? currentTotal - rankFromBottom : null;
      currentUserStats = { bestScore: score ?? null, rank };
    }

    // Previous week data
    const prevLb = await getTournamentLeaderboard(prevWeekKey, 20);
    const prevTotal = await redis.zCard(prevKey);

    let prevUserStats: { bestScore: number | null; rank: number | null } | null = null;
    if (username) {
      const score = await redis.zScore(prevKey, username);
      const rankFromBottom = await redis.zRank(prevKey, username);
      const rank = rankFromBottom !== undefined ? prevTotal - rankFromBottom : null;
      prevUserStats = { bestScore: score ?? null, rank };
    }

    return {
      currentWeek: {
        weekKey: currentWeekKey,
        postId: currentPostId,
        leaderboard: currentLb,
        totalPlayers: currentTotal,
        userStats: currentUserStats,
      },
      previousWeek: {
        weekKey: prevWeekKey,
        leaderboard: prevLb,
        totalPlayers: prevTotal,
        userStats: prevUserStats,
      },
    };
  } catch (err) {
    console.error('Failed to get tournament dashboard:', err);
    return null;
  }
}
