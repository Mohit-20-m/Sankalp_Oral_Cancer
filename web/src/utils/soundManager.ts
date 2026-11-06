import { prefs } from "./preferences";

/**
 * ─────────────────────────────────────────────────────────────
 *  SOUND MANAGER — every UI sound goes through here.
 * ─────────────────────────────────────────────────────────────
 *  By default each sound is synthesised with the Web Audio API (tiny,
 *  offline, no files to ship). To use your own recordings, drop files in
 *  /public/sounds and set `file` for that sound in SOUND_LIBRARY below —
 *  files take priority over the synth.
 *
 *  Guarantees:
 *   • Silent until the first user gesture (browser autoplay rules; never on load).
 *   • Respects the user's on/off + volume setting (Settings → Sound).
 *   • De-duplicates bursts (no machine-gun sounds from background work).
 *   • Stays quiet while speech synthesis / voice prompts are speaking.
 */
export type SoundName =
  | "click"
  | "success"
  | "notify"
  | "error"
  | "transition"
  | "shutter"
  | "upload"
  | "complete";

interface Tone {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}
interface SoundDef {
  file?: string;
  tones?: Tone[];
  noise?: { dur: number; gain: number; hp: number };
  /** Minimum ms between two plays of the same sound. */
  throttle: number;
}

export const SOUND_LIBRARY: Record<SoundName, SoundDef> = {
  click: { tones: [{ freq: 1800, to: 1200, dur: 0.035, type: "sine", gain: 0.22 }], throttle: 60 },
  transition: { tones: [{ freq: 520, to: 680, dur: 0.12, type: "sine", gain: 0.06 }], throttle: 400 },
  success: {
    tones: [
      { freq: 659.25, dur: 0.16, type: "sine", gain: 0.2 },
      { freq: 987.77, dur: 0.32, type: "sine", gain: 0.18, delay: 0.09 },
    ],
    throttle: 600,
  },
  complete: {
    tones: [
      { freq: 523.25, dur: 0.12, type: "triangle", gain: 0.14 },
      { freq: 783.99, dur: 0.22, type: "triangle", gain: 0.12, delay: 0.07 },
    ],
    throttle: 400,
  },
  upload: {
    tones: [
      { freq: 880, dur: 0.1, type: "sine", gain: 0.14 },
      { freq: 1174.66, dur: 0.18, type: "sine", gain: 0.12, delay: 0.06 },
    ],
    throttle: 1500,
  },
  notify: {
    tones: [
      { freq: 1046.5, dur: 0.14, type: "sine", gain: 0.14 },
      { freq: 1318.5, dur: 0.24, type: "sine", gain: 0.1, delay: 0.12 },
    ],
    throttle: 2000,
  },
  error: {
    tones: [
      { freq: 330, dur: 0.14, type: "triangle", gain: 0.16 },
      { freq: 262, dur: 0.22, type: "triangle", gain: 0.14, delay: 0.11 },
    ],
    throttle: 800,
  },
  shutter: { noise: { dur: 0.09, gain: 0.25, hp: 1800 }, tones: [{ freq: 2400, to: 900, dur: 0.05, gain: 0.08 }], throttle: 250 },
};

class SoundManager {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private last = new Map<SoundName, number>();
  private buffers = new Map<string, AudioBuffer>();

  /** Call once at startup. Unlocks audio on the first real user gesture. */
  init(): void {
    const unlock = () => {
      this.ensureCtx();
      void this.ctx?.resume();
      this.unlocked = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: false });
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    return this.ctx;
  }

  get enabled(): boolean {
    return prefs.get("soundEnabled");
  }

  play(name: SoundName): void {
    if (!this.unlocked || !this.enabled) return;
    if (typeof window.speechSynthesis !== "undefined" && window.speechSynthesis.speaking) return;
    const def = SOUND_LIBRARY[name];
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < def.throttle) return;
    this.last.set(name, now);
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const volume = prefs.get("soundVolume");
    if (def.file) {
      void this.playFile(ctx, def.file, volume);
      return;
    }
    const t0 = ctx.currentTime + 0.005;
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    def.tones?.forEach((tone) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const start = t0 + (tone.delay ?? 0);
      osc.type = tone.type ?? "sine";
      osc.frequency.setValueAtTime(tone.freq, start);
      if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.dur);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(tone.gain ?? 0.15, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
      osc.connect(g).connect(master);
      osc.start(start);
      osc.stop(start + tone.dur + 0.02);
    });

    if (def.noise) {
      const len = Math.floor(ctx.sampleRate * def.noise.dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = def.noise.hp;
      const g = ctx.createGain();
      g.gain.value = def.noise.gain;
      src.connect(hp).connect(g).connect(master);
      src.start(t0);
    }
  }

  private async playFile(ctx: AudioContext, url: string, volume: number) {
    try {
      let buf = this.buffers.get(url);
      if (!buf) {
        const res = await fetch(url);
        buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(url, buf);
      }
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = volume;
      src.buffer = buf;
      src.connect(g).connect(ctx.destination);
      src.start();
    } catch {
      /* missing file — fail silently, visual feedback still shows */
    }
  }

  setEnabled(v: boolean) {
    prefs.set("soundEnabled", v);
  }
  setVolume(v: number) {
    prefs.set("soundVolume", Math.min(1, Math.max(0, v)));
  }
}

export const soundManager = new SoundManager();
