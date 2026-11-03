/**
 * Muzica generată: câte o piesă originală per facțiune, cântată de un mic „band” sintetizat.
 * SUA — „Freedom Drive”: rock alert, 132 BPM, Re minor, chitare distorsionate + alămuri.
 * URSS — „Steel March”: marș industrial, 112 BPM, Do minor, tobe grele, cor, corn.
 */
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export function env(p: AudioParam, t: number, a: number, peak: number, d: number) {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  p.exponentialRampToValueAtTime(0.0001, t + a + d);
}

type Eng = { noise: AudioBuffer; reverb: ConvolverNode };

export class Band {
  drums: GainNode; guitar: GainNode; bass: GainNode; brass: GainNode; choir: GainNode;
  constructor(public ctx: AudioContext, out: AudioNode, private eng: Eng, opt: { drive: number; guitarLp: number; reverbDrums: number }) {
    const send = (n: AudioNode, amt: number) => { const s = ctx.createGain(); s.gain.value = amt; n.connect(s).connect(eng.reverb); };
    this.drums = ctx.createGain(); this.drums.gain.value = 0.9; this.drums.connect(out); send(this.drums, opt.reverbDrums);
    // chitară: distorsiune + filtru
    this.guitar = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = distCurve(opt.drive);
    shaper.oversample = "2x";
    const glp = ctx.createBiquadFilter(); glp.type = "lowpass"; glp.frequency.value = opt.guitarLp; glp.Q.value = 0.8;
    const gpk = ctx.createBiquadFilter(); gpk.type = "peaking"; gpk.frequency.value = 1400; gpk.gain.value = 3;
    const gout = ctx.createGain(); gout.gain.value = 0.16;
    this.guitar.connect(shaper).connect(glp).connect(gpk).connect(gout).connect(out);
    send(gout, 0.12);
    // bas: puțină saturație
    this.bass = ctx.createGain();
    const bsh = ctx.createWaveShaper(); bsh.curve = distCurve(4);
    const blp = ctx.createBiquadFilter(); blp.type = "lowpass"; blp.frequency.value = 900;
    const bout = ctx.createGain(); bout.gain.value = 0.32;
    this.bass.connect(bsh).connect(blp).connect(bout).connect(out);
    // alămuri / corn
    this.brass = ctx.createGain(); this.brass.gain.value = 0.22; this.brass.connect(out); send(this.brass, 0.35);
    // cor
    this.choir = ctx.createGain(); this.choir.gain.value = 0.14; this.choir.connect(out); send(this.choir, 0.9);
  }

