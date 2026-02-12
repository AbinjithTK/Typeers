import Phaser from 'phaser';
import { FastTyperGame } from './FastTyperGame';

export const createGameConfig = (
  parent: string | HTMLElement,
  width: number,
  height: number
): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent,
  width,
  height,
  backgroundColor: '#1a1a1b',
  scene: [FastTyperGame],
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
});
