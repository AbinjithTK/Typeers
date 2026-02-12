import { reddit, redis } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: '⌨️ Typeers - Daily Typing Challenge',
    entry: 'default',
  });
};

export const createLevelFromComment = async (commentId: string): Promise<{
  success: boolean;
  message: string;
  postId?: string;
  wordCount?: number;
}> => {
  try {
    // Ensure comment ID has proper prefix
    const fullId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
    
    // Get the comment
    const comment = await reddit.getCommentById(fullId as `t1_${string}`);
    if (!comment) {
      return { success: false, message: 'Comment not found' };
    }

    // Extract words from comment body
    const words = comment.body
      .split(/\s+/)
      .filter((w: string) => w.length >= 3 && /^[a-zA-Z]+$/.test(w))
      .map((w: string) => w.toUpperCase());

    if (words.length < 3) {
      return { success: false, message: 'Comment needs at least 3 valid words!' };
    }

    // Limit to 15 words max
    const levelWords = words.slice(0, 15);

    // Create a unique level ID
    const levelId = `level:${Date.now()}:${commentId}`;
    
    // Store the level words in Redis
    await redis.set(levelId, JSON.stringify({
      words: levelWords,
      sourceCommentId: commentId,
      authorName: comment.authorName,
      createdAt: Date.now(),
    }));
    
    // Set expiry for 30 days
    await redis.expire(levelId, 60 * 60 * 24 * 30);

    // Create the game post
    const post = await reddit.submitCustomPost({
      title: `⌨️ Typeers Challenge by u/${comment.authorName}`,
      entry: 'default',
    });

    // Store the level ID with the post
    await redis.set(`post:${post.id}:level`, levelId);

    return {
      success: true,
      message: 'Level created!',
      postId: post.id,
      wordCount: levelWords.length,
    };
  } catch (error) {
    console.error('Error creating level from comment:', error);
    return { success: false, message: 'Failed to create level' };
  }
};

export const getLevelForPost = async (postId: string): Promise<string[] | null> => {
  try {
    const levelId = await redis.get(`post:${postId}:level`);
    if (!levelId) return null;

    const levelData = await redis.get(levelId);
    if (!levelData) return null;

    const parsed = JSON.parse(levelData);
    return parsed.words;
  } catch {
    return null;
  }
};
