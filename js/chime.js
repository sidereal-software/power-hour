/**
 * Synthesised chimes via Web Audio — no audio files to host, and it mixes
 * over the Spotify SDK's own output instead of interrupting it.
 */
let ctx = null;

/** Create/resume the context. Must be reached from a user gesture at least once. */
export function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function envelope(gain, startAt, peak, attack, decay) {
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);
}

function tone({ type = 'sine', freq, start, attack, decay, peak, bendTo }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (bendTo) osc.frequency.exponentialRampToValueAtTime(bendTo, start + attack + decay);
  envelope(gain, start, peak, attack, decay);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + attack + decay + 0.05);
}

const VOICES = {
  // Struck bell: fundamental plus inharmonic partials, long tail.
  bell(now) {
    [
      { freq: 880, peak: 0.34, decay: 1.9 },
      { freq: 1320, peak: 0.18, decay: 1.4 },
      { freq: 2640, peak: 0.07, decay: 0.9 },
      { freq: 1760, peak: 0.05, decay: 2.4 },
    ].forEach(({ freq, peak, decay }) =>
      tone({ freq, peak, decay, start: now, attack: 0.005 }));
  },

  ding(now) {
    tone({ freq: 1568, peak: 0.32, start: now, attack: 0.004, decay: 0.55 });
    tone({ freq: 3136, peak: 0.09, start: now, attack: 0.004, decay: 0.35 });
  },

  // Two detuned saw stacks with a short blat, roughly stadium-shaped.
  airhorn(now) {
    [233, 293, 349].forEach((freq, i) => {
      tone({ type: 'sawtooth', freq, peak: 0.16, start: now + i * 0.004, attack: 0.03, decay: 0.9 });
      tone({ type: 'sawtooth', freq: freq * 1.01, peak: 0.12, start: now, attack: 0.04, decay: 0.9 });
    });
  },

  // Rising square arpeggio — coin-collect energy.
  arcade(now) {
    [523, 659, 784, 1047].forEach((freq, i) =>
      tone({ type: 'square', freq, peak: 0.18, start: now + i * 0.075, attack: 0.005, decay: 0.16 }));
  },

  none() {},
};

export function playChime(name = 'bell') {
  const voice = VOICES[name] || VOICES.bell;
  if (voice === VOICES.none) return;
  try {
    unlockAudio();
    voice(ctx.currentTime + 0.01);
  } catch { /* audio is a nicety; never let it break the timer */ }
}

/** Short blip for the final-seconds countdown. */
export function playTick(last = false) {
  try {
    unlockAudio();
    tone({
      type: 'sine',
      freq: last ? 1200 : 800,
      peak: last ? 0.16 : 0.1,
      start: ctx.currentTime + 0.01,
      attack: 0.004,
      decay: 0.09,
    });
  } catch { /* ignore */ }
}

export const CHIME_NAMES = Object.keys(VOICES);
