import { redis, reddit } from '@devvit/web/server';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Reward {
  id: string;
  type: 'coupon' | 'secret' | 'giveaway' | 'message';
  value: string;       // the actual code/text/secret
  description: string; // what the player sees: "10% off at XYZ"
  affiliateLink?: string; // legendary tier only — tracked affiliate link
}

export interface GoldenChallenge {
  id: string;
  title: string;
  brandName: string;
  creatorName: string;
  subredditName: string;
  words: string[];                        // brand message split into words
  rewardWords: Record<number, Reward>;    // wordIndex → reward
  createdAt: number;
  expiresAt: number;
  maxClaims: number;
  claimCount: number;
  status: 'pending' | 'approved' | 'active' | 'expired' | 'rejected';
  tier: 'golden' | 'diamond' | 'legendary';
  postId?: string;
  brandLink?: string;       // diamond + legendary — shown after game completion
}

export interface VaultItem {
  id: string;
  reward: Reward;
  challengeId: string;
  challengeTitle: string;
  brandName: string;
  claimedAt: number;
  redeemed: boolean;
}

export interface GoldenChallengeSummary {
  id: string;
  title: string;
  brandName: string;
  creatorName: string;
  wordCount: number;
  rewardCount: number;
  tier: 'golden' | 'diamond' | 'legendary';
  claimCount: number;
  maxClaims: number;
  status: string;
}

// ── Redis Keys ─────────────────────────────────────────────────────────────

const GOLDEN_KEY = (id: string) => `golden:challenge:${id}`;
const GOLDEN_BY_SUBREDDIT = (sub: string) => `golden:sub:${sub}`;
const GOLDEN_ALL_ACTIVE = 'golden:active';
const GOLDEN_PENDING = 'golden:pending';
const VAULT_KEY = (username: string) => `golden:vault:${username}`;
const CLAIM_KEY = (challengeId: string, username: string) => `golden:claimed:${challengeId}:${username}`;
const GOLDEN_POST_KEY = (postId: string) => `golden:post:${postId}`;
const GOLDEN_ANALYTICS = (id: string) => `golden:analytics:${id}`;
const TOKEN_BALANCE_KEY = (username: string) => `golden:tokens:${username}`;
const ORDER_KEY = (orderId: string) => `golden:order:${orderId}`;
const GOLDEN_PLAYED_KEY = (challengeId: string, username: string) => `golden:played:${challengeId}:${username}`;
const GOLDEN_BY_CREATOR = (username: string) => `golden:creator:${username}`;
const LINK_CLICKS = (challengeId: string) => `golden:clicks:${challengeId}`;
const AFFILIATE_CLICKS = (challengeId: string, rewardId: string) => `golden:aff:${challengeId}:${rewardId}`;

// ── Tier Limits ────────────────────────────────────────────────────────────

