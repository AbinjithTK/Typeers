import './index.css';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, context, purchase, OrderResultStatus } from '@devvit/web/client';
import { trpc } from './trpc';
import type { GameOverData, RewardFoundData } from './game/index';

// Lazy load Phaser to improve initial load time
const loadPhaser = () => import('phaser');
const loadGameModule = () => import('./game/index');

// Button click sound function (loaded lazily with game module)
let buttonSoundFn: (() => void) | null = null;
const playButtonClick = () => {
  if (buttonSoundFn) {
    buttonSoundFn();
  } else {
    // Load and play
    loadGameModule().then(mod => {
      buttonSoundFn = mod.playButtonSound;
      buttonSoundFn();
    });
  }
};

type GameState = 'menu' | 'tutorial' | 'categories' | 'gallery' | 'creator' | 'golden-create' | 'golden-dashboard' | 'tournament-dashboard' | 'vault' | 'loading' | 'playing' | 'results';

interface LeaderboardEntry {
  username: string;
  score: number;
}

interface Category {
  id: string;
  name: string;
  emoji: string;
}

interface LevelSummary {
  id: string;
  title: string;
  creatorName: string;
  wordCount: number;
  plays: number;
  avgRating: number;
  ratingCount: number;
  isRemix: boolean;
}

export const App = () => {
  const [gameState, setGameState] = useState<GameState>('menu');
  const [phaserGame, setPhaserGame] = useState<Phaser.Game | null>(null);
  const [score, setScore] = useState(0);
  const [wordsTyped, setWordsTyped] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [maxCombo, setMaxCombo] = useState(0);
  const [accuracy, setAccuracy] = useState(100);
  const [wpm, setWpm] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userBest, setUserBest] = useState<number | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [levelInfo, setLevelInfo] = useState<{ type: 'daily' | 'custom' | 'category' | 'community'; categoryName?: string; subredditName?: string; author?: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tournamentInfo, setTournamentInfo] = useState<{
    weekKey: string;
    postId: string | null;
    userStats: { bestScore: number | null; rank: number | null; totalPlayers: number } | null;
  } | null>(null);
  const [tournamentLeaderboard, setTournamentLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [tournamentRank, setTournamentRank] = useState<number | null>(null);
  const [userStats, setUserStats] = useState<{
    gamesPlayed: number;
    totalWordsTyped: number;
    allTimeBest: number;
    bestCombo: number;
    bestWpm: number;
    bestAccuracy: number;
    streak: number;
  } | null>(null);
  const [galleryLevels, setGalleryLevels] = useState<LevelSummary[]>([]);
  const [gallerySortBy, setGallerySortBy] = useState<'plays' | 'rating'>('plays');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'levels' | 'golden'>('all');
  const [currentUgcLevel, setCurrentUgcLevel] = useState<{ id: string; title: string; creatorName: string; originalCreator?: string } | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [creatorLeaderboard, setCreatorLeaderboard] = useState<{ username: string; score: number }[]>([]);
  const [featuredLevels, setFeaturedLevels] = useState<LevelSummary[]>([]);
  const [levelOfTheDay, setLevelOfTheDay] = useState<LevelSummary | null>(null);
  const [viewingCreator, setViewingCreator] = useState<{
    username: string;
    stats: { levelsCreated: number; totalPlays: number; totalRatings: number; badges: string[] } | null;
    levels: LevelSummary[];
  } | null>(null);
  const [galleryPage, setGalleryPage] = useState(0);
  const [creatorTitle, setCreatorTitle] = useState('');
  const [creatorWordInput, setCreatorWordInput] = useState('');
  const [creatorWords, setCreatorWords] = useState<string[]>([]);
  const [creatorPublishing, setCreatorPublishing] = useState(false);
  // Golden challenge state
  const [goldenChallenge, setGoldenChallenge] = useState<{
    id: string;
    title: string;
    brandName: string;
    words: string[];
    tier: string;
    rewardIndices: number[];
    rewardMap: Record<number, number>; // shuffledIdx → originalIdx
    fullMessage: string;
    brandLink: string | null;
  } | null>(null);
  const [vaultItems, setVaultItems] = useState<{
    id: string;
    reward: { type: string; value: string; description: string };
    challengeTitle: string;
    brandName: string;
    claimedAt: number;
    redeemed: boolean;
  }[]>([]);
  const [rewardPopup, setRewardPopup] = useState<{ description: string; type: string } | null>(null);
  const [collectedRewards, setCollectedRewards] = useState<{ description: string; type: string }[]>([]);
  const [goldenChallenges, setGoldenChallenges] = useState<{
    id: string; title: string; brandName: string; wordCount: number;
    rewardCount: number; tier: string; claimCount: number; maxClaims: number;
  }[]>([]);
  // Golden challenge creation form
  const [gcTitle, setGcTitle] = useState('');
  const [gcBrandName, setGcBrandName] = useState('');
  const [gcMessage, setGcMessage] = useState('');
  const [gcRewards, setGcRewards] = useState<{ wordIndex: number; type: string; value: string; description: string; affiliateLink?: string }[]>([]);
  const [gcTier, setGcTier] = useState<'golden' | 'diamond' | 'legendary'>('golden');
  const [gcMaxClaims, setGcMaxClaims] = useState(100);
  const [gcDuration, setGcDuration] = useState(7);
  const [gcPublishing, setGcPublishing] = useState(false);
  const [gcBrandLink, setGcBrandLink] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<{ golden: number; diamond: number; legendary: number }>({ golden: 0, diamond: 0, legendary: 0 });
  const [isGoldenCreator, setIsGoldenCreator] = useState(false);
  const [goldenDashboard, setGoldenDashboard] = useState<{
    username: string;
    challenges: {
      id: string; title: string; brandName: string; tier: string; status: string;
      wordCount: number; rewardCount: number; claimCount: number; maxClaims: number;
      createdAt: number; expiresAt: number;
      analytics: { plays: number; completions: number; totalClaims: number; claimRate: number } | null;
      linkAnalytics: { brandLinkClicks: number; affiliateClicks: Record<string, number> } | null;
      brandLink?: string;
      hasAffiliateLinks: boolean;
    }[];
    totals: { totalChallenges: number; activeChallenges: number; totalPlays: number; totalCompletions: number; totalClaims: number };
    tokenBalance: { golden: number; diamond: number; legendary: number };
  } | null>(null);
  const [tournamentDashboard, setTournamentDashboard] = useState<{
    currentWeek: {
      weekKey: string; postId: string | null;
      leaderboard: { username: string; score: number }[];
      totalPlayers: number;
      userStats: { bestScore: number | null; rank: number | null } | null;
    };
    previousWeek: {
      weekKey: string;
      leaderboard: { username: string; score: number }[];
      totalPlayers: number;
      userStats: { bestScore: number | null; rank: number | null } | null;
    };
  } | null>(null);
  const [goldenAlreadyPlayed, setGoldenAlreadyPlayed] = useState(false);
  const [keyboardReady, setKeyboardReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const phaserRef = useRef<typeof Phaser | null>(null);
  const gameModuleRef = useRef<Awaited<ReturnType<typeof loadGameModule>> | null>(null);

  // Preload Phaser in background when component mounts
  useEffect(() => {
    Promise.all([loadPhaser(), loadGameModule()]).then(([phaserModule, gameModule]) => {
      phaserRef.current = phaserModule.default;
      gameModuleRef.current = gameModule;
    });
  }, []);

  // Load leaderboard on mount
  useEffect(() => {
    loadLeaderboard();
    loadUserBest();
    loadUserStats();
    loadCategories();
    loadTournamentInfo();
    loadGoldenChallenges();
    checkIsGoldenCreator();
    // Auto-start if this is a golden challenge post
    autoStartGoldenChallenge();
  }, []);

  const autoStartGoldenChallenge = async () => {
    if (!context.postId) return;
    try {
      const goldenData = await trpc.golden.getForPost.query({ postId: context.postId });
      if (goldenData.isGolden && goldenData.challenge) {
        // Once-per-user: if already played, show menu instead of auto-starting
        if (goldenData.hasPlayed) {
          setGoldenAlreadyPlayed(true);
          setGoldenChallenge(goldenData.challenge);
          return; // stay on menu — don't auto-start
        }
        const gc = goldenData.challenge;
        setGoldenChallenge(gc);
        setLevelInfo({ type: 'custom', author: gc.brandName });
        setCollectedRewards([]);
        setIsNewHighScore(false);
        setRank(null);
        setShowShareOptions(false);
        setCurrentUgcLevel(null);
        setUserRating(null);
        initializeGame(gc.words, { rewardIndices: gc.rewardIndices, isGolden: true });
      }
    } catch {
      // Not a golden challenge post — stay on menu
    }
  };

  const loadLeaderboard = async () => {
    try {
      const data = await trpc.game.getLeaderboard.query({ limit: 5 });
      setLeaderboard(data);
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  };

  const loadUserBest = async () => {
    try {
      const data = await trpc.game.getUserBest.query();
      setUserBest(data.score);
    } catch (err) {
      console.error('Failed to load user best:', err);
    }
  };

  const loadUserStats = async () => {
    try {
      const data = await trpc.game.getStats.query();
      setUserStats(data);
    } catch (err) {
      console.error('Failed to load user stats:', err);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await trpc.game.getCategories.query();
      setCategories(data);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  };

  const loadTournamentInfo = async () => {
    try {
      const [info, lb] = await Promise.all([
        trpc.tournament.getInfo.query(),
        trpc.tournament.getLeaderboard.query({ limit: 5 }),
      ]);
      setTournamentInfo(info);
      setTournamentLeaderboard(lb);
    } catch (err) {
      console.error('Failed to load tournament info:', err);
    }
  };

  const loadVault = async () => {
    try {
      const items = await trpc.golden.getVault.query();
      setVaultItems(items);
    } catch (err) {
      console.error('Failed to load vault:', err);
    }
  };

  const loadGoldenChallenges = async () => {
    try {
      const challenges = await trpc.golden.listActive.query({ limit: 10 });
      setGoldenChallenges(challenges);
    } catch (err) {
      console.error('Failed to load golden challenges:', err);
    }
  };

  const loadTokenBalance = async () => {
    try {
      const balance = await trpc.golden.getTokenBalance.query();
      setTokenBalance(balance);
    } catch (err) {
      console.error('Failed to load token balance:', err);
    }
  };

  const checkIsGoldenCreator = async () => {
    try {
      const data = await trpc.golden.isCreator.query();
      setIsGoldenCreator(data.isCreator);
    } catch (err) {
      console.error('Failed to check creator status:', err);
    }
  };

  const loadGoldenDashboard = async () => {
    try {
      const data = await trpc.golden.getCreatorDashboard.query();
      setGoldenDashboard(data);
    } catch (err) {
      console.error('Failed to load golden dashboard:', err);
    }
  };

  const loadTournamentDashboard = async () => {
    try {
      const data = await trpc.tournament.getDashboard.query();
      setTournamentDashboard(data);
    } catch (err) {
      console.error('Failed to load tournament dashboard:', err);
    }
  };

  const purchaseToken = async (tier: 'golden' | 'diamond' | 'legendary') => {
    const skuMap = { golden: 'golden_tier', diamond: 'diamond_tier', legendary: 'legendary_tier' };
    try {
      setError(null);
      setPurchasing(true);
      const result = await purchase(skuMap[tier]);
      setPurchasing(false);
      if (result.status === OrderResultStatus.STATUS_SUCCESS) {
        // Reload balance — fulfillOrder will have credited the token
        await loadTokenBalance();
        return true;
      } else if (result.status === OrderResultStatus.STATUS_CANCELLED) {
        setError('Purchase cancelled.');
        return false;
      } else {
        setError(result.errorMessage || 'Purchase failed. Please try again.');
        return false;
      }
    } catch (err: unknown) {
      setPurchasing(false);
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Purchase error:', msg);
      setError(`Purchase failed: ${msg}`);
      return false;
    }
  };

  const loadGallery = async (sort: 'plays' | 'rating' = gallerySortBy, page: number = 0) => {
    try {
      const [levels, featured, lotd] = await Promise.all([
        trpc.levels.getGallery.query({ sortBy: sort, offset: page * 12, limit: 12 }),
        page === 0 ? trpc.levels.getFeatured.query({ limit: 3 }) : Promise.resolve(featuredLevels),
        page === 0 ? trpc.levels.getLevelOfTheDay.query() : Promise.resolve(levelOfTheDay),
      ]);
      setGalleryLevels(page === 0 ? levels : [...galleryLevels, ...levels]);
      if (page === 0) {
        setFeaturedLevels(featured);
        setLevelOfTheDay(lotd);
      }
      setGalleryPage(page);
    } catch (err) {
      console.error('Failed to load gallery:', err);
    }
  };

  const loadCreatorLeaderboard = async () => {
    try {
      const data = await trpc.levels.getCreatorLeaderboard.query({ sortBy: 'plays', limit: 5 });
      setCreatorLeaderboard(data);
    } catch (err) {
      console.error('Failed to load creator leaderboard:', err);
    }
  };

  const handleGameOver = useCallback(async (data: GameOverData) => {
    // Blur input to close mobile keyboard immediately
    setKeyboardReady(false);
    inputRef.current?.blur();
    
    setScore(data.score);
    setWordsTyped(data.wordsTyped);
    setTotalWords(data.totalWords);
    setCompleted(data.completed);
    setMaxCombo(data.maxCombo);
    setAccuracy(data.accuracy);
    setWpm(data.wpm);
    setGameState('results');

    if (phaserGame) {
      phaserGame.destroy(true);
      setPhaserGame(null);
    }

    // Submit score to backend
    try {
      const result = await trpc.game.submitScore.mutate({ score: data.score });
      setRank(result.rank);
      setIsNewHighScore(result.isNewHighScore);
      
      // Submit persistent stats
      await trpc.game.submitStats.mutate({
        score: data.score,
        wordsTyped: data.wordsTyped,
        accuracy: data.accuracy,
        maxCombo: data.maxCombo,
        wpm: data.wpm,
      });

      // Submit tournament score
      try {
        const tournamentResult = await trpc.tournament.submitScore.mutate({ score: data.score });
        setTournamentRank(tournamentResult.rank);
      } catch (e) {
        console.error('Failed to submit tournament score:', e);
      }

      // Record UGC level play if applicable
      if (currentUgcLevel) {
        try {
          await trpc.levels.recordPlay.mutate({ levelId: currentUgcLevel.id });
          const ratingData = await trpc.levels.getUserRating.query({ levelId: currentUgcLevel.id });
          setUserRating(ratingData.rating);
        } catch (e) {
          console.error('Failed to record UGC play:', e);
        }
      }

      // Record golden challenge play if applicable
      if (goldenChallenge) {
        try {
          await trpc.golden.recordPlay.mutate({ challengeId: goldenChallenge.id, completed: data.completed });
        } catch (e) {
          console.error('Failed to record golden play:', e);
        }
      }
      
      // Reload leaderboard and stats
      await loadLeaderboard();
      await loadUserBest();
      await loadUserStats();
      await loadTournamentInfo();
      // Preload vault if rewards were collected
      if (goldenChallenge) {
        await loadVault();
      }
    } catch (err) {
      console.error('Failed to submit score:', err);
    }
  }, [phaserGame, currentUgcLevel, goldenChallenge]);

  const handleRewardFound = useCallback(async (data: RewardFoundData) => {
    if (!goldenChallenge) return;
    // Resolve the shuffled word index back to the original reward index
    const originalWordIndex = goldenChallenge.rewardMap[data.wordIndex];
    if (originalWordIndex === undefined) return;
    try {
      const result = await trpc.golden.claimReward.mutate({
        challengeId: goldenChallenge.id,
        wordIndex: data.wordIndex,
        originalWordIndex,
      });
      if (result.success && result.reward) {
        setCollectedRewards(prev => [...prev, { description: result.reward!.description, type: result.reward!.type }]);
        setRewardPopup({ description: result.reward.description, type: result.reward.type });
        setTimeout(() => setRewardPopup(null), 3000);
      }
    } catch (err) {
      console.error('Failed to claim reward:', err);
    }
  }, [goldenChallenge]);

  const handleCountdownComplete = useCallback(() => {
    // Focus the hidden input when countdown finishes — this is when the player needs to type
    setKeyboardReady(true);
    // Small delay to let React re-render (remove readOnly) before focusing
    setTimeout(() => inputRef.current?.focus(), 16);
  }, []);

  const initializeGame = useCallback(async (words: string[], goldenData?: {
    rewardIndices: number[];
    isGolden: boolean;
  }) => {
    setGameState('playing');
    
    // Wait for container to be available with retry logic
    const waitForContainer = (retries = 10): Promise<HTMLDivElement> => {
      return new Promise((resolve, reject) => {
        const check = (attempt: number) => {
          if (gameContainerRef.current) {
            resolve(gameContainerRef.current);
          } else if (attempt >= retries) {
            reject(new Error('Game container not found after retries'));
          } else {
            requestAnimationFrame(() => check(attempt + 1));
          }
        };
        // Start checking after a small delay to let React render
        setTimeout(() => check(0), 50);
      });
    };

    try {
      const container = await waitForContainer();

      // Ensure Phaser is loaded
      if (!phaserRef.current || !gameModuleRef.current) {
        const [phaserModule, gameModule] = await Promise.all([loadPhaser(), loadGameModule()]);
        phaserRef.current = phaserModule.default;
        gameModuleRef.current = gameModule;
      }

      const Phaser = phaserRef.current;
      const { createGameConfig } = gameModuleRef.current;

      // Clear any existing game
      if (phaserGame) {
        phaserGame.destroy(true);
        setPhaserGame(null);
      }

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      const config = createGameConfig(container, width, height);
      const game = new Phaser.Game(config);
      
      game.scene.start('FastTyperGame', {
        words,
        onGameOver: handleGameOver,
        rewardWordIndices: goldenData?.rewardIndices || [],
        onRewardFound: goldenData?.isGolden ? handleRewardFound : undefined,
        isGoldenChallenge: goldenData?.isGolden || false,
        onCountdownComplete: handleCountdownComplete,
      });

      setPhaserGame(game);

      // Don't focus here — wait for countdown to finish (onCountdownComplete)
    } catch (err) {
      console.error('Failed to initialize game:', err);
      setError(`Failed to start game: ${err}`);
      setGameState('menu');
    }
  }, [phaserGame, handleGameOver, handleRewardFound, handleCountdownComplete]);

  const requestDailyChallenge = async () => {
    setError(null);
    setGameState('loading');
    setIsNewHighScore(false);
    setRank(null);
    setShowShareOptions(false);
    setCurrentUgcLevel(null);
    setUserRating(null);
    setGoldenChallenge(null);
    setCollectedRewards([]);

    try {
      // Check if this post is a golden challenge
      if (context.postId) {
        try {
          const goldenData = await trpc.golden.getForPost.query({ postId: context.postId });
          if (goldenData.isGolden && goldenData.challenge) {
            // Once-per-user enforcement
            if (goldenData.hasPlayed) {
              setGoldenAlreadyPlayed(true);
              setError('You have already played this Golden Challenge. Each challenge can only be played once.');
              setGameState('menu');
              return;
            }
            const gc = goldenData.challenge;
            setGoldenChallenge(gc);
            setLevelInfo({ type: 'custom', author: gc.brandName });
            initializeGame(gc.words, { rewardIndices: gc.rewardIndices, isGolden: true });
            return;
          }
        } catch (e) {
          // Not a golden challenge post, continue
        }

        try {
          const ugcData = await trpc.levels.getForPost.query({ postId: context.postId });
          if (ugcData.hasLevel && ugcData.level) {
            setLevelInfo({ type: 'custom', author: ugcData.level.creatorName });
            setCurrentUgcLevel({
              id: ugcData.level.id,
              title: ugcData.level.title,
              creatorName: ugcData.level.creatorName,
              ...(ugcData.level.originalCreator ? { originalCreator: ugcData.level.originalCreator } : {}),
            });
            initializeGame(ugcData.level.words);
            return;
          }
        } catch (e) {
          // Not a UGC level post, continue
        }

        // Check legacy custom level format
        try {
          const levelData = await trpc.game.getLevelForPost.query({ postId: context.postId });
          if (levelData.isCustomLevel && levelData.words) {
            setLevelInfo({ type: 'custom' });
            initializeGame(levelData.words);
            return;
          }
        } catch (e) {
          console.log('No custom level for this post');
        }
      }
      
      // Otherwise load daily challenge
      const data = await trpc.game.getDaily.query();
      setLevelInfo({ type: 'daily' });
      initializeGame(data.words);
    } catch (err) {
      console.error('Failed to load challenge:', err);
      setLevelInfo({ type: 'daily' });
      initializeGame(['REDDIT', 'DEVVIT', 'TYPING', 'GAME', 'FAST']);
    }
  };

  const requestCategoryChallenge = async (categoryId: string, categoryName: string) => {
    setError(null);
    setGameState('loading');
    setIsNewHighScore(false);
    setRank(null);
    setShowShareOptions(false);
    setCurrentUgcLevel(null);
    setUserRating(null);
    setGoldenChallenge(null);
    setCollectedRewards([]);

    try {
      const data = await trpc.game.getWordsByCategory.query({ categoryId });
      setLevelInfo({ type: 'category', categoryName });
      initializeGame(data.words);
    } catch (err) {
      console.error('Failed to load category words:', err);
      setError('Failed to load category. Try daily challenge instead.');
      setGameState('categories');
    }
  };

  const requestCommunityChallenge = async () => {
    setError(null);
    setGameState('loading');
    setIsNewHighScore(false);
    setRank(null);
    setShowShareOptions(false);
    setCurrentUgcLevel(null);
    setUserRating(null);
    setGoldenChallenge(null);
    setCollectedRewards([]);

    try {
      const data = await trpc.game.getCommunityWords.query();
      setLevelInfo({ type: 'community', subredditName: data.subredditName });
      initializeGame(data.words);
    } catch (err) {
      console.error('Failed to load community words:', err);
      setError('Failed to load community words. Try another category.');
      setGameState('categories');
    }
  };

  const requestGalleryLevel = async (level: LevelSummary) => {
    setError(null);
    setGameState('loading');
    setIsNewHighScore(false);
    setRank(null);
    setShowShareOptions(false);
    setUserRating(null);
    setGoldenChallenge(null);
    setCollectedRewards([]);

    try {
      const data = await trpc.levels.getLevel.query({ levelId: level.id });
      if (!data) {
        setError('Level not found');
        setGameState('gallery');
        return;
      }
      setLevelInfo({ type: 'custom', author: level.creatorName });
      setCurrentUgcLevel({
        id: level.id,
        title: level.title,
        creatorName: level.creatorName,
      });
      initializeGame(data.words);
    } catch (err) {
      console.error('Failed to load gallery level:', err);
      setError('Failed to load level.');
      setGameState('gallery');
    }
  };

  const handleRateLevel = async (rating: number) => {
    if (!currentUgcLevel) return;
    try {
      await trpc.levels.rate.mutate({ levelId: currentUgcLevel.id, rating });
      setUserRating(rating);
    } catch (err) {
      console.error('Failed to rate level:', err);
    }
  };

  const viewCreatorProfile = async (username: string) => {
    try {
      const [stats, levels] = await Promise.all([
        trpc.levels.getCreatorStats.query({ username }),
        trpc.levels.getLevelsByCreator.query({ username, limit: 10 }),
      ]);
      setViewingCreator({ username, stats, levels });
    } catch (err) {
      console.error('Failed to load creator profile:', err);
    }
  };

  const addCreatorWord = () => {
    const word = creatorWordInput.trim().replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (!word || word.length < 2 || word.length > 14) return;
    if (creatorWords.includes(word)) return;
    if (creatorWords.length >= 15) return;
    setCreatorWords([...creatorWords, word]);
    setCreatorWordInput('');
  };

  const removeCreatorWord = (index: number) => {
    setCreatorWords(creatorWords.filter((_, i) => i !== index));
  };

  const publishLevel = async () => {
    if (creatorWords.length < 3) {
      setError('Need at least 3 words to create a level');
      return;
    }
    if (!creatorTitle.trim()) {
      setError('Give your level a title');
      return;
    }
    setCreatorPublishing(true);
    setError(null);
    try {
      const result = await trpc.levels.createCustom.mutate({
        title: creatorTitle.trim(),
        words: creatorWords,
      });
      if (!result.success) {
        setError(result.message);
        setCreatorPublishing(false);
        return;
      }
      // Reset creator state
      setCreatorTitle('');
      setCreatorWords([]);
      setCreatorWordInput('');
      setCreatorPublishing(false);
      // Play the level immediately
      if (result.levelId) {
        setCurrentUgcLevel({ id: result.levelId, title: creatorTitle.trim(), creatorName: 'you' });
        setLevelInfo({ type: 'custom', author: 'you' });
        const levelData = await trpc.levels.getLevel.query({ levelId: result.levelId });
        if (levelData) {
          initializeGame(levelData.words);
          return;
        }
      }
      setGameState('menu');
    } catch (err) {
      console.error('Failed to publish level:', err);
      setError('Failed to publish level. Try again.');
      setCreatorPublishing(false);
    }
  };

  const openCreator = () => {
    setCreatorTitle('');
    setCreatorWords([]);
    setCreatorWordInput('');
    setCreatorPublishing(false);
    setGameState('creator');
  };

  const openGoldenCreator = () => {
    setGcTitle('');
    setGcBrandName('');
    setGcMessage('');
    setGcRewards([]);
    setGcTier('golden');
    setGcMaxClaims(100);
    setGcDuration(7);
    setGcPublishing(false);
    setGcBrandLink('');
    loadTokenBalance();
    setGameState('golden-create');
  };

  const publishGoldenChallenge = async () => {
    if (!gcTitle.trim() || !gcBrandName.trim() || !gcMessage.trim()) {
      setError('Fill in all fields');
      return;
    }
    if (gcRewards.length === 0) {
      setError('Add at least 1 reward');
      return;
    }
    setGcPublishing(true);
    setError(null);
    try {
      const result = await trpc.golden.create.mutate({
        title: gcTitle.trim(),
        brandName: gcBrandName.trim(),
        message: gcMessage.trim(),
        rewards: gcRewards.map(r => ({
          wordIndex: r.wordIndex,
          type: r.type as 'coupon' | 'secret' | 'giveaway' | 'message',
          value: r.value,
          description: r.description,
          affiliateLink: r.affiliateLink?.trim() || undefined,
        })),
        tier: gcTier,
        maxClaims: gcMaxClaims,
        durationDays: gcDuration,
        brandLink: gcBrandLink.trim() || undefined,
      });
      if (!result.success) {
        setError(result.message);
        setGcPublishing(false);
        return;
      }
      setGcPublishing(false);
      setError(null);
      setGameState('menu');
    } catch (err) {
      console.error('Failed to create golden challenge:', err);
      setError('Failed to create golden challenge');
      setGcPublishing(false);
    }
  };

  const handleVirtualInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const char = e.target.value.slice(-1);
    if (char && phaserGame && gameModuleRef.current) {
      const scene = phaserGame.scene.getScene('FastTyperGame') as InstanceType<typeof gameModuleRef.current.FastTyperGame>;
      scene?.handleVirtualInput(char);
    }
    e.target.value = '';
  };

  const shareScore = async () => {
    try {
      await trpc.game.shareScore.mutate({ 
        score, 
        wordsTyped, 
        totalWords,
        completed 
      });
      setShowShareOptions(false);
      setError(null);
    } catch (err) {
      console.error('Failed to share score:', err);
    }
  };

  // Keep input focused during gameplay only
  useEffect(() => {
    if (gameState === 'playing') {
      // Aggressively refocus on mobile to keep keyboard open
      // The initial focus happens via onCountdownComplete callback
      const interval = setInterval(() => {
        if (gameState === 'playing' && document.activeElement !== inputRef.current) {
          inputRef.current?.focus();
        }
      }, 300);
      return () => clearInterval(interval);
    } else {
      // Ensure keyboard is closed when not playing
      setKeyboardReady(false);
      inputRef.current?.blur();
    }
  }, [gameState]);

  // Cleanup game on unmount
  useEffect(() => {
    return () => {
      if (phaserGame) {
        phaserGame.destroy(true);
      }
    };
  }, [phaserGame]);

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-white overflow-hidden" style={{ fontFamily: '"Press Start 2P", "Courier New", monospace' }}>
      {/* Hidden input for mobile keyboard */}
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        inputMode="text"
        readOnly={gameState === 'playing' && !keyboardReady}
        className="fixed top-0 left-0 w-full opacity-0 h-10 z-50"
        style={{ fontSize: '16px' }}
        onChange={handleVirtualInput}
      />

      {error && (
        <div className="fixed top-4 left-4 right-4 bg-red-600 text-white p-3 rounded-lg z-50 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {gameState === 'menu' && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <h1 className="text-2xl md:text-3xl text-[#ff4500]" style={{ textShadow: '0 0 10px #ff4500' }}>TYPEERS</h1>
          <p className="text-center text-gray-400 text-[8px] md:text-[10px] max-w-md px-4 leading-relaxed">
            Type words fast before time runs out! Compete with the community.
          </p>
          
          {userBest !== null && (
            <p className="text-[8px] text-gray-500">
              BEST TODAY: <span className="text-[#ff4500]">{userBest}</span>
            </p>
          )}
          
          <div className="flex flex-col gap-3 mt-2">
            <button
              onClick={() => { playButtonClick(); setGameState('tutorial'); }}
              className="px-4 py-3 text-[10px] bg-gray-800 hover:bg-gray-700 border-2 border-gray-600 transition-colors"
              style={{ imageRendering: 'pixelated' }}
            >
              HOW TO PLAY
            </button>
            <button
              onClick={() => { playButtonClick(); requestDailyChallenge(); }}
              className="px-6 py-4 text-[12px] bg-[#ff4500] hover:bg-[#ff5722] border-2 border-[#ff6633] transition-colors active:scale-95"
              style={{ textShadow: '2px 2px 0 #aa2200' }}
            >
              DAILY CHALLENGE
            </button>
            <button
              onClick={() => { playButtonClick(); setGameState('categories'); }}
              className="px-4 py-3 text-[10px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#4a4a6a] transition-colors"
            >
              PICK CATEGORY
            </button>
            <button
              onClick={() => { playButtonClick(); loadGallery(); loadCreatorLeaderboard(); loadGoldenChallenges(); setViewingCreator(null); setGameState('gallery'); }}
              className="px-4 py-3 text-[10px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#9b59b6] transition-colors"
            >
              🎨 CHALLENGE GALLERY
            </button>
            <button
              onClick={() => { playButtonClick(); openCreator(); }}
              className="px-4 py-3 text-[10px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#00ff00] border-opacity-60 transition-colors"
            >
              ✏️ CREATE LEVEL
            </button>
            <button
              onClick={() => { playButtonClick(); openGoldenCreator(); }}
              className="px-4 py-3 text-[10px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#ffd700] border-opacity-60 transition-colors text-[#ffd700]"
            >
              ✨ GOLDEN CHALLENGE
            </button>
            <button
              onClick={() => { playButtonClick(); loadVault(); setGameState('vault'); }}
              className="px-4 py-3 text-[10px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#ff69b4] border-opacity-60 transition-colors text-[#ff69b4]"
            >
              🎁 MY VAULT
            </button>
            <button
              onClick={() => { playButtonClick(); loadTournamentDashboard(); setGameState('tournament-dashboard'); }}
              className="px-4 py-3 text-[10px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#00bcd4] border-opacity-60 transition-colors text-[#00bcd4]"
            >
              🏆 TOURNAMENT
            </button>
            {isGoldenCreator && (
              <button
                onClick={() => { playButtonClick(); loadGoldenDashboard(); setGameState('golden-dashboard'); }}
                className="px-4 py-3 text-[10px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#ffd700] border-opacity-40 transition-colors text-[#ffd700]"
              >
                📊 MY CHALLENGES
              </button>
            )}

          </div>

          {goldenAlreadyPlayed && (
            <p className="text-[8px] text-[#ffd700] text-center mt-2">
              ✨ You've already played this Golden Challenge.
            </p>
          )}

          {/* Mini Leaderboard */}
          {leaderboard.length > 0 && (
            <div className="mt-4 w-full max-w-xs">
              <h3 className="text-[8px] text-gray-500 mb-2 text-center">TOP PLAYERS TODAY</h3>
              <div className="bg-[#111] border-2 border-gray-800 p-3">
                {leaderboard.map((entry, i) => (
                  <div key={entry.username} className="flex justify-between py-1 text-[8px]">
                    <span className="text-gray-400">
                      {i === 0 ? '1ST' : i === 1 ? '2ND' : i === 2 ? '3RD' : `${i + 1}.`} {entry.username.slice(0, 10)}
                    </span>
                    <span className="text-[#00ff00]">{entry.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Weekly Tournament */}
          {tournamentInfo && (
            <div className="mt-4 w-full max-w-xs">
              <h3 className="text-[8px] text-[#ffff00] mb-2 text-center">🏆 WEEKLY TOURNAMENT — {tournamentInfo.weekKey}</h3>
              <div className="bg-[#111] border-2 border-[#ffff00] border-opacity-30 p-3">
                {tournamentInfo.userStats?.bestScore != null && (
                  <div className="flex justify-between text-[8px] mb-2">
                    <span className="text-gray-400">YOUR BEST</span>
                    <span className="text-[#ffff00]">{tournamentInfo.userStats.bestScore} pts (#{tournamentInfo.userStats.rank})</span>
                  </div>
                )}
                {tournamentLeaderboard.length > 0 ? (
                  tournamentLeaderboard.map((entry, i) => (
                    <div key={entry.username} className="flex justify-between py-1 text-[8px]">
                      <span className="text-gray-400">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {entry.username.slice(0, 10)}
                      </span>
                      <span className="text-[#ffff00]">{entry.score}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-[7px] text-gray-500 text-center">NO SCORES YET — BE THE FIRST!</p>
                )}
                <p className="text-[6px] text-gray-600 text-center mt-2">EVERY GAME COUNTS TOWARD THE TOURNAMENT</p>
              </div>
            </div>
          )}

          {/* Active Golden Challenges */}
          {goldenChallenges.length > 0 && (
            <div className="mt-4 w-full max-w-xs">
              <h3 className="text-[8px] text-[#ffd700] mb-2 text-center">✨ GOLDEN CHALLENGES</h3>
              <div className="bg-[#111] border-2 border-[#ffd700] border-opacity-30 p-3">
                {goldenChallenges.slice(0, 3).map((gc) => (
                  <div key={gc.id} className="flex justify-between py-1 text-[8px]">
                    <span className="text-gray-400 truncate flex-1">
                      {gc.tier === 'diamond' ? '💎' : gc.tier === 'legendary' ? '🔥' : '✨'} {gc.title.slice(0, 20)}
                    </span>
                    <span className="text-[#ffd700] ml-2">{gc.rewardCount} 🎁</span>
                  </div>
                ))}
                <p className="text-[6px] text-gray-600 text-center mt-2">TYPE WORDS TO FIND HIDDEN REWARDS</p>
              </div>
            </div>
          )}

          {/* Player Stats */}
          {userStats && (
            <div className="mt-4 w-full max-w-xs">
              <h3 className="text-[8px] text-gray-500 mb-2 text-center">YOUR STATS</h3>
              <div className="bg-[#111] border-2 border-gray-800 p-3">
                <div className="grid grid-cols-2 gap-2 text-[7px]">
                  <div className="flex justify-between">
                    <span className="text-gray-500">GAMES</span>
                    <span className="text-white">{userStats.gamesPlayed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">BEST</span>
                    <span className="text-[#00ff00]">{userStats.allTimeBest}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">WORDS</span>
                    <span className="text-white">{userStats.totalWordsTyped}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">STREAK</span>
                    <span className="text-[#ff4500]">{userStats.streak}d</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Community Features */}
          <div className="mt-4 text-center">
            <p className="text-[6px] text-gray-600 mb-2">CREATE YOUR OWN LEVELS!</p>
            <p className="text-[6px] text-gray-500 max-w-xs leading-relaxed">
              Use "Create Level" above, or the menu on any post or comment
            </p>
          </div>

          <footer className="absolute bottom-4 text-[8px] text-gray-600">
            <button
              className="hover:text-[#ff4500] transition-colors"
              onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
            >
              r/DEVVIT
            </button>
          </footer>
        </div>
      )}

      {gameState === 'tutorial' && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <h2 className="text-xl text-[#ff4500]" style={{ textShadow: '0 0 10px #ff4500' }}>HOW TO PLAY</h2>
          
          <div className="bg-[#111] border-2 border-gray-800 p-4 max-w-sm text-[8px] space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-[#00ff00]">&gt;</span>
              <p className="text-gray-300 leading-relaxed">TYPE THE WORD ON SCREEN AS FAST AS YOU CAN</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#ff4500]">&gt;</span>
              <p className="text-gray-300 leading-relaxed">THE CLOCK DRAINS FAST — TYPE TO SURVIVE!</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#00ff00]">&gt;</span>
              <p className="text-gray-300 leading-relaxed">COMPLETE A WORD = TIME ADDED BACK ⏱️+</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#ff0000]">&gt;</span>
              <p className="text-gray-300 leading-relaxed">WRONG LETTER = TIME DRAINED ⏱️−</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#ffff00]">&gt;</span>
              <p className="text-gray-300 leading-relaxed">COMBOS GIVE BONUS POINTS AND EXTRA TIME</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#ff4500]">&gt;</span>
              <p className="text-gray-300 leading-relaxed">COMPETE ON DAILY LEADERBOARD</p>
            </div>
          </div>

          <div className="bg-[#0a0a0a] border-2 border-[#ff4500] p-4 max-w-sm text-[7px]">
            <h3 className="text-[#ff4500] mb-2">PRO TIPS</h3>
            <ul className="text-gray-400 space-y-2 leading-relaxed">
              <li>&gt; TAP SCREEN FOR MOBILE KEYBOARD</li>
              <li>&gt; ACCURACY FIRST, SPEED LATER</li>
              <li>&gt; CREATE LEVELS FROM ANY POST OR COMMENT!</li>
              <li>&gt; BROWSE THE CHALLENGE GALLERY FOR UGC LEVELS</li>
              <li>&gt; RATE LEVELS TO HELP CREATORS GET FEATURED</li>
            </ul>
          </div>

          <button
            onClick={() => { playButtonClick(); requestDailyChallenge(); }}
            className="mt-4 px-6 py-4 text-[12px] bg-[#ff4500] hover:bg-[#ff5722] border-2 border-[#ff6633] transition-colors"
            style={{ textShadow: '2px 2px 0 #aa2200' }}
          >
            START GAME
          </button>
          
          <button
            onClick={() => { playButtonClick(); setGameState('menu'); }}
            className="text-gray-500 hover:text-white text-[8px]"
          >
            &lt; BACK
          </button>
        </div>
      )}

      {gameState === 'categories' && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <h2 className="text-xl text-[#ff4500]" style={{ textShadow: '0 0 10px #ff4500' }}>PICK CATEGORY</h2>
          <p className="text-[8px] text-gray-500">CHOOSE YOUR WORD PACK</p>

          {/* Community words — pulled from this subreddit */}
          <button
            onClick={() => { playButtonClick(); requestCommunityChallenge(); }}
            className="w-full max-w-xs flex items-center gap-3 p-4 bg-[#111] hover:bg-[#1a1a2e] border-2 border-[#ff4500] border-opacity-50 hover:border-opacity-100 transition-colors"
          >
            <span className="text-[18px]">📍</span>
            <div className="text-left">
              <span className="text-[9px] text-white block">THIS COMMUNITY</span>
              <span className="text-[6px] text-gray-500">WORDS FROM TOP POSTS</span>
            </div>
          </button>

          <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { playButtonClick(); requestCategoryChallenge(cat.id, cat.name); }}
                className="flex flex-col items-center gap-1 p-4 bg-[#111] hover:bg-[#1a1a2e] border-2 border-gray-800 hover:border-[#ff4500] transition-colors"
              >
                <span className="text-[18px]">{cat.emoji}</span>
                <span className="text-[8px] text-white">{cat.name}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 mt-4">
            <button
              onClick={() => { playButtonClick(); requestDailyChallenge(); }}
              className="px-4 py-3 text-[10px] bg-[#ff4500] hover:bg-[#ff5722] border-2 border-[#ff6633] transition-colors"
              style={{ textShadow: '2px 2px 0 #aa2200' }}
            >
              DAILY MIX
            </button>
            <button
              onClick={() => { playButtonClick(); setGameState('menu'); }}
              className="text-gray-500 hover:text-white text-[8px]"
            >
              &lt; BACK
            </button>
          </div>
        </div>
      )}

      {gameState === 'creator' && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <h2 className="text-xl text-[#00ff00]" style={{ textShadow: '0 0 10px #00ff00' }}>✏️ CREATE LEVEL</h2>
          <p className="text-[8px] text-gray-500">ADD 3-15 WORDS FOR YOUR TYPING CHALLENGE</p>

          {/* Title input */}
          <div className="w-full max-w-xs">
            <label className="text-[7px] text-gray-500 block mb-1">LEVEL TITLE</label>
            <input
              type="text"
              value={creatorTitle}
              onChange={(e) => setCreatorTitle(e.target.value)}
              placeholder="My awesome level..."
              maxLength={60}
              className="w-full px-3 py-2 bg-[#111] border-2 border-gray-700 focus:border-[#00ff00] text-white text-[10px] outline-none transition-colors"
              style={{ fontFamily: '"Press Start 2P", monospace' }}
            />
          </div>

          {/* Word input */}
          <div className="w-full max-w-xs">
            <label className="text-[7px] text-gray-500 block mb-1">ADD WORD ({creatorWords.length}/15)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={creatorWordInput}
                onChange={(e) => setCreatorWordInput(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') addCreatorWord(); }}
                placeholder="Type a word..."
                maxLength={14}
                className="flex-1 px-3 py-2 bg-[#111] border-2 border-gray-700 focus:border-[#00ff00] text-white text-[10px] outline-none transition-colors uppercase"
                style={{ fontFamily: '"Press Start 2P", monospace', fontSize: '16px' }}
                disabled={creatorWords.length >= 15}
              />
              <button
                onClick={addCreatorWord}
                disabled={creatorWords.length >= 15 || !creatorWordInput.trim()}
                className="px-3 py-2 bg-[#00ff00] text-black text-[10px] border-2 border-[#00cc00] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ADD
              </button>
            </div>
          </div>

          {/* Word list */}
          <div className="w-full max-w-xs">
            {creatorWords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {creatorWords.map((word, i) => (
                  <button
                    key={`${word}-${i}`}
                    onClick={() => removeCreatorWord(i)}
                    className="px-2 py-1 bg-[#111] border border-gray-700 hover:border-red-500 hover:bg-red-900 hover:bg-opacity-30 text-[8px] text-white transition-colors group"
                    title="Click to remove"
                  >
                    {word} <span className="text-gray-600 group-hover:text-red-400">×</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[7px] text-gray-600 text-center py-4">NO WORDS YET — START ADDING!</p>
            )}
          </div>

          {/* Publish */}
          <div className="flex flex-col gap-2 mt-2 w-full max-w-xs">
            <button
              onClick={() => { playButtonClick(); publishLevel(); }}
              disabled={creatorWords.length < 3 || !creatorTitle.trim() || creatorPublishing}
              className="w-full px-4 py-3 text-[10px] bg-[#00ff00] text-black border-2 border-[#00cc00] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              style={{ textShadow: '1px 1px 0 rgba(0,0,0,0.2)' }}
            >
              {creatorPublishing ? 'PUBLISHING...' : `PUBLISH & PLAY (${creatorWords.length} WORDS)`}
            </button>
            <p className="text-[6px] text-gray-600 text-center">
              YOUR LEVEL WILL BE POSTED AND ADDED TO THE CHALLENGE GALLERY
            </p>
          </div>

          <button
            onClick={() => { playButtonClick(); setGameState('menu'); }}
            className="text-gray-500 hover:text-white text-[8px] mt-2"
          >
            &lt; BACK
          </button>
        </div>
      )}

      {gameState === 'gallery' && !viewingCreator && (
        <div className="flex min-h-screen flex-col items-center gap-4 p-4 pt-8 pb-16">
          <h2 className="text-xl text-[#9b59b6]" style={{ textShadow: '0 0 10px #9b59b6' }}>🎨 CHALLENGE GALLERY</h2>

          {/* Filter tabs */}
          <div className="flex gap-1 w-full max-w-xs">
            {([['all', 'ALL'], ['levels', '⌨️ LEVELS'], ['golden', '✨ GOLDEN']] as const).map(([key, label]) => (
              <button key={key}
                onClick={() => setGalleryFilter(key)}
                className={`flex-1 py-1.5 text-[7px] border-2 transition-colors ${galleryFilter === key ? 'bg-[#9b59b6] border-[#9b59b6] text-white' : 'bg-[#111] border-gray-700 text-gray-400'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Level of the Day — only in 'all' or 'levels' */}
          {galleryFilter !== 'golden' && levelOfTheDay && (
            <div className="w-full max-w-xs">
              <h3 className="text-[8px] text-[#ffff00] mb-2 text-center">⭐ LEVEL OF THE DAY</h3>
              <button
                onClick={() => { playButtonClick(); requestGalleryLevel(levelOfTheDay); }}
                className="w-full p-3 bg-[#111] hover:bg-[#1a1a2e] border-2 border-[#ffff00] border-opacity-50 hover:border-opacity-100 transition-colors text-left"
              >
                <p className="text-[9px] text-white truncate">{levelOfTheDay.title}</p>
                <div className="flex justify-between mt-1">
                  <p className="text-[6px] text-gray-500">
                    by <span className="text-[#9b59b6] cursor-pointer" onClick={(e) => { e.stopPropagation(); viewCreatorProfile(levelOfTheDay.creatorName); }}>u/{levelOfTheDay.creatorName}</span> · {levelOfTheDay.wordCount} words
                  </p>
                  <p className="text-[6px] text-[#00ff00]">▶ {levelOfTheDay.plays}{levelOfTheDay.ratingCount > 0 ? ` · ${'★'.repeat(Math.round(levelOfTheDay.avgRating))}` : ''}</p>
                </div>
              </button>
            </div>
          )}

          {/* Golden Challenges — in 'all' or 'golden' */}
          {galleryFilter !== 'levels' && goldenChallenges.length > 0 && (
            <div className="w-full max-w-xs">
              {galleryFilter === 'all' && <h3 className="text-[8px] text-[#ffd700] mb-2 text-center">✨ GOLDEN CHALLENGES</h3>}
              <div className="space-y-1">
                {goldenChallenges.map((gc) => (
                  <div key={gc.id} className="p-2 bg-[#111] border border-[#ffd700] border-opacity-40">
                    <div className="flex justify-between items-center">
                      <div className="flex-1 min-w-0">
                        <p className="text-[8px] text-[#ffd700] truncate">
                          {gc.tier === 'diamond' ? '💎' : gc.tier === 'legendary' ? '🔥' : '✨'} {gc.title}
                        </p>
                        <p className="text-[6px] text-gray-500">by {gc.brandName} · {gc.wordCount} words · {gc.rewardCount} rewards</p>
                      </div>
                      <p className="text-[6px] text-gray-400 ml-2 flex-shrink-0">{gc.claimCount}/{gc.maxClaims}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Golden-only empty state */}
          {galleryFilter === 'golden' && goldenChallenges.length === 0 && (
            <div className="text-center py-8">
              <p className="text-[8px] text-gray-500">NO GOLDEN CHALLENGES YET</p>
              <p className="text-[6px] text-gray-600 mt-2">CREATE ONE FROM THE MENU!</p>
            </div>
          )}

          {/* Featured Levels — only in 'all' or 'levels' */}
          {galleryFilter !== 'golden' && featuredLevels.length > 0 && (
            <div className="w-full max-w-xs">
              <h3 className="text-[8px] text-[#ff4500] mb-2 text-center">🔥 FEATURED</h3>
              <div className="space-y-1">
                {featuredLevels.map((level) => (
                  <button
                    key={level.id}
                    onClick={() => { playButtonClick(); requestGalleryLevel(level); }}
                    className="w-full text-left p-2 bg-[#111] hover:bg-[#1a1a2e] border border-gray-800 hover:border-[#ff4500] transition-colors"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex-1 min-w-0">
                        <p className="text-[7px] text-white truncate">{level.isRemix ? '🔄 ' : ''}{level.title}</p>
                        <p className="text-[6px] text-gray-500">
                          by <span className="text-[#9b59b6]" onClick={(e) => { e.stopPropagation(); viewCreatorProfile(level.creatorName); }}>u/{level.creatorName}</span>
                        </p>
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <p className="text-[6px] text-[#ffff00]">{'★'.repeat(Math.round(level.avgRating))}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sort tabs — only for levels */}
          {galleryFilter !== 'golden' && (
            <div className="flex gap-2">
              <button
                onClick={() => { setGallerySortBy('plays'); loadGallery('plays'); }}
                className={`px-3 py-1 text-[8px] border-2 transition-colors ${gallerySortBy === 'plays' ? 'bg-[#9b59b6] border-[#9b59b6] text-white' : 'bg-[#111] border-gray-700 text-gray-400'}`}
              >
                MOST PLAYED
              </button>
              <button
                onClick={() => { setGallerySortBy('rating'); loadGallery('rating'); }}
                className={`px-3 py-1 text-[8px] border-2 transition-colors ${gallerySortBy === 'rating' ? 'bg-[#9b59b6] border-[#9b59b6] text-white' : 'bg-[#111] border-gray-700 text-gray-400'}`}
              >
                TOP RATED
              </button>
            </div>
          )}

          {/* Level list — only in 'all' or 'levels' */}
          {galleryFilter !== 'golden' && (
            <div className="w-full max-w-xs space-y-2">
              {galleryLevels.length > 0 ? (
                <>
                  {galleryLevels.map((level) => (
                    <button
                      key={level.id}
                      onClick={() => { playButtonClick(); requestGalleryLevel(level); }}
                      className="w-full text-left p-3 bg-[#111] hover:bg-[#1a1a2e] border-2 border-gray-800 hover:border-[#9b59b6] transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-[8px] text-white truncate">{level.isRemix ? '🔄 ' : ''}{level.title}</p>
                          <p className="text-[6px] text-gray-500 mt-1">
                            by <span className="text-[#9b59b6]" onClick={(e) => { e.stopPropagation(); viewCreatorProfile(level.creatorName); }}>u/{level.creatorName}</span> · {level.wordCount} words
                          </p>
                        </div>
                        <div className="text-right ml-2 flex-shrink-0">
                          <p className="text-[7px] text-[#00ff00]">▶ {level.plays}</p>
                          {level.ratingCount > 0 && (
                            <p className="text-[7px] text-[#ffff00]">{'★'.repeat(Math.round(level.avgRating))}{'☆'.repeat(5 - Math.round(level.avgRating))}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                  {galleryLevels.length >= (galleryPage + 1) * 12 && (
                    <button
                      onClick={() => loadGallery(gallerySortBy, galleryPage + 1)}
                      className="w-full py-2 text-[8px] text-[#9b59b6] hover:text-white bg-[#111] border-2 border-gray-800 hover:border-[#9b59b6] transition-colors text-center"
                    >
                      LOAD MORE
                    </button>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-[8px] text-gray-500">NO LEVELS YET</p>
                  <p className="text-[6px] text-gray-600 mt-2">BE THE FIRST TO CREATE ONE!</p>
                  <button
                    onClick={() => { playButtonClick(); openCreator(); }}
                    className="mt-3 px-4 py-2 text-[8px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#00ff00] border-opacity-60 text-[#00ff00] transition-colors"
                  >
                    ✏️ CREATE LEVEL
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Creator Leaderboard — only in 'all' or 'levels' */}
          {galleryFilter !== 'golden' && creatorLeaderboard.length > 0 && (
            <div className="w-full max-w-xs mt-4">
              <h3 className="text-[8px] text-[#9b59b6] mb-2 text-center">🏅 TOP CREATORS</h3>
              <div className="bg-[#111] border-2 border-gray-800 p-3">
                {creatorLeaderboard.map((entry, i) => (
                  <button
                    key={entry.username}
                    onClick={() => viewCreatorProfile(entry.username)}
                    className="w-full flex justify-between py-1 text-[8px] hover:text-white transition-colors"
                  >
                    <span className="text-gray-400">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {entry.username.slice(0, 12)}
                    </span>
                    <span className="text-[#9b59b6]">{entry.score} plays</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => { playButtonClick(); openCreator(); }}
              className="px-3 py-2 text-[8px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#00ff00] border-opacity-60 text-[#00ff00] transition-colors"
            >
              ✏️ CREATE
            </button>
            <button
              onClick={() => { playButtonClick(); setGameState('menu'); }}
              className="text-gray-500 hover:text-white text-[8px] px-3 py-2"
            >
              &lt; BACK
            </button>
          </div>
        </div>
      )}

      {/* Creator Profile View */}
      {gameState === 'gallery' && viewingCreator && (
        <div className="flex min-h-screen flex-col items-center gap-4 p-4 pt-8 pb-16">
          <h2 className="text-lg text-[#9b59b6]" style={{ textShadow: '0 0 10px #9b59b6' }}>u/{viewingCreator.username}</h2>

          {/* Badges */}
          {viewingCreator.stats && viewingCreator.stats.badges.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {viewingCreator.stats.badges.map((badge) => (
                <span key={badge} className="px-2 py-1 text-[7px] bg-[#1a1a2e] border border-[#9b59b6] text-[#9b59b6]">
                  {badge === 'Level Architect' ? '🏗️' : badge === 'Master Builder' ? '👷' : badge === 'Community Favorite' ? '❤️' : badge === 'Viral Creator' ? '🚀' : badge === 'Well Reviewed' ? '⭐' : '🏅'} {badge.toUpperCase()}
                </span>
              ))}
            </div>
          )}

          {/* Creator Stats */}
          {viewingCreator.stats && (
            <div className="bg-[#111] border-2 border-gray-800 p-3 w-full max-w-xs">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[#9b59b6] text-[12px]">{viewingCreator.stats.levelsCreated}</p>
                  <p className="text-gray-500 text-[6px]">LEVELS</p>
                </div>
                <div>
                  <p className="text-[#00ff00] text-[12px]">{viewingCreator.stats.totalPlays}</p>
                  <p className="text-gray-500 text-[6px]">TOTAL PLAYS</p>
                </div>
                <div>
                  <p className="text-[#ffff00] text-[12px]">{viewingCreator.stats.totalRatings}</p>
                  <p className="text-gray-500 text-[6px]">RATINGS</p>
                </div>
              </div>
            </div>
          )}

          {/* Creator's Levels */}
          <div className="w-full max-w-xs">
            <h3 className="text-[8px] text-gray-500 mb-2 text-center">THEIR LEVELS</h3>
            <div className="space-y-2">
              {viewingCreator.levels.length > 0 ? (
                viewingCreator.levels.map((level) => (
                  <button
                    key={level.id}
                    onClick={() => { playButtonClick(); requestGalleryLevel(level); }}
                    className="w-full text-left p-3 bg-[#111] hover:bg-[#1a1a2e] border-2 border-gray-800 hover:border-[#9b59b6] transition-colors"
                  >
                    <div className="flex justify-between items-center">
                      <p className="text-[8px] text-white truncate flex-1">{level.isRemix ? '🔄 ' : ''}{level.title}</p>
                      <div className="text-right ml-2">
                        <p className="text-[7px] text-[#00ff00]">▶ {level.plays}</p>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-[7px] text-gray-500 text-center py-4">NO LEVELS YET</p>
              )}
            </div>
          </div>

          <button
            onClick={() => { playButtonClick(); setViewingCreator(null); }}
            className="text-gray-500 hover:text-white text-[8px] mt-4"
          >
            &lt; BACK TO CHALLENGES
          </button>
        </div>
      )}

      {gameState === 'loading' && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4">
          <div className="text-2xl text-[#ff4500] animate-pulse">...</div>
          <p className="text-gray-400 text-[10px]">GET READY</p>
        </div>
      )}

      {gameState === 'playing' && (
        <div
          ref={gameContainerRef}
          className="w-full h-screen"
          style={{ minHeight: '100vh', touchAction: 'manipulation' }}
          onClick={() => { if (keyboardReady) inputRef.current?.focus(); }}
        />
      )}

      {gameState === 'results' && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <h1 className="text-lg md:text-xl text-[#ff4500]" style={{ textShadow: '0 0 10px #ff4500' }}>
            {completed ? 'COMPLETE!' : 'TIME\'S UP!'}
          </h1>
          
          {isNewHighScore && (
            <div className="text-[#ffff00] text-[10px] animate-pulse">
              NEW HIGH SCORE!
            </div>
          )}
          
          <div className="text-center">
            <p className="text-3xl md:text-4xl text-[#00ff00]" style={{ textShadow: '0 0 15px #00ff00' }}>{score}</p>
            <p className="text-gray-500 mt-1 text-[8px]">POINTS</p>
          </div>

          {rank && (
            <p className="text-gray-400 text-[8px]">
              RANK: <span className="text-white">#{rank}</span>
            </p>
          )}

          {tournamentRank && (
            <p className="text-[#ffff00] text-[8px]">
              🏆 TOURNAMENT RANK: <span className="text-white">#{tournamentRank}</span>
            </p>
          )}

          <div className="text-center text-gray-400 text-[8px]">
            <p>WORDS: {wordsTyped}/{totalWords}</p>
            {levelInfo?.type === 'daily' && <p className="text-[6px] mt-1">DAILY CHALLENGE</p>}
            {levelInfo?.type === 'custom' && <p className="text-[6px] mt-1">CUSTOM LEVEL{levelInfo.author ? ` by u/${levelInfo.author}` : ''}</p>}
            {levelInfo?.type === 'category' && <p className="text-[6px] mt-1">{levelInfo.categoryName} CATEGORY</p>}
            {levelInfo?.type === 'community' && <p className="text-[6px] mt-1">📍 r/{levelInfo.subredditName} WORDS</p>}
          </div>

          {/* UGC Level Rating */}
          {currentUgcLevel && (
            <div className="bg-[#111] border-2 border-[#9b59b6] border-opacity-50 p-3 w-full max-w-xs text-center">
              <p className="text-[7px] text-gray-400 mb-2">RATE THIS LEVEL</p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleRateLevel(star)}
                    className={`text-[16px] transition-colors ${userRating && star <= userRating ? 'text-[#ffff00]' : 'text-gray-600 hover:text-[#ffff00]'}`}
                  >
                    {userRating && star <= userRating ? '★' : '☆'}
                  </button>
                ))}
              </div>
              {userRating && <p className="text-[6px] text-gray-500 mt-1">RATED {userRating}/5</p>}
              {currentUgcLevel.originalCreator && (
                <p className="text-[6px] text-gray-500 mt-1">REMIX OF u/{currentUgcLevel.originalCreator}'S LEVEL</p>
              )}
              <div className="flex justify-center gap-2 mt-2">
                <button
                  onClick={() => { playButtonClick(); viewCreatorProfile(currentUgcLevel.creatorName); setGameState('gallery'); }}
                  className="px-2 py-1 text-[7px] bg-[#1a1a2e] hover:bg-[#2a2a3e] border border-[#9b59b6] transition-colors"
                >
                  VIEW CREATOR
                </button>
              </div>
              <p className="text-[6px] text-gray-600 mt-2 leading-relaxed">
                THIS LEVEL WAS CREATED BY u/{currentUgcLevel.creatorName} — CHECK OUT THEIR PROFILE!
              </p>
            </div>
          )}

          {/* Golden Challenge — Full Message Reveal */}
          {goldenChallenge && (
            <div className="bg-[#111] border-2 border-[#ffd700] p-3 w-full max-w-xs"
              style={{ boxShadow: '0 0 12px rgba(255,215,0,0.15)' }}>
              <p className="text-[7px] text-[#ffd700] mb-2 text-center">✨ MESSAGE FROM {goldenChallenge.brandName.toUpperCase()}</p>
              <p className="text-[9px] text-white leading-relaxed text-center">
                {goldenChallenge.fullMessage}
              </p>
              <p className="text-[6px] text-gray-500 mt-2 text-center">
                {goldenChallenge.tier === 'diamond' ? '💎' : goldenChallenge.tier === 'legendary' ? '🔥' : '✨'} {goldenChallenge.title}
              </p>
              {goldenChallenge.brandLink && (
                <button
                  onClick={async () => {
                    try {
                      const result = await trpc.golden.trackBrandClick.mutate({ challengeId: goldenChallenge.id });
                      if (result.url) window.open(result.url, '_blank', 'noopener');
                    } catch { /* best effort */ }
                  }}
                  className="w-full mt-2 px-3 py-2 text-[8px] bg-[#ffd700] bg-opacity-20 border border-[#ffd700] text-[#ffd700] hover:bg-opacity-40 transition-colors text-center"
                >
                  🔗 VISIT {goldenChallenge.brandName.toUpperCase()}
                </button>
              )}
            </div>
          )}

          {/* Rewards Collected This Game */}
          {collectedRewards.length > 0 && (
            <div className="bg-[#111] border-2 border-[#00ff00] p-3 w-full max-w-xs"
              style={{ boxShadow: '0 0 12px rgba(0,255,0,0.1)' }}>
              <p className="text-[7px] text-[#00ff00] mb-2 text-center">🎁 REWARDS COLLECTED ({collectedRewards.length})</p>
              {collectedRewards.map((r, i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <span className="text-[10px]">{r.type === 'coupon' ? '🏷️' : r.type === 'secret' ? '🔒' : r.type === 'giveaway' ? '🎁' : '💬'}</span>
                  <p className="text-[8px] text-white">{r.description}</p>
                </div>
              ))}
              <p className="text-[6px] text-gray-500 mt-2 text-center">SAVED TO YOUR VAULT — VIEW ANYTIME</p>
            </div>
          )}

          {/* Stats Breakdown */}
          <div className="bg-[#111] border-2 border-gray-800 p-3 w-full max-w-xs">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="text-[#00ffff] text-[12px]">{wpm}</p>
                <p className="text-gray-500 text-[6px]">WPM</p>
              </div>
              <div>
                <p className="text-[#00ff00] text-[12px]">{accuracy}%</p>
                <p className="text-gray-500 text-[6px]">ACCURACY</p>
              </div>
              <div>
                <p className="text-[#ffff00] text-[12px]">{maxCombo}x</p>
                <p className="text-gray-500 text-[6px]">MAX COMBO</p>
              </div>
              <div>
                <p className="text-[#ff4500] text-[12px]">{wordsTyped}/{totalWords}</p>
                <p className="text-gray-500 text-[6px]">WORDS</p>
              </div>
            </div>
          </div>

          {/* Share Options */}
          <div className="flex flex-col gap-2 mt-2">
            <button
              onClick={() => { playButtonClick(); setShowShareOptions(!showShareOptions); }}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 border-2 border-blue-500 transition-colors text-[8px]"
            >
              SHARE SCORE
            </button>
            
            {showShareOptions && (
              <div className="bg-[#111] border-2 border-gray-800 p-3 text-[8px]">
                <p className="text-gray-400 mb-2 text-[6px]">POST TO COMMENTS</p>
                <button
                  onClick={() => { playButtonClick(); shareScore(); }}
                  className="w-full px-4 py-2 bg-[#ff4500] hover:bg-[#ff5722] border-2 border-[#ff6633] text-[8px]"
                >
                  POST SCORE
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-2">
            <button
              onClick={() => { playButtonClick(); requestDailyChallenge(); }}
              className="px-4 py-2 bg-[#ff4500] hover:bg-[#ff5722] border-2 border-[#ff6633] transition-colors text-[8px]"
            >
              PLAY AGAIN
            </button>
            <button
              onClick={() => { playButtonClick(); setGameState('menu'); }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border-2 border-gray-600 transition-colors text-[8px]"
            >
              MENU
            </button>
          </div>

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <div className="mt-4 w-full max-w-xs">
              <h3 className="text-[8px] text-gray-500 mb-2 text-center">LEADERBOARD</h3>
              <div className="bg-[#111] border-2 border-gray-800 p-3">
                {leaderboard.map((entry, i) => (
                  <div key={entry.username} className="flex justify-between py-1 text-[8px]">
                    <span className="text-gray-400">
                      {i === 0 ? '1ST' : i === 1 ? '2ND' : i === 2 ? '3RD' : `${i + 1}.`} {entry.username.slice(0, 10)}
                    </span>
                    <span className="text-[#00ff00]">{entry.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Challenge Friends */}
          <div className="mt-4 text-center">
            <button
              onClick={() => { playButtonClick(); loadGallery(); loadCreatorLeaderboard(); loadGoldenChallenges(); setViewingCreator(null); setGameState('gallery'); }}
              className="px-4 py-2 bg-[#1a1a2e] hover:bg-[#2a2a3e] border-2 border-[#9b59b6] transition-colors text-[8px] text-[#9b59b6]"
            >
              🎨 BROWSE CHALLENGES
            </button>
            <p className="text-[6px] text-gray-500 leading-relaxed mt-2">
              SHARE THIS POST TO CHALLENGE FRIENDS
            </p>
          </div>
        </div>
      )}

      {/* ── Vault Screen ──────────────────────────────────────────────── */}
      {gameState === 'vault' && (
        <div className="flex min-h-screen flex-col items-center gap-4 p-4 pt-8 pb-16">
          <h2 className="text-xl text-[#ff69b4]" style={{ textShadow: '0 0 10px #ff69b4' }}>🎁 MY VAULT</h2>
          <p className="text-[8px] text-gray-500">YOUR CLAIMED REWARDS</p>

          {vaultItems.length > 0 ? (
            <div className="w-full max-w-xs space-y-2">
              {vaultItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 bg-[#111] border-2 transition-colors ${item.redeemed ? 'border-gray-700 opacity-60' : 'border-[#ffd700]'}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <p className="text-[8px] text-[#ffd700] truncate">
                        {item.reward.type === 'coupon' ? '🏷️' : item.reward.type === 'secret' ? '🔒' : item.reward.type === 'giveaway' ? '🎁' : '💬'} {item.reward.description}
                      </p>
                      <p className="text-[6px] text-gray-500 mt-1">
                        from {item.brandName} · {item.challengeTitle}
                      </p>
                    </div>
                    {!item.redeemed && (
                      <button
                        onClick={async () => {
                          await trpc.golden.redeemVaultItem.mutate({ itemId: item.id });
                          loadVault();
                        }}
                        className="ml-2 px-2 py-1 text-[7px] bg-[#ffd700] text-black border border-[#cc9900] flex-shrink-0"
                      >
                        REVEAL
                      </button>
                    )}
                  </div>
                  {item.redeemed && (
                    <div className="mt-2 p-2 bg-[#0a0a0a] border border-[#ffd700] border-opacity-30">
                      <p className="text-[8px] text-[#00ff00] break-all">{item.reward.value}</p>
                    </div>
                  )}
                  <p className="text-[5px] text-gray-600 mt-1">
                    {new Date(item.claimedAt).toLocaleDateString()} {item.redeemed ? '· REDEEMED' : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[8px] text-gray-500">NO REWARDS YET</p>
              <p className="text-[6px] text-gray-600 mt-2">PLAY GOLDEN CHALLENGES TO FIND HIDDEN REWARDS!</p>
            </div>
          )}

          <button
            onClick={() => { playButtonClick(); setGameState('menu'); }}
            className="text-gray-500 hover:text-white text-[8px] mt-4"
          >
            &lt; BACK
          </button>
        </div>
      )}

      {/* ── Golden Challenge Creation ─────────────────────────────────── */}
      {gameState === 'golden-create' && (
        <div className="flex min-h-screen flex-col items-center gap-3 p-4 pt-8 pb-16">
          <h2 className="text-lg text-[#ffd700]" style={{ textShadow: '0 0 10px #ffd700' }}>✨ CREATE GOLDEN CHALLENGE</h2>
          <p className="text-[7px] text-gray-500 max-w-xs text-center">HIDE REWARDS IN YOUR MESSAGE. PLAYERS TYPE YOUR WORDS AND DISCOVER HIDDEN GIFTS.</p>

          <div className="w-full max-w-xs space-y-3">
            <div>
              <label className="text-[7px] text-gray-500 block mb-1">CHALLENGE TITLE</label>
              <input type="text" value={gcTitle} onChange={(e) => setGcTitle(e.target.value)} placeholder="Summer Sale Challenge..." maxLength={80}
                className="w-full px-3 py-2 bg-[#111] border-2 border-gray-700 focus:border-[#ffd700] text-white text-[10px] outline-none" style={{ fontFamily: '"Press Start 2P", monospace', fontSize: '16px' }} />
            </div>
            <div>
              <label className="text-[7px] text-gray-500 block mb-1">BRAND NAME</label>
              <input type="text" value={gcBrandName} onChange={(e) => setGcBrandName(e.target.value)} placeholder="Your Brand..." maxLength={40}
                className="w-full px-3 py-2 bg-[#111] border-2 border-gray-700 focus:border-[#ffd700] text-white text-[10px] outline-none" style={{ fontFamily: '"Press Start 2P", monospace', fontSize: '16px' }} />
            </div>
            <div>
              <label className="text-[7px] text-gray-500 block mb-1">MESSAGE (WORDS PLAYERS WILL TYPE)</label>
              <textarea value={gcMessage} onChange={(e) => setGcMessage(e.target.value)} placeholder="Check out our amazing new product launch this summer..." maxLength={500} rows={3}
                className="w-full px-3 py-2 bg-[#111] border-2 border-gray-700 focus:border-[#ffd700] text-white text-[9px] outline-none resize-none" style={{ fontFamily: '"Press Start 2P", monospace', fontSize: '16px' }} />
              <p className="text-[6px] text-gray-600 mt-1">
                WORDS: {gcMessage.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length >= 2).length}/{gcTier === 'golden' ? 15 : gcTier === 'diamond' ? 25 : 30}
              </p>
            </div>

            {/* Reward setup */}
            <div>
              <label className="text-[7px] text-gray-500 block mb-1">HIDDEN REWARDS ({gcRewards.length}/{gcTier === 'golden' ? 3 : gcTier === 'diamond' ? 6 : 10})</label>
              {gcMessage.trim() && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {gcMessage.split(/\s+/).map((w) => w.replace(/[^a-zA-Z]/g, '')).filter(w => w.length >= 2).map((word, i) => {
                    const hasReward = gcRewards.some(r => r.wordIndex === i);
                    return (
                      <button key={`${word}-${i}`}
                        onClick={() => {
                          const maxRewards = gcTier === 'golden' ? 3 : gcTier === 'diamond' ? 6 : 10;
                          if (hasReward) {
                            setGcRewards(gcRewards.filter(r => r.wordIndex !== i));
                          } else if (gcRewards.length < maxRewards) {
                            setGcRewards([...gcRewards, { wordIndex: i, type: 'coupon', value: '', description: '' }]);
                          }
                        }}
                        className={`px-1 py-0.5 text-[7px] border transition-colors ${hasReward ? 'bg-[#ffd700] text-black border-[#cc9900]' : 'bg-[#111] text-gray-400 border-gray-700 hover:border-[#ffd700]'}`}
                      >
                        {word.toUpperCase().slice(0, 10)}
                      </button>
                    );
                  })}
                </div>
              )}
              {gcRewards.map((reward, idx) => (
                <div key={idx} className="bg-[#0a0a0a] border border-gray-700 p-2 mb-2">
                  <p className="text-[6px] text-[#ffd700] mb-1">WORD #{reward.wordIndex + 1}</p>
                  <select value={reward.type} onChange={(e) => {
                    const updated = [...gcRewards];
                    updated[idx] = { ...reward, type: e.target.value };
                    setGcRewards(updated);
                  }} className="w-full mb-1 px-2 py-1 bg-[#111] border border-gray-700 text-white text-[8px] outline-none">
                    <option value="coupon">🏷️ Coupon</option>
                    <option value="secret">🔒 Secret</option>
                    <option value="giveaway">🎁 Giveaway</option>
                    <option value="message">💬 Message</option>
                  </select>
                  <input type="text" placeholder="What player sees: 10% off..." value={reward.description}
                    onChange={(e) => { const u = [...gcRewards]; u[idx] = { ...reward, description: e.target.value }; setGcRewards(u); }}
                    className="w-full mb-1 px-2 py-1 bg-[#111] border border-gray-700 text-white text-[8px] outline-none" style={{ fontSize: '16px' }} />
                  <input type="text" placeholder="Hidden value: CODE123..." value={reward.value}
                    onChange={(e) => { const u = [...gcRewards]; u[idx] = { ...reward, value: e.target.value }; setGcRewards(u); }}
                    className="w-full px-2 py-1 bg-[#111] border border-gray-700 text-[#00ff00] text-[8px] outline-none" style={{ fontSize: '16px' }} />
                  {gcTier === 'legendary' && (
                    <input type="url" placeholder="Affiliate link (optional): https://..." value={reward.affiliateLink ?? ''}
                      onChange={(e) => { const u = [...gcRewards]; u[idx] = { ...reward, affiliateLink: e.target.value }; setGcRewards(u); }}
                      className="w-full mt-1 px-2 py-1 bg-[#111] border border-gray-700 text-[#00bcd4] text-[8px] outline-none" style={{ fontSize: '16px' }} />
                  )}
                </div>
              ))}
            </div>

            {/* Tier & settings */}
            <div className="flex gap-2">
              {(['golden', 'diamond', 'legendary'] as const).map(t => {
                const limits = { golden: { w: 15, r: 3, c: 100, d: 7 }, diamond: { w: 25, r: 6, c: 500, d: 30 }, legendary: { w: 30, r: 10, c: 2000, d: 90 } }[t];
                return (
                  <button key={t} onClick={() => {
                    setGcTier(t);
                    setGcMaxClaims(limits.c);
                    setGcDuration(limits.d);
                    // Clear brand link if downgrading to golden
                    if (t === 'golden') { setGcBrandLink(''); }
                    // Clear affiliate links if not legendary
                    if (t !== 'legendary') {
                      setGcRewards(gcRewards.map(({ affiliateLink: _, ...rest }) => rest));
                    }
                  }}
                    className={`flex-1 py-2 text-[6px] border-2 transition-colors ${gcTier === t ? 'bg-[#ffd700] text-black border-[#ffd700]' : 'bg-[#111] text-gray-400 border-gray-700'}`}>
                    {t === 'golden' ? '✨ 25g' : t === 'diamond' ? '💎 100g' : '🔥 500g'}
                    <br />{t.toUpperCase()}
                    <br /><span className="text-[5px]">{limits.w}w · {limits.r}r · {limits.c}c · {limits.d}d</span>
                    {t !== 'golden' && <br />}
                    {t === 'diamond' && <span className="text-[5px]">+ BRAND LINK</span>}
                    {t === 'legendary' && <span className="text-[5px]">+ LINKS + AFFILIATE</span>}
                    {tokenBalance[t] > 0 && <span className="text-[6px]"> ({tokenBalance[t]})</span>}
                  </button>
                );
              })}
            </div>

            {/* Brand Link (diamond + legendary) */}
            {(gcTier === 'diamond' || gcTier === 'legendary') && (
              <div>
                <label className="text-[7px] text-gray-500 block mb-1">🔗 BRAND LINK (SHOWN AFTER GAME)</label>
                <input type="url" value={gcBrandLink} onChange={(e) => setGcBrandLink(e.target.value)} placeholder="https://yourbrand.com"
                  maxLength={500}
                  className="w-full px-3 py-2 bg-[#111] border-2 border-gray-700 focus:border-[#00bcd4] text-[#00bcd4] text-[9px] outline-none" style={{ fontFamily: '"Press Start 2P", monospace', fontSize: '16px' }} />
                <p className="text-[5px] text-gray-600 mt-1">UTM TRACKING AUTO-APPENDED · CLICKS TRACKED IN DASHBOARD</p>
              </div>
            )}

            {/* Token balance & purchase */}
            <div className="bg-[#0a0a0a] border border-[#ffd700] border-opacity-30 p-2">
              {tokenBalance[gcTier] > 0 ? (
                <p className="text-[7px] text-[#00ff00] text-center">
                  ✓ YOU HAVE {tokenBalance[gcTier]} {gcTier.toUpperCase()} TOKEN{tokenBalance[gcTier] > 1 ? 'S' : ''}
                </p>
              ) : (
                <div className="text-center">
                  <p className="text-[7px] text-[#ff4500] mb-2">NO {gcTier.toUpperCase()} TOKENS — PURCHASE WITH REDDIT GOLD</p>
                  <button
                    onClick={async () => {
                      playButtonClick();
                      await purchaseToken(gcTier);
                    }}
                    disabled={purchasing}
                    className="px-4 py-2 text-[8px] bg-[#ffd700] text-black border-2 border-[#cc9900] transition-colors disabled:opacity-50"
                  >
                    {purchasing ? 'PURCHASING...' : `BUY ${gcTier.toUpperCase()} (${gcTier === 'golden' ? '25' : gcTier === 'diamond' ? '100' : '500'} GOLD)`}
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[6px] text-gray-500 block mb-1">MAX CLAIMS</label>
                <input type="number" value={gcMaxClaims} onChange={(e) => setGcMaxClaims(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
                  className="w-full px-2 py-1 bg-[#111] border border-gray-700 text-white text-[8px] outline-none" style={{ fontSize: '16px' }} />
              </div>
              <div className="flex-1">
                <label className="text-[6px] text-gray-500 block mb-1">DURATION (DAYS)</label>
                <input type="number" value={gcDuration} onChange={(e) => setGcDuration(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))}
                  className="w-full px-2 py-1 bg-[#111] border border-gray-700 text-white text-[8px] outline-none" style={{ fontSize: '16px' }} />
              </div>
            </div>

            <button onClick={() => { playButtonClick(); publishGoldenChallenge(); }}
              disabled={gcPublishing || !gcTitle.trim() || !gcBrandName.trim() || !gcMessage.trim() || gcRewards.length === 0 || tokenBalance[gcTier] < 1}
              className="w-full px-4 py-3 text-[10px] bg-[#ffd700] text-black border-2 border-[#cc9900] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              style={{ textShadow: '1px 1px 0 rgba(255,255,255,0.3)' }}>
              {gcPublishing ? 'CREATING...' : tokenBalance[gcTier] < 1 ? 'PURCHASE TOKEN FIRST' : '✨ CREATE GOLDEN CHALLENGE'}
            </button>
            <p className="text-[6px] text-gray-600 text-center">REQUIRES MOD APPROVAL BEFORE GOING LIVE</p>
          </div>

          <button onClick={() => { playButtonClick(); setGameState('menu'); }}
            className="text-gray-500 hover:text-white text-[8px] mt-2">&lt; BACK</button>
        </div>
      )}

      {/* ── Tournament Dashboard ──────────────────────────────────────── */}
      {gameState === 'tournament-dashboard' && (
        <div className="flex min-h-screen flex-col items-center gap-4 p-4 pt-8 pb-16">
          <h2 className="text-xl text-[#00bcd4]" style={{ textShadow: '0 0 10px #00bcd4' }}>🏆 TOURNAMENT</h2>

          {tournamentDashboard ? (
            <div className="w-full max-w-sm space-y-4">
              {/* Current Week */}
              <div className="p-3 bg-[#111] border-2 border-[#00bcd4]">
                <p className="text-[9px] text-[#00bcd4] mb-2">THIS WEEK — {tournamentDashboard.currentWeek.weekKey}</p>
                <div className="flex gap-4 mb-3">
                  <div className="text-center">
                    <p className="text-[14px] text-white">{tournamentDashboard.currentWeek.totalPlayers}</p>
                    <p className="text-[6px] text-gray-500">PLAYERS</p>
                  </div>
                  {tournamentDashboard.currentWeek.userStats?.bestScore != null && (
                    <>
                      <div className="text-center">
                        <p className="text-[14px] text-[#ffd700]">{tournamentDashboard.currentWeek.userStats.bestScore}</p>
                        <p className="text-[6px] text-gray-500">YOUR BEST</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[14px] text-[#ff4500]">#{tournamentDashboard.currentWeek.userStats.rank ?? '—'}</p>
                        <p className="text-[6px] text-gray-500">YOUR RANK</p>
                      </div>
                    </>
                  )}
                </div>
                {tournamentDashboard.currentWeek.leaderboard.length > 0 ? (
                  <div className="space-y-1">
                    {tournamentDashboard.currentWeek.leaderboard.map((entry, i) => (
                      <div key={entry.username} className="flex justify-between text-[8px]">
                        <span className={i < 3 ? 'text-[#ffd700]' : 'text-gray-400'}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {entry.username}
                        </span>
                        <span className="text-white">{entry.score}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[7px] text-gray-600 text-center">NO SCORES YET — BE THE FIRST!</p>
                )}
              </div>

              {/* Previous Week */}
              <div className="p-3 bg-[#111] border-2 border-gray-700">
                <p className="text-[9px] text-gray-400 mb-2">LAST WEEK — {tournamentDashboard.previousWeek.weekKey}</p>
                <div className="flex gap-4 mb-3">
                  <div className="text-center">
                    <p className="text-[12px] text-gray-400">{tournamentDashboard.previousWeek.totalPlayers}</p>
                    <p className="text-[6px] text-gray-600">PLAYERS</p>
                  </div>
                  {tournamentDashboard.previousWeek.userStats?.bestScore != null && (
                    <>
                      <div className="text-center">
                        <p className="text-[12px] text-gray-400">{tournamentDashboard.previousWeek.userStats.bestScore}</p>
                        <p className="text-[6px] text-gray-600">YOUR BEST</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[12px] text-gray-400">#{tournamentDashboard.previousWeek.userStats.rank ?? '—'}</p>
                        <p className="text-[6px] text-gray-600">YOUR RANK</p>
                      </div>
                    </>
                  )}
                </div>
                {tournamentDashboard.previousWeek.leaderboard.length > 0 ? (
                  <div className="space-y-1">
                    {tournamentDashboard.previousWeek.leaderboard.slice(0, 10).map((entry, i) => (
                      <div key={entry.username} className="flex justify-between text-[7px]">
                        <span className={i < 3 ? 'text-[#ffd700]' : 'text-gray-500'}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {entry.username}
                        </span>
                        <span className="text-gray-400">{entry.score}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[7px] text-gray-600 text-center">NO DATA</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[8px] text-gray-500">LOADING...</p>
          )}

          <button onClick={() => { playButtonClick(); setGameState('menu'); }}
            className="text-gray-500 hover:text-white text-[8px] mt-4">&lt; BACK</button>
        </div>
      )}

      {/* ── Golden Creator Dashboard ──────────────────────────────────── */}
      {gameState === 'golden-dashboard' && (
        <div className="flex min-h-screen flex-col items-center gap-4 p-4 pt-8 pb-16">
          <h2 className="text-lg text-[#ffd700]" style={{ textShadow: '0 0 10px #ffd700' }}>📊 MY CHALLENGES</h2>

          {goldenDashboard ? (
            <div className="w-full max-w-sm space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-[#111] border border-[#ffd700] border-opacity-30 text-center">
                  <p className="text-[14px] text-[#ffd700]">{goldenDashboard.totals.totalChallenges}</p>
                  <p className="text-[5px] text-gray-500">CHALLENGES</p>
                </div>
                <div className="p-2 bg-[#111] border border-[#00ff00] border-opacity-30 text-center">
                  <p className="text-[14px] text-[#00ff00]">{goldenDashboard.totals.activeChallenges}</p>
                  <p className="text-[5px] text-gray-500">ACTIVE</p>
                </div>
                <div className="p-2 bg-[#111] border border-[#ff4500] border-opacity-30 text-center">
                  <p className="text-[14px] text-[#ff4500]">{goldenDashboard.totals.totalPlays}</p>
                  <p className="text-[5px] text-gray-500">TOTAL PLAYS</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-[#111] border border-gray-700 text-center">
                  <p className="text-[12px] text-white">{goldenDashboard.totals.totalCompletions}</p>
                  <p className="text-[5px] text-gray-500">COMPLETIONS</p>
                </div>
                <div className="p-2 bg-[#111] border border-gray-700 text-center">
                  <p className="text-[12px] text-white">{goldenDashboard.totals.totalClaims}</p>
                  <p className="text-[5px] text-gray-500">REWARDS CLAIMED</p>
                </div>
              </div>

              {/* Token Balance */}
              <div className="p-2 bg-[#111] border border-[#ffd700] border-opacity-20">
                <p className="text-[7px] text-gray-500 mb-1">TOKEN BALANCE</p>
                <div className="flex gap-3 text-[8px]">
                  <span className="text-[#ffd700]">🥇 {goldenDashboard.tokenBalance.golden}</span>
                  <span className="text-[#00bcd4]">💎 {goldenDashboard.tokenBalance.diamond}</span>
                  <span className="text-[#ff4500]">🔥 {goldenDashboard.tokenBalance.legendary}</span>
                </div>
              </div>

              {/* Challenge List */}
              <div className="space-y-2">
                <p className="text-[8px] text-gray-400">YOUR CHALLENGES</p>
                {goldenDashboard.challenges.length > 0 ? (
                  goldenDashboard.challenges.map((ch) => {
                    const isActive = ch.status === 'active' && Date.now() < ch.expiresAt;
                    const isExpired = ch.status === 'active' && Date.now() >= ch.expiresAt;
                    const statusColor = ch.status === 'pending' ? '#ffa500' : isActive ? '#00ff00' : ch.status === 'rejected' ? '#ff0000' : '#666';
                    const statusLabel = isExpired ? 'EXPIRED' : ch.status.toUpperCase();
                    const daysLeft = isActive ? Math.max(0, Math.ceil((ch.expiresAt - Date.now()) / 86400000)) : 0;

                    return (
                      <div key={ch.id} className="p-3 bg-[#111] border border-gray-700">
                        <div className="flex justify-between items-start mb-1">
                          <p className="text-[8px] text-white truncate flex-1">{ch.title}</p>
                          <span className="text-[6px] ml-2 flex-shrink-0" style={{ color: statusColor }}>{statusLabel}</span>
                        </div>
                        <p className="text-[6px] text-gray-500">{ch.brandName} · {ch.tier.toUpperCase()} · {ch.wordCount} words · {ch.rewardCount} rewards</p>
                        {ch.analytics && (
                          <div className="flex gap-3 mt-2 text-[6px]">
                            <span className="text-gray-400">▶ {ch.analytics.plays} plays</span>
                            <span className="text-gray-400">✓ {ch.analytics.completions} done</span>
                            <span className="text-[#ffd700]">🎁 {ch.analytics.totalClaims} claims</span>
                          </div>
                        )}
                        {ch.linkAnalytics && (
                          <div className="flex gap-3 mt-1 text-[6px]">
                            <span className="text-[#00bcd4]">🔗 {ch.linkAnalytics.brandLinkClicks} link clicks</span>
                            {Object.keys(ch.linkAnalytics.affiliateClicks).length > 0 && (
                              <span className="text-[#ff69b4]">
                                📎 {Object.values(ch.linkAnalytics.affiliateClicks).reduce((a, b) => a + b, 0)} affiliate clicks
                              </span>
                            )}
                          </div>
                        )}
                        {ch.brandLink && (
                          <p className="text-[5px] text-[#00bcd4] mt-1 truncate">🔗 {ch.brandLink}</p>
                        )}
                        <div className="flex justify-between mt-1 text-[5px] text-gray-600">
                          <span>{ch.claimCount}/{ch.maxClaims} claims used</span>
                          {isActive && <span>{daysLeft}d left</span>}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-[7px] text-gray-600 text-center py-4">NO CHALLENGES YET</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[8px] text-gray-500">LOADING...</p>
          )}

          <button onClick={() => { playButtonClick(); setGameState('menu'); }}
            className="text-gray-500 hover:text-white text-[8px] mt-4">&lt; BACK</button>
        </div>
      )}

      {/* ── Reward Popup Overlay ──────────────────────────────────────── */}
      {rewardPopup && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] pointer-events-none">
          <div className="bg-[#111] border-4 border-[#ffd700] p-6 text-center animate-bounce pointer-events-auto"
            style={{ boxShadow: '0 0 30px rgba(255,215,0,0.5)' }}>
            <p className="text-[16px] mb-2">🎁</p>
            <p className="text-[10px] text-[#ffd700] mb-1" style={{ fontFamily: '"Press Start 2P", monospace' }}>REWARD FOUND!</p>
            <p className="text-[8px] text-white" style={{ fontFamily: '"Press Start 2P", monospace' }}>{rewardPopup.description}</p>
            <p className="text-[6px] text-gray-500 mt-2" style={{ fontFamily: '"Press Start 2P", monospace' }}>SAVED TO YOUR VAULT</p>
            <button onClick={() => setRewardPopup(null)}
              className="mt-3 px-3 py-1 text-[7px] bg-[#ffd700] text-black border border-[#cc9900]"
              style={{ fontFamily: '"Press Start 2P", monospace' }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
    <App />
);
