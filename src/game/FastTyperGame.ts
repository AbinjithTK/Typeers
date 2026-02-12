import Phaser from 'phaser';

export interface GameOverData {
  score: number;
  completed: boolean;
  wordsTyped: number;
  totalWords: number;
  maxCombo: number;
  accuracy: number;
  wpm: number;
  livesLost: number;
}

export interface RewardFoundData {
  wordIndex: number;
  word: string;
}


// Pixel font family with fallbacks
const PIXEL_FONT = '"Press Start 2P", "Courier New", monospace';

// Audio context for sound effects
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext;
}

// Different click characteristics for variety (like different keys on a keyboard)
const KEY_CLICKS = [
  { freq: 1800, duration: 0.035 },
  { freq: 2000, duration: 0.030 },
  { freq: 1600, duration: 0.040 },
  { freq: 2200, duration: 0.032 },
  { freq: 1900, duration: 0.038 },
];
let clickIndex = 0;

function playTypingSound() {
  try {
    const ctx = getAudioContext();
    const click = KEY_CLICKS[clickIndex];
    if (!click) return;
    clickIndex = (clickIndex + 1) % 5;
    
    // Create noise for the "thock" part of the keypress
    const bufferSize = ctx.sampleRate * click.duration;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      // Filtered noise that decays quickly
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }
    
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    
    // Bandpass filter to shape the click sound
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = click.freq;
    filter.Q.value = 2;
    
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.4;
    
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    // Add a subtle click tone
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    
    clickOsc.frequency.value = click.freq;
    clickOsc.type = 'sine';
    
    clickGain.gain.setValueAtTime(0.08, ctx.currentTime);
    clickGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02);
    
    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    
    noiseSource.start(ctx.currentTime);
    clickOsc.start(ctx.currentTime);
    clickOsc.stop(ctx.currentTime + 0.02);
  } catch (e) {
    // Audio not supported or blocked
  }
}

function playWrongSound() {
  try {
    const ctx = getAudioContext();
    
    // Harsh buzz for wrong key
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.value = 120;
    oscillator.type = 'sawtooth';
    
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.12);
  } catch (e) {
    // Audio not supported or blocked
  }
}

function playSuccessSound() {
  try {
    const ctx = getAudioContext();
    
    // Big Enter key press sound - louder and more satisfying
    // First: the heavy "thock" of the enter key going down
    const bufferSize = ctx.sampleRate * 0.08;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
    }
    
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    filter.Q.value = 1;
    
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    // Tone that drops in pitch (like pressing down)
    const downOsc = ctx.createOscillator();
    const downGain = ctx.createGain();
    
    downOsc.type = 'sine';
    downOsc.frequency.setValueAtTime(800, ctx.currentTime);
    downOsc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.06);
    
    downGain.gain.setValueAtTime(0.15, ctx.currentTime);
    downGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
    
    downOsc.connect(downGain);
    downGain.connect(ctx.destination);
    
    // Second tone that rises (key coming back up)
    const upOsc = ctx.createOscillator();
    const upGain = ctx.createGain();
    
    upOsc.type = 'sine';
    upOsc.frequency.setValueAtTime(500, ctx.currentTime + 0.07);
    upOsc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.12);
    
    upGain.gain.setValueAtTime(0.001, ctx.currentTime);
    upGain.gain.setValueAtTime(0.1, ctx.currentTime + 0.07);
    upGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    
    upOsc.connect(upGain);
    upGain.connect(ctx.destination);
    
    noiseSource.start(ctx.currentTime);
    downOsc.start(ctx.currentTime);
    downOsc.stop(ctx.currentTime + 0.1);
    upOsc.start(ctx.currentTime);
    upOsc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    // Audio not supported or blocked
  }
}

// UI Button click sound - exported for React components
export function playButtonSound() {
  try {
    const ctx = getAudioContext();
    
    // Soft click for UI buttons
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
    
    // Quick pop tone
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
    // Audio not supported or blocked
  }
}

export class FastTyperGame extends Phaser.Scene {
  private typedText!: Phaser.GameObjects.Text;
  private remainingText!: Phaser.GameObjects.Text;
  private timerGraphics!: Phaser.GameObjects.Graphics;
  private scoreText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private bonusContainer!: Phaser.GameObjects.Container;
  private comboText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;

