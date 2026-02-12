import { redis, reddit } from '@devvit/web/server';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LevelData {
  id: string;
  words: string[];
  title: string;
  creatorName: string;
  sourceType: 'post' | 'comment' | 'remix' | 'custom';
  sourceId: string;
  originalLevelId?: string; // for remixes
  originalCreator?: string;
  createdAt: number;
  plays: number;
  totalRating: number;
  ratingCount: number;
}

export interface LevelSummary {
  id: string;
  title: string;
  creatorName: string;
  wordCount: number;
  plays: number;
  avgRating: number;
  ratingCount: number;
  isRemix: boolean;
}

export interface CreatorStats {
  username: string;
  levelsCreated: number;
  totalPlays: number;
  totalRatings: number;
  avgRating: number;
  badges: string[];
}

// ── Redis Keys ─────────────────────────────────────────────────────────────

const LEVEL_KEY = (id: string) => `ugc:level:${id}`;
const LEVEL_GALLERY_BY_PLAYS = 'ugc:gallery:byPlays';
const LEVEL_GALLERY_BY_RATING = 'ugc:gallery:byRating';
const LEVEL_RATING_USER = (levelId: string, username: string) =>
  `ugc:rating:${levelId}:${username}`;
const CREATOR_STATS_KEY = (username: string) => `ugc:creator:${username}`;
const CREATOR_LEADERBOARD_PLAYS = 'ugc:creators:byPlays';
const CREATOR_LEADERBOARD_RATINGS = 'ugc:creators:byRatings';
const FEATURED_LEVELS = 'ugc:featured';

// ── Level CRUD ─────────────────────────────────────────────────────────────

