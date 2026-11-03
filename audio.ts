export type MixSettings = { gain: number; low: number; mid: number; high: number; compression: number; reverb: number; delay: number; gate: number; width: number };
export const DEFAULT_MIX: MixSettings = { gain: 0, low: 0, mid: 0, high: 0, compression: 0, reverb: 0, delay: 0, gate: 0, width: 1 };
export type AudioMetrics = { duration: number; peakDb: number; rmsDb: number; low: number; mid: number; high: number; clipping: number; crestDb: number; stereoWidth: number };

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-7));
export function analyzeBuffer(buffer: AudioBuffer): AudioMetrics {
  let peak = 0, squares = 0, count = 0, clipped = 0;
  const n = buffer.length;
  const stride = Math.max(1, Math.floor(n / 250000));
  let prev = 0, crossings = 0;
  const values: number[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i += stride) {
      const x = data[i]; values.push(x); const a = Math.abs(x); peak = Math.max(peak, a); squares += x * x; count++;
      if (a >= 0.999) clipped++;
      if ((prev <= 0 && x > 0) || (prev >= 0 && x < 0)) crossings++;
      prev = x;
    }
  }
  const rms = Math.sqrt(squares / Math.max(1, count));
  // A lightweight, deterministic band estimate from short-window difference energy.
  let lowE = 0, midE = 0, highE = 0;
  const step = Math.max(1, Math.floor(values.length / 50000));
  for (let i = 0; i < values.length - 1; i += step) {
    const x = values[i], d = values[i + 1] - x;
    lowE += x * x; highE += d * d; midE += Math.abs(x * d);
  }
  const total = lowE + midE * 3 + highE * 2 || 1;
  let stereoWidth = 1;
  if (buffer.numberOfChannels > 1) { const l = buffer.getChannelData(0), r = buffer.getChannelData(1); let side = 0, midEnergy = 0; for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 50000))) { const m = (l[i] + r[i]) / 2, sd = (l[i] - r[i]) / 2; midEnergy += m * m; side += sd * sd; } stereoWidth = Math.sqrt(side / Math.max(1e-9, midEnergy)); }
  return { duration: buffer.duration, peakDb: db(peak), rmsDb: db(rms), low: lowE / total, mid: (midE * 3) / total, high: (highE * 2) / total, clipping: clipped / Math.max(1, count), crestDb: db(peak) - db(rms), stereoWidth };
}

export async function decodeFile(file: File): Promise<AudioBuffer> {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); }
  finally { await ctx.close(); }
}

