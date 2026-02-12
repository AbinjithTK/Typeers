import { Hono } from 'hono';
import { createTournamentPost } from '../core/tournament';

export const schedulerRoutes = new Hono();

// Weekly tournament cron — runs every Monday at 00:00 UTC
schedulerRoutes.post('/weekly-tournament', async (c) => {
  try {
    const result = await createTournamentPost();
    if (!result) {
      console.error('Weekly tournament: failed to create post');
      return c.json({ status: 'error', message: 'Failed to create tournament post' }, 500);
    }
    return c.json({ status: 'ok', postId: result.postId }, 200);
  } catch (err) {
    console.error('Weekly tournament task failed:', err);
    return c.json({ status: 'error', message: 'Tournament task threw an exception' }, 500);
  }
});
