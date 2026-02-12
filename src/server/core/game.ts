import { redis, reddit, context as serverContext } from '@devvit/web/server';

// Word categories
export interface WordCategory {
  id: string;
  name: string;
  emoji: string;
  words: string[];
}

const WORD_CATEGORIES: WordCategory[] = [
  {
    id: 'reddit',
    name: 'REDDIT',
    emoji: '🤖',
    words: [
      'REDDIT', 'KARMA', 'UPVOTE', 'DOWNVOTE', 'COMMENT', 'POST', 'AWARD',
      'SNOO', 'GOLD', 'SILVER', 'PLATINUM', 'MODERATOR', 'SUBREDDIT',
      'THREAD', 'REPLY', 'SHARE', 'SAVE', 'HIDE', 'REPORT', 'BLOCK',
      'COMMUNITY', 'RULES', 'FLAIR', 'CROSSPOST', 'REPOST', 'ORIGINAL',
      'MEME', 'VIRAL', 'TRENDING', 'POPULAR', 'RISING', 'CONTROVERSIAL',
      'WHOLESOME', 'HELPFUL', 'PREMIUM', 'COINS', 'AVATAR',
    ],
  },
  {
    id: 'tech',
    name: 'TECH',
    emoji: '💻',
    words: [
      'REACT', 'TYPESCRIPT', 'JAVASCRIPT', 'PYTHON', 'DOCKER', 'LINUX',
      'GITHUB', 'DEPLOY', 'SERVER', 'CLIENT', 'DATABASE', 'QUERY',
      'FUNCTION', 'VARIABLE', 'BOOLEAN', 'STRING', 'ARRAY', 'OBJECT',
      'COMPILE', 'DEBUG', 'RUNTIME', 'WEBPACK', 'NODEJS', 'BROWSER',
      'PIXEL', 'BINARY', 'KERNEL', 'CACHE', 'ASYNC', 'PROMISE',
      'DEVVIT', 'PHASER', 'WEBVIEW', 'MOBILE', 'DESKTOP', 'HACKATHON',
    ],
  },
  {
    id: 'animals',
    name: 'ANIMALS',
    emoji: '🐾',
    words: [
      'DOLPHIN', 'PENGUIN', 'GIRAFFE', 'ELEPHANT', 'TIGER', 'FALCON',
      'OCTOPUS', 'PANTHER', 'CHEETAH', 'GORILLA', 'HAMSTER', 'PARROT',
      'TURTLE', 'RABBIT', 'SALMON', 'JAGUAR', 'LIZARD', 'MONKEY',
      'WALRUS', 'BADGER', 'COYOTE', 'FERRET', 'IGUANA', 'MANTIS',
      'OSPREY', 'PYTHON', 'TOUCAN', 'ALPACA', 'BISON', 'COBRA',
      'EAGLE', 'HERON', 'KOALA', 'LEMUR', 'OTTER', 'RAVEN',
    ],
  },
  {
    id: 'gaming',
    name: 'GAMING',
    emoji: '🎮',
    words: [
      'RESPAWN', 'HITBOX', 'COMBO', 'SHIELD', 'POTION', 'DUNGEON',
      'DRAGON', 'WIZARD', 'KNIGHT', 'ARCHER', 'ROGUE', 'HEALER',
      'QUEST', 'LOOT', 'SPAWN', 'LEVEL', 'BOSS', 'ARMOR',
      'MANA', 'GUILD', 'RAID', 'CRAFT', 'FORGE', 'SKILL',
      'STEALTH', 'PORTAL', 'GOBLIN', 'ZOMBIE', 'DEMON', 'TITAN',
      'NEXUS', 'REALM', 'TOWER', 'SIEGE', 'FLANK', 'CLUTCH',
    ],
  },
  {
    id: 'space',
    name: 'SPACE',
    emoji: '🚀',
    words: [
      'GALAXY', 'NEBULA', 'QUASAR', 'PULSAR', 'COMET', 'ORBIT',
      'ROCKET', 'SATURN', 'MARS', 'VENUS', 'PLUTO', 'LUNAR',
      'SOLAR', 'METEOR', 'COSMIC', 'PHOTON', 'PLASMA', 'GRAVITY',
      'ECLIPSE', 'STELLAR', 'NEUTRON', 'FUSION', 'WORMHOLE', 'ASTEROID',
      'CAPSULE', 'MISSION', 'LAUNCH', 'THRUST', 'PROBE', 'SIGNAL',
      'ZENITH', 'AURORA', 'CRATER', 'DWARF', 'FLARE', 'TITAN',
    ],
  },
];

// Legacy flat dictionary (used for daily challenge — pulls from all categories)
const WORD_DICTIONARY = WORD_CATEGORIES.flatMap(c => c.words);