  private currentWord: string = '';
  private typedSoFar: string = '';
  private wordList: string[] = [];
  private currentWordIndex: number = 0;
  private score: number = 0;
  private isGameActive: boolean = false;
  private isTransitioning: boolean = false;
  private onGameOver: ((data: GameOverData) => void) | undefined;
  private isMobile: boolean = false;
  private lastKeyboardInputTime: number = 0;

  // Golden challenge support
  private rewardWordIndices: number[] = [];
  private onRewardFound: ((data: RewardFoundData) => void) | undefined;
  private isGoldenChallenge: boolean = false;
  private onCountdownComplete: (() => void) | undefined;

  // Global timer (ms)
  private readonly totalTime: number = 20000; // 20 seconds
  private timeRemaining: number = 20000;
  private lastUpdateTime: number = 0;

  // Time adjustments
  private readonly drainRate: number = 1.4;         // timer drains 1.4x faster than real time
  private readonly timePerWord: number = 2000;      // +2s base for completing a word
  private readonly timePenalty: number = 1000;       // -1s per wrong letter
  private readonly maxTime: number = 25000;          // cap at 25s

  // Combo & stats
  private combo: number = 0;
  private maxCombo: number = 0;
  private correctKeys: number = 0;
  private totalKeys: number = 0;
  private gameStartTime: number = 0;
  private wordStartTime: number = 0;

  constructor() {
    super('FastTyperGame');
  }

  init(data: {
    words: string[];
    onGameOver?: (data: GameOverData) => void;
    rewardWordIndices?: number[];
    onRewardFound?: (data: RewardFoundData) => void;
    isGoldenChallenge?: boolean;
    onCountdownComplete?: () => void;
  }) {
    this.wordList = data.words || ['REDDIT', 'HACKATHON', 'DEVVIT', 'GAMING'];
    this.onGameOver = data.onGameOver;
    this.rewardWordIndices = data.rewardWordIndices || [];
    this.onRewardFound = data.onRewardFound;
    this.isGoldenChallenge = data.isGoldenChallenge || false;
    this.onCountdownComplete = data.onCountdownComplete;
    this.currentWordIndex = 0;
    this.score = 0;
    this.typedSoFar = '';
    this.isTransitioning = false;
    this.isMobile = window.innerWidth < 768;
    this.combo = 0;
    this.maxCombo = 0;
    this.correctKeys = 0;
    this.totalKeys = 0;
    this.gameStartTime = 0;
    this.wordStartTime = 0;
    this.timeRemaining = this.totalTime;
    this.lastUpdateTime = 0;
  }

  create() {
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const wordY = this.isMobile ? height * 0.25 : height * 0.45;
    const wordFontSize = this.isMobile ? '20px' : '28px';

    this.cameras.main.setBackgroundColor('#0a0a0a');

    this.timerGraphics = this.add.graphics();

    // Score
    this.scoreText = this.add.text(width - 15, 15, 'SCORE 0', {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '10px' : '14px',
      color: '#00ff00',
      stroke: '#003300',
      strokeThickness: 1,
    }).setOrigin(1, 0);

    // Progress
    this.progressText = this.add.text(15, 15, '', {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '10px' : '14px',
      color: '#888888',
    });

    // Timer text (seconds remaining)
    this.timerText = this.add.text(centerX, this.isMobile ? height - 18 : height - 28, '', {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '10px' : '14px',
      color: '#ff4500',
      stroke: '#331100',
      strokeThickness: 1,
    }).setOrigin(0.5);

    // Instruction text
    this.instructionText = this.add.text(centerX, wordY + 80, 'TYPE THE WORD!', {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '8px' : '10px',
      color: '#666666',
    }).setOrigin(0.5);

    // Word display
    this.typedText = this.add.text(centerX, wordY, '', {
      fontFamily: PIXEL_FONT,
      fontSize: wordFontSize,
      color: '#00ff00',
      stroke: '#004400',
      strokeThickness: 2,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: '#00ff00',
        blur: 8,
        fill: true,
      },
    }).setOrigin(1, 0.5);

    this.remainingText = this.add.text(centerX, wordY, '', {
      fontFamily: PIXEL_FONT,
      fontSize: wordFontSize,
      color: '#ffffff',
      stroke: '#333333',
      strokeThickness: 2,
    }).setOrigin(0, 0.5);

    // Container for bonus animations
    this.bonusContainer = this.add.container(centerX, wordY - 60);

