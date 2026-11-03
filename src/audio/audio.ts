/**
 * Sunet: efecte (aceleași pentru toate facțiunile) + muzică proprie fiecărei facțiuni.
 * Totul e sintetizat cu WebAudio (fără fișiere, fără licențe). Dacă există `public/audio/music_<facțiune>.mp3`,
 * se folosește fișierul în locul muzicii generate.
 */
import { SONGS, Song, env, mtof } from "./music";
export { mtof };

export interface AudioSettings { music: number; sfx: number; muted: boolean }
const STORE = "ca-audio";
const loadSettings = (): AudioSettings => {
  const d: AudioSettings = { music: 0.5, sfx: 0.8, muted: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") }; } catch { return d; }
};

export type Sfx =
  | "rifle" | "rifle2" | "cannon" | "cannon2" | "turret" | "howitzer" | "v3"
  | "boom" | "bigBoom" | "buildingBoom" | "infDeath"
  | "click" | "tab" | "ready" | "unitReady" | "place" | "error" | "alarm" | "sell" | "ack" | "ackAttack"
  | "victory" | "defeat";

/** Distanța minimă (s) între două redări ale aceluiași efect — evită zgomotul la 30 de puști deodată. */
const GAP: Partial<Record<Sfx, number>> = { rifle: 0.045, rifle2: 0.045, cannon: 0.07, cannon2: 0.07, turret: 0.08, boom: 0.06, bigBoom: 0.1, infDeath: 0.08, ack: 0.12, ackAttack: 0.12, click: 0.03, tab: 0.03, error: 0.25 };


class AudioEngine {
  settings = loadSettings();
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  reverb!: ConvolverNode;
  noise!: AudioBuffer;
  private last = new Map<string, number>();
  private faction: string | null = null;
  private track: { stop(fade: number): void } | null = null;

  /** Contextul audio se poate crea doar după un gest al utilizatorului (click / tastă). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
      this.master.connect(comp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = impulse(ctx, 2.2, 2.8);
      const wet = ctx.createGain();
      wet.gain.value = 0.32;
      this.reverb.connect(wet).connect(this.master);
      this.applyVolumes();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.faction && !this.track) this.startMusic(this.faction);
  }

  setVolumes(p: Partial<AudioSettings>) {
    Object.assign(this.settings, p);
    try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch { /* */ }
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
  }

  // ─── muzică ───
  playMusic(faction: string) {
    if (this.faction === faction && this.track) return;
    this.faction = faction;
    this.track?.stop(1.2);
    this.track = null;
    if (this.ctx) this.startMusic(faction);
  }
  stopMusic(fade = 1.5) { this.track?.stop(fade); this.track = null; this.faction = null; }

  private startMusic(faction: string) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.connect(this.musicBus);
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5);
    let inner: { stop(): void } | null = null;
    let stopped = false;
    // întâi încearcă fișierul (dacă există un mp3 propriu), altfel muzica generată
    const url = `${import.meta.env.BASE_URL}audio/music_${faction}.mp3`;
    const useSynth = () => { if (!stopped && !inner) inner = playSong(this, SONGS[faction] ?? SONGS.usa, out); };
    const useFile = () => {
      if (stopped || inner) return;
      const el = new Audio(url);
      el.loop = true;
      el.preload = "auto";
      ctx.createMediaElementSource(el).connect(out);
      inner = { stop: () => { el.pause(); el.removeAttribute("src"); el.load(); } };
      // pornește în streaming, nu așteaptă descărcarea completă
      void el.play().catch(() => { inner = null; useSynth(); });
    };
    // verificăm doar dacă fișierul există (serverul de dev răspunde cu index.html pentru orice cale → tipul contează)
    fetch(url, { method: "HEAD", cache: "no-cache" })
      .then((r) => (r.ok && /audio|mpeg|octet-stream/.test(r.headers.get("content-type") ?? "") ? useFile() : useSynth()))
      .catch(useSynth);
    this.track = {
      stop: (fade) => {
        stopped = true;
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => { inner?.stop(); out.disconnect(); }, fade * 1000 + 100);
      },
    };
  }

  // ─── efecte ───
  /** `vol` 0–1, `pan` −1 (stânga) … 1 (dreapta). */
  play(name: Sfx, vol = 1, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || vol < 0.02) return;
    const now = ctx.currentTime;
    const gap = GAP[name] ?? 0;
    if (gap && now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.sfxBus);
    const send = (amt: number) => { const s = ctx.createGain(); s.gain.value = amt * this.settings.sfx; g.connect(s).connect(this.reverb); };
    const t = now + 0.005;
    const r = 0.94 + Math.random() * 0.12; // mică variație de ton
    switch (name) {
      case "rifle":
        this.noiseHit(g, t, "bandpass", 2600 * r, 1300, 0.9, 0.002, 0.07, 0.55);
        this.tone(g, t, "square", 190 * r, 70, 0.001, 0.035, 0.12);
        break;
      case "rifle2":
        this.noiseHit(g, t, "bandpass", 1800 * r, 900, 0.9, 0.002, 0.08, 0.6);
        this.tone(g, t, "square", 150 * r, 60, 0.001, 0.04, 0.13);
        break;
      case "cannon": case "cannon2": case "turret": {
        const k = name === "cannon2" ? 0.8 : name === "turret" ? 1.2 : 1;
        this.tone(g, t, "sine", 115 * k * r, 36, 0.003, 0.38, 0.9);
        this.noiseHit(g, t, "lowpass", 2200 * k, 180, 0.7, 0.002, 0.4, 0.75);
        this.noiseHit(g, t, "highpass", 3500, 3500, 0.7, 0.001, 0.035, 0.35);
        send(0.25);
        break;
      }
      case "howitzer":
        this.tone(g, t, "sine", 72 * r, 26, 0.004, 0.7, 1);
        this.noiseHit(g, t, "lowpass", 1100, 110, 0.6, 0.003, 0.8, 0.85);
        this.noiseHit(g, t, "highpass", 2500, 2500, 0.7, 0.001, 0.05, 0.3);
        send(0.5);
        break;
      case "v3":
        this.noiseHit(g, t, "bandpass", 280, 2200, 1.6, 0.18, 1.7, 0.7);
        this.noiseHit(g, t, "lowpass", 700, 200, 0.7, 0.01, 0.5, 0.6);
        this.tone(g, t, "sawtooth", 55, 110, 0.15, 1.2, 0.08);
        send(0.35);
        break;
      case "boom":
        this.noiseHit(g, t, "lowpass", 1400 * r, 150, 0.7, 0.003, 0.45, 0.7);
        this.tone(g, t, "sine", 80 * r, 32, 0.003, 0.35, 0.55);
        send(0.25);
        break;
      case "bigBoom":
        this.noiseHit(g, t, "lowpass", 1000 * r, 70, 0.6, 0.004, 1.4, 1);
        this.noiseHit(g, t + 0.05, "bandpass", 500, 120, 0.8, 0.02, 0.9, 0.4);
        this.tone(g, t, "sine", 58 * r, 24, 0.004, 1.0, 0.9);
        send(0.6);
        break;
      case "buildingBoom":
        this.noiseHit(g, t, "lowpass", 1100, 70, 0.6, 0.004, 1.6, 1);
        this.tone(g, t, "sine", 50, 22, 0.004, 1.2, 1);
        this.noiseHit(g, t + 0.28, "lowpass", 900, 60, 0.6, 0.01, 1.5, 0.8);
        this.noiseHit(g, t + 0.5, "lowpass", 380, 120, 0.5, 0.2, 2.2, 0.45); // dărâmături
        send(0.8);
        break;
      case "infDeath":
        this.tone(g, t, "sawtooth", 260 * r, 120, 0.01, 0.22, 0.08);
        this.noiseHit(g, t + 0.08, "lowpass", 500, 200, 0.7, 0.005, 0.15, 0.3);
        break;
      case "click":
        this.tone(g, t, "square", 1250, 1250, 0.001, 0.03, 0.12);
        break;
      case "tab":
        this.tone(g, t, "triangle", 780, 980, 0.002, 0.06, 0.25);
        break;
      case "ready":
        this.tone(g, t, "triangle", 659, 659, 0.005, 0.22, 0.35);
        this.tone(g, t + 0.13, "triangle", 988, 988, 0.005, 0.35, 0.35);
        this.tone(g, t + 0.13, "sine", 1976, 1976, 0.005, 0.25, 0.08);
        break;
      case "unitReady":
        this.tone(g, t, "triangle", 880, 880, 0.004, 0.1, 0.3);
        this.tone(g, t + 0.08, "triangle", 1318, 1318, 0.004, 0.18, 0.3);
        break;
      case "place":
        this.tone(g, t, "sine", 170, 55, 0.003, 0.28, 0.8);
        this.noiseHit(g, t, "lowpass", 800, 200, 0.7, 0.003, 0.25, 0.5);
        break;
      case "error":
        this.tone(g, t, "square", 140, 130, 0.004, 0.12, 0.18);
        this.tone(g, t + 0.15, "square", 110, 100, 0.004, 0.16, 0.18);
        break;
      case "alarm":
        for (let i = 0; i < 4; i++) this.tone(g, t + i * 0.24, "sawtooth", i % 2 ? 560 : 760, i % 2 ? 560 : 760, 0.01, 0.22, 0.13, 2400);
        break;
      case "sell":
        this.tone(g, t, "triangle", 1568, 1568, 0.002, 0.09, 0.28);
        this.tone(g, t + 0.07, "triangle", 2093, 2093, 0.002, 0.2, 0.28);
        break;
      case "ack":
        this.noiseHit(g, t, "bandpass", 2600, 2600, 2, 0.002, 0.04, 0.25);
        this.tone(g, t + 0.02, "square", 1300, 1800, 0.003, 0.06, 0.07, 3000);
        break;
      case "ackAttack":
        this.noiseHit(g, t, "bandpass", 2200, 2200, 2, 0.002, 0.04, 0.25);
        this.tone(g, t + 0.02, "square", 1100, 700, 0.003, 0.08, 0.08, 3000);
        break;
      case "victory":
        [60, 64, 67, 72, 76, 79].forEach((m, i) => this.tone(g, t + i * 0.13, "sawtooth", mtof(m), mtof(m), 0.02, i === 5 ? 1.6 : 0.3, 0.16, 2600));
        [72, 76, 79].forEach((m) => this.tone(g, t + 0.78, "sawtooth", mtof(m), mtof(m), 0.05, 1.8, 0.1, 2200));
        send(0.5);
        break;
      case "defeat":
        [67, 63, 60, 55].forEach((m, i) => this.tone(g, t + i * 0.4, "sawtooth", mtof(m), mtof(m) * 0.995, 0.04, i === 3 ? 2.2 : 0.5, 0.15, 1400));
        this.tone(g, t + 1.2, "sine", 65, 40, 0.1, 2.5, 0.4);
        send(0.6);
        break;
    }
    setTimeout(() => g.disconnect(), 4500);
  }

  /** Zgomot filtrat cu anvelopă exponențială; frecvența filtrului alunecă f0 → f1. */
  noiseHit(out: AudioNode, t: number, type: BiquadFilterType, f0: number, f1: number, q: number, a: number, d: number, peak: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    const g = ctx.createGain();
    env(g.gain, t, a, peak, d);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + a + d + 0.05);
  }
  tone(out: AudioNode, t: number, wave: OscillatorType, f0: number, f1: number, a: number, d: number, peak: number, lp = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    const g = ctx.createGain();
    env(g.gain, t, a, peak, d);
    let node: AudioNode = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; node = o.connect(f); }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }
}

function impulse(ctx: BaseAudioContext, sec: number, decay: number) {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}

/** Programează piesa cu „lookahead” (câte o măsură înainte) până la oprire. */
function playSong(eng: AudioEngine, song: Song, out: GainNode) {
  const ctx = eng.ctx!;
  const step = 60 / song.bpm / 4; // șaisprezecimi
  const bus = song.setup(ctx, out, eng);
  let bar = 0;
  let next = ctx.currentTime + 0.15;
  const tick = () => {
    while (next < ctx.currentTime + 0.6) {
      song.bar(bar % song.length, next, step, bus);
      next += step * 16;
      bar++;
    }
  };
  tick();
  const id = window.setInterval(tick, 120);
  return { stop: () => window.clearInterval(id) };
}

export const audio = new AudioEngine();
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => audio.unlock(), { capture: true });