export const TIER_LIMITS = {
  golden:    { maxWords: 15, maxRewards: 3,  maxClaims: 100,  maxDays: 7,  brandLink: false, affiliateLinks: false },
  diamond:   { maxWords: 25, maxRewards: 6,  maxClaims: 500,  maxDays: 30, brandLink: true,  affiliateLinks: false },
  legendary: { maxWords: 30, maxRewards: 10, maxClaims: 2000, maxDays: 90, brandLink: true,  affiliateLinks: true  },
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateGoldenId(): string {
  return `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateRewardId(): string {
  return `rw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateVaultItemId(): string {
  return `vi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}


// ── CRUD ───────────────────────────────────────────────────────────────────

export async function createGoldenChallenge(opts: {
  title: string;
  brandName: string;
  message: string;           // full brand message — will be split into words
  rewards: { wordIndex: number; type: Reward['type']; value: string; description: string; affiliateLink?: string }[];
  tier: GoldenChallenge['tier'];
  maxClaims: number;
  durationDays: number;
  subredditName: string;
  brandLink?: string;        // diamond + legendary only
}): Promise<{ success: boolean; message: string; challengeId?: string; postId?: string }> {
  try {
    const creatorName = await reddit.getCurrentUsername();
    if (!creatorName) return { success: false, message: 'Not logged in' };

    const limits = TIER_LIMITS[opts.tier];

    // Check token balance — must have purchased the tier first
    const hasToken = await debitToken(creatorName, opts.tier);
    if (!hasToken) {
      return { success: false, message: `No ${opts.tier} tokens. Purchase one first!` };
    }

    // Split message into words, clean them
    const words = opts.message
      .split(/\s+/)
      .map(w => w.replace(/[^a-zA-Z]/g, '').toUpperCase())
      .filter(w => w.length >= 2 && w.length <= 14 && /^[A-Z]+$/.test(w));

    if (words.length < 3) {
      return { success: false, message: 'Message needs at least 3 valid words' };
    }

    const finalWords = words.slice(0, limits.maxWords);

    // Build reward map — validate indices and enforce tier limit
    const rewardWords: Record<number, Reward> = {};
    let rewardCount = 0;
    for (const r of opts.rewards) {
      if (rewardCount >= limits.maxRewards) break;
      if (r.wordIndex < 0 || r.wordIndex >= finalWords.length) continue;
      if (!r.value.trim() || !r.description.trim()) continue;

      const reward: Reward = {
        id: generateRewardId(),
        type: r.type,
        value: r.value.trim(),
        description: r.description.trim(),
      };

      // Affiliate links — legendary only
      if (limits.affiliateLinks && r.affiliateLink?.trim()) {
        reward.affiliateLink = r.affiliateLink.trim().slice(0, 500);
      }

      rewardWords[r.wordIndex] = reward;
      rewardCount++;
    }

    if (Object.keys(rewardWords).length === 0) {
      return { success: false, message: 'Need at least 1 reward word' };
    }

    // Enforce tier limits on claims and duration
    const clampedClaims = Math.max(1, Math.min(limits.maxClaims, opts.maxClaims));
    const clampedDays = Math.max(1, Math.min(limits.maxDays, opts.durationDays));

    const id = generateGoldenId();
    const now = Date.now();
    const expiresAt = now + clampedDays * 24 * 60 * 60 * 1000;

    // Brand link — diamond + legendary only
    let brandLink: string | undefined;
    if (limits.brandLink && opts.brandLink?.trim()) {
      brandLink = opts.brandLink.trim().slice(0, 500);
    }

    const challenge: GoldenChallenge = {
      id,
      title: opts.title.trim().slice(0, 80),
      brandName: opts.brandName.trim().slice(0, 40),
      creatorName,
      subredditName: opts.subredditName,
      words: finalWords,
      rewardWords,
      createdAt: now,
      expiresAt,
      maxClaims: clampedClaims,
      claimCount: 0,
      status: 'pending', // needs mod approval
      tier: opts.tier,
      brandLink,
    };

    // Save challenge
    await redis.set(GOLDEN_KEY(id), JSON.stringify(challenge));

    // Add to pending queue for mod approval
    await redis.zAdd(GOLDEN_PENDING, { member: id, score: now });

    // Index by creator for dashboard
    await redis.zAdd(GOLDEN_BY_CREATOR(creatorName), { member: id, score: now });

    return { success: true, message: 'Golden Challenge created! Awaiting mod approval.', challengeId: id };
  } catch (err) {
    console.error('Failed to create golden challenge:', err);
    return { success: false, message: 'Failed to create golden challenge' };
  }
}

export async function getGoldenChallenge(id: string): Promise<GoldenChallenge | null> {
  try {
    const raw = await redis.get(GOLDEN_KEY(id));
    if (!raw) return null;
    return JSON.parse(raw) as GoldenChallenge;
  } catch {
    return null;
  }
}

// ── Approval / Rejection ───────────────────────────────────────────────────

export async function approveGoldenChallenge(challengeId: string): Promise<{
  success: boolean;
  message: string;
  postId?: string;
}> {
  try {
    const challenge = await getGoldenChallenge(challengeId);
    if (!challenge) return { success: false, message: 'Challenge not found' };
    if (challenge.status !== 'pending') return { success: false, message: `Challenge is ${challenge.status}, not pending` };

    challenge.status = 'active';

    // Create the golden challenge post
    const post = await reddit.submitCustomPost({
      title: `✨ Golden Challenge: ${challenge.title.slice(0, 60)} — by ${challenge.brandName}`,
      entry: 'default',
    });

    challenge.postId = post.id;

    // Save updated challenge
    await redis.set(GOLDEN_KEY(challengeId), JSON.stringify(challenge));

    // Link post → challenge
    await redis.set(GOLDEN_POST_KEY(post.id), challengeId);

    // Add to active set and subreddit set
    await redis.zAdd(GOLDEN_ALL_ACTIVE, { member: challengeId, score: challenge.createdAt });
    await redis.zAdd(GOLDEN_BY_SUBREDDIT(challenge.subredditName), { member: challengeId, score: challenge.createdAt });

    // Remove from pending
    await redis.zRem(GOLDEN_PENDING, [challengeId]);

    // Initialize analytics
    await redis.hSet(GOLDEN_ANALYTICS(challengeId), {
      plays: '0',
      completions: '0',
      totalClaims: '0',
    });

    // Post a comment
    try {
      await reddit.submitComment({
        id: post.id as `t3_${string}`,
        text: `✨ **Golden Challenge by ${challenge.brandName}!** Type ${challenge.words.length} words and discover hidden rewards! ${Object.keys(challenge.rewardWords).length} rewards are hidden in the message. Can you find them all? 🎁`,
      });
    } catch (e) {
      console.error('Failed to post golden challenge comment:', e);
    }

    return { success: true, message: 'Challenge approved and posted!', postId: post.id };
  } catch (err) {
    console.error('Failed to approve golden challenge:', err);
    return { success: false, message: 'Failed to approve challenge' };
  }
}

export async function rejectGoldenChallenge(challengeId: string): Promise<{ success: boolean; message: string }> {
  try {
    const challenge = await getGoldenChallenge(challengeId);
    if (!challenge) return { success: false, message: 'Challenge not found' };
    if (challenge.status !== 'pending') return { success: false, message: `Challenge is ${challenge.status}` };

    challenge.status = 'rejected';
    await redis.set(GOLDEN_KEY(challengeId), JSON.stringify(challenge));
    await redis.zRem(GOLDEN_PENDING, [challengeId]);

    return { success: true, message: 'Challenge rejected' };
  } catch (err) {
    console.error('Failed to reject golden challenge:', err);
    return { success: false, message: 'Failed to reject challenge' };
  }
}

// ── Claim Rewards ──────────────────────────────────────────────────────────

export async function claimReward(
  challengeId: string,
  wordIndex: number
): Promise<{ success: boolean; message: string; reward?: Reward }> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return { success: false, message: 'Not logged in' };

    const challenge = await getGoldenChallenge(challengeId);
    if (!challenge) return { success: false, message: 'Challenge not found' };
    if (challenge.status !== 'active') return { success: false, message: 'Challenge is not active' };
    if (Date.now() > challenge.expiresAt) return { success: false, message: 'Challenge has expired' };

    // Check if this word has a reward
    const reward = challenge.rewardWords[wordIndex];
    if (!reward) return { success: false, message: 'No reward at this word' };

    // Check if user already claimed this specific reward
    const claimKey = CLAIM_KEY(challengeId, username);
    const existingClaims = await redis.get(claimKey);
    const claimedIndices: number[] = existingClaims ? JSON.parse(existingClaims) : [];

    if (claimedIndices.includes(wordIndex)) {
      return { success: false, message: 'Already claimed this reward' };
    }

    // Check max claims for the challenge
    if (challenge.claimCount >= challenge.maxClaims) {
      return { success: false, message: 'All rewards have been claimed' };
    }

    // Record the claim
    claimedIndices.push(wordIndex);
    await redis.set(claimKey, JSON.stringify(claimedIndices));

    // Increment challenge claim count
    challenge.claimCount++;
    await redis.set(GOLDEN_KEY(challengeId), JSON.stringify(challenge));

    // Save to user's vault
    const vaultItem: VaultItem = {
      id: generateVaultItemId(),
      reward,
      challengeId,
      challengeTitle: challenge.title,
      brandName: challenge.brandName,
      claimedAt: Date.now(),
      redeemed: false,
    };

    const vaultKey = VAULT_KEY(username);
    const existingVault = await redis.get(vaultKey);
    const vault: VaultItem[] = existingVault ? JSON.parse(existingVault) : [];
    vault.push(vaultItem);
    await redis.set(vaultKey, JSON.stringify(vault));

    // Update analytics
    try {
      const analyticsKey = GOLDEN_ANALYTICS(challengeId);
      const currentClaims = parseInt((await redis.hGet(analyticsKey, 'totalClaims')) ?? '0');
      await redis.hSet(analyticsKey, { totalClaims: (currentClaims + 1).toString() });
    } catch {
      // analytics are best-effort
    }

    return { success: true, message: 'Reward claimed!', reward };
  } catch (err) {
    console.error('Failed to claim reward:', err);
    return { success: false, message: 'Failed to claim reward' };
  }
}

// ── Vault ──────────────────────────────────────────────────────────────────

export async function getUserVault(): Promise<VaultItem[]> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return [];
    const raw = await redis.get(VAULT_KEY(username));
    if (!raw) return [];
    return JSON.parse(raw) as VaultItem[];
  } catch {
    return [];
  }
}

export async function markVaultItemRedeemed(itemId: string): Promise<boolean> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return false;
    const vaultKey = VAULT_KEY(username);
    const raw = await redis.get(vaultKey);
    if (!raw) return false;
    const vault: VaultItem[] = JSON.parse(raw);
    const item = vault.find(v => v.id === itemId);
    if (!item) return false;
    item.redeemed = true;
    await redis.set(vaultKey, JSON.stringify(vault));
    return true;
  } catch {
    return false;
  }
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getActiveGoldenChallenges(limit: number = 10): Promise<GoldenChallengeSummary[]> {
  try {
    const entries = await redis.zRange(GOLDEN_ALL_ACTIVE, 0, limit - 1, { by: 'rank', reverse: true });
    const results: GoldenChallengeSummary[] = [];
    for (const entry of entries) {
      const challenge = await getGoldenChallenge(entry.member);
      if (challenge && challenge.status === 'active' && Date.now() < challenge.expiresAt) {
        results.push(toSummary(challenge));
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function getGoldenChallengesForSubreddit(subredditName: string, limit: number = 10): Promise<GoldenChallengeSummary[]> {
  try {
    const entries = await redis.zRange(GOLDEN_BY_SUBREDDIT(subredditName), 0, limit - 1, { by: 'rank', reverse: true });
    const results: GoldenChallengeSummary[] = [];
    for (const entry of entries) {
      const challenge = await getGoldenChallenge(entry.member);
      if (challenge && challenge.status === 'active' && Date.now() < challenge.expiresAt) {
        results.push(toSummary(challenge));
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function getPendingGoldenChallenges(limit: number = 20): Promise<GoldenChallengeSummary[]> {
  try {
    const entries = await redis.zRange(GOLDEN_PENDING, 0, limit - 1, { by: 'rank', reverse: true });
    const results: GoldenChallengeSummary[] = [];
    for (const entry of entries) {
      const challenge = await getGoldenChallenge(entry.member);
      if (challenge && challenge.status === 'pending') {
        results.push(toSummary(challenge));
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function getGoldenChallengeForPost(postId: string): Promise<GoldenChallenge | null> {
  try {
    const challengeId = await redis.get(GOLDEN_POST_KEY(postId));
    if (!challengeId) return null;
    return await getGoldenChallenge(challengeId);
  } catch {
    return null;
  }
}

export async function getGoldenChallengeAnalytics(challengeId: string): Promise<{
  plays: number;
  completions: number;
  totalClaims: number;
  claimRate: number;
} | null> {
  try {
    const data = await redis.hGetAll(GOLDEN_ANALYTICS(challengeId));
    if (!data) return null;
    const plays = parseInt(data.plays ?? '0');
    const completions = parseInt(data.completions ?? '0');
    const totalClaims = parseInt(data.totalClaims ?? '0');
    return {
      plays,
      completions,
      totalClaims,
      claimRate: plays > 0 ? totalClaims / plays : 0,
    };
  } catch {
    return null;
  }
}

export async function recordGoldenPlay(challengeId: string, completed: boolean): Promise<void> {
  try {
    // Mark user as having played this challenge (once-per-user enforcement)
    const username = await reddit.getCurrentUsername();
    if (username) {
      await redis.set(GOLDEN_PLAYED_KEY(challengeId, username), '1');
    }

    const key = GOLDEN_ANALYTICS(challengeId);
    const plays = parseInt((await redis.hGet(key, 'plays')) ?? '0');
    const completions = parseInt((await redis.hGet(key, 'completions')) ?? '0');
    await redis.hSet(key, {
      plays: (plays + 1).toString(),
      completions: (completions + (completed ? 1 : 0)).toString(),
    });
  } catch {
    // best-effort
  }
}

// Check if user has already played a golden challenge
export async function hasUserPlayedGolden(challengeId: string): Promise<boolean> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return false;
    const val = await redis.get(GOLDEN_PLAYED_KEY(challengeId, username));
    return val === '1';
  } catch {
    return false;
  }
}

export async function getUserClaimedRewards(challengeId: string): Promise<number[]> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return [];
    const raw = await redis.get(CLAIM_KEY(challengeId, username));
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toSummary(c: GoldenChallenge): GoldenChallengeSummary {
  return {
    id: c.id,
    title: c.title,
    brandName: c.brandName,
    creatorName: c.creatorName,
    wordCount: c.words.length,
    rewardCount: Object.keys(c.rewardWords).length,
    tier: c.tier,
    claimCount: c.claimCount,
    maxClaims: c.maxClaims,
    status: c.status,
  };
}


// ── Creator Dashboard ──────────────────────────────────────────────────────

export interface CreatorDashboardChallenge {
  id: string;
  title: string;
  brandName: string;
  tier: string;
  status: string;
  wordCount: number;
  rewardCount: number;
  claimCount: number;
  maxClaims: number;
  createdAt: number;
  expiresAt: number;
  analytics: { plays: number; completions: number; totalClaims: number; claimRate: number } | null;
  linkAnalytics: { brandLinkClicks: number; affiliateClicks: Record<string, number> } | null;
  brandLink?: string;
  hasAffiliateLinks: boolean;
}

export interface CreatorDashboard {
  username: string;
  challenges: CreatorDashboardChallenge[];
  totals: {
    totalChallenges: number;
    activeChallenges: number;
    totalPlays: number;
    totalCompletions: number;
    totalClaims: number;
  };
  tokenBalance: Record<TokenTier, number>;
}

export async function getCreatorDashboard(): Promise<CreatorDashboard | null> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return null;

    const entries = await redis.zRange(GOLDEN_BY_CREATOR(username), 0, 49, { by: 'rank', reverse: true });
    const challenges: CreatorDashboardChallenge[] = [];
    let totalPlays = 0;
    let totalCompletions = 0;
    let totalClaims = 0;
    let activeChallenges = 0;

    for (const entry of entries) {
      const challenge = await getGoldenChallenge(entry.member);
      if (!challenge) continue;

      const analytics = await getGoldenChallengeAnalytics(challenge.id);
      if (analytics) {
        totalPlays += analytics.plays;
        totalCompletions += analytics.completions;
        totalClaims += analytics.totalClaims;
      }
      if (challenge.status === 'active' && Date.now() < challenge.expiresAt) {
        activeChallenges++;
      }

      challenges.push({
        id: challenge.id,
        title: challenge.title,
        brandName: challenge.brandName,
        tier: challenge.tier,
        status: challenge.status,
        wordCount: challenge.words.length,
        rewardCount: Object.keys(challenge.rewardWords).length,
        claimCount: challenge.claimCount,
        maxClaims: challenge.maxClaims,
        createdAt: challenge.createdAt,
        expiresAt: challenge.expiresAt,
        analytics,
        linkAnalytics: (challenge.brandLink || Object.values(challenge.rewardWords).some(r => r.affiliateLink))
          ? await getLinkAnalytics(challenge.id) : null,
        brandLink: challenge.brandLink,
        hasAffiliateLinks: Object.values(challenge.rewardWords).some(r => !!r.affiliateLink),
      });
    }

    const balance = await getTokenBalance(username);

    return {
      username,
      challenges,
      totals: {
        totalChallenges: challenges.length,
        activeChallenges,
        totalPlays,
        totalCompletions,
        totalClaims,
      },
      tokenBalance: balance,
    };
  } catch (err) {
    console.error('Failed to get creator dashboard:', err);
    return null;
  }
}

// Check if user is a golden challenge creator (has created at least 1)
export async function isGoldenCreator(): Promise<boolean> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) return false;
    const count = await redis.zCard(GOLDEN_BY_CREATOR(username));
    return count > 0;
  } catch {
    return false;
  }
}

// ── Token Balance (Payment Bridge) ─────────────────────────────────────────
// Tokens are credited when a user purchases a golden challenge tier via Reddit Gold.
// The fulfillOrder endpoint credits tokens; createGoldenChallenge debits them.

export type TokenTier = 'golden' | 'diamond' | 'legendary';

const TIER_TOKEN_COST: Record<TokenTier, number> = {
  golden: 1,
  diamond: 1,
  legendary: 1,
};

// SKU → tier mapping (must match products.json)
export const SKU_TO_TIER: Record<string, TokenTier> = {
  golden_tier: 'golden',
  diamond_tier: 'diamond',
  legendary_tier: 'legendary',
};

export async function creditTokens(username: string, tier: TokenTier, orderId: string): Promise<boolean> {
  try {
    // Idempotency: check if this order was already fulfilled
    const existing = await redis.get(ORDER_KEY(orderId));
    if (existing) return false; // already processed

    // Mark order as fulfilled
    await redis.set(ORDER_KEY(orderId), JSON.stringify({ username, tier, fulfilledAt: Date.now() }));

    // Credit the token
    const key = TOKEN_BALANCE_KEY(username);
    const balanceRaw = await redis.hGet(key, tier);
    const current = parseInt(balanceRaw ?? '0');
    await redis.hSet(key, { [tier]: (current + 1).toString() });

    return true;
  } catch (err) {
    console.error('Failed to credit tokens:', err);
    return false;
  }
}

export async function debitToken(username: string, tier: TokenTier): Promise<boolean> {
  try {
    const key = TOKEN_BALANCE_KEY(username);
    const balanceRaw = await redis.hGet(key, tier);
    const current = parseInt(balanceRaw ?? '0');
    const cost = TIER_TOKEN_COST[tier];

    if (current < cost) return false; // insufficient balance

    await redis.hSet(key, { [tier]: (current - cost).toString() });
    return true;
  } catch (err) {
    console.error('Failed to debit token:', err);
    return false;
  }
}

export async function getTokenBalance(username: string): Promise<Record<TokenTier, number>> {
  try {
    const key = TOKEN_BALANCE_KEY(username);
    const data = await redis.hGetAll(key);
    return {
      golden: parseInt(data?.golden ?? '0'),
      diamond: parseInt(data?.diamond ?? '0'),
      legendary: parseInt(data?.legendary ?? '0'),
    };
  } catch {
    return { golden: 0, diamond: 0, legendary: 0 };
  }
}

export async function refundToken(username: string, tier: TokenTier, orderId: string): Promise<boolean> {
  try {
    // Check if order exists
    const existing = await redis.get(ORDER_KEY(orderId));
    if (!existing) return false;

    // Remove order record
    await redis.del(ORDER_KEY(orderId));

    // Debit the token back
    const key = TOKEN_BALANCE_KEY(username);
    const balanceRaw = await redis.hGet(key, tier);
    const current = parseInt(balanceRaw ?? '0');
    if (current > 0) {
      await redis.hSet(key, { [tier]: (current - 1).toString() });
    }

    return true;
  } catch (err) {
    console.error('Failed to refund token:', err);
    return false;
  }
}

// ── Link Click Tracking ────────────────────────────────────────────────────

/**
 * Track a brand link click. Returns the URL with UTM params appended.
 */
export async function trackBrandLinkClick(challengeId: string): Promise<string | null> {
  try {
    const challenge = await getGoldenChallenge(challengeId);
    if (!challenge || !challenge.brandLink) return null;

    // Increment click counter
    const key = LINK_CLICKS(challengeId);
    const current = parseInt((await redis.get(key)) ?? '0');
    await redis.set(key, (current + 1).toString());

    // Append UTM params
    return appendUtm(challenge.brandLink, challengeId);
  } catch {
    return null;
  }
}

/**
 * Track an affiliate link click on a specific reward.
 */
export async function trackAffiliateLinkClick(challengeId: string, rewardId: string): Promise<string | null> {
  try {
    const challenge = await getGoldenChallenge(challengeId);
    if (!challenge) return null;

    // Find the reward
    const reward = Object.values(challenge.rewardWords).find(r => r.id === rewardId);
    if (!reward?.affiliateLink) return null;

    // Increment affiliate click counter
    const key = AFFILIATE_CLICKS(challengeId, rewardId);
    const current = parseInt((await redis.get(key)) ?? '0');
    await redis.set(key, (current + 1).toString());

    // Also increment total brand link clicks
    const totalKey = LINK_CLICKS(challengeId);
    const totalCurrent = parseInt((await redis.get(totalKey)) ?? '0');
    await redis.set(totalKey, (totalCurrent + 1).toString());

    return appendUtm(reward.affiliateLink, challengeId, rewardId);
  } catch {
    return null;
  }
}

/**
 * Get link click analytics for a challenge (creator dashboard).
 */
export async function getLinkAnalytics(challengeId: string): Promise<{
  brandLinkClicks: number;
  affiliateClicks: Record<string, number>; // rewardId → clicks
}> {
  try {
    const brandLinkClicks = parseInt((await redis.get(LINK_CLICKS(challengeId))) ?? '0');

    const challenge = await getGoldenChallenge(challengeId);
    const affiliateClicks: Record<string, number> = {};
    if (challenge) {
      for (const reward of Object.values(challenge.rewardWords)) {
        if (reward.affiliateLink) {
          const clicks = parseInt((await redis.get(AFFILIATE_CLICKS(challengeId, reward.id))) ?? '0');
          affiliateClicks[reward.id] = clicks;
        }
      }
    }

    return { brandLinkClicks, affiliateClicks };
  } catch {
    return { brandLinkClicks: 0, affiliateClicks: {} };
  }
}

function appendUtm(url: string, challengeId: string, rewardId?: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'typeers');
    u.searchParams.set('utm_medium', 'golden_challenge');
    u.searchParams.set('utm_campaign', challengeId);
    if (rewardId) u.searchParams.set('utm_content', rewardId);
    return u.toString();
  } catch {
    // If URL parsing fails, return as-is
    return url;
  }
}