  private noise(dest: AudioNode, t: number, type: BiquadFilterType, f: number, d: number, peak: number, q = 0.7) {
    const s = this.ctx.createBufferSource(); s.buffer = this.eng.noise;
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = this.ctx.createGain(); env(g.gain, t, 0.001, peak, d);
    s.connect(fl).connect(g).connect(dest);
    s.start(t, Math.random()); s.stop(t + d + 0.05);
  }
  private osc(dest: AudioNode, t: number, wave: OscillatorType, f0: number, f1: number, d: number, peak: number, a = 0.001) {
    const o = this.ctx.createOscillator(); o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + d);
    const g = this.ctx.createGain(); env(g.gain, t, a, peak, d);
    o.connect(g).connect(dest); o.start(t); o.stop(t + a + d + 0.05);
  }

  kick(t: number, v = 1) { this.osc(this.drums, t, "sine", 130, 42, 0.32, 0.95 * v); this.noise(this.drums, t, "lowpass", 1500, 0.02, 0.25 * v); }
  snare(t: number, v = 1) { this.noise(this.drums, t, "highpass", 1400, 0.17, 0.55 * v); this.osc(this.drums, t, "triangle", 200, 160, 0.09, 0.4 * v); }
  hat(t: number, v = 1, open = false) { this.noise(this.drums, t, "highpass", 7500, open ? 0.16 : 0.035, 0.22 * v); }
  tom(t: number, m: number, v = 1) { this.osc(this.drums, t, "sine", mtof(m) * 1.4, mtof(m), 0.25, 0.6 * v); }
  crash(t: number, v = 1) { this.noise(this.drums, t, "highpass", 5000, 1.4, 0.28 * v); }
  /** lovitura metalică a marșului industrial */
  anvil(t: number, v = 1) {
    for (const f of [820, 1270, 1930]) this.osc(this.drums, t, "square", f, f * 0.99, 0.12, 0.05 * v);
    this.noise(this.drums, t, "bandpass", 2400, 0.08, 0.2 * v, 3);
  }

  /** acord „power” (fundamentala + cvinta + octava); `mute` = palm mute (scurt, filtrat) */
  power(t: number, root: number, dur: number, v = 1, mute = false) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const d = mute ? Math.min(dur, 0.09) : dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.setValueAtTime(v, t + d * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.04);
    let dest: AudioNode = g;
    if (mute) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700; f.connect(g); dest = f; }
    g.connect(this.guitar);
    for (const [iv, det] of [[0, -7], [0, 7], [7, 0], [12, 4]]) {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.value = mtof(root + iv); o.detune.value = det;
      o.connect(dest); o.start(t); o.stop(t + d + 0.08);
    }
  }
  bassNote(t: number, m: number, dur: number, v = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m);
    const s = ctx.createOscillator(); s.type = "square"; s.frequency.value = mtof(m - 12);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 4;
    f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ctx.createGain(); env(g.gain, t, 0.004, v, dur);
    const sg = ctx.createGain(); sg.gain.value = 0.5;
    o.connect(f); s.connect(sg).connect(f); f.connect(g).connect(this.bass);
    for (const x of [o, s]) { x.start(t); x.stop(t + dur + 0.06); }
  }
  /** alămuri / corn: două dinți de fierăstrău ușor dezacordați, filtru care se deschide, vibrato */
  horn(t: number, m: number, dur: number, v = 1, bright = 2600) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(bright, t + 0.09);
    f.frequency.setTargetAtTime(bright * 0.6, t + 0.12, 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.04);
    g.gain.setValueAtTime(v * 0.85, t + Math.max(0.05, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
    const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(9, t + Math.min(0.5, dur));
    lfo.connect(lg);
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m); o.detune.value = det;
      lg.connect(o.detune);
      o.connect(f); o.start(t); o.stop(t + dur + 0.2);
    }
    lfo.start(t); lfo.stop(t + dur + 0.2);
    f.connect(g).connect(this.brass);
  }
  /** cor / pad: atac lent, formanți „a” (aprox. 700 + 1150 Hz) */
  pad(t: number, notes: number[], dur: number, v = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.35);
    g.gain.setValueAtTime(v, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 720; f1.Q.value = 1.4;
    const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 1160; f2.Q.value = 2;
    const f2g = ctx.createGain(); f2g.gain.value = 0.6;
    const low = ctx.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = 600;
    const mix = ctx.createGain();
    mix.connect(f1).connect(g); mix.connect(f2).connect(f2g).connect(g); mix.connect(low).connect(g);
    g.connect(this.choir);
    for (const m of notes) for (const det of [-11, 0, 11]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m); o.detune.value = det + (Math.random() - 0.5) * 6;
      o.connect(mix); o.start(t); o.stop(t + dur + 0.6);
    }
  }
}

function distCurve(k: number) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

export interface Song {
  bpm: number;
  length: number; // măsuri
  setup(ctx: AudioContext, out: AudioNode, eng: Eng): Band;
  bar(i: number, t: number, step: number, b: Band): void;
}

/** model de 16 pași: caracter ≠ "." = lovitură; „X” = accent */
const hits = (p: string) => [...p.replace(/ /g, "")].map((c) => (c === "." ? 0 : c === "X" ? 2 : 1));
type Note = [step: number, midi: number, len: number];