function generateLevelId(): string {
  return `lvl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createLevel(opts: {
  words: string[];
  title: string;
  creatorName: string;
  sourceType: 'post' | 'comment' | 'remix' | 'custom';
  sourceId: string;
  originalLevelId?: string;
  originalCreator?: string;
}): Promise<LevelData> {
  const id = generateLevelId();
  const level: LevelData = {
    id,
    words: opts.words,
    title: opts.title,
    creatorName: opts.creatorName,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    originalLevelId: opts.originalLevelId,
    originalCreator: opts.originalCreator,
    createdAt: Date.now(),
    plays: 0,
    totalRating: 0,
    ratingCount: 0,
  };

  await redis.set(LEVEL_KEY(id), JSON.stringify(level));
  // Add to gallery sorted sets (score 0 initially)
  await redis.zAdd(LEVEL_GALLERY_BY_PLAYS, { member: id, score: 0 });
  await redis.zAdd(LEVEL_GALLERY_BY_RATING, { member: id, score: 0 });

  // Update creator stats
  await incrementCreatorStat(opts.creatorName, 'levelsCreated', 1);

  return level;
}

export async function getLevel(id: string): Promise<LevelData | null> {
  try {
    const raw = await redis.get(LEVEL_KEY(id));
    if (!raw) return null;
    return JSON.parse(raw) as LevelData;
  } catch {
    return null;
  }
}

// ── Gallery Browsing ───────────────────────────────────────────────────────

export async function getGalleryLevels(
  sortBy: 'plays' | 'rating' = 'plays',
  offset: number = 0,
  limit: number = 10
): Promise<LevelSummary[]> {
  const key = sortBy === 'plays' ? LEVEL_GALLERY_BY_PLAYS : LEVEL_GALLERY_BY_RATING;
  try {
    const entries = await redis.zRange(key, offset, offset + limit - 1, {
      by: 'rank',
      reverse: true,
    });

    const levels: LevelSummary[] = [];
    for (const entry of entries) {
      const level = await getLevel(entry.member);
      if (level) {
        levels.push({
          id: level.id,
          title: level.title,
          creatorName: level.creatorName,
          wordCount: level.words.length,
          plays: level.plays,
          avgRating: level.ratingCount > 0 ? level.totalRating / level.ratingCount : 0,
          ratingCount: level.ratingCount,
          isRemix: level.sourceType === 'remix',
        });
      }
    }
    return levels;
  } catch (err) {
    console.error('Failed to get gallery levels:', err);
    return [];
  }
}

export async function getFeaturedLevels(limit: number = 5): Promise<LevelSummary[]> {
  try {
    const entries = await redis.zRange(FEATURED_LEVELS, 0, limit - 1, {
      by: 'rank',
      reverse: true,
    });
    const levels: LevelSummary[] = [];
    for (const entry of entries) {
      const level = await getLevel(entry.member);
      if (level) {
        levels.push({
          id: level.id,
          title: level.title,
          creatorName: level.creatorName,
          wordCount: level.words.length,
          plays: level.plays,
          avgRating: level.ratingCount > 0 ? level.totalRating / level.ratingCount : 0,
          ratingCount: level.ratingCount,
          isRemix: level.sourceType === 'remix',
        });
      }
    }
    return levels;
  } catch {
    return [];
  }
}

// ── Play Tracking ──────────────────────────────────────────────────────────

export async function recordPlay(levelId: string): Promise<void> {
  try {
    const level = await getLevel(levelId);
    if (!level) return;

    level.plays += 1;
    await redis.set(LEVEL_KEY(levelId), JSON.stringify(level));
    await redis.zAdd(LEVEL_GALLERY_BY_PLAYS, { member: levelId, score: level.plays });

    // Update creator stats
    await incrementCreatorStat(level.creatorName, 'totalPlays', 1);

    // Auto-feature levels with 10+ plays and 4+ avg rating
    if (level.plays >= 10 && level.ratingCount > 0) {
      const avg = level.totalRating / level.ratingCount;
      if (avg >= 4) {
        await redis.zAdd(FEATURED_LEVELS, { member: levelId, score: avg * level.plays });
      }
    }
  } catch (err) {
    console.error('Failed to record play:', err);
  }
}

// ── Ratings ────────────────────────────────────────────────────────────────

export async function rateLevel(
  levelId: string,
  rating: number
): Promise<{ avgRating: number; ratingCount: number } | null> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return null;

    // Clamp rating 1-5
    rating = Math.max(1, Math.min(5, Math.round(rating)));

    const ratingKey = LEVEL_RATING_USER(levelId, username);
    const existingRating = await redis.get(ratingKey);

    const level = await getLevel(levelId);
    if (!level) return null;

    if (existingRating) {
      // Update: subtract old, add new
      const oldRating = parseInt(existingRating);
      level.totalRating = level.totalRating - oldRating + rating;
    } else {
      level.totalRating += rating;
      level.ratingCount += 1;
      // Update creator stats
      await incrementCreatorStat(level.creatorName, 'totalRatings', 1);
    }

    await redis.set(ratingKey, rating.toString());
    await redis.set(LEVEL_KEY(levelId), JSON.stringify(level));

    const avgRating = level.ratingCount > 0 ? level.totalRating / level.ratingCount : 0;
    await redis.zAdd(LEVEL_GALLERY_BY_RATING, { member: levelId, score: avgRating });

    // Update creator avg rating
    await updateCreatorAvgRating(level.creatorName);

    // Auto-feature check
    if (level.plays >= 10 && avgRating >= 4) {
      await redis.zAdd(FEATURED_LEVELS, { member: levelId, score: avgRating * level.plays });
    }

    return { avgRating, ratingCount: level.ratingCount };
  } catch (err) {
    console.error('Failed to rate level:', err);
    return null;
  }
}

export async function getUserRating(levelId: string): Promise<number | null> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return null;
    const val = await redis.get(LEVEL_RATING_USER(levelId, username));
    return val ? parseInt(val) : null;
  } catch {
    return null;
  }
}

// ── Creator Stats & Leaderboard ────────────────────────────────────────────

async function incrementCreatorStat(username: string, field: string, amount: number): Promise<void> {
  try {
    const key = CREATOR_STATS_KEY(username);
    const existing = await redis.hGetAll(key);
    const current = parseInt(existing?.[field] ?? '0');
    await redis.hSet(key, { [field]: (current + amount).toString() });

    // Update leaderboards
    if (field === 'totalPlays') {
      await redis.zAdd(CREATOR_LEADERBOARD_PLAYS, {
        member: username,
        score: current + amount,
      });
    }
  } catch (err) {
    console.error('Failed to increment creator stat:', err);
  }
}

async function updateCreatorAvgRating(username: string): Promise<void> {
  try {
    const key = CREATOR_STATS_KEY(username);
    const data = await redis.hGetAll(key);
    const totalRatings = parseInt(data?.totalRatings ?? '0');
    if (totalRatings > 0) {
      await redis.zAdd(CREATOR_LEADERBOARD_RATINGS, {
        member: username,
        score: totalRatings,
      });
    }
  } catch (err) {
    console.error('Failed to update creator avg rating:', err);
  }
}

export async function getCreatorStats(username: string): Promise<CreatorStats | null> {
  try {
    const key = CREATOR_STATS_KEY(username);
    const data = await redis.hGetAll(key);
    if (!data || Object.keys(data).length === 0) return null;

    const levelsCreated = parseInt(data.levelsCreated ?? '0');
    const totalPlays = parseInt(data.totalPlays ?? '0');
    const totalRatings = parseInt(data.totalRatings ?? '0');

    // Compute badges
    const badges: string[] = [];
    if (levelsCreated >= 10) badges.push('Level Architect');
    if (levelsCreated >= 25) badges.push('Master Builder');
    if (totalPlays >= 100) badges.push('Community Favorite');
    if (totalPlays >= 500) badges.push('Viral Creator');
    if (totalRatings >= 50) badges.push('Well Reviewed');

    return {
      username,
      levelsCreated,
      totalPlays,
      totalRatings,
      avgRating: 0, // simplified — would need aggregation across all levels
      badges,
    };
  } catch {
    return null;
  }
}

export async function getCreatorLeaderboard(
  sortBy: 'plays' | 'ratings' = 'plays',
  limit: number = 10
): Promise<{ username: string; score: number }[]> {
  const key = sortBy === 'plays' ? CREATOR_LEADERBOARD_PLAYS : CREATOR_LEADERBOARD_RATINGS;
  try {
    const entries = await redis.zRange(key, 0, limit - 1, { by: 'rank', reverse: true });
    return entries.map((e) => ({ username: e.member, score: e.score }));
  } catch {
    return [];
  }
}

// ── Create Custom Level (in-app) ────────────────────────────────────────────

export async function createCustomLevel(opts: {
  title: string;
  words: string[];
}): Promise<{
  success: boolean;
  message: string;
  levelId?: string;
  postId?: string;
  wordCount?: number;
}> {
  try {
    const creatorName = await reddit.getCurrentUsername() ?? 'anonymous';

    // Validate & clean words
    const cleaned = opts.words
      .map((w) => w.replace(/[^a-zA-Z]/g, '').toUpperCase())
      .filter((w) => w.length >= 2 && w.length <= 14 && /^[A-Z]+$/.test(w));

    const unique = [...new Set(cleaned)];
    if (unique.length < 3) {
      return { success: false, message: 'Need at least 3 valid words (letters only, 2-14 chars)' };
    }

    const levelWords = unique.slice(0, 15);
    const title = opts.title.trim().slice(0, 60) || `Level by ${creatorName}`;

    const level = await createLevel({
      words: levelWords,
      title,
      creatorName,
      sourceType: 'custom',
      sourceId: `custom_${Date.now()}`,
    });

    // Create a game post for this level
    const gamePost = await reddit.submitCustomPost({
      title: `⌨️ Typeers Level by u/${creatorName}: ${title.slice(0, 40)}`,
      entry: 'default',
    });

    await redis.set(`post:${gamePost.id}:ugcLevel`, level.id);

    // Auto-post challenge comment
    try {
      await reddit.submitComment({
        id: gamePost.id as `t3_${string}`,
        text: `🎮 **New Typing Challenge!** u/${creatorName} created a custom level with ${levelWords.length} words. Think you can type them all? Drop your score below! ⌨️`,
      });
    } catch (e) {
      console.error('Failed to post challenge comment:', e);
    }

    return {
      success: true,
      message: `Level published with ${levelWords.length} words!`,
      levelId: level.id,
      postId: gamePost.id,
      wordCount: levelWords.length,
    };
  } catch (error) {
    console.error('Error creating custom level:', error);
    return { success: false, message: 'Failed to create level' };
  }
}

// ── Create Level from Post ─────────────────────────────────────────────────

export async function createLevelFromPost(postId: string): Promise<{
  success: boolean;
  message: string;
  levelId?: string;
  postId?: string;
  wordCount?: number;
}> {
  try {
    const fullId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
    const post = await reddit.getPostById(fullId as `t3_${string}`);
    if (!post) {
      return { success: false, message: 'Post not found' };
    }

    // Extract words from title + body
    const text = `${post.title} ${post.body ?? ''}`;
    const words = text
      .split(/\s+/)
      .map((w: string) => w.replace(/[^a-zA-Z]/g, '').toUpperCase())
      .filter((w: string) => w.length >= 3 && w.length <= 14 && /^[A-Z]+$/.test(w));

    // Remove duplicates
    const unique = [...new Set(words)];

    if (unique.length < 3) {
      return { success: false, message: 'Post needs at least 3 valid words (3+ letters, alpha only)' };
    }

    const levelWords = unique.slice(0, 15);
    const creatorName = await reddit.getCurrentUsername() ?? 'anonymous';

    const level = await createLevel({
      words: levelWords,
      title: post.title.slice(0, 60),
      creatorName,
      sourceType: 'post',
      sourceId: postId,
    });

    // Create a game post for this level
    const gamePost = await reddit.submitCustomPost({
      title: `⌨️ Typeers Level by u/${creatorName}: ${post.title.slice(0, 40)}`,
      entry: 'default',
    });

    // Link the level to the game post
    await redis.set(`post:${gamePost.id}:ugcLevel`, level.id);

    // Auto-post challenge comment on the new game post
    try {
      await reddit.submitComment({
        id: gamePost.id as `t3_${string}`,
        text: `🎮 **New Typing Challenge!** This level has ${levelWords.length} words from "${post.title.slice(0, 50)}". Created by u/${creatorName}. Can you type them all? Drop your score below! ⌨️`,
      });
    } catch (e) {
      console.error('Failed to post challenge comment:', e);
    }

    return {
      success: true,
      message: `Level created with ${levelWords.length} words!`,
      levelId: level.id,
      postId: gamePost.id,
      wordCount: levelWords.length,
    };
  } catch (error) {
    console.error('Error creating level from post:', error);
    return { success: false, message: 'Failed to create level from post' };
  }
}

// ── Remix ──────────────────────────────────────────────────────────────────

export async function remixLevel(
  originalLevelId: string,
  newWords: string[]
): Promise<{ success: boolean; message: string; levelId?: string; postId?: string }> {
  try {
    const original = await getLevel(originalLevelId);
    if (!original) return { success: false, message: 'Original level not found' };

    const creatorName = await reddit.getCurrentUsername() ?? 'anonymous';

    const level = await createLevel({
      words: newWords.map((w) => w.toUpperCase()).slice(0, 15),
      title: `Remix of "${original.title}"`,
      creatorName,
      sourceType: 'remix',
      sourceId: originalLevelId,
      originalLevelId,
      originalCreator: original.creatorName,
    });

    const gamePost = await reddit.submitCustomPost({
      title: `⌨️ Typeers Remix by u/${creatorName} (original by u/${original.creatorName})`,
      entry: 'default',
    });

    await redis.set(`post:${gamePost.id}:ugcLevel`, level.id);

    return {
      success: true,
      message: `Remix created with ${level.words.length} words!`,
      levelId: level.id,
      postId: gamePost.id,
    };
  } catch (error) {
    console.error('Error remixing level:', error);
    return { success: false, message: 'Failed to remix level' };
  }
}

// ── Create Level from Comment ───────────────────────────────────────────────

export async function createLevelFromComment(commentId: string): Promise<{
  success: boolean;
  message: string;
  levelId?: string;
  postId?: string;
  wordCount?: number;
}> {
  try {
    const fullId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
    const comment = await reddit.getCommentById(fullId as `t1_${string}`);
    if (!comment) {
      return { success: false, message: 'Comment not found' };
    }

    const words = comment.body
      .split(/\s+/)
      .map((w: string) => w.replace(/[^a-zA-Z]/g, '').toUpperCase())
      .filter((w: string) => w.length >= 3 && w.length <= 14 && /^[A-Z]+$/.test(w));

    const unique = [...new Set(words)];
    if (unique.length < 3) {
      return { success: false, message: 'Comment needs at least 3 valid words (3+ letters)' };
    }

    const levelWords = unique.slice(0, 15);
    const creatorName = await reddit.getCurrentUsername() ?? 'anonymous';

    const level = await createLevel({
      words: levelWords,
      title: `From u/${comment.authorName}'s comment`,
      creatorName,
      sourceType: 'comment',
      sourceId: commentId,
    });

    // Create game post
    const gamePost = await reddit.submitCustomPost({
      title: `⌨️ Typeers Level by u/${creatorName} — ${levelWords.length} words`,
      entry: 'default',
    });

    await redis.set(`post:${gamePost.id}:ugcLevel`, level.id);

    // Auto-post challenge comment on the new game post
    try {
      await reddit.submitComment({
        id: gamePost.id as `t3_${string}`,
        text: `🎮 **New Typing Challenge!** This level has ${levelWords.length} words extracted from a comment by u/${comment.authorName}. Can you type them all before time runs out? Drop your score below! ⌨️`,
      });
    } catch (e) {
      console.error('Failed to post challenge comment:', e);
    }

    return {
      success: true,
      message: `Level created with ${levelWords.length} words!`,
      levelId: level.id,
      postId: gamePost.id,
      wordCount: levelWords.length,
    };
  } catch (error) {
    console.error('Error creating level from comment:', error);
    return { success: false, message: 'Failed to create level from comment' };
  }
}

