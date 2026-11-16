// Shared sweet Web Audio alert chime for incoming in-ride chat messages
// Works seamlessly across Captain Dashboard & Passenger Dashboard with user-gesture audio unlock & deduplication.

let sharedAudioCtx: AudioContext | null = null;
let unlockRegistered = false;
let lastPlayTimestamp = 0;
const chimedMessageIds = new Set<string>();

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function initChatAudioUnlock(): () => void {
  if (typeof window === 'undefined' || unlockRegistered) {
    return () => {};
  }
  unlockRegistered = true;

  const unlock = () => {
    getOrCreateAudioContext();
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('click', unlock, { passive: true });

  return () => {
    unlockRegistered = false;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('click', unlock);
  };
}

export function markChatMessageChimed(messageId?: string) {
  if (!messageId) return;
  chimedMessageIds.add(messageId);
  if (chimedMessageIds.size > 300) {
    const first = chimedMessageIds.values().next().value;
    if (first) chimedMessageIds.delete(first);
  }
}

/**
 * Plays a sweet, gentle crystal-bell chat chime (G5 -> B5 -> D6 with soft shimmer harmonic).
 * Deduplicates by messageId and enforces a short cooldown so multiple realtime channels never double-ding.
 */
export function playSweetChatAlert(messageId?: string) {
  if (messageId) {
    if (chimedMessageIds.has(messageId)) return;
    markChatMessageChimed(messageId);
  }

  const nowMs = Date.now();
  if (nowMs - lastPlayTimestamp < 250) return;
  lastPlayTimestamp = nowMs;

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([35, 25, 45]);
    }
  } catch {}

  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Sweet warm crystal-bell tri-note chime: G5 -> B5 -> D6 (soft & pleasant messaging alert)
    const notes = [
      { freq: 783.99, delay: 0.0, dur: 0.34, vol: 0.13 },   // G5
      { freq: 987.77, delay: 0.085, dur: 0.38, vol: 0.14 }, // B5
      { freq: 1174.66, delay: 0.17, dur: 0.55, vol: 0.15 }, // D6
    ];

    notes.forEach(({ freq, delay, dur, vol }) => {
      const start = now + delay;

      // Warm fundamental bell tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.03);

      // Delicate upper octave shimmer for sweet bell sparkle
      const shimmerOsc = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      shimmerOsc.type = 'triangle';
      shimmerOsc.frequency.setValueAtTime(freq * 2, start);

      shimmerGain.gain.setValueAtTime(0.0001, start);
      shimmerGain.gain.linearRampToValueAtTime(vol * 0.22, start + 0.012);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0005, start + dur * 0.6);

      shimmerOsc.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      shimmerOsc.start(start);
      shimmerOsc.stop(start + dur * 0.65);
    });
  } catch {}
}