export async function processBuffer(source: AudioBuffer, settings: MixSettings, trimStart = 0, trimEnd = source.duration): Promise<AudioBuffer> {
  const start = Math.max(0, Math.min(source.duration, trimStart));
  const end = Math.max(start + 0.02, Math.min(source.duration, trimEnd));
  const sampleRate = source.sampleRate;
  const frames = Math.max(1, Math.floor((end - start) * sampleRate));
  const offline = new OfflineAudioContext(source.numberOfChannels, frames, sampleRate);
  const clip = offline.createBuffer(source.numberOfChannels, frames, sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) clip.copyToChannel(source.getChannelData(ch).slice(Math.floor(start * sampleRate), Math.floor(start * sampleRate) + frames), ch);
  const src = offline.createBufferSource(); src.buffer = clip;
  const low = offline.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 160; low.gain.value = settings.low;
  const mid = offline.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.8; mid.gain.value = settings.mid;
  const high = offline.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6500; high.gain.value = settings.high;
  const comp = offline.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 1 + settings.compression * 7; comp.attack.value = 0.008; comp.release.value = 0.18;
  const gain = offline.createGain(); gain.gain.value = Math.pow(10, settings.gain / 20);
  src.connect(low); low.connect(mid); mid.connect(high); high.connect(comp);
  let last: AudioNode = comp;
  if (settings.gate > 0) {
    // Gentle gate approximation via a waveshaper; it preserves quiet detail better than a hard mute.
    const shaper = offline.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; const threshold = settings.gate; curve[i] = Math.abs(x) < threshold ? x * 0.18 : x; }
    shaper.curve = curve; shaper.oversample = '2x'; last.connect(shaper); last = shaper;
  }
  if (settings.delay > 0) {
    const delay = offline.createDelay(1.5); delay.delayTime.value = 0.18;
    const wet = offline.createGain(); wet.gain.value = settings.delay * 0.22;
    last.connect(gain); last.connect(delay); delay.connect(wet); wet.connect(gain); last = gain;
  } else last.connect(gain);
  const sum = offline.createGain();
  if (settings.reverb > 0) {
    const delayA = offline.createDelay(1); delayA.delayTime.value = 0.029;
    const delayB = offline.createDelay(1); delayB.delayTime.value = 0.041;
    const wetA = offline.createGain(); wetA.gain.value = settings.reverb * 0.10;
    const wetB = offline.createGain(); wetB.gain.value = settings.reverb * 0.07;
    gain.connect(sum); gain.connect(delayA); delayA.connect(wetA); wetA.connect(sum); gain.connect(delayB); delayB.connect(wetB); wetB.connect(sum);
  } else gain.connect(sum);
  if (source.numberOfChannels > 1 && Math.abs(settings.width - 1) > 0.001) {
    const splitter = offline.createChannelSplitter(2), merger = offline.createChannelMerger(2);
    const ll = offline.createGain(), lr = offline.createGain(), rl = offline.createGain(), rr = offline.createGain();
    const w = Math.max(0.5, Math.min(1.5, settings.width));
    ll.gain.value = (1 + w) / 2; rl.gain.value = (1 - w) / 2; lr.gain.value = (1 - w) / 2; rr.gain.value = (1 + w) / 2;
    sum.connect(splitter); splitter.connect(ll, 0); ll.connect(merger, 0, 0); splitter.connect(rl, 1); rl.connect(merger, 0, 0); splitter.connect(lr, 0); lr.connect(merger, 0, 1); splitter.connect(rr, 1); rr.connect(merger, 0, 1); merger.connect(offline.destination);
  } else sum.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

export function bufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels, length = buffer.length, sampleRate = buffer.sampleRate;
  const bytes = 44 + length * channels * 2;
  const array = new ArrayBuffer(bytes); const view = new DataView(array);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, bytes - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, bytes - 44, true);
  const channelData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) { const s = Math.max(-1, Math.min(1, channelData[c][i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); offset += 2; }
  return new Blob([array], { type: 'audio/wav' });
}
export function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }

export function findSilenceSegments(buffer: AudioBuffer, threshold = 0.018, minSeconds = 0.45) {
  const data = buffer.getChannelData(0), hop = Math.floor(buffer.sampleRate * 0.08), silent: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = 0; i < data.length; i += hop) {
    let sum = 0; for (let j = i; j < Math.min(i + hop, data.length); j += 4) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / Math.max(1, Math.ceil(Math.min(hop, data.length - i) / 4)));
    if (rms < threshold && start < 0) start = i;
    if ((rms >= threshold || i + hop >= data.length) && start >= 0) { const end = i; if ((end - start) / buffer.sampleRate >= minSeconds) silent.push({ start: start / buffer.sampleRate, end: end / buffer.sampleRate }); start = -1; }
  }
  return silent;
}