// ── Get UGC level for a post ───────────────────────────────────────────────

export async function getUgcLevelForPost(postId: string): Promise<LevelData | null> {
  try {
    const levelId = await redis.get(`post:${postId}:ugcLevel`);
    if (!levelId) return null;
    return await getLevel(levelId);
  } catch {
    return null;
  }
}

// ── Level of the Day ───────────────────────────────────────────────────────

export async function getLevelOfTheDay(): Promise<LevelSummary | null> {
  try {
    // Pick from featured first, fall back to most played
    const featured = await redis.zRange(FEATURED_LEVELS, 0, 19, { by: 'rank', reverse: true });
    const pool = featured.length > 0
      ? featured
      : await redis.zRange(LEVEL_GALLERY_BY_PLAYS, 0, 19, { by: 'rank', reverse: true });

    if (pool.length === 0) return null;

    // Use date seed for consistent daily pick
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    const index = seed % pool.length;
    const entry = pool[index];
    if (!entry) return null;

    const level = await getLevel(entry.member);
    if (!level) return null;

    return {
      id: level.id,
      title: level.title,
      creatorName: level.creatorName,
      wordCount: level.words.length,
      plays: level.plays,
      avgRating: level.ratingCount > 0 ? level.totalRating / level.ratingCount : 0,
      ratingCount: level.ratingCount,
      isRemix: level.sourceType === 'remix',
    };
  } catch {
    return null;
  }
}

// ── Get levels by a specific creator ───────────────────────────────────────

export async function getLevelsByCreator(
  username: string,
  limit: number = 10
): Promise<LevelSummary[]> {
  // Scan gallery and filter — not ideal at scale but fine for now
  try {
    const all = await redis.zRange(LEVEL_GALLERY_BY_PLAYS, 0, 99, { by: 'rank', reverse: true });
    const levels: LevelSummary[] = [];
    for (const entry of all) {
      if (levels.length >= limit) break;
      const level = await getLevel(entry.member);
      if (level && level.creatorName === username) {
        levels.push({
          id: level.id,
          title: level.title,
          creatorName: level.creatorName,
          wordCount: level.words.length,
          plays: level.plays,
          avgRating: level.ratingCount > 0 ? level.totalRating / level.ratingCount : 0,
          ratingCount: level.ratingCount,
          isRemix: level.sourceType === 'remix',
        });
      }
    }
    return levels;
  } catch {
    return [];
  }
}
