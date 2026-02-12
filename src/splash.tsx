import './index.css';

import { requestExpandedMode, context } from '@devvit/web/client';
import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { trpc } from './trpc';

// Simple button click sound for splash screen
const playButtonClick = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const bufferSize = ctx.sampleRate * 0.025;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
    }
    
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 1.5;
    
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.25;
    
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    
    osc.frequency.value = 1000;
    osc.type = 'sine';
    
    oscGain.gain.setValueAtTime(0.08, ctx.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    
    noiseSource.start(ctx.currentTime);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.03);
  } catch (e) {
    // Audio not supported
  }
};

interface LeaderboardEntry {
  username: string;
  score: number;
}

export const Splash = () => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [goldenChallenge, setGoldenChallenge] = useState<{ title: string; brandName: string; tier: string } | null>(null);

  useEffect(() => {
    loadLeaderboard();
    loadGoldenChallenge();
  }, []);

  const loadLeaderboard = async () => {
    try {
      const data = await trpc.game.getLeaderboard.query({ limit: 3 });
      setLeaderboard(data);
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  };

  const loadGoldenChallenge = async () => {
    try {
      if (!context.postId) return;
      const data = await trpc.golden.getForPost.query({ postId: context.postId });
      if (data.isGolden && data.challenge) {
        setGoldenChallenge({ title: data.challenge.title, brandName: data.challenge.brandName, tier: data.challenge.tier });
      }
    } catch {
      // Not a golden challenge post
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0a0a0a] text-white p-4" style={{ fontFamily: '"Press Start 2P", "Courier New", monospace' }}>
      <h1 className="text-xl text-[#ff4500]" style={{ textShadow: '0 0 10px #ff4500' }}>TYPEERS</h1>
      <p className="text-center text-gray-400 text-[8px] max-w-xs leading-relaxed">
        TYPE FAST. BEAT THE CLOCK. TOP THE BOARD!
      </p>
      
      {/* Golden Challenge Banner */}
      {goldenChallenge && (
        <div className="bg-[#111] border-2 border-[#ffd700] p-3 w-full max-w-[240px] mt-2 text-center"
          style={{ boxShadow: '0 0 12px rgba(255,215,0,0.2)' }}>
          <p className="text-[7px] text-[#ffd700] mb-1">
            {goldenChallenge.tier === 'diamond' ? '💎' : goldenChallenge.tier === 'legendary' ? '🔥' : '✨'} GOLDEN CHALLENGE
          </p>
          <p className="text-[9px] text-white">{goldenChallenge.title}</p>
          <p className="text-[6px] text-gray-500 mt-1">by {goldenChallenge.brandName}</p>
        </div>
      )}

      {/* Mini preview of top scores */}
      {!goldenChallenge && leaderboard.length > 0 && (
        <div className="bg-[#111] border-2 border-gray-800 p-2 w-full max-w-[200px] mt-2">
          <p className="text-[7px] text-gray-500 text-center mb-1">TOP PLAYERS</p>
          {leaderboard.slice(0, 3).map((entry, i) => (
            <div key={entry.username} className="flex justify-between text-[7px] py-0.5">
              <span className="text-gray-400">
                {i === 0 ? '1ST' : i === 1 ? '2ND' : '3RD'} {entry.username.slice(0, 8)}
              </span>
              <span className="text-[#00ff00]">{entry.score}</span>
            </div>
          ))}
        </div>
      )}
      
      <button
        className={`mt-3 px-6 py-3 text-[10px] border-2 transition-colors active:scale-95 ${goldenChallenge ? 'bg-[#ffd700] hover:bg-[#ffe033] border-[#cc9900] text-black' : 'bg-[#ff4500] hover:bg-[#ff5722] border-[#ff6633]'}`}
        style={{ textShadow: goldenChallenge ? '1px 1px 0 rgba(255,255,255,0.3)' : '2px 2px 0 #aa2200' }}
        onClick={(e) => { playButtonClick(); requestExpandedMode(e.nativeEvent, 'game'); }}
      >
        {goldenChallenge ? '✨ PLAY GOLDEN CHALLENGE' : 'PLAY NOW'}
      </button>

      {context.username && (
        <p className="text-[7px] text-gray-500 mt-1">
          PLAYER: {context.username.toUpperCase()}
        </p>
      )}

      <p className="text-[6px] text-gray-600 mt-2 text-center max-w-xs leading-relaxed">
        CREATE LEVELS FROM COMMENTS!
      </p>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
    <Splash />
);
