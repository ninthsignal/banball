// Banball audio engine.
//
// Plays short SFX for every player-visible game event. Each cue is synthesized
// procedurally with the Web Audio API so the game has working sound with no
// bundled files or licensing burden. If a real sample is provided it is used
// instead of the synth: drop files into `apps/web/public/sounds/` and list them
// in `apps/web/public/sounds/manifest.json` as { "throw": "throw_whoosh.ogg" }.
// See SOUND_ASSET_PLAN.md for the Freesound / Kenney candidates per cue.

export type SoundName =
  | "ui_hover"
  | "ui_click"
  | "ui_back"
  | "start"
  | "win"
  | "lose"
  | "throw"
  | "catch"
  | "dodge"
  | "hit"
  | "bounce"
  | "elim"
  | "command"
  | "gift"
  | "appeal"
  | "stream_connect"
  | "stream_disconnect"
  | "step"
  | "emote"
  | "lizard";

interface PlayOpts {
  volume?: number;
  rate?: number; // pitch / playback multiplier (1 = nominal)
  throttleMs?: number; // ignore repeat plays of this cue within the window
}

const STORAGE_KEY = "banball.muted";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private overrides = new Map<SoundName, AudioBuffer>();
  private lastPlayed = new Map<SoundName, number>();
  private muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      /* localStorage may be unavailable */
    }
  }

  /** Lazily build the context. Safe to call repeatedly. */
  private ensure(): boolean {
    if (this.ctx) return true;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(1);
    void this.loadManifest();
    return true;
  }

  /** Resume the context after a user gesture (browsers start it suspended). */
  resume(): void {
    if (!this.ensure()) return;
    if (this.ctx!.state === "suspended") void this.ctx!.resume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Load optional real samples that override the synthesized cues. */
  private async loadManifest(): Promise<void> {
    if (!this.ctx) return;
    const base = import.meta.env.BASE_URL ?? "/";
    let manifest: Record<string, string>;
    try {
      const res = await fetch(`${base}sounds/manifest.json`);
      if (!res.ok) return; // no manifest -> pure synth, no console noise
      manifest = await res.json();
    } catch {
      return;
    }
    await Promise.all(
      Object.entries(manifest).map(async ([name, file]) => {
        try {
          const res = await fetch(`${base}sounds/${file}`);
          if (!res.ok) return;
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
          this.overrides.set(name as SoundName, buf);
        } catch {
          /* keep the synth fallback for this cue */
        }
      }),
    );
  }

  play(name: SoundName, opts: PlayOpts = {}): void {
    if (this.muted || !this.ensure()) return;
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume();

    if (opts.throttleMs) {
      const now = ctx.currentTime * 1000;
      const last = this.lastPlayed.get(name) ?? -Infinity;
      if (now - last < opts.throttleMs) return;
      this.lastPlayed.set(name, now);
    }

    const override = this.overrides.get(name);
    if (override) {
      const src = ctx.createBufferSource();
      src.buffer = override;
      src.playbackRate.value = opts.rate ?? 1;
      const gain = ctx.createGain();
      gain.gain.value = opts.volume ?? 1;
      src.connect(gain).connect(this.master!);
      src.start();
      return;
    }

    this.synth(name, opts);
  }

  // --- low level helpers ---------------------------------------------------

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A pitched tone with an attack/decay envelope. */
  private tone(
    type: OscillatorType,
    freq: number,
    start: number,
    dur: number,
    peak: number,
    endFreq?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.012, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** A filtered noise burst (whoosh / impact / cloth). */
  private burst(
    start: number,
    dur: number,
    peak: number,
    filterType: BiquadFilterType,
    freq: number,
    endFreq?: number,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, start);
    if (endFreq !== undefined) filter.frequency.linearRampToValueAtTime(endFreq, start + dur);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + dur * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  private synth(name: SoundName, opts: PlayOpts): void {
    const t = this.ctx!.currentTime;
    const r = opts.rate ?? 1;
    const v = opts.volume ?? 1;
    switch (name) {
      case "ui_hover":
        this.tone("triangle", 880 * r, t, 0.05, 0.12 * v);
        break;
      case "ui_click":
        this.tone("square", 520 * r, t, 0.07, 0.16 * v, 360 * r);
        break;
      case "ui_back":
        this.tone("square", 360 * r, t, 0.1, 0.16 * v, 200 * r);
        break;
      case "command":
        this.tone("square", 660 * r, t, 0.06, 0.14 * v);
        break;
      case "gift":
        this.tone("triangle", 990 * r, t, 0.07, 0.13 * v, 1320 * r);
        break;
      case "start":
        this.tone("square", 392, t, 0.1, 0.18 * v);
        this.tone("square", 523, t + 0.1, 0.1, 0.18 * v);
        this.tone("square", 784, t + 0.2, 0.16, 0.2 * v);
        break;
      case "win":
        // bright ascending 8-bit fanfare: C E G C
        this.tone("square", 523, t, 0.12, 0.2 * v);
        this.tone("square", 659, t + 0.12, 0.12, 0.2 * v);
        this.tone("square", 784, t + 0.24, 0.12, 0.2 * v);
        this.tone("square", 1047, t + 0.36, 0.3, 0.22 * v);
        break;
      case "lose":
        // descending minor sting
        this.tone("sawtooth", 440, t, 0.16, 0.16 * v, 415);
        this.tone("sawtooth", 349, t + 0.16, 0.16, 0.16 * v, 330);
        this.tone("sawtooth", 262, t + 0.32, 0.4, 0.17 * v, 247);
        break;
      case "throw":
        // rising-then-falling air whoosh
        this.burst(t, 0.26, 0.22 * v, "bandpass", 500 * r, 1700 * r, 1.2);
        break;
      case "dodge":
        // quick cloth swish, quieter and shorter than a throw
        this.burst(t, 0.14, 0.13 * v, "bandpass", 1200 * r, 700 * r, 0.8);
        break;
      case "catch":
        // soft body thump + tiny success tick
        this.tone("sine", 170 * r, t, 0.16, 0.32 * v, 90 * r);
        this.burst(t, 0.07, 0.12 * v, "lowpass", 600);
        this.tone("square", 1200, t + 0.05, 0.05, 0.1 * v);
        break;
      case "hit":
        // heavy body impact + warning blip
        this.tone("sine", 120 * r, t, 0.22, 0.4 * v, 60 * r);
        this.burst(t, 0.12, 0.2 * v, "lowpass", 900);
        this.tone("square", 320, t + 0.04, 0.18, 0.12 * v);
        break;
      case "elim":
        // shorter descending knockout
        this.tone("square", 300 * r, t, 0.1, 0.16 * v, 150 * r);
        this.burst(t, 0.1, 0.16 * v, "lowpass", 800);
        break;
      case "bounce":
        // low pluck + click; triggers often, keep it light
        this.tone("sine", 220 * r, t, 0.09, 0.14 * v, 130 * r);
        this.burst(t, 0.03, 0.08 * v, "highpass", 1800);
        break;
      case "step":
        this.burst(t, 0.05, 0.06 * v, "lowpass", 350);
        break;
      case "appeal":
        // bright two-note up
        this.tone("sine", 784, t, 0.1, 0.18 * v);
        this.tone("sine", 988, t + 0.09, 0.18, 0.2 * v);
        break;
      case "stream_connect":
        this.tone("triangle", 660, t, 0.08, 0.12 * v);
        this.tone("triangle", 880, t + 0.08, 0.12, 0.13 * v);
        break;
      case "stream_disconnect":
        this.tone("triangle", 660, t, 0.08, 0.12 * v);
        this.tone("triangle", 440, t + 0.08, 0.14, 0.13 * v);
        break;
      case "emote": {
        // Fallback only: a playful up-and-down giggle of blips if no sample is loaded.
        const notes = [880, 990, 1100, 990, 1180, 1040];
        notes.forEach((f, i) => this.tone("triangle", f * r, t + i * 0.09, 0.08, 0.12 * v));
        break;
      }
      case "lizard": {
        // Fallback only: a short comedic "boing" + buzzer until a real clip is added.
        this.tone("square", 200 * r, t, 0.18, 0.18 * v, 520 * r);
        this.tone("sawtooth", 160 * r, t + 0.1, 0.22, 0.14 * v, 110 * r);
        break;
      }
    }
  }
}

export const audio = new AudioEngine();