// Remove duplicates
const UNIQUE_WORDS = [...new Set(WORD_DICTIONARY)];

// Simple seeded random for consistent daily words
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function getDateSeed(): number {
  const today = new Date();
  return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
}

export function getTodayKey(): string {
  const parts = new Date().toISOString().split('T');
  return parts[0] ?? new Date().toDateString();
}

export async function getDailyWords(): Promise<string[]> {
  const seed = getDateSeed();
  const random = seededRandom(seed);
  
  // Shuffle and pick 10 words for the daily challenge
  const shuffled = [...UNIQUE_WORDS].sort(() => random() - 0.5);
  return shuffled.slice(0, 10);
}

export function getCategories(): { id: string; name: string; emoji: string }[] {
  return WORD_CATEGORIES.map(({ id, name, emoji }) => ({ id, name, emoji }));
}

export function getWordsByCategory(categoryId: string): string[] {
  const category = WORD_CATEGORIES.find(c => c.id === categoryId);
  if (!category) return [];
  // Shuffle and pick 10
  const shuffled = [...category.words].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 10);
}

export async function getLeaderboard(limit: number = 10): Promise<{ username: string; score: number }[]> {
  const today = getTodayKey();
  const key = `leaderboard:${today}`;
  
  try {
    // Use zRange with reverse to get highest scores first
    const entries = await redis.zRange(key, 0, limit - 1, { by: 'rank', reverse: true });
    return entries.map((entry) => ({
      username: entry.member,
      score: entry.score,
    }));
  } catch (err) {
    console.error('Failed to get leaderboard:', err);
    return [];
  }
}

export async function submitScore(score: number): Promise<{ rank: number | null; isNewHighScore: boolean }> {
  const today = getTodayKey();
  const key = `leaderboard:${today}`;
  
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return { rank: null, isNewHighScore: false };

    // Get current high score for user
    const currentScore = await redis.zScore(key, username);
    let isNewHighScore = false;
    
    // Only update if new score is higher
    if (currentScore === undefined || score > currentScore) {
      await redis.zAdd(key, { member: username, score });
      // Set expiry for 7 days
      await redis.expire(key, 60 * 60 * 24 * 7);
      isNewHighScore = true;
    }

    // Get rank (zRank returns 0-indexed from lowest, so we need to calculate from top)
    const totalPlayers = await redis.zCard(key);
    const rankFromBottom = await redis.zRank(key, username);
    const rank = rankFromBottom !== undefined ? totalPlayers - rankFromBottom : null;
    
    return { rank, isNewHighScore };
  } catch (err) {
    console.error('Failed to submit score:', err);
    return { rank: null, isNewHighScore: false };
  }
}

export async function getUserBestScore(): Promise<number | null> {
  const today = getTodayKey();
  const key = `leaderboard:${today}`;
  
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return null;
    
    const score = await redis.zScore(key, username);
    return score ?? null;
  } catch {
    return null;
  }
}

// Persistent user stats using Redis hashes
export async function updateUserStats(data: {
  score: number;
  wordsTyped: number;
  accuracy: number;
  maxCombo: number;
  wpm: number;
}): Promise<void> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return;

    const key = `stats:${username}`;
    const existing = await redis.hGetAll(key);

    const gamesPlayed = parseInt(existing?.gamesPlayed ?? '0') + 1;
    const totalWordsTyped = parseInt(existing?.totalWordsTyped ?? '0') + data.wordsTyped;
    const allTimeBest = Math.max(parseInt(existing?.allTimeBest ?? '0'), data.score);
    const bestCombo = Math.max(parseInt(existing?.bestCombo ?? '0'), data.maxCombo);
    const bestWpm = Math.max(parseInt(existing?.bestWpm ?? '0'), data.wpm);
    const bestAccuracy = Math.max(parseInt(existing?.bestAccuracy ?? '0'), data.accuracy);

    // Track daily streak
    const today = getTodayKey();
    const lastPlayDate = existing?.lastPlayDate ?? '';
    let streak = parseInt(existing?.streak ?? '0');

    if (lastPlayDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = yesterday.toISOString().split('T')[0] ?? '';

      if (lastPlayDate === yesterdayKey) {
        streak += 1;
      } else {
        streak = 1;
      }
    }

    await redis.hSet(key, {
      gamesPlayed: gamesPlayed.toString(),
      totalWordsTyped: totalWordsTyped.toString(),
      allTimeBest: allTimeBest.toString(),
      bestCombo: bestCombo.toString(),
      bestWpm: bestWpm.toString(),
      bestAccuracy: bestAccuracy.toString(),
      streak: streak.toString(),
      lastPlayDate: today,
    });
  } catch (err) {
    console.error('Failed to update user stats:', err);
  }
}

