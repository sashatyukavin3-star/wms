/**
 * Звуковой фидбек для операций сканирования и складских действий.
 * Использует Web Audio API — без внешних файлов, работает оффлайн.
 *
 * Тоны подобраны так, чтобы хорошо звучать на динамиках ТСД и в наушниках:
 *  - success: высокий приятный «дзынь» (E5)
 *  - error:   низкий резкий «бум» (A3, нисходящий)
 *  - warning: средний короткий «дудук» (A4)
 *  - info:    тихий короткий клик (C5)
 */

import { getSetting } from '../db';

const SOUNDS_ENABLED_KEY = 'sounds_enabled';
let cachedEnabled: boolean | null = null;
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

export async function loadSoundSetting(): Promise<boolean> {
  const v = await getSetting(SOUNDS_ENABLED_KEY, '1');
  cachedEnabled = v === '1';
  return cachedEnabled;
}

export function setSoundEnabled(enabled: boolean) {
  cachedEnabled = enabled;
}

type SoundType = 'success' | 'error' | 'warning' | 'info';

interface Tone {
  freq: number;
  duration: number; // в секундах
  type?: OscillatorType;
  glideTo?: number;
}

const PROFILES: Record<SoundType, Tone[]> = {
  success: [{ freq: 659.25, duration: 0.12, type: 'sine' }], // E5
  error:   [{ freq: 220, duration: 0.18, type: 'square', glideTo: 110 }], // A3 → A2
  warning: [{ freq: 440, duration: 0.08, type: 'triangle' }, { freq: 440, duration: 0.08, type: 'triangle' }],
  info:    [{ freq: 523.25, duration: 0.05, type: 'sine' }], // C5
};

export function playSound(type: SoundType): void {
  if (cachedEnabled === false) return;
  const ctx = getCtx();
  if (!ctx) return;
  // На некоторых браузерах контекст находится в suspended state до первого клика
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const tones = PROFILES[type];
  let offset = 0;
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type ?? 'sine';
    osc.frequency.setValueAtTime(tone.freq, ctx.currentTime + offset);
    if (tone.glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, tone.glideTo), ctx.currentTime + offset + tone.duration);
    }
    // Огибающая громкости: быстрая атака, плавный спад — чтобы не было щелчков.
    gain.gain.setValueAtTime(0, ctx.currentTime + offset);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + offset + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + tone.duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + tone.duration + 0.02);
    offset += tone.duration + 0.04;
  }
}