// ───────────────────────── SUA ─────────────────────────
// Secțiuni: intro 2 · A 8 · A' 8 (alămuri) · B 8 (alămuri) · break 2 = 28 de măsuri
const D = 50, BB = 46, C = 48, G = 43, A = 45;
const USA_ROOTS = [D, D, ...[D, D, BB, C, D, D, BB, C], ...[D, D, BB, C, D, D, BB, C], ...[G, A, BB, C, G, A, BB, A], D, D];
const USA_LEAD_A: Note[][] = [
  [[0, 62, 4], [4, 69, 4], [8, 74, 6], [14, 72, 2]],
  [[0, 69, 6], [6, 67, 2], [8, 65, 4], [12, 67, 4]],
  [[0, 65, 4], [4, 62, 4], [8, 65, 4], [12, 70, 4]],
  [[0, 69, 8], [8, 67, 4], [12, 64, 4]],
];
const USA_LEAD_A2: Note[] = [[0, 72, 4], [4, 74, 12]];
const USA_LEAD_B: Note[][] = [
  [[0, 74, 6], [6, 74, 2], [8, 72, 4], [12, 70, 4]],
  [[0, 69, 12], [12, 64, 4]],
  [[0, 77, 6], [6, 77, 2], [8, 74, 4], [12, 77, 4]],
  [[0, 76, 8], [8, 74, 4], [12, 72, 4]],
  [[0, 74, 6], [6, 74, 2], [8, 72, 4], [12, 70, 4]],
  [[0, 69, 12], [12, 64, 4]],
  [[0, 77, 6], [6, 77, 2], [8, 74, 4], [12, 77, 4]],
  [[0, 69, 16]],
];
const USA_GTR = hits("X.x.xX.xX.x.xX.x");
const USA_KICK = hits("x.....x.x.....x.");
const USA_SNARE = hits("....x.......x...");
const USA_FILL = hits("....x...xxxxxxxx");

const usa: Song = {
  bpm: 132,
  length: USA_ROOTS.length,
  setup: (ctx, out, eng) => new Band(ctx, out, eng, { drive: 9, guitarLp: 3600, reverbDrums: 0.1 }),
  bar(i, t, s, b) {
    const root = USA_ROOTS[i];
    const intro = i < 2, brk = i >= 26;
    const sec = intro ? "intro" : i < 10 ? "A" : i < 18 ? "A2" : i < 26 ? "B" : "break";
    const k = i - (sec === "A" ? 2 : sec === "A2" ? 10 : 18); // indexul în secțiune
    const lastOfSec = i === 1 || i === 9 || i === 17 || i === 25 || i === 27;
    if (i === 2 || i === 10 || i === 18) b.crash(t);
    // tobe
    for (let st = 0; st < 16; st++) {
      const tt = t + st * s;
      if (brk) {
        if (st % 4 === 0) b.kick(tt, 0.9);
        if (i === 27 && st >= 8) b.tom(tt, 50 - (st - 8) * 2, 0.5 + (st - 8) * 0.06);
        else if (st % 2 === 0) b.hat(tt, 0.6);
        continue;
      }
      if (USA_KICK[st]) b.kick(tt);
      if (lastOfSec ? USA_FILL[st] : USA_SNARE[st]) b.snare(tt, lastOfSec && st > 7 ? 0.45 + (st - 8) * 0.07 : 1);
      if (st % 2 === 0) b.hat(tt, st % 4 === 2 ? 0.55 : 0.8, st === 14 && !intro);
    }
    if (brk) { b.pad(t, [root + 12, root + 19, root + 24], s * 16, 0.5); return; }
    // chitara și basul
    for (let st = 0; st < 16; st++) {
      const tt = t + st * s;
      if (USA_GTR[st]) b.power(tt, root, s * 2, USA_GTR[st] === 2 ? 0.9 : 0.6, intro || USA_GTR[st] === 1);
      if (st % 2 === 0 && !intro) b.bassNote(tt, root - 12, s * 1.8, st === 0 ? 1 : 0.75);
    }
    // alămurile
    let lead: Note[] | null = null;
    if (sec === "A2") lead = k === 7 ? USA_LEAD_A2 : USA_LEAD_A[k % 4];
    if (sec === "B") { lead = USA_LEAD_B[k]; b.pad(t, [root + 12, root + 19, root + 24], s * 16, 0.35); }
    if (lead) for (const [st, m, len] of lead) b.horn(t + st * s, m, len * s * 0.95, 0.9);
  },
};

