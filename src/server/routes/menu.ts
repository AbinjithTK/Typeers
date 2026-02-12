import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { createPost } from '../core/post';
import { createTournamentPost } from '../core/tournament';
import { createLevelFromPost, createLevelFromComment } from '../core/levels';
import {
  approveGoldenChallenge,
  rejectGoldenChallenge,
  getPendingGoldenChallenges,
  getActiveGoldenChallenges,
  getGoldenChallengeAnalytics,
} from '../core/golden';

export const menu = new Hono();

// Helper: build a navigateTo URL from a post ID (handles t3_ prefix)
function postUrl(postId: string): string {
  const id = postId.startsWith('t3_') ? postId.slice(3) : postId;
  return `https://www.reddit.com/comments/${id}`;
}

// Create a new Typeers game post
menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();
    return c.json<UiResponse>({ navigateTo: postUrl(post.id) }, 200);
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

// Create a level from a comment (UGC feature)
menu.post('/create-level-from-comment', async (c) => {
  try {
    const body = await c.req.json();
    const commentId = body.targetId;

    if (!commentId) {
      return c.json<UiResponse>({ showToast: 'No comment selected' }, 400);
    }

    const result = await createLevelFromComment(commentId);

    if (!result.success) {
      return c.json<UiResponse>({ showToast: result.message }, 400);
    }

    return c.json<UiResponse>(
      {
        showToast: `Level created with ${result.wordCount} words! 🎮`,
        navigateTo: result.postId ? postUrl(result.postId) : undefined,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating level from comment: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create level from comment' }, 400);
  }
});

// Manually start/create this week's tournament post (mod action)
menu.post('/start-tournament', async (c) => {
  try {
    const result = await createTournamentPost();

    if (!result) {
      return c.json<UiResponse>(
        { showToast: 'Failed to create tournament post. Check app logs for details.' },
        400
      );
    }

    return c.json<UiResponse>(
      {
        showToast: '🏆 Weekly tournament post created and pinned!',
        navigateTo: postUrl(result.postId),
      },
      200
    );
  } catch (error) {
    console.error(`Error creating tournament post: ${error}`);
    return c.json<UiResponse>(
      { showToast: `Failed to create tournament: ${error instanceof Error ? error.message : 'Unknown error'}` },
      400
    );
  }
});

// Create a level from a post (UGC feature)
menu.post('/create-level-from-post', async (c) => {
  try {
    const body = await c.req.json();
    const postId = body.targetId;

    if (!postId) {
      return c.json<UiResponse>({ showToast: 'No post selected' }, 400);
    }

    const result = await createLevelFromPost(postId);

    if (!result.success) {
      return c.json<UiResponse>({ showToast: result.message }, 400);
    }

    return c.json<UiResponse>(
      {
        showToast: `Level created with ${result.wordCount} words!`,
        navigateTo: result.postId ? postUrl(result.postId) : undefined,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating level from post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create level from post' }, 400);
  }
});

// ── Golden Challenge Menu Routes ───────────────────────────────────────────

// Step 1: Mod clicks "Manage Golden Challenges" → show select form with pending challenges
menu.post('/manage-golden-challenges', async (c) => {
  try {
    const pending = await getPendingGoldenChallenges(20);
    const active = await getActiveGoldenChallenges(20);

    if (pending.length === 0 && active.length === 0) {
      return c.json<UiResponse>({ showToast: 'No golden challenges to manage' }, 200);
    }

    // Build options: pending first, then active
    const options: { label: string; value: string }[] = [];
    for (const ch of pending) {
      options.push({
        label: `⏳ [PENDING] ${ch.title} — by ${ch.brandName} (${ch.tier.toUpperCase()}, ${ch.wordCount}w, ${ch.rewardCount}r)`,
        value: `${ch.id}|pending`,
      });
    }
    for (const ch of active) {
      const analytics = await getGoldenChallengeAnalytics(ch.id);
      const plays = analytics?.plays ?? 0;
      options.push({
        label: `✅ [ACTIVE] ${ch.title} — ${ch.brandName} (${plays} plays, ${ch.claimCount}/${ch.maxClaims} claims)`,
        value: `${ch.id}|active`,
      });
    }

    return c.json<UiResponse>({
      showForm: {
        name: 'goldenChallengeAction',
        form: {
          title: '🛡️ Manage Golden Challenges',
          description: `${pending.length} pending · ${active.length} active`,
          fields: [
            {
              type: 'select',
              name: 'challenge',
              label: 'Select a challenge',
              options,
              required: true,
            },
            {
              type: 'select',
              name: 'action',
              label: 'Action',
              options: [
                { label: '✓ Approve (creates post)', value: 'approve' },
                { label: '✗ Reject', value: 'reject' },
              ],
              required: true,
            },
          ],
          acceptLabel: 'Confirm',
          cancelLabel: 'Cancel',
        },
      },
    });
  } catch (error) {
    console.error(`Error loading golden challenges: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to load golden challenges' }, 400);
  }
});

// Step 2: Form submission — mod picked a challenge and action
menu.post('/golden-challenge-action', async (c) => {
  try {
    const body = await c.req.json<{ challenge: string[]; action: string[] }>();
    const challengeRaw = body.challenge?.[0]; // select returns array
    const actionRaw = body.action?.[0];

    if (!challengeRaw || !actionRaw) {
      return c.json<UiResponse>({ showToast: 'Invalid selection' }, 400);
    }

    const [challengeId, status] = challengeRaw.split('|');
    if (!challengeId) {
      return c.json<UiResponse>({ showToast: 'Invalid challenge ID' }, 400);
    }

    if (actionRaw === 'approve') {
      if (status !== 'pending') {
        return c.json<UiResponse>({ showToast: 'Only pending challenges can be approved' }, 400);
      }
      const result = await approveGoldenChallenge(challengeId);
      if (!result.success) {
        return c.json<UiResponse>({ showToast: result.message }, 400);
      }
      return c.json<UiResponse>({
        showToast: `✨ Golden Challenge approved and posted!`,
        navigateTo: result.postId ? postUrl(result.postId) : undefined,
      }, 200);
    }

    if (actionRaw === 'reject') {
      if (status !== 'pending') {
        return c.json<UiResponse>({ showToast: 'Only pending challenges can be rejected' }, 400);
      }
      const result = await rejectGoldenChallenge(challengeId);
      if (!result.success) {
        return c.json<UiResponse>({ showToast: result.message }, 400);
      }
      return c.json<UiResponse>({ showToast: '❌ Golden Challenge rejected' }, 200);
    }

    return c.json<UiResponse>({ showToast: 'Unknown action' }, 400);
  } catch (error) {
    console.error(`Error processing golden challenge action: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to process action' }, 400);
  }
});