    // Combo display
    this.comboText = this.add.text(15, this.isMobile ? 30 : 35, '', {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '8px' : '10px',
      color: '#ff4500',
    });

    // Countdown text
    this.countdownText = this.add.text(centerX, wordY, '', {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '40px' : '60px',
      color: '#ff4500',
      stroke: '#331100',
      strokeThickness: 4,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: '#ff4500',
        blur: 15,
        fill: true,
      },
    }).setOrigin(0.5).setDepth(10);

    this.input.keyboard?.on('keydown', this.handleInput, this);

    // Hide game elements during countdown
    this.typedText.setVisible(false);
    this.remainingText.setVisible(false);
    this.instructionText.setVisible(false);
    this.scoreText.setVisible(false);
    this.progressText.setVisible(false);
    this.comboText.setVisible(false);
    this.timerText.setVisible(false);

    this.showCountdown();
  }

  showCountdown() {
    const steps = ['3', '2', '1', 'GO!'];
    let step = 0;

    const showNext = () => {
      if (step >= steps.length) {
        this.countdownText.setVisible(false);
        this.typedText.setVisible(true);
        this.remainingText.setVisible(true);
        this.instructionText.setVisible(true);
        this.scoreText.setVisible(true);
        this.progressText.setVisible(true);
        this.comboText.setVisible(true);
        this.timerText.setVisible(true);
        this.startGame();
        return;
      }

      const text = steps[step];
      if (!text) return;
      this.countdownText.setText(text);
      this.countdownText.setVisible(true);
      this.countdownText.setScale(0.3);
      this.countdownText.setAlpha(1);

      if (text === 'GO!') {
        this.countdownText.setColor('#00ff00');
        this.countdownText.setStroke('#003300', 4);
      } else {
        this.countdownText.setColor('#ff4500');
        this.countdownText.setStroke('#331100', 4);
      }

      this.tweens.add({
        targets: this.countdownText,
        scale: 1,
        duration: 200,
        ease: 'Back.easeOut',
      });

      this.tweens.add({
        targets: this.countdownText,
        alpha: 0,
        scale: 1.5,
        duration: 300,
        delay: text === 'GO!' ? 400 : 500,
        ease: 'Power2',
        onComplete: () => {
          step++;
          showNext();
        },
      });

      playButtonSound();
    };

    showNext();
  }

  startGame() {
    this.isGameActive = true;
    this.gameStartTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.timeRemaining = this.totalTime;
    this.nextWord();

    // Notify React to focus the input NOW (keyboard should appear when typing starts)
    if (this.onCountdownComplete) {
      this.onCountdownComplete();
    }
  }

  nextWord() {
    if (this.currentWordIndex >= this.wordList.length) {
      this.endGame(true);
      return;
    }

    const word = this.wordList[this.currentWordIndex];
    this.currentWord = word ? word.toUpperCase() : '';
    this.typedSoFar = '';
    this.isTransitioning = false;
    this.wordStartTime = Date.now();
    this.updateTextVisuals();
    this.updateProgress();

    if (this.currentWordIndex > 0) {
      this.instructionText.setVisible(false);
    }
  }

  addTime(ms: number) {
    this.timeRemaining = Math.min(this.maxTime, this.timeRemaining + ms);
    // Flash the timer text green briefly
    this.timerText.setColor('#00ff00');
    this.time.delayedCall(300, () => {
      if (this.timerText) this.timerText.setColor('#ff4500');
    });
  }

  drainTime(ms: number) {
    this.timeRemaining = Math.max(0, this.timeRemaining - ms);
    // Flash timer red
    this.timerText.setColor('#ff0000');
    this.time.delayedCall(200, () => {
      if (this.timerText) this.timerText.setColor('#ff4500');
    });
    if (this.timeRemaining <= 0) {
      this.endGame(false);
    }
  }

  showWordCompleteAnimation(basePoints: number, timeBonus: number, comboBonus: number = 0) {
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const wordY = this.isMobile ? height * 0.25 : height * 0.45;

    this.bonusContainer.removeAll(true);

    const totalPoints = basePoints + timeBonus + comboBonus;

    // Main points text - pixel style
    const pointsText = this.add.text(0, 0, `+${totalPoints}`, {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '14px' : '18px',
      color: '#00ff00',
      stroke: '#003300',
      strokeThickness: 2,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: '#00ff00',
        blur: 6,
        fill: true,
      },
    }).setOrigin(0.5);

    this.bonusContainer.add(pointsText);

    let yOffset = this.isMobile ? 20 : 26;

    // Speed bonus text - pixel style
    if (timeBonus > 0) {
      const bonusText = this.add.text(0, yOffset, `SPEED +${timeBonus}`, {
        fontFamily: PIXEL_FONT,
        fontSize: this.isMobile ? '6px' : '8px',
        color: '#ff4500',
        stroke: '#331100',
        strokeThickness: 1,
      }).setOrigin(0.5);
      this.bonusContainer.add(bonusText);
      yOffset += this.isMobile ? 16 : 20;
    }

    // Combo bonus text
    if (comboBonus > 0) {
      const comboText = this.add.text(0, yOffset, `${this.combo}x COMBO +${comboBonus}`, {
        fontFamily: PIXEL_FONT,
        fontSize: this.isMobile ? '6px' : '8px',
        color: '#ffff00',
        stroke: '#333300',
        strokeThickness: 1,
      }).setOrigin(0.5);
      this.bonusContainer.add(comboText);
    }

    this.bonusContainer.setPosition(centerX, wordY - 50);
    this.bonusContainer.setAlpha(1);
    this.bonusContainer.setScale(0.3);

    // Pop in animation
    this.tweens.add({
      targets: this.bonusContainer,
      scale: 1,
      duration: 200,
      ease: 'Back.easeOut',
    });

    // Float up and fade
    this.tweens.add({
      targets: this.bonusContainer,
      y: wordY - 100,
      alpha: 0,
      duration: 600,
      delay: 300,
      ease: 'Power1',
    });

    // Word pulse
    this.tweens.add({
      targets: [this.typedText, this.remainingText],
      scale: 1.15,
      duration: 80,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    // Pixel particle burst
    this.createParticleBurst(centerX, wordY);
  }

  createParticleBurst(x: number, y: number) {
    const colors = [0x00ff00, 0xff4500, 0xffff00, 0x00ffff, 0xff00ff];
    const particleCount = this.isMobile ? 6 : 10;

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const distance = 50 + Math.random() * 30;
      // Square pixels instead of circles
      const size = this.isMobile ? 4 : 6;
      const particle = this.add.rectangle(x, y, size, size, colors[i % colors.length]);
      
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0,
        duration: 350,
        ease: 'Power2',
        onComplete: () => particle.destroy(),
      });
    }
  }

  showRewardFoundAnimation() {
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const centerY = this.isMobile ? height * 0.25 : height * 0.45;

    // Golden particle burst
    const goldColors = [0xffd700, 0xffaa00, 0xffcc33, 0xffe066, 0xffffff];
    const particleCount = this.isMobile ? 12 : 20;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const distance = 60 + Math.random() * 50;
      const size = this.isMobile ? 5 : 8;
      const particle = this.add.rectangle(centerX, centerY, size, size, goldColors[i % goldColors.length]);
      this.tweens.add({
        targets: particle,
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0,
        duration: 600,
        ease: 'Power2',
        onComplete: () => particle.destroy(),
      });
    }

    // "REWARD FOUND!" text
    const rewardText = this.add.text(centerX, centerY - 90, '🎁 REWARD FOUND!', {
      fontFamily: PIXEL_FONT,
      fontSize: this.isMobile ? '10px' : '14px',
      color: '#ffd700',
      stroke: '#664400',
      strokeThickness: 3,
      shadow: { offsetX: 0, offsetY: 0, color: '#ffd700', blur: 12, fill: true },
    }).setOrigin(0.5).setDepth(20);

    rewardText.setScale(0.3);
    this.tweens.add({
      targets: rewardText,
      scale: 1.2,
      duration: 300,
      ease: 'Back.easeOut',
      yoyo: true,
      hold: 600,
      onComplete: () => {
        this.tweens.add({
          targets: rewardText,
          alpha: 0,
          y: centerY - 140,
          duration: 400,
          onComplete: () => rewardText.destroy(),
        });
      },
    });

    // Golden flash
    this.cameras.main.flash(200, 255, 215, 0, false);

    // Play reward sound
    this.playRewardSound();
  }

  private playRewardSound() {
    try {
      const ctx = getAudioContext();
      // Ascending chime — magical reward sound
      const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.3);
      });
    } catch {
      // Audio not supported
    }
  }

  handleInput(event: KeyboardEvent) {
    if (!this.isGameActive || this.isTransitioning) return;

    if (event.key.length !== 1) return;

    this.lastKeyboardInputTime = Date.now();

    const nextChar = this.currentWord[this.typedSoFar.length];
    this.totalKeys++;

    if (event.key.toUpperCase() === nextChar) {
      playTypingSound();
      this.correctKeys++;
      this.typedSoFar += nextChar;

      if (this.typedSoFar === this.currentWord) {
        this.wordComplete();
      }
    } else {
      playWrongSound();
      this.combo = 0;
      this.updateCombo();
      this.cameras.main.shake(100, 0.01);
      this.score = Math.max(0, this.score - 10);
      this.drainTime(this.timePenalty);
    }

    this.updateTextVisuals();
    this.updateScore();
  }

  wordComplete() {
    this.isTransitioning = true;
    
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    
    // Speed bonus: faster completion = more points
    const wordTime = Date.now() - this.wordStartTime;
    const wordLen = this.currentWord.length;
    const basePoints = 50 + wordLen * 15; // longer words = more base points
    const speedBonus = Math.max(0, Math.floor((3000 - wordTime) / 30)); // up to ~100 bonus for fast typing
    const comboMultiplier = Math.min(this.combo, 8);
    const comboBonus = this.combo > 1 ? Math.floor(basePoints * (comboMultiplier - 1) * 0.2) : 0;
    const totalPoints = basePoints + speedBonus + comboBonus;
    
    this.score += totalPoints;

    // Check if this word is a reward word (golden challenge)
    const isRewardWord = this.rewardWordIndices.includes(this.currentWordIndex);
    if (isRewardWord && this.onRewardFound) {
      this.onRewardFound({ wordIndex: this.currentWordIndex, word: this.currentWord });
      this.showRewardFoundAnimation();
    }

    this.currentWordIndex++;

    // Add time back: base + small length bonus + combo bonus
    const timeBack = this.timePerWord + wordLen * 100 + (this.combo > 1 ? 300 : 0);
    this.addTime(timeBack);

    playSuccessSound();
    this.showWordCompleteAnimation(basePoints, speedBonus, Math.floor(comboBonus));
    this.updateCombo();
    this.cameras.main.flash(100, 0, 255, 0, false);
    this.updateScore();

    this.time.delayedCall(250, () => {
      this.nextWord();
    });
  }

  handleVirtualInput(char: string) {
    if (!this.isGameActive || this.isTransitioning || !char) return;

    if (Date.now() - this.lastKeyboardInputTime < 50) return;

    const nextChar = this.currentWord[this.typedSoFar.length];
    this.totalKeys++;

    if (char.toUpperCase() === nextChar) {
      playTypingSound();
      this.correctKeys++;
      this.typedSoFar += nextChar;

      if (this.typedSoFar === this.currentWord) {
        this.wordComplete();
      }
    } else {
      playWrongSound();
      this.combo = 0;
      this.updateCombo();
      this.cameras.main.shake(100, 0.01);
      this.score = Math.max(0, this.score - 10);
      this.drainTime(this.timePenalty);
    }

    this.updateTextVisuals();
    this.updateScore();
  }

  updateTextVisuals() {
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const wordY = this.isMobile ? height * 0.25 : height * 0.45;

    const typed = this.typedSoFar;
    const remaining = this.currentWord.slice(this.typedSoFar.length);

    this.typedText.setText(typed);
    this.remainingText.setText(remaining);

    const typedWidth = this.typedText.width;
    const remainingWidth = this.remainingText.width;
    const totalWidth = typedWidth + remainingWidth;

    this.typedText.setPosition(centerX - totalWidth / 2 + typedWidth, wordY);
    this.remainingText.setPosition(centerX - totalWidth / 2 + typedWidth, wordY);
  }

  updateScore() {
    this.scoreText.setText(`SCORE ${this.score}`);
  }

  updateProgress() {
    this.progressText.setText(`${this.currentWordIndex + 1}/${this.wordList.length}`);
  }

  updateCombo() {
    if (this.combo > 1) {
      this.comboText.setText(`${this.combo}x COMBO`);
      this.comboText.setColor(this.combo >= 5 ? '#ffff00' : this.combo >= 3 ? '#ff4500' : '#ff8800');
      
      // Pulse animation on combo change
      this.tweens.add({
        targets: this.comboText,
        scale: 1.3,
        duration: 100,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    } else {
      this.comboText.setText('');
    }
  }

  override update() {
    if (!this.isGameActive) return;

    // Tick the global timer
    const now = Date.now();
    const delta = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    if (!this.isTransitioning) {
      this.timeRemaining -= delta * this.drainRate;
    }

    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endGame(false);
      return;
    }

    // Update timer text
    const secs = Math.ceil(this.timeRemaining / 1000);
    this.timerText.setText(`${secs}s`);

    // Urgency coloring
    if (secs <= 5) {
      this.timerText.setColor('#ff0000');
      // Pulse when critical
      if (secs <= 3 && Math.floor(now / 500) % 2 === 0) {
        this.timerText.setScale(1.2);
      } else {
        this.timerText.setScale(1);
      }
    } else if (secs <= 15) {
      this.timerText.setColor('#ff4500');
      this.timerText.setScale(1);
    } else {
      this.timerText.setColor('#ff4500');
      this.timerText.setScale(1);
    }

    // Draw timer ring
    const progress = this.timeRemaining / this.totalTime;
    const endAngle = 360 * progress;
    const { width, height } = this.cameras.main;
    const centerX = width / 2;
    const centerY = this.isMobile ? height * 0.25 : height * 0.45;
    const radius = this.isMobile ? Math.min(width, height) * 0.18 : Math.min(width, height) * 0.28;

    this.timerGraphics.clear();
    
    const thickness = this.isMobile ? 8 : 12;
    
    // Background ring
    this.timerGraphics.lineStyle(thickness, 0x222222);
    this.timerGraphics.beginPath();
    this.timerGraphics.arc(centerX, centerY, radius, 0, Math.PI * 2);
    this.timerGraphics.strokePath();

    // Progress ring — color shifts with urgency
    const isGolden = this.isGoldenChallenge;
    const ringColor = isGolden
      ? (secs <= 5 ? 0xff0000 : 0xffd700)
      : (secs <= 5 ? 0xff0000 : secs <= 15 ? 0xff4500 : 0xff4500);
    const glowColor = isGolden
      ? (secs <= 5 ? 0xff3333 : 0xffaa00)
      : (secs <= 5 ? 0xff3333 : secs <= 15 ? 0xff6633 : 0xff6633);

    this.timerGraphics.lineStyle(thickness, ringColor);
    this.timerGraphics.beginPath();
    this.timerGraphics.arc(
      centerX,
      centerY,
      radius,
      Phaser.Math.DegToRad(-90),
      Phaser.Math.DegToRad(endAngle - 90),
      false
    );
    this.timerGraphics.strokePath();

    // Inner glow
    this.timerGraphics.lineStyle(thickness / 2, glowColor, 0.5);
    this.timerGraphics.beginPath();
    this.timerGraphics.arc(
      centerX,
      centerY,
      radius - thickness / 2,
      Phaser.Math.DegToRad(-90),
      Phaser.Math.DegToRad(endAngle - 90),
      false
    );
    this.timerGraphics.strokePath();
  }

  endGame(completed: boolean) {
    this.isGameActive = false;
    this.isTransitioning = false;
    this.timerGraphics.clear();

    const elapsed = (Date.now() - this.gameStartTime) / 1000 / 60; // minutes
    const totalChars = this.wordList.slice(0, this.currentWordIndex).reduce((sum, w) => sum + w.length, 0);
    const wpm = elapsed > 0 ? Math.round((totalChars / 5) / elapsed) : 0;
    const accuracy = this.totalKeys > 0 ? Math.round((this.correctKeys / this.totalKeys) * 100) : 100;

    // Time bonus: remaining seconds * 10 points
    const timeBonus = completed ? Math.floor(this.timeRemaining / 100) : 0;
    this.score += timeBonus;

    const data: GameOverData = {
      score: this.score,
      completed,
      wordsTyped: this.currentWordIndex,
      totalWords: this.wordList.length,
      maxCombo: this.maxCombo,
      accuracy,
      wpm,
      livesLost: 0, // no lives in this mode, kept for interface compat
    };

    if (this.onGameOver) {
      this.onGameOver(data);
    }
  }
}