export async function getUserStats(): Promise<{
  gamesPlayed: number;
  totalWordsTyped: number;
  allTimeBest: number;
  bestCombo: number;
  bestWpm: number;
  bestAccuracy: number;
  streak: number;
} | null> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return null;

    const key = `stats:${username}`;
    const data = await redis.hGetAll(key);
    if (!data || Object.keys(data).length === 0) return null;

    return {
      gamesPlayed: parseInt(data.gamesPlayed ?? '0'),
      totalWordsTyped: parseInt(data.totalWordsTyped ?? '0'),
      allTimeBest: parseInt(data.allTimeBest ?? '0'),
      bestCombo: parseInt(data.bestCombo ?? '0'),
      bestWpm: parseInt(data.bestWpm ?? '0'),
      bestAccuracy: parseInt(data.bestAccuracy ?? '0'),
      streak: parseInt(data.streak ?? '0'),
    };
  } catch (err) {
    console.error('Failed to get user stats:', err);
    return null;
  }
}


// Common English stop words to filter out
const STOP_WORDS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER',
  'WAS', 'ONE', 'OUR', 'OUT', 'HAS', 'HIS', 'HOW', 'ITS', 'LET', 'MAY',
  'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'DID', 'GET', 'HAS', 'HIM',
  'HAD', 'SAY', 'SHE', 'TOO', 'USE', 'DAD', 'MOM', 'WITH', 'HAVE', 'THIS',
  'WILL', 'YOUR', 'FROM', 'THEY', 'BEEN', 'SOME', 'THAN', 'THEM', 'THEN',
  'WHAT', 'WHEN', 'THAT', 'EACH', 'MAKE', 'LIKE', 'JUST', 'OVER', 'SUCH',
  'TAKE', 'INTO', 'MOST', 'ALSO', 'DOES', 'VERY', 'MUCH', 'ABOUT', 'WOULD',
  'STILL', 'THESE', 'OTHER', 'THEIR', 'THERE', 'COULD', 'AFTER', 'WHICH',
  'THOSE', 'BEING', 'WHERE', 'SHOULD', 'BECAUSE', 'REALLY', 'THINK',
]);

function extractWordsFromText(text: string): string[] {
  return text
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z]/g, '').toUpperCase())
    .filter(w => w.length >= 4 && w.length <= 12 && /^[A-Z]+$/.test(w) && !STOP_WORDS.has(w));
}

// Fetch words from the subreddit's top posts, cached daily
export async function getSubredditWords(): Promise<{
  words: string[];
  subredditName: string;
  cached: boolean;
}> {
  const subredditName = serverContext.subredditName ?? 'unknown';
  const today = getTodayKey();
  const cacheKey = `community-words:${subredditName}:${today}`;

  try {
    // Check cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      const words = JSON.parse(cached) as string[];
      // Shuffle and pick 10
      const shuffled = [...words].sort(() => Math.random() - 0.5);
      return { words: shuffled.slice(0, 10), subredditName, cached: true };
    }

    // Fetch top posts from the subreddit
    const posts = await reddit.getTopPosts({
      subredditName,
      timeframe: 'week',
      limit: 50,
    });

    // Collect words from post titles
    const wordFrequency = new Map<string, number>();
    const allPosts = await posts.all();

    for (const post of allPosts) {
      const words = extractWordsFromText(post.title);
      for (const word of words) {
        wordFrequency.set(word, (wordFrequency.get(word) ?? 0) + 1);
      }
    }

    // Sort by frequency, take top words
    const sortedWords = [...wordFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);

    // We want at least 15 unique words for variety; dedupe
    const uniqueWords = [...new Set(sortedWords)].slice(0, 40);

    if (uniqueWords.length < 5) {
      // Not enough words from posts, fall back to daily mix
      return { words: await getDailyWords(), subredditName, cached: false };
    }

    // Cache for 24 hours
    await redis.set(cacheKey, JSON.stringify(uniqueWords));
    await redis.expire(cacheKey, 60 * 60 * 24);

    const shuffled = [...uniqueWords].sort(() => Math.random() - 0.5);
    return { words: shuffled.slice(0, 10), subredditName, cached: false };
  } catch (err) {
    console.error('Failed to get subreddit words:', err);
    // Fallback to daily words
    return { words: await getDailyWords(), subredditName, cached: false };
  }
}

export async function getWordsFromComment(commentId: string): Promise<string[]> {
  try {
    const fullId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
    const comment = await reddit.getCommentById(fullId as `t1_${string}`);
    if (!comment) return [];
    
    // Extract words from comment body
    const words = comment.body
      .split(/\s+/)
      .filter((w: string) => w.length >= 3 && /^[a-zA-Z]+$/.test(w))
      .map((w: string) => w.toUpperCase())
      .slice(0, 15); // Max 15 words
    
    return words;
  } catch (err) {
    console.error('Failed to get comment:', err);
    return [];
  }
}