export function generateAgentBand(duration = 12, bpm = 100, energy = 0.6): { name: string; buffer: AudioBuffer }[] {
  const rate = 44100, frames = Math.floor(duration * rate), beat = 60 / bpm, count = Math.ceil(duration / beat);
  const make = () => new AudioBuffer({ length: frames, sampleRate: rate, numberOfChannels: 2 });
  const kick = make(), snare = make(), hats = make(), bass = make();
  const add = (buf: AudioBuffer, start: number, len: number, fn: (t: number) => number, amp: number) => {
    const from = Math.max(0, Math.floor(start * rate)), to = Math.min(frames, from + Math.floor(len * rate));
    for (let i = from; i < to; i++) { const t = (i - from) / rate; const v = fn(t) * amp; for (let c = 0; c < 2; c++) buf.getChannelData(c)[i] += v; }
  };
  for (let b = 0; b < count; b++) {
    const t = b * beat;
    add(kick, t, 0.35, x => Math.sin(2 * Math.PI * (48 + 100 * Math.exp(-x * 22)) * x) * Math.exp(-x * 13), 0.72 * energy);
    if (b % 2 === 1) add(snare, t, 0.22, x => (Math.random() * 2 - 1) * Math.exp(-x * 21) * 0.75 + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 16) * 0.25, 0.42 * energy);
    for (let h = 0; h < 2; h++) add(hats, t + h * beat / 2, 0.045, x => (Math.random() * 2 - 1) * Math.exp(-x * 90), 0.13 * energy);
    const notes = [55, 55, 65.4, 73.4, 49, 49, 65.4, 73.4];
    const freq = notes[b % notes.length];
    add(bass, t, beat * 0.78, x => Math.sin(2 * Math.PI * freq * x) * Math.exp(-x * 0.8) + Math.sin(4 * Math.PI * freq * x) * 0.16, 0.26 * energy);
  }
  const keys = make(); const chords = [[110, 130.81, 164.81], [87.31, 110, 130.81], [98, 123.47, 146.83], [73.42, 110, 146.83]];
  for (let i = 0; i < Math.ceil(duration / 2); i++) { const chord = chords[i % chords.length]; for (const f of chord) add(keys, i * 2, 1.9, x => Math.sin(2 * Math.PI * f * x) * (0.6 + 0.4 * Math.sin(Math.PI * x / 1.9)), 0.055 * energy); }
  return [{ name: 'Agent Drums · Kick', buffer: kick }, { name: 'Agent Drums · Snare', buffer: snare }, { name: 'Agent Drums · Hats', buffer: hats }, { name: 'Agent Bass', buffer: bass }, { name: 'Agent Keys · Chords', buffer: keys }];
}

export function generateSoundEffect(description: string, duration = 2.8): AudioBuffer {
  const rate = 44100, frames = Math.floor(rate * duration), out = new AudioBuffer({ length: frames, sampleRate: rate, numberOfChannels: 2 });
  const p = description.toLowerCase();
  const noise = /rain|wind|hiss|crowd|door|crack|foot|paper|fire|water/.test(p);
  const base = /bell|chime|glass/.test(p) ? 880 : /door|creak/.test(p) ? 180 : /wood|knock/.test(p) ? 110 : /alarm|siren/.test(p) ? 560 : 240;
  for (let i = 0; i < frames; i++) {
    const t = i / rate, envelope = Math.min(1, t * 12) * Math.exp(-t * (noise ? 0.7 : 2.2));
    const n = Math.random() * 2 - 1;
    const v = (noise ? n * (0.25 + 0.25 * Math.sin(t * 8)) : Math.sin(2 * Math.PI * (base + Math.sin(t * 3) * base * 0.2) * t) * 0.6 + Math.sin(2 * Math.PI * base * 1.51 * t) * 0.2) * envelope;
    for (let c = 0; c < 2; c++) out.getChannelData(c)[i] = v * 0.22;
  }
  return out;
}

export function createMoodBed(curve: number[], duration = 20, bpm = 100): AudioBuffer {
  const rate = 44100, frames = Math.floor(rate * duration), out = new AudioBuffer({ length: frames, sampleRate: rate, numberOfChannels: 2 });
  const chord = [110, 130.81, 164.81, 196];
  for (let i = 0; i < frames; i++) {
    const t = i / rate, progress = t / duration * (curve.length - 1), a = Math.floor(progress), frac = progress - a;
    const energy = Math.max(0, Math.min(1, (curve[a] ?? 0.3) * (1 - frac) + (curve[Math.min(curve.length - 1, a + 1)] ?? 0.3) * frac));
    const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * (bpm / 60 / 2) * t);
    const v = (Math.sin(2 * Math.PI * chord[Math.floor(t / 4) % chord.length] * t) * 0.5 + Math.sin(2 * Math.PI * chord[(Math.floor(t / 4) % chord.length) + 1 > 3 ? 0 : (Math.floor(t / 4) % chord.length) + 1] * 2 * t) * 0.22) * energy * (0.5 + pulse * 0.35);
    out.getChannelData(0)[i] = v * 0.19; out.getChannelData(1)[i] = v * 0.19;
  }
  return out;
}

