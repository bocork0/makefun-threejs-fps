// Every sound is synthesised with WebAudio: a shared noise buffer, a few
// oscillators and gain envelopes. No audio files, no network, nothing to load.
// The context is created on the first user gesture (the Play click), so the
// browser's autoplay rules are never fought.
export function createAudio() {
  let ctx = null;
  let noise = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function burst(duration, filterFreq, filterType, gainValue, when = 0) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + when;
    const source = c.createBufferSource();
    source.buffer = noise;
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  function tone(freq, duration, type, gainValue, slideTo = 0, when = 0) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    // kind: 'rifle' | 'smg' | 'dmr' | 'sidearm'. Distance muffles far shots.
    shot(kind, distance = 0) {
      const near = Math.max(0.15, 1 - distance / 55);
      if (kind === 'dmr') {
        burst(0.22, 900, 'lowpass', 0.9 * near);
        tone(140, 0.14, 'sine', 0.5 * near, 55);
      } else if (kind === 'smg') {
        burst(0.09, 1700, 'bandpass', 0.55 * near);
        tone(190, 0.06, 'square', 0.16 * near, 90);
      } else if (kind === 'sidearm') {
        burst(0.1, 1400, 'bandpass', 0.6 * near);
        tone(170, 0.07, 'square', 0.18 * near, 80);
      } else {
        burst(0.14, 1200, 'lowpass', 0.8 * near);
        tone(160, 0.1, 'sawtooth', 0.28 * near, 70);
      }
    },
    dryFire() {
      tone(1400, 0.03, 'square', 0.12);
    },
    reload() {
      tone(900, 0.04, 'square', 0.12);
      tone(620, 0.04, 'square', 0.12, 0, 0.22);
      tone(1100, 0.05, 'square', 0.14, 0, 0.55);
    },
    hit() {
      tone(2200, 0.05, 'sine', 0.22);
    },
    kill() {
      tone(880, 0.09, 'sine', 0.25);
      tone(1320, 0.12, 'sine', 0.22, 0, 0.08);
    },
    hurt() {
      tone(220, 0.12, 'sawtooth', 0.2, 110);
    },
    plantBeep(final = false) {
      tone(final ? 1560 : 1180, final ? 0.3 : 0.09, 'sine', 0.3);
    },
    defuseBeep() {
      tone(980, 0.09, 'sine', 0.25);
    },
    explosion() {
      burst(0.9, 320, 'lowpass', 1.0);
      tone(70, 0.7, 'sine', 0.7, 32);
      burst(0.3, 2400, 'highpass', 0.25);
    },
    flashRing() {
      tone(2400, 0.5, 'sine', 0.12, 1800);
    },
    buy() {
      tone(660, 0.06, 'sine', 0.2);
      tone(990, 0.09, 'sine', 0.2, 0, 0.06);
    },
    roundWin() {
      tone(523, 0.14, 'triangle', 0.25);
      tone(659, 0.14, 'triangle', 0.25, 0, 0.13);
      tone(784, 0.22, 'triangle', 0.28, 0, 0.26);
    },
    roundLose() {
      tone(392, 0.16, 'triangle', 0.22);
      tone(311, 0.2, 'triangle', 0.22, 0, 0.15);
      tone(233, 0.3, 'triangle', 0.24, 0, 0.3);
    },
    roundStart() {
      tone(440, 0.1, 'sine', 0.2);
      tone(587, 0.16, 'sine', 0.22, 0, 0.1);
    },
    spikeTick() {
      tone(1500, 0.05, 'sine', 0.14);
    },
  };
}