// ───────────────────────── URSS ─────────────────────────
// Secțiuni: intro 4 · A 8 · A' 8 (corn) · B 8 (corn + cor mare) · break 2 = 30 de măsuri
const CM = 48, AB = 44, BB2 = 46, G2 = 43;
const CHORD: Record<number, number[]> = { [CM]: [60, 63, 67], [AB]: [56, 60, 63], [BB2]: [58, 62, 65], [G2]: [55, 59, 62] };
const USSR_ROOTS = [CM, CM, CM, CM, ...[CM, CM, AB, BB2, CM, CM, AB, BB2], ...[CM, CM, AB, BB2, CM, CM, AB, BB2], ...[AB, BB2, CM, CM, AB, BB2, G2, G2], CM, CM];
const USSR_LEAD_A: Note[][] = [
  [[0, 67, 6], [6, 68, 2], [8, 67, 4], [12, 63, 4]],
  [[0, 65, 4], [4, 63, 4], [8, 62, 4], [12, 63, 4]],
  [[0, 72, 8], [8, 70, 4], [12, 68, 4]],
  [[0, 70, 12], [12, 74, 4]],
];
const USSR_LEAD_A2: Note[] = [[0, 70, 8], [8, 68, 4], [12, 67, 4]];
const USSR_LEAD_B: Note[][] = [
  [[0, 75, 8], [8, 72, 8]],
  [[0, 74, 8], [8, 70, 8]],
  [[0, 72, 6], [6, 74, 2], [8, 75, 4], [12, 79, 4]],
  [[0, 79, 12], [12, 77, 4]],
  [[0, 75, 8], [8, 72, 8]],
  [[0, 77, 8], [8, 74, 8]],
  [[0, 74, 8], [8, 71, 8]],
  [[0, 67, 16]],
];
const OST: Record<number, number> = { 0: 0, 2: 0, 3: 0, 4: 12, 6: 0, 7: 0, 8: 0, 10: 0, 11: 0, 12: 7, 14: 10 };
const USSR_GTR = hits("X.....x.X...x.x.");
const USSR_GHOST = hits("..x...x...x..xx.");

const ussr: Song = {
  bpm: 112,
  length: USSR_ROOTS.length,
  setup: (ctx, out, eng) => new Band(ctx, out, eng, { drive: 6, guitarLp: 2600, reverbDrums: 0.35 }),
  bar(i, t, s, b) {
    const root = USSR_ROOTS[i];
    const intro = i < 4, brk = i >= 28;
    const sec = intro ? "intro" : i < 12 ? "A" : i < 20 ? "A2" : i < 28 ? "B" : "break";
    const k = i - (sec === "A" ? 4 : sec === "A2" ? 12 : 20);
    if (i === 4 || i === 12 || i === 20) b.crash(t, 1.2);
    // marșul: toba mare pe fiecare timp, caisa pe 2 și 4, „nicovala” pe contratimp
    for (let st = 0; st < 16; st++) {
      const tt = t + st * s;
      if (st % 4 === 0) b.kick(tt, intro && i < 2 ? 0.7 : 1);
      if (intro) continue;
      if (st === 4 || st === 12) b.snare(tt, 1.1);
      if (USSR_GHOST[st]) b.snare(tt, 0.18);
      if (st === 6 || st === 14) b.anvil(tt, brk ? 0.6 : 1);
      if ((i === 11 || i === 19 || i === 27 || i === 29) && st >= 12) b.snare(tt, 0.5 + (st - 12) * 0.15);
    }
    // corul
    const big = sec === "B";
    b.pad(t, big ? [...CHORD[root], CHORD[root][0] + 12] : CHORD[root].map((n) => (intro ? n - 12 : n)), s * 16, big ? 0.9 : intro ? 0.7 : 0.55);
    if (intro || brk) { if (brk) b.bassNote(t, root - 12, s * 14, 0.9); return; }
    // ostinato de bas și acorduri de chitară
    for (let st = 0; st < 16; st++) {
      const tt = t + st * s;
      if (OST[st] !== undefined) b.bassNote(tt, root - 12 + OST[st], s * 0.9, st === 0 ? 1 : 0.7);
      if (USSR_GTR[st]) b.power(tt, root - 12, USSR_GTR[st] === 2 ? s * 5 : s * 1.5, USSR_GTR[st] === 2 ? 0.85 : 0.55, USSR_GTR[st] === 1);
    }
    let lead: Note[] | null = null;
    if (sec === "A2") lead = k === 7 ? USSR_LEAD_A2 : USSR_LEAD_A[k % 4];
    if (sec === "B") lead = USSR_LEAD_B[k];
    if (lead) for (const [st, m, len] of lead) b.horn(t + st * s, m - 12, len * s * 0.95, 1, 1500);
  },
};

export const SONGS: Record<string, Song> = { usa, ussr };