export function bufferToDataUrl(buffer: AudioBuffer): string { return URL.createObjectURL(bufferToWav(buffer)); }


export function spliceBuffer(source: AudioBuffer, removeStart: number, removeEnd: number): AudioBuffer {
  const a = clampAudio(removeStart, 0, source.duration), b = clampAudio(removeEnd, a, source.duration);
  const rate = source.sampleRate, left = Math.floor(a * rate), right = Math.floor(b * rate);
  const kept = Math.max(0, left) + Math.max(0, source.length - right);
  const out = new AudioBuffer({ length: Math.max(1, kept), sampleRate: rate, numberOfChannels: source.numberOfChannels });
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch), src = source.getChannelData(ch);
    dst.set(src.slice(0, left), 0); dst.set(src.slice(right), left);
    const fade = Math.min(Math.floor(rate * 0.008), left, dst.length - left);
    for (let i = 0; i < fade; i++) { const t = i / Math.max(1, fade); dst[left - fade + i] *= t; dst[left + i] *= t; }
  }
  return out;
}
function clampAudio(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export function alignAndSelectCleanest(buffers: AudioBuffer[]): { buffer: AudioBuffer; offsets: number[]; selectedSources: number[] } {
  if (buffers.length < 2) throw new Error('At least two recordings are required.');
  const rate = buffers[0].sampleRate;
  const onset = (b: AudioBuffer) => { const d = b.getChannelData(0), hop = Math.max(1, Math.floor(b.sampleRate * 0.01)); for (let i = 0; i < d.length; i += hop) { let e = 0, n = 0; for (let j = i; j < Math.min(d.length, i + hop); j += 3) { e += d[j] * d[j]; n++; } if (Math.sqrt(e / Math.max(1, n)) > 0.025) return i / b.sampleRate; } return 0; };
  const raw = buffers.map(onset), anchor = Math.min(...raw), offsets = raw.map(x => x - anchor);
  const duration = Math.max(...buffers.map((b, i) => b.duration + offsets[i]));
  const frames = Math.ceil(duration * rate); const out = new AudioBuffer({ length: frames, sampleRate: rate, numberOfChannels: 2 });
  const selectedSources: number[] = []; const block = Math.floor(rate * 0.5);
  for (let start = 0; start < frames; start += block) {
    const scores = buffers.map((b, idx) => {
      const pos = Math.floor((start / rate - offsets[idx]) * b.sampleRate); if (pos < 0 || pos >= b.length) return -Infinity;
      const d = b.getChannelData(0), len = Math.min(Math.floor(block * b.sampleRate / rate), d.length - pos); let energy = 0, clips = 0;
      for (let i = 0; i < len; i += 4) { energy += d[pos + i] * d[pos + i]; if (Math.abs(d[pos + i]) > .995) clips++; }
      const rms = Math.sqrt(energy / Math.max(1, Math.ceil(len / 4))); const levelPenalty = Math.abs(db(rms) + 22); const clipPenalty = clips / Math.max(1, Math.ceil(len / 4)) * 400;
      return -levelPenalty - clipPenalty;
    });
    const best = scores.indexOf(Math.max(...scores)); selectedSources.push(best);
    if (best < 0) continue;
    const src = buffers[best], offsetFrames = Math.floor(offsets[best] * src.sampleRate), sourcePos = Math.floor((start / rate) * src.sampleRate - offsetFrames);
    const count = Math.min(block, frames - start, Math.max(0, Math.floor((src.length - sourcePos) * rate / src.sampleRate)));
    if (count <= 0) continue;
    for (let ch = 0; ch < 2; ch++) {
      const srcCh = src.getChannelData(Math.min(ch, src.numberOfChannels - 1)), dst = out.getChannelData(ch);
      for (let j = 0; j < count; j++) { const si = Math.floor((sourcePos + j * src.sampleRate / rate)); if (si >= 0 && si < srcCh.length) dst[start + j] = srcCh[si]; }
    }
  }
  return { buffer: out, offsets, selectedSources };
}
