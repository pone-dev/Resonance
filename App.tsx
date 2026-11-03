import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AudioLines, AudioWaveform, Bandage, BookOpen, BrainCircuit, Check, ChevronDown,
  CircleHelp, Copy, Download, Drum, FileAudio, Gauge, Headphones, History, Layers3, Link2,
  ListMusic, LoaderCircle, MessageSquare, Mic, Mic2, Minus, Pause, Play, Plus, Radio,
  RefreshCw, Save, Search, ShieldCheck, Sparkles, Split, Trash2, Upload, WandSparkles, Waves, X, Zap, FileMusic
} from 'lucide-react';
import {
  analyzeBuffer, alignAndSelectCleanest, bufferToDataUrl, bufferToWav, createMoodBed, decodeFile, DEFAULT_MIX,
  downloadBlob, findSilenceSegments, generateAgentBand, generateSoundEffect, processBuffer,
  spliceBuffer, type AudioMetrics, type MixSettings
} from './audio';

type Track = {
  id: string; name: string; url: string; serverUrl?: string; duration: number; buffer: AudioBuffer;
  settings: MixSettings; metrics: AudioMetrics; kind: string; aiLabel: boolean; file?: File;
};
type NavKey = 'studio' | 'creative' | 'podcast' | 'repair' | 'workflow' | 'consent';
type Consent = { _id: string; speaker: string; purpose: string; active: boolean; evidence?: string; createdAt?: string };
type Recipe = { _id?: string; id?: string; name: string; description: string; steps: any[] };
const API = '/api';
const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, s) % 60).toString().padStart(2, '0')}`;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const presets: Record<string, Partial<MixSettings>> = {
  'Warm vocal': { low: 1.8, mid: -0.7, high: 0.5, compression: 0.35, gain: 1 },
  'Podcast clarity': { low: -1.4, mid: 1.1, high: 1.4, compression: 0.48, gate: 0.009 },
  'Gentle master': { low: 0.4, mid: 0.2, high: 0.6, compression: 0.25, gain: 0.8 },
  'Lo-fi texture': { low: 1.6, mid: -0.8, high: -2.4, reverb: 0.22, width: 0.9 },
  'Bright acoustic': { low: -0.5, mid: 0.4, high: 1.8, reverb: 0.12 }
};

async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('resonance.token');
  const headers = new Headers(options.headers || {}); if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API}${url}`, { ...options, headers });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as any)?.error || `Request failed (${response.status})`);
  return data as T;
}
const json = (body: any): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function Slider({ label, value, min, max, step = 0.1, unit = '', onChange, left, right }: any) {
  return <div className="slider-control"><div className="slider-top"><span>{label}</span><strong>{Number(value).toFixed(step < 1 ? 1 : 0)}{unit}</strong></div><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /><div className="slider-ends"><span>{left ?? min}</span><span>{right ?? max}</span></div></div>;
}
function SectionTitle({ eyebrow, title, detail, action }: any) { return <div className="section-title"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>; }
function Waveform({ buffer, progress = 0, onSeek }: { buffer: AudioBuffer; progress?: number; onSeek?: (p: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const ctx = el.getContext('2d'); if (!ctx) return;
    const w = el.width = Math.max(320, el.clientWidth * devicePixelRatio), h = el.height = 110 * devicePixelRatio;
    ctx.clearRect(0, 0, w, h); const data = buffer.getChannelData(0), step = Math.ceil(data.length / w), mid = h / 2;
    ctx.fillStyle = '#171a22'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8b78f4'; ctx.lineWidth = 1.2 * devicePixelRatio; ctx.beginPath();
    for (let x = 0; x < w; x++) { let min = 1, max = -1; for (let j = x * step; j < Math.min((x + 1) * step, data.length); j += 1) { min = Math.min(min, data[j]); max = Math.max(max, data[j]); } ctx.moveTo(x, mid + min * mid * 0.83); ctx.lineTo(x, mid + max * mid * 0.83); }
    ctx.stroke(); ctx.fillStyle = 'rgba(151,132,255,.12)'; ctx.fillRect(0, 0, w * progress, h); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.moveTo(w * progress, 0); ctx.lineTo(w * progress, h); ctx.stroke();
  }, [buffer, progress]);
  return <canvas className="waveform" ref={canvas} onClick={e => { if (onSeek) { const r = e.currentTarget.getBoundingClientRect(); onSeek(clamp((e.clientX - r.left) / r.width, 0, 1)); } }} />;
}
function Metric({ label, value, hint }: any) { return <div className="metric"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>; }
function EmptyState({ title, body, action }: any) { return <div className="empty-state"><div className="empty-icon"><AudioWaveform size={25} /></div><h3>{title}</h3><p>{body}</p>{action}</div>; }

export default function App() {
  const [active, setActive] = useState<NavKey>('studio');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [projectName, setProjectName] = useState('Untitled Session');
  const [projectId, setProjectId] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [prompt, setPrompt] = useState('Make the vocals warmer and sit them behind the guitar');
  const [aiBusy, setAiBusy] = useState(false);
  const [message, setMessage] = useState('Import an audio file to start creating.');
  const [toast, setToast] = useState('');
  const [versions, setVersions] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [savedProjects, setSavedProjects] = useState<any[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [reviewProject, setReviewProject] = useState<any>(null);
  const [reference, setReference] = useState<{ name: string; buffer: AudioBuffer; metrics: AudioMetrics } | null>(null);
  const [referenceResult, setReferenceResult] = useState<string>('');
  const [transcript, setTranscript] = useState('');
  const [transcriptSegments, setTranscriptSegments] = useState<{ start: number; end: number; text: string }[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState('No transcript yet');
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(30);
  const [chapterList, setChapterList] = useState<{ start: number; end: number }[]>([]);
  const [paceResult, setPaceResult] = useState('');
  const [roomResult, setRoomResult] = useState('');
  const [syncResult, setSyncResult] = useState('');
  const [syncPreview, setSyncPreview] = useState<AudioBuffer | null>(null);
  const [syncFiles, setSyncFiles] = useState<File[]>([]);
  const [soundQuery, setSoundQuery] = useState('wooden door creaking in an empty hall');
  const [moodCurve, setMoodCurve] = useState([0.2, 0.25, 0.45, 0.9, 0.7, 0.35]);
  const [bpm, setBpm] = useState(100);
  const [bandEnergy, setBandEnergy] = useState(0.6);
  const [styleName, setStyleName] = useState('My signature sound');
  const [styleResult, setStyleResult] = useState('');
  const [stylePreset, setStylePreset] = useState<Partial<MixSettings> | null>(null);
  const [versionPreviewUrl, setVersionPreviewUrl] = useState('');
  const [selectedConsent, setSelectedConsent] = useState('');
  const [selectedDubConsents, setSelectedDubConsents] = useState<string[]>([]);
  const [arrangementPlan, setArrangementPlan] = useState('');
  const [liveTranscribing, setLiveTranscribing] = useState(false);
  const [consentSpeaker, setConsentSpeaker] = useState('');
  const [consentPurpose, setConsentPurpose] = useState('voice-repair');
  const [consentEvidence, setConsentEvidence] = useState('');
  const [repairText, setRepairText] = useState('Replace the mispronounced word at 00:12 with “resonance”.');
  const [dubLanguage, setDubLanguage] = useState('Hindi');
  const [creditFeature, setCreditFeature] = useState('stems');
  const [creditEstimate, setCreditEstimate] = useState<any>(null);
  const [reviewUrl, setReviewUrl] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentTime, setCommentTime] = useState(0);
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [authLocked, setAuthLocked] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [voiceCommand, setVoiceCommand] = useState(false);
  const [recipeName, setRecipeName] = useState('Clean · Tighten · Mix · Master');
  const [recipeSteps, setRecipeSteps] = useState(['cleanup', 'compress', 'warm', 'master']);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const graphNodesRef = useRef<AudioNode[]>([]);
  const versionRef = useRef<any[]>([]);
  const current = tracks.find(t => t.id === currentId) || tracks[0];
  const [settings, setSettings] = useState<MixSettings>(DEFAULT_MIX);
  const settingsRef = useRef(settings);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { if (!currentId) return; const timer = window.setTimeout(() => addVersion('Auto checkpoint · mix change'), 900); return () => window.clearTimeout(timer); }, [currentId, settings, trimStart, trimEnd]);
  useEffect(() => { api<any>('/health').then(async h => { setServerStatus(h); if (h.authRequired && !window.location.pathname.startsWith('/review/')) { try { await api('/auth/verify'); } catch { setAuthLocked(true); } } }).catch(() => setServerStatus({ ok: false, database: 'offline' })); }, []);
  useEffect(() => { if (active === 'consent' || active === 'repair' || active === 'podcast') loadConsents(); if (active === 'workflow') loadProjectsAndRecipes(); }, [active]);
  useEffect(() => { if (current) { setSettings(current.settings); setTrimStart(0); setTrimEnd(current.duration); setCurrentTime(0); } }, [currentId]);
  useEffect(() => { const el = audioRef.current; if (!el) return; const time = () => setCurrentTime(el.currentTime); const end = () => setPlaying(false); el.addEventListener('timeupdate', time); el.addEventListener('ended', end); return () => { el.removeEventListener('timeupdate', time); el.removeEventListener('ended', end); }; }, []);
  useEffect(() => {
    const el = audioRef.current; if (!el || !current) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (!sourceNodeRef.current) sourceNodeRef.current = ctx.createMediaElementSource(el);
    graphNodesRef.current.forEach(n => { try { n.disconnect(); } catch {} }); graphNodesRef.current = [];
    const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 160; low.gain.value = settings.low;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.8; mid.gain.value = settings.mid;
    const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6500; high.gain.value = settings.high;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 1 + settings.compression * 7;
    const gain = ctx.createGain(); gain.gain.value = Math.pow(10, settings.gain / 20);
    sourceNodeRef.current.connect(low); low.connect(mid); mid.connect(high); high.connect(comp);
    let tail: AudioNode = comp;
    const nodes: AudioNode[] = [low, mid, high, comp, gain];
    if (settings.gate > 0) { const shaper = ctx.createWaveShaper(); const curve = new Float32Array(2048); for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.abs(x) < settings.gate ? x * 0.18 : x; } shaper.curve = curve; tail.connect(shaper); tail = shaper; nodes.push(shaper); }
    const sum = ctx.createGain(); tail.connect(gain); gain.connect(sum); nodes.push(sum);
    if (settings.delay > 0) { const delay = ctx.createDelay(1); delay.delayTime.value = 0.18; const wet = ctx.createGain(); wet.gain.value = settings.delay * 0.22; gain.connect(delay); delay.connect(wet); wet.connect(sum); nodes.push(delay, wet); }
    if (settings.reverb > 0) { for (const ms of [0.029, 0.041, 0.053]) { const delay = ctx.createDelay(1); delay.delayTime.value = ms; const wet = ctx.createGain(); wet.gain.value = settings.reverb * 0.055; gain.connect(delay); delay.connect(wet); wet.connect(sum); nodes.push(delay, wet); } }
    if (current.buffer.numberOfChannels > 1 && Math.abs(settings.width - 1) > 0.001) {
      const splitter = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(2); const ll = ctx.createGain(), lr = ctx.createGain(), rl = ctx.createGain(), rr = ctx.createGain(); const w = clamp(settings.width, .5, 1.5);
      ll.gain.value = (1 + w) / 2; rl.gain.value = (1 - w) / 2; lr.gain.value = (1 - w) / 2; rr.gain.value = (1 + w) / 2;
      sum.connect(splitter); splitter.connect(ll, 0); ll.connect(merger, 0, 0); splitter.connect(rl, 1); rl.connect(merger, 0, 0); splitter.connect(lr, 0); lr.connect(merger, 0, 1); splitter.connect(rr, 1); rr.connect(merger, 0, 1); merger.connect(ctx.destination); nodes.push(splitter, merger, ll, lr, rl, rr);
    } else sum.connect(ctx.destination);
    graphNodesRef.current = nodes;
  }, [currentId, settings.low, settings.mid, settings.high, settings.gain, settings.compression, settings.gate, settings.delay, settings.reverb, settings.width]);
  useEffect(() => { const timer = setTimeout(() => setToast(''), 3600); return () => clearTimeout(timer); }, [toast]);

  const notify = (text: string) => { setToast(text); setMessage(text); };
  const updateCurrentSettings = (patch: Partial<MixSettings>, label = 'Mix updated') => {
    if (!current) return;
    const next = { ...current.settings, ...patch };
    setSettings(next); setTracks(prev => prev.map(t => t.id === current.id ? { ...t, settings: next, aiLabel: t.aiLabel || label.toLowerCase().includes('ai') } : t));
    setMessage(label);
  };
  const addTrack = async (file: File, kind = 'Audio', aiLabel = false, serverUrl?: string) => {
    try {
      const buffer = await decodeFile(file), metrics = analyzeBuffer(buffer), url = URL.createObjectURL(file);
      const track: Track = { id: crypto.randomUUID(), name: file.name, url, duration: buffer.duration, buffer, settings: { ...DEFAULT_MIX }, metrics, kind, aiLabel, file, serverUrl };
      setTracks(prev => [...prev, track]); setCurrentId(track.id); setTrimStart(0); setTrimEnd(buffer.duration); setProjectName(file.name.replace(/\.[^.]+$/, ''));
      notify(`Imported ${file.name} · ${fmt(buffer.duration)} · ${buffer.numberOfChannels} channel(s)`);
      addVersion('Imported audio');
    } catch (e: any) { notify(`Could not decode this media file: ${e.message}`); }
  };
  const addGeneratedTrack = (name: string, buffer: AudioBuffer, kind: string, aiLabel = false) => {
    const url = bufferToDataUrl(buffer), track: Track = { id: crypto.randomUUID(), name, url, duration: buffer.duration, buffer, settings: { ...DEFAULT_MIX }, metrics: analyzeBuffer(buffer), kind, aiLabel };
    setTracks(prev => [...prev, track]); setCurrentId(track.id); setTrimStart(0); setTrimEnd(buffer.duration); notify(`${name} added as an editable track.`); addVersion(`Generated ${name}`);
  };
  const addVersion = (label: string) => {
    const snap = { label, createdAt: new Date().toISOString(), settings: { ...settingsRef.current }, trimStart, trimEnd, tracks: tracks.map(t => ({ id: t.id, name: t.name, settings: { ...t.settings } })) };
    versionRef.current = [snap, ...versionRef.current].slice(0, 40); setVersions([...versionRef.current]);
    try { localStorage.setItem('resonance.versions', JSON.stringify(versionRef.current)); } catch {}
  };
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem('resonance.versions') || '[]'); if (saved.length) { versionRef.current = saved; setVersions(saved); } const rs = JSON.parse(localStorage.getItem('resonance.recipes') || '[]'); setRecipes(rs); } catch {} }, []);
  const selectTrack = (id: string) => { setCurrentId(id); setPlaying(false); if (audioRef.current) audioRef.current.pause(); };
  const playPause = async () => { const el = audioRef.current; if (!el || !current) return; try { if (audioCtxRef.current?.state === 'suspended') await audioCtxRef.current.resume(); if (playing) { el.pause(); setPlaying(false); } else { await el.play(); setPlaying(true); } } catch (e: any) { notify(`Playback error: ${e.message}`); } };
  const applyPreset = (name: string) => { updateCurrentSettings({ ...DEFAULT_MIX, ...presets[name] }, `${name} preset applied`); addVersion(`${name} preset`); };
  const runDescribeMix = async () => {
    if (!current) return notify('Import an audio track first.');
    setAiBusy(true);
    try {
      let result: any;
      try { result = await api('/ai/describe-mix', json({ prompt })); }
      catch { const p = prompt.toLowerCase(), s: any = {}; if (/warm/.test(p)) s.low = 2; if (/bright|air/.test(p)) s.high = 1.8; if (/harsh/.test(p)) s.high = -2; if (/behind|quieter|lower/.test(p)) s.gain = -3; if (/loud|forward/.test(p)) s.gain = 2; if (/wide/.test(p)) s.width = 1.2; if (/compress/.test(p)) s.compression = 0.4; if (/reverb|space/.test(p)) s.reverb = 0.2; result = { settings: s, explanation: 'Local mix-command parser interpreted your request.' }; }
      updateCurrentSettings(result.settings || {}, 'AI Describe-to-Mix applied'); setTracks(prev => prev.map(t => t.id === current.id ? { ...t, aiLabel: true } : t)); addVersion('Describe-to-Mix'); notify(result.explanation || 'Suggested settings applied.');
    } catch (e: any) { notify(e.message); } finally { setAiBusy(false); }
  };
  const exportMix = async (clipStart = trimStart, clipEnd = trimEnd, baseName = current?.name || 'resonance-mix') => {
    if (!current) return;
    try {
      setAiBusy(true); const rendered = await processBuffer(current.buffer, current.settings, clipStart, clipEnd); const wav = bufferToWav(rendered);
      const safe = baseName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]/gi, '-');
      downloadBlob(wav, `${safe}-resonance.wav`);
      const metadata = { product: 'Resonance', aiAssisted: current.aiLabel, track: current.name, exportedAt: new Date().toISOString(), settings: current.settings, note: 'AI-assisted edits are disclosed here and on the exported track timeline.' };
      downloadBlob(new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), `${safe}-resonance-metadata.json`);
      notify('WAV mix and AI-edit metadata sidecar exported.');
    } catch (e: any) { notify(`Export failed: ${e.message}`); } finally { setAiBusy(false); }
  };
  const doReferenceMatch = async () => {
    if (!current || !reference) return notify('Load a reference track first.');
    const a = current.metrics, b = reference.metrics;
    const patch: Partial<MixSettings> = {
      gain: clamp(current.settings.gain + clamp((b.rmsDb - a.rmsDb) * 0.45, -4, 4), -18, 12),
      low: clamp(current.settings.low + clamp((b.low - a.low) * 14, -3, 3), -12, 12),
      mid: clamp(current.settings.mid + clamp((b.mid - a.mid) * 12, -3, 3), -12, 12),
      high: clamp(current.settings.high + clamp((b.high - a.high) * 12, -3, 3), -12, 12),
      width: clamp(current.settings.width + clamp((b.stereoWidth - a.stereoWidth) * 0.5, -0.2, 0.2), 0.5, 1.5)
    };
    updateCurrentSettings(patch, 'Reference Match suggestions applied'); setReferenceResult(`Suggested changes: gain ${patch.gain?.toFixed(1)} dB, low ${patch.low?.toFixed(1)} dB, mid ${patch.mid?.toFixed(1)} dB, high ${patch.high?.toFixed(1)} dB, width ${patch.width?.toFixed(2)}. These are measurement-based starting points, not perceptual mastering guarantees.`); setTracks(prev => prev.map(t => t.id === current.id ? { ...t, aiLabel: true } : t)); addVersion('Reference Match');
  };
  const explainMix = async () => {
    if (!current) return notify('Import an audio track first.');
    try { const result = await api('/ai/explain-mix', json({ metrics: current.metrics })); setMessage(result.explanation); notify(result.explanation); }
    catch (e: any) { notify(e.message); }
  };
  const uploadToApi = async (file: File) => { const form = new FormData(); form.append('file', file); return api<any>('/upload', { method: 'POST', body: form }); };
  const separateStems = async () => {
    if (!current?.file) return notify('This track needs to be imported from a local audio file before server stem separation.');
    setAiBusy(true); try { const uploaded = await uploadToApi(current.file); const result = await api<any>('/stems', json({ mediaUrl: uploaded.url, filename: current.name, stems: ['vocals', 'drums', 'bass', 'other'] }));
      const stems = result.stems || []; if (!stems.length) return notify('Stem service returned no stem files. Check the configured provider response.');
      for (const s of stems) { const r = await fetch(s.url); const f = new File([await r.blob()], s.name || `${s.type}.wav`); await addTrack(f, `Stem · ${s.type || s.name}`, true, s.url); }
      notify(`Added ${stems.length} separated stems.`);
    } catch (e: any) { notify(e.message); } finally { setAiBusy(false); }
  };
  const loadProjectsAndRecipes = async () => {
    try { const [p, r] = await Promise.all([api<any[]>('/projects'), api<Recipe[]>('/recipes')]); setSavedProjects(p); setRecipes(r); }
    catch (e: any) { if (serverStatus?.database === 'connected') notify(e.message); }
  };
  const openProject = async (p: any) => {
    try {
      const loaded: Track[] = [];
      for (const t of p.tracks || []) {
        if (!t.url) continue;
        const response = await fetch(t.url); if (!response.ok) throw new Error(`Could not fetch ${t.name}`);
        const blob = await response.blob(); const file = new File([blob], t.name || 'session-track.wav', { type: blob.type || 'audio/wav' }); const buffer = await decodeFile(file);
        loaded.push({ id: t.id || crypto.randomUUID(), name: t.name || file.name, url: URL.createObjectURL(blob), serverUrl: t.url, duration: buffer.duration, buffer, settings: { ...DEFAULT_MIX, ...(t.settings || {}) }, metrics: analyzeBuffer(buffer), kind: t.kind || 'Audio', aiLabel: Boolean(t.aiLabel), file });
      }
      setProjectId(p._id); setProjectName(p.name || 'Untitled Session'); setTracks(loaded); setCurrentId(loaded[0]?.id || ''); setVersions([]); versionRef.current = [];
      const serverVersions = await api<any[]>(`/projects/${p._id}/versions`).catch(() => []); setVersions(serverVersions.map(v => ({ ...v.snapshot, label: v.label, createdAt: v.createdAt })));
      setActive('studio'); notify(`Opened project “${p.name}” with ${loaded.length} track(s).`);
    } catch (e: any) { notify(`Could not open project: ${e.message}`); }
  };
  const loadConsents = async () => { try { const list = await api<Consent[]>('/consents'); setConsents(list); } catch (e: any) { notify(`Consent vault unavailable: ${e.message}`); } };
  const createConsent = async () => {
    try { const created = await api<Consent>('/consents', json({ speaker: consentSpeaker, purpose: consentPurpose, evidence: consentEvidence, scope: [consentPurpose] })); setConsents(prev => [created, ...prev]); setSelectedConsent(created._id); setConsentSpeaker(''); setConsentEvidence(''); notify('Consent record created. Keep the signed permission evidence securely.'); }
    catch (e: any) { notify(e.message); }
  };
  const revokeConsent = async (id: string) => { try { const item = await api<Consent>(`/consents/${id}/revoke`, { method: 'POST' }); setConsents(prev => prev.map(c => c._id === id ? item : c)); if (selectedConsent === id) setSelectedConsent(''); notify('Consent revoked. New protected operations will be blocked.'); } catch (e: any) { notify(e.message); } };
  const voiceRepair = async () => {
    if (!current?.file || !selectedConsent) return notify('Choose a track and active voice-repair consent first.');
    setAiBusy(true); try { const media = await uploadToApi(current.file); const r = await api<any>('/voice/repair', json({ mediaUrl: media.url, instruction: repairText, consentId: selectedConsent })); if (r.url) { const resp = await fetch(r.url); await addTrack(new File([await resp.blob()], r.name || 'voice-repair.wav'), 'AI Voice Repair', true, r.url); } notify(r.message || (r.url ? 'Repaired audio added to the session.' : 'Voice repair job submitted to the configured provider.')); }
    catch (e: any) { notify(e.message); } finally { setAiBusy(false); }
  };
  const dub = async () => {
    if (!current?.file || !selectedDubConsents.length) return notify('Choose a track and active dubbing consent for every speaker first.');
    setAiBusy(true); try { const media = await uploadToApi(current.file); const r = await api<any>('/dub', json({ mediaUrl: media.url, targetLanguage: dubLanguage, consentIds: selectedDubConsents })); if (r.url) { const resp = await fetch(r.url); await addTrack(new File([await resp.blob()], r.name || `dub-${dubLanguage}.wav`), `AI Dub · ${dubLanguage}`, true, r.url); } notify(r.message || (r.url ? 'Dubbed audio added to the session.' : 'Dubbing job submitted to the configured provider.')); }
    catch (e: any) { notify(e.message); } finally { setAiBusy(false); }
  };
  const saveProject = async () => {
    try {
      const serverTracks: any[] = [];
      for (const t of tracks) {
        let mediaUrl = t.serverUrl;
        if (!mediaUrl) { const file = t.file || new File([bufferToWav(t.buffer)], `${t.name.replace(/[^a-z0-9-_]/gi, '-')}.wav`, { type: 'audio/wav' }); const uploaded = await uploadToApi(file); mediaUrl = uploaded.url; setTracks(prev => prev.map(x => x.id === t.id ? { ...x, serverUrl: mediaUrl } : x)); }
        serverTracks.push({ id: t.id, name: t.name, duration: t.duration, settings: t.settings, kind: t.kind, aiLabel: t.aiLabel, url: mediaUrl });
      }
      const payload = { name: projectName, description: 'Resonance audio session', tracks: serverTracks };
      if (projectId) await api(`/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      else { const p = await api<any>('/projects', json(payload)); setProjectId(p._id); }
      notify('Project and media saved to the Resonance server.');
    } catch (e: any) { localStorage.setItem('resonance.project', JSON.stringify({ name: projectName, tracks: tracks.map(t => ({ id: t.id, name: t.name, duration: t.duration, settings: t.settings, kind: t.kind, aiLabel: t.aiLabel })) })); notify(`Saved session metadata locally. Server/media save unavailable: ${e.message}`); }
  };
  const saveVersionToServer = async () => {
    if (!projectId) { addVersion('Manual checkpoint'); return notify('Checkpoint saved locally. Save the project to sync versions to the server.'); }
    try { await api(`/projects/${projectId}/versions`, json({ label: 'Manual checkpoint', snapshot: { tracks: tracks.map(t => ({ id: t.id, name: t.name, settings: t.settings })) } })); notify('Version checkpoint saved to server.'); }
    catch (e: any) { notify(e.message); }
    addVersion('Manual checkpoint');
  };
  const createReviewLink = async () => {
    try {
      let id = projectId; const serverTracks: any[] = [];
      for (const t of tracks) { let mediaUrl = t.serverUrl; if (!mediaUrl) { const f = t.file || new File([bufferToWav(t.buffer)], `${t.name.replace(/[^a-z0-9-_]/gi, '-')}.wav`, { type: 'audio/wav' }); const u = await uploadToApi(f); mediaUrl = u.url; setTracks(prev => prev.map(x => x.id === t.id ? { ...x, serverUrl: mediaUrl } : x)); } serverTracks.push({ id: t.id, name: t.name, duration: t.duration, settings: t.settings, kind: t.kind, aiLabel: t.aiLabel, url: mediaUrl }); }
      const payload = { name: projectName, description: 'Resonance audio session', tracks: serverTracks };
      if (!id) { const saved = await api<any>('/projects', json(payload)); id = saved._id; setProjectId(id); } else await api(`/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const r = await api<any>(`/projects/${id}/share`, json({})); setReviewUrl(r.url); navigator.clipboard?.writeText(r.url); notify('Private review link copied.');
    } catch (e: any) { notify(`Could not create review link: ${e.message}`); }
  };
  const saveRecipe = async () => {
    const recipe = { name: recipeName, description: 'Reusable audio processing sequence', steps: recipeSteps.map(type => ({ type })) };
    try { const saved = await api<Recipe>('/recipes', json(recipe)); setRecipes(prev => [saved, ...prev]); notify('Recipe saved to the server.'); }
    catch { const local = { ...recipe, id: crypto.randomUUID() }; const all = [local, ...recipes]; setRecipes(all); localStorage.setItem('resonance.recipes', JSON.stringify(all)); notify('Recipe saved locally.'); }
  };
  const runRecipe = async (recipe: Recipe) => {
    if (!tracks.length) return notify('Import one or more tracks first.');
    let patch: Partial<MixSettings> = {};
    for (const step of recipe.steps) { const type = step.type; if (type === 'cleanup') patch = { ...patch, gate: 0.012 }; if (type === 'compress') patch = { ...patch, compression: 0.42 }; if (type === 'warm') patch = { ...patch, low: 1.5, mid: -0.4 }; if (type === 'master') patch = { ...patch, gain: 1, high: 0.5 }; if (type === 'clarity') patch = { ...patch, high: 1.2, mid: 0.5 }; }
    setTracks(prev => prev.map(t => ({ ...t, settings: { ...t.settings, ...patch } }))); if (current) setSettings({ ...current.settings, ...patch }); addVersion(`Recipe: ${recipe.name}`); notify(`Recipe “${recipe.name}” applied to ${tracks.length} track(s).`);
  };
  const exportCaptions = () => {
    if (!current) return;
    const toSrtTime = (n: number) => { const ms = Math.max(0, Math.round(n * 1000)); const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), sec = Math.floor(ms % 60000 / 1000), milli = ms % 1000; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(milli).padStart(3,'0')}`; };
    const segs = transcriptSegments.length ? transcriptSegments : transcript.trim() ? [{ start: clipStart, end: clipEnd, text: transcript.trim() }] : [];
    const lines = segs.filter(s => s.end > clipStart && s.start < clipEnd).map((s, i) => `${i + 1}\n${toSrtTime(Math.max(0, s.start - clipStart))} --> ${toSrtTime(Math.min(clipEnd - clipStart, s.end - clipStart))}\n${s.text}`).join('\n\n');
    if (!lines) return notify('Add transcript text or timestamped segments before exporting captions.');
    downloadBlob(new Blob([lines], { type: 'text/plain;charset=utf-8' }), 'resonance-clip-captions.srt'); notify('Caption sidecar exported as SRT.');
  };
  const makePreview = async () => { if (!current) return; try { const b = await processBuffer(current.buffer, current.settings, 0, Math.min(8, current.duration)); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(bufferToDataUrl(b)); } catch (e: any) { notify(e.message); } };
  const runPaceCoach = () => {
    const words = transcript.trim().split(/\s+/).filter(Boolean), duration = current?.duration || 0, fillers = (transcript.match(/\b(um|uh|like|you know|basically|actually)\b/gi) || []).length;
    if (!words.length || !duration) return setPaceResult('Add a transcript and load a recording to calculate speaking pace.');
    const wpm = Math.round(words.length / (duration / 60)); const score = clamp(100 - fillers * 3 - Math.abs(wpm - 145) * 0.35, 0, 100);
    setPaceResult(`${wpm} words/minute · ${fillers} filler word(s) · ${score.toFixed(0)}/100 coaching score. ${wpm > 175 ? 'Try slowing down and pausing at sentence boundaries.' : wpm < 105 ? 'Try adding a little more energy and reducing long pauses.' : 'Your pace is in a conversational range. Focus on consistent emphasis and clear endings.'}`);
  };
  const transcribe = async () => {
    if (!current?.file) return notify('Import an audio file first.');
    setAiBusy(true); try { const media = await uploadToApi(current.file); const r = await api<any>('/transcribe', json({ mediaUrl: media.url, language: 'auto' })); setTranscript(r.text || ''); setTranscriptSegments(Array.isArray(r.segments) ? r.segments.map((x: any) => ({ start: Number(x.start || 0), end: Number(x.end || 0), text: String(x.text || '') })) : []); setTranscriptStatus(Array.isArray(r.segments) ? `Provider transcription · ${r.segments.length} timestamped segments` : 'Provider transcription completed'); notify('Transcript loaded.'); }
    catch (e: any) { setTranscriptStatus(e.message); notify(e.message); } finally { setAiBusy(false); }
  };
  const makeChapters = () => {
    if (!current) return notify('Import a track first.');
    const silences = findSilenceSegments(current.buffer, 0.012, 0.7); const cuts = [0, ...silences.map(s => s.end), current.duration].sort((a, b) => a - b);
    const chapters: { start: number; end: number }[] = []; for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > 2.5) chapters.push({ start: cuts[i], end: cuts[i + 1] });
    setChapterList(chapters); setClipStart(0); setClipEnd(Math.min(30, current.duration)); notify(`Found ${chapters.length} chapter/clip regions using silence boundaries. Review them before publishing.`);
  };
  const startVoiceCommand = () => {
    const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Speech) return notify('This browser does not support speech recognition. Try Chrome or type a command.');
    const recog = new Speech(); recog.lang = 'en-US'; recog.interimResults = false; recog.onresult = (e: any) => { const text = e.results[0][0].transcript; setPrompt(text); setVoiceCommand(false); const p = text.toLowerCase(); if (/cut|trim/.test(p) && current) { const end = Math.max(0, currentTime); setTrimEnd(end); notify(`Trim end set to ${fmt(end)}. Export to apply the edit.`); } else { setTimeout(() => runDescribeMix(), 50); } }; recog.onerror = () => setVoiceCommand(false); recog.onend = () => setVoiceCommand(false); setVoiceCommand(true); recog.start();
  };
  const startLiveTranscript = () => {
    const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Speech) return notify('Live speech recognition is unavailable in this browser. Use the model transcription provider instead.');
    const rec = new Speech(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true; setLiveTranscribing(true);
    rec.onresult = (event: any) => { let finalText = ''; for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' '; if (finalText) setTranscript(prev => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${finalText}`); };
    rec.onerror = () => setLiveTranscribing(false); rec.onend = () => setLiveTranscribing(false); rec.start();
    setTimeout(() => { try { rec.stop(); } catch {} }, 60000);
  };
  const multiSync = async () => {
    if (syncFiles.length < 2) return notify('Select at least two recordings of the same event.');
    setAiBusy(true); try {
      const buffers = await Promise.all(syncFiles.map(decodeFile));
      const aligned = alignAndSelectCleanest(buffers); setSyncPreview(aligned.buffer);
      const lines = aligned.offsets.map((off, i) => `${syncFiles[i].name}: offset ${off.toFixed(3)}s`).join('\n');
      const counts = aligned.selectedSources.reduce((acc: Record<number, number>, id) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {});
      const chosen = Object.entries(counts).map(([id, n]) => `${syncFiles[Number(id)].name}: ${n} half-second blocks`).join('\n');
      setSyncResult(`${lines}\n\nAutomatic clean-source selection by 0.5s block:\n${chosen}\n\nReview the composite for phase/timing artifacts before delivery.`);
    } catch (e: any) { notify(e.message); } finally { setAiBusy(false); }
  };
  const runRoomDoctor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const recorder = new MediaRecorder(stream); const chunks: BlobPart[] = [];
      recorder.ondataavailable = e => chunks.push(e.data); recorder.start(); setRoomResult('Clap once now, then stay quiet while Resonance captures the decay…');
      await new Promise(resolve => setTimeout(resolve, 3000)); recorder.stop(); await new Promise(resolve => recorder.onstop = () => resolve(null)); stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks); const f = new File([blob], 'room-check.webm', { type: blob.type }); const b = await decodeFile(f); const m = analyzeBuffer(b);
      const data = b.getChannelData(0); let peakIndex = 0, peak = 0; for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak) { peak = Math.abs(data[i]); peakIndex = i; }
      const base = Math.max(1e-6, peak); let decaySeconds = 0; const hop = Math.floor(b.sampleRate * .05); for (let i = peakIndex; i < data.length; i += hop) { let energy = 0, count = 0; for (let j = i; j < Math.min(data.length, i + hop); j += 4) { energy += data[j] * data[j]; count++; } const level = Math.sqrt(energy / Math.max(1, count)); if (level <= base * .0316) { decaySeconds = (i - peakIndex) / b.sampleRate; break; } }
      const rt30 = decaySeconds > 0 ? decaySeconds * 2 : 0;
      setRoomResult(`Room sample captured (${fmt(b.duration)}). Input RMS ${m.rmsDb.toFixed(1)} dBFS, peak ${m.peakDb.toFixed(1)} dBFS. Estimated -30 dB decay ${decaySeconds ? decaySeconds.toFixed(2) + ' s (rough RT60 ≈ ' + rt30.toFixed(2) + ' s)' : 'not measurable from this sample'}. Treat this as an informal clap/decay estimate, not a calibrated room measurement. If decay is long, move away from bare parallel walls, add thick curtains/rugs/soft furnishings and place the mic 15–30 cm away.`);
    } catch (e: any) { setRoomResult(`Microphone check could not run: ${e.message}. Allow microphone access and try again.`); }
  };
  const generateBand = () => { const duration = Math.max(8, current?.duration || 14); const generated = generateAgentBand(duration, bpm, bandEnergy); generated.forEach(t => addGeneratedTrack(t.name, t.buffer, 'Agent Band')); setArrangementPlan(`Producer suggestion (${bpm} BPM): 0:00–0:08 sparse intro · 0:08–${fmt(Math.max(8, duration * .35))} groove enters · ${fmt(duration * .35)}–${fmt(duration * .7)} full hook · ${fmt(duration * .7)}–${fmt(duration * .85)} breakdown · ${fmt(duration * .85)}–${fmt(duration)} outro. Keep bass locked to the kick; mute hats in the breakdown to create contrast.`); }
  const generateMood = () => addGeneratedTrack('Mood Painter · generated bed', createMoodBed(moodCurve, current?.duration || 20, bpm), 'Mood Painter');
  const generateSfx = () => addGeneratedTrack(`Sound effect · ${soundQuery}`, generateSoundEffect(soundQuery), 'Sound Search · local synth');
  const searchSound = async () => { setAiBusy(true); try { const r = await api<any>('/sound-search', json({ query: soundQuery, license: 'cleared-only' })); if (r.url) { const resp = await fetch(r.url); const f = new File([await resp.blob()], r.name || 'sound-effect.wav'); await addTrack(f, 'Sound Search · licensed/provider'); } else generateSfx(); } catch (e: any) { generateSfx(); notify(`Catalog provider unavailable; generated a procedural placeholder instead. ${e.message}`); } finally { setAiBusy(false); } };
  const createStylePreset = () => {
    if (tracks.length < 3) return setStyleResult('Import at least three of your own finished tracks to build a profile.');
    const sample = tracks.slice(-3); const avg = (key: keyof MixSettings) => sample.reduce((n, t) => n + t.settings[key], 0) / sample.length;
    const learned = { low: avg('low'), mid: avg('mid'), high: avg('high'), gain: avg('gain'), compression: avg('compression'), reverb: avg('reverb'), delay: avg('delay'), gate: avg('gate'), width: avg('width') };
    localStorage.setItem(`resonance.style.${styleName}`, JSON.stringify(learned)); setStylePreset(learned); setStyleResult(`Learned a settings-based profile from ${sample.map(t => t.name).join(', ')}. Average EQ: low ${learned.low.toFixed(1)} dB, mid ${learned.mid.toFixed(1)} dB, high ${learned.high.toFixed(1)} dB. This models saved mix choices; it does not train a neural voice or audio model.`); 
  };
  const estimateCredits = async () => { try { const r = await api('/ai/credit-estimate', json({ feature: creditFeature, durationSeconds: current?.duration || 0 })); setCreditEstimate(r); } catch (e: any) { setCreditEstimate({ note: e.message }); } };
  const previewVersion = async (v: any) => { if (!current) return; const map = new Map((v.tracks || []).map((t: any) => [t.id, t.settings])); const versionSettings = (map.get(current.id) as MixSettings) || v.settings || current.settings; try { const b = await processBuffer(current.buffer, versionSettings, v.trimStart ?? 0, v.trimEnd ?? current.duration); if (versionPreviewUrl) URL.revokeObjectURL(versionPreviewUrl); setVersionPreviewUrl(bufferToDataUrl(b)); } catch (e: any) { notify(e.message); } };
  const restoreVersion = (v: any) => { const map = new Map((v.tracks || []).map((t: any) => [t.id, t.settings])); setTracks(prev => prev.map(t => map.has(t.id) ? { ...t, settings: map.get(t.id) as MixSettings } : t)); if (current && map.has(current.id)) setSettings(map.get(current.id) as MixSettings); if (typeof v.trimStart === 'number') setTrimStart(v.trimStart); if (typeof v.trimEnd === 'number' && current) setTrimEnd(Math.min(current.duration, v.trimEnd)); notify(`Restored snapshot: ${v.label}`); };

  const isReview = window.location.pathname.startsWith('/review/');
  useEffect(() => { if (isReview) { const id = window.location.pathname.split('/').pop(); api<any>(`/review/${id}`).then(r => { setProjectName(r.project?.name || 'Shared review'); setReviewProject(r.project); setComments(r.comments || []); }).catch(e => notify(e.message)); } }, [isReview]);

  const sidebar = [
    { key: 'studio', label: 'Studio', icon: AudioWaveform }, { key: 'creative', label: 'Creative lab', icon: Sparkles },
    { key: 'podcast', label: 'Podcast & voice', icon: Mic2 }, { key: 'repair', label: 'Repair suite', icon: Bandage },
    { key: 'workflow', label: 'Workflow', icon: Layers3 }, { key: 'consent', label: 'Consent vault', icon: ShieldCheck }
  ] as const;

  if (authLocked && !isReview) return <div className="login-screen"><div className="brand"><div className="brand-symbol"><Waves size={20} /></div><span>resonance</span></div><section className="panel login-card"><div className="feature-icon violet"><ShieldCheck /></div><span className="eyebrow">PRIVATE STUDIO</span><h2>Welcome back</h2><p>Enter the access password configured by the studio owner.</p><form onSubmit={async e => { e.preventDefault(); setAuthError(''); try { const r = await api<any>('/auth/login', json({ password: loginPassword })); if (r.token) localStorage.setItem('resonance.token', r.token); setAuthLocked(false); setLoginPassword(''); } catch (err: any) { setAuthError(err.message); } }}><input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Studio access password" autoFocus /><button className="primary block-btn">Unlock Resonance</button></form>{authError && <div className="login-error">{authError}</div>}</section></div>;

  if (isReview) return <div className="review-page"><div className="brand-mark"><div className="brand-symbol"><Waves /></div><span>resonance</span></div><h1>{projectName}</h1><p>Private collaboration review</p><section className="panel"><h3>Session audio</h3>{(reviewProject?.tracks || []).map((t: any) => <div className="review-track" key={t.id}><b>{t.name}</b><audio controls preload="none" src={t.url} /><small>{t.aiLabel ? 'AI-assisted edit disclosed' : 'Original track'}</small></div>)}</section><section className="panel"><h3>Timestamped comments</h3>{comments.map((c: any) => <div className="comment" key={c._id}><b>{fmt(c.time || 0)}</b><span>{c.body}</span><small>{c.author}</small></div>)}<form onSubmit={async e => { e.preventDefault(); try { const id = window.location.pathname.split('/').pop(); await api(`/review/${id}/comments`, json({ body: commentText, time: commentTime, author: 'Reviewer' })); const r = await api<any>(`/review/${id}`); setComments(r.comments); setCommentText(''); } catch (err: any) { notify(err.message); } }}><input type="number" min="0" value={commentTime} onChange={e => setCommentTime(+e.target.value)} /><input placeholder="Add a timestamped note…" value={commentText} onChange={e => setCommentText(e.target.value)} /><button className="primary">Add comment</button></form></section></div>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-symbol"><Waves size={20} /></div><span>resonance</span><span className="brand-tag">AI AUDIO STUDIO</span></div><div className="top-project"><span className="online-dot" /> <input value={projectName} onChange={e => setProjectName(e.target.value)} aria-label="Project name" /><span className="tiny-chevron"><ChevronDown size={14} /></span></div><div className="top-actions"><div className="save-state"><span className={`status-dot ${serverStatus?.ok ? 'green' : 'amber'}`} />{serverStatus?.database === 'connected' ? 'Cloud connected' : 'Local session'}</div><button className="ghost-btn" onClick={saveVersionToServer}><History size={15} /> Checkpoint</button><button className="primary small" onClick={saveProject}><Save size={15} /> Save project</button><div className="avatar">R</div></div></header>
    <audio ref={audioRef} src={current?.url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    <aside className="sidebar"><div className="sidebar-label">WORKSPACE</div>{sidebar.map(item => <button key={item.key} className={`nav-item ${active === item.key ? 'active' : ''}`} onClick={() => setActive(item.key)}><item.icon size={17} /><span>{item.label}</span>{item.key === 'consent' && <span className="nav-lock"><ShieldCheck size={12} /></span>}</button>)}<div className="sidebar-spacer" /><div className="sidebar-label">SESSION</div><div className="session-card"><div className="session-icon"><Headphones size={17} /></div><div><b>{tracks.length} tracks</b><small>{tracks.length ? fmt(Math.max(...tracks.map(t => t.duration))) + ' total max' : 'No media imported'}</small></div></div><button className="nav-item" onClick={() => setActive('workflow')}><CircleHelp size={17} /><span>Help & shortcuts</span></button><div className="sidebar-foot"><span className="status-dot green" /> All local tools ready</div></aside>

    <main className="main-content">
      {active === 'studio' && <>
        <SectionTitle eyebrow="PRODUCTION WORKSPACE" title="Studio" detail="Shape your sound. Direct the agents. Keep every edit in your hands." action={<div className="title-actions"><button className="ghost-btn" onClick={() => document.getElementById('audio-input')?.click()}><Upload size={15} /> Import audio</button><button className="primary" disabled={!current || aiBusy} onClick={() => exportMix()}><Download size={15} /> Export mix</button><input id="audio-input" hidden type="file" accept="audio/*,video/*" multiple onChange={e => { Array.from(e.target.files || []).forEach(f => addTrack(f)); e.currentTarget.value = ''; }} /></div>} />
        {!current ? <EmptyState title="Your studio is ready" body="Drop in a vocal, beat, podcast or full song to open the multitrack workspace. You can add multiple files and edit each track independently." action={<button className="primary" onClick={() => document.getElementById('audio-input')?.click()}><Plus size={16} /> Add your first track</button>} /> : <div className="studio-grid">
          <div className="studio-main-col">
            <section className="panel player-panel"><div className="panel-heading"><div><span className="eyebrow">NOW EDITING</span><h3>{current.name}</h3><small>{current.kind} · {current.metrics.duration.toFixed(1)} sec · {current.buffer.sampleRate.toLocaleString()} Hz · {current.buffer.numberOfChannels} ch</small></div><div className="panel-heading-actions">{current.aiLabel && <span className="ai-tag"><Sparkles size={12} /> AI assisted</span>}<button className="icon-btn" title="Remove track" onClick={() => { setTracks(prev => prev.filter(t => t.id !== current.id)); setCurrentId(tracks.find(t => t.id !== current.id)?.id || ''); }}><Trash2 size={15} /></button></div></div>
              <Waveform buffer={current.buffer} progress={currentTime / current.duration} onSeek={p => { if (audioRef.current) audioRef.current.currentTime = p * current.duration; }} />
              <div className="player-bottom"><div className="transport"><button className="play-btn" onClick={playPause}>{playing ? <Pause fill="currentColor" size={18} /> : <Play fill="currentColor" size={18} />}</button><span className="timecode">{fmt(currentTime)} <i>/</i> {fmt(current.duration)}</span></div><div className="transport-right"><button className="icon-btn" title="Voice edit command" onClick={startVoiceCommand}><Mic size={15} /></button><button className="icon-btn" title="Restart" onClick={() => { if (audioRef.current) audioRef.current.currentTime = 0; }}><RefreshCw size={15} /></button><span className="monitor-pill"><Activity size={13} /> Monitoring</span></div></div>
              {voiceCommand && <div className="inline-status"><span className="pulse-dot" /> Listening for an edit command…</div>}
            </section>
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">TRACK LAYERS</span><h3>Session tracks</h3></div><button className="text-btn" onClick={() => document.getElementById('audio-input')?.click()}><Plus size={14} /> Add track</button></div>
              <div className="track-list">{tracks.map((t, i) => <div className={`track-row ${current.id === t.id ? 'selected' : ''}`} key={t.id} onClick={() => selectTrack(t.id)}><div className={`track-icon tint-${i % 4}`}><AudioLines size={17} /></div><div className="track-info"><b>{t.name}</b><small>{t.kind} · {fmt(t.duration)} {t.aiLabel && '· AI label'}</small></div><div className="track-mini-wave"><div style={{ width: `${clamp(t.metrics.peakDb + 50, 14, 96)}%` }} /></div><span className="track-db">{t.metrics.rmsDb.toFixed(1)} dB</span><button className="icon-btn" onClick={e => { e.stopPropagation(); setTracks(prev => prev.filter(x => x.id !== t.id)); if (current.id === t.id) setCurrentId(tracks.find(x => x.id !== t.id)?.id || ''); }}><X size={14} /></button></div>)}</div>
            </section>
            <section className="panel describe-panel"><div className="panel-heading"><div><span className="eyebrow">NATURAL-LANGUAGE PRODUCER</span><h3><Sparkles size={17} /> Describe-to-Mix</h3></div><span className="small-badge">AGENT 01</span></div><p className="muted">Describe the sound you want. Resonance translates your direction into editable controls, with a change history you can undo.</p><div className="prompt-row"><input value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && runDescribeMix()} placeholder="e.g. Make the vocals warmer and wider…" /><button className="primary" onClick={runDescribeMix} disabled={aiBusy}>{aiBusy ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />} Apply</button></div><div className="prompt-suggestions">{['Make it warmer', 'Tame harsh highs', 'Bring the vocal forward', 'Add subtle space'].map(s => <button key={s} onClick={() => setPrompt(s)}>{s}</button>)}</div><div className="inline-note"><Sparkles size={13} /> Every suggestion becomes a visible knob change. Use Checkpoint to preserve a version before experimenting.</div></section>
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">FAST START</span><h3>Producer presets</h3></div><button className="text-btn" onClick={explainMix}><BrainCircuit size={14} /> Explain my mix</button></div><div className="preset-grid">{Object.keys(presets).map((p, i) => <button className="preset-card" key={p} onClick={() => applyPreset(p)}><div className={`preset-art art-${i}`}><AudioWaveform size={20} /></div><b>{p}</b><small>Apply starting chain <span>↗</span></small></button>)}</div><div className="analysis-strip"><div><span className="eyebrow">SIGNAL CHECK</span><p>{message}</p></div><button className="ghost-btn" onClick={explainMix}>Analyze now</button></div></section>
          </div>
          <div className="studio-side-col">
            <section className="panel inspector"><div className="panel-heading"><div><span className="eyebrow">CHANNEL STRIP</span><h3>Mix controls</h3></div><button className="icon-btn" onClick={() => { updateCurrentSettings(DEFAULT_MIX, 'Mix controls reset'); addVersion('Reset mix'); }}><RefreshCw size={14} /></button></div>
              <div className="control-group"><div className="control-head"><span>INPUT / OUTPUT</span><small>GAIN STAGING</small></div><Slider label="Track gain" value={settings.gain} min={-18} max={12} step={0.5} unit=" dB" onChange={(v: number) => updateCurrentSettings({ gain: v })} /></div>
              <div className="control-group"><div className="control-head"><span>3-BAND EQUALIZER</span><small>TONAL SHAPE</small></div><Slider label="Low · 160 Hz" value={settings.low} min={-12} max={12} step={0.5} unit=" dB" onChange={(v: number) => updateCurrentSettings({ low: v })} /><Slider label="Mid · 1.2 kHz" value={settings.mid} min={-12} max={12} step={0.5} unit=" dB" onChange={(v: number) => updateCurrentSettings({ mid: v })} /><Slider label="High · 6.5 kHz" value={settings.high} min={-12} max={12} step={0.5} unit=" dB" onChange={(v: number) => updateCurrentSettings({ high: v })} /></div>
              <div className="control-group"><div className="control-head"><span>DYNAMICS & SPACE</span><small>CHARACTER</small></div><Slider label="Compression" value={settings.compression} min={0} max={1} step={0.05} onChange={(v: number) => updateCurrentSettings({ compression: v })} /><Slider label="Reverb send" value={settings.reverb} min={0} max={1} step={0.05} onChange={(v: number) => updateCurrentSettings({ reverb: v })} /><Slider label="Delay send" value={settings.delay} min={0} max={1} step={0.05} onChange={(v: number) => updateCurrentSettings({ delay: v })} /><Slider label="Breath / noise control" value={settings.gate} min={0} max={0.08} step={0.002} onChange={(v: number) => updateCurrentSettings({ gate: v })} /></div>
              <div className="control-group"><div className="control-head"><span>STEREO IMAGE</span><small>WIDTH</small></div><Slider label="Width" value={settings.width} min={0.5} max={1.5} step={0.05} onChange={(v: number) => updateCurrentSettings({ width: v })} /></div>
              <div className="inspector-foot"><span><Check size={13} /> Settings are non-destructive</span><button className="text-btn" onClick={() => exportMix()}>Render track <Download size={13} /></button></div>
            </section>
            <section className="panel metrics-panel"><div className="panel-heading"><h3>Audio intelligence</h3><span className="live-pill">LIVE ANALYSIS</span></div><div className="metrics-grid"><Metric label="Peak" value={`${current.metrics.peakDb.toFixed(1)} dB`} /><Metric label="RMS" value={`${current.metrics.rmsDb.toFixed(1)} dB`} /><Metric label="Crest" value={`${current.metrics.crestDb.toFixed(1)} dB`} /><Metric label="Clipping" value={`${(current.metrics.clipping * 100).toFixed(2)}%`} /></div><div className="spectrum"><div><i className="low" style={{ height: `${current.metrics.low * 100}%` }} /><span>LOW</span></div><div><i className="mid" style={{ height: `${current.metrics.mid * 100}%` }} /><span>MID</span></div><div><i className="high" style={{ height: `${current.metrics.high * 100}%` }} /><span>HIGH</span></div></div><small className="muted">Band values are lightweight estimates from the decoded signal, not a calibrated spectral analyzer.</small></section>
            <section className="panel"><div className="panel-heading"><h3>Trim & export</h3><FileAudio size={16} /></div><Slider label="Start" value={trimStart} min={0} max={Math.max(0.01, current.duration - 0.1)} step={0.1} unit=" s" onChange={setTrimStart} /><Slider label="End" value={trimEnd} min={Math.max(0.01, trimStart + 0.1)} max={current.duration} step={0.1} unit=" s" onChange={setTrimEnd} /><button className="primary block-btn" disabled={aiBusy} onClick={() => exportMix(trimStart, trimEnd)}><Download size={14} /> Export selected range</button></section>
          </div>
        </div>}
      </>}

      {active === 'creative' && <>
        <SectionTitle eyebrow="GENERATIVE WORKBENCH" title="Creative lab" detail="Compose supporting parts, sculpt ambience and reshape source material." action={<span className="small-badge">4 CREATIVE AGENTS</span>} />
        <div className="feature-grid">
          <section className="panel feature-card"><div className="feature-icon violet"><Drum /></div><span className="eyebrow">AGENT BAND · 03</span><h3>Session players</h3><p>Generate editable drum and bass companion tracks around your session tempo and energy setting.</p><div className="field-grid"><label>Tempo<input type="number" min="50" max="220" value={bpm} onChange={e => setBpm(clamp(+e.target.value, 50, 220))} /></label><label>Energy<select value={bandEnergy} onChange={e => setBandEnergy(+e.target.value)}><option value={0.3}>Gentle</option><option value={0.6}>Balanced</option><option value={0.9}>High energy</option></select></label></div><button className="primary block-btn" onClick={generateBand}><Plus size={15} /> Generate editable band tracks</button>{arrangementPlan && <div className="result-box">{arrangementPlan}</div>}<small className="helper">Creates kick, snare, hats and bass as separate WAV-ready tracks. Melody/chord intelligence can be connected to a music-generation model.</small></section>
          <section className="panel feature-card"><div className="feature-icon blue"><Search /></div><span className="eyebrow">SOUND SEARCH · 10</span><h3>Sound by description</h3><p>Describe an effect and create a quick procedural sound. Connect a licensed SFX catalog for production-library search.</p><input className="full-input" value={soundQuery} onChange={e => setSoundQuery(e.target.value)} /><div className="suggestion-tags"><button onClick={() => setSoundQuery('rain on a window')}>Rain</button><button onClick={() => setSoundQuery('metallic sci-fi impact')}>Sci-fi impact</button><button onClick={() => setSoundQuery('wooden door creaking')}>Door creak</button></div><button className="primary block-btn" disabled={aiBusy} onClick={searchSound}><Sparkles size={15} /> Search library / generate</button><small className="helper">Generated locally with synthesis/noise primitives; not a field recording.</small></section>
          <section className="panel feature-card mood-card"><div className="feature-icon pink"><Waves /></div><span className="eyebrow">MOOD PAINTER · 11</span><h3>Draw the energy arc</h3><p>Set how the emotional energy moves across the piece. Generate a backing bed that follows the curve.</p><div className="mood-curve">{moodCurve.map((v, i) => <label key={i}><span>{['INTRO', 'BUILD', 'LIFT', 'PEAK', 'FALL', 'OUTRO'][i]}</span><input type="range" min="0" max="1" step="0.05" value={v} onChange={e => setMoodCurve(prev => prev.map((x, j) => i === j ? +e.target.value : x))} /></label>)}</div><button className="primary block-btn" onClick={generateMood}><WandSparkles size={15} /> Generate mood bed</button></section>
          <section className="panel feature-card"><div className="feature-icon orange"><Split /></div><span className="eyebrow">INSTANT STEMS · 12</span><h3>Separate & remix</h3><p>Split a full mix into vocals, drums, bass and other stems, then remix each stem independently.</p><div className="stem-chips"><span>VOCALS</span><span>DRUMS</span><span>BASS</span><span>OTHER</span></div><button className="primary block-btn" disabled={aiBusy || !current} onClick={separateStems}>{aiBusy ? <LoaderCircle className="spin" size={15} /> : <Split size={15} />} Run stem separation</button><small className="helper">Requires a Demucs/MDX-compatible model gateway. The app will not fabricate separated audio.</small></section>
          <section className="panel feature-card wide-card"><div className="feature-icon green"><Sparkles /></div><span className="eyebrow">STYLE PRESETS · 13</span><h3>Teach Resonance your sound</h3><p>Build a repeatable settings profile from three of your own finished mixes. Resonance averages your saved mix decisions so new tracks start closer to your taste.</p><div className="inline-form"><input value={styleName} onChange={e => setStyleName(e.target.value)} /><button className="primary" onClick={createStylePreset}>Learn my style from 3 tracks</button></div>{styleResult && <div className="result-box">{styleResult}</div>}{stylePreset && <button className="ghost-btn block-btn" onClick={() => { updateCurrentSettings(stylePreset, 'Personal style preset applied'); addVersion(`Style preset: ${styleName}`); }}>Apply my signature sound</button>}</section>
          <section className="panel feature-card wide-card reference-card"><div className="feature-icon cyan"><Radio /></div><div className="reference-copy"><span className="eyebrow">REFERENCE MATCH · 02</span><h3>Match the sonic direction</h3><p>Load a reference song. Resonance compares loudness and estimated low/mid/high balance, then suggests starting EQ and gain changes.</p><div className="reference-upload"><label className="upload-drop"><Upload size={17} /><span>{reference ? reference.name : 'Choose reference audio'}</span><input type="file" accept="audio/*" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const b = await decodeFile(f); setReference({ name: f.name, buffer: b, metrics: analyzeBuffer(b) }); setReferenceResult('Reference analyzed.'); } catch (err: any) { notify(err.message); } }} /></label><button className="primary" disabled={!reference || !current} onClick={doReferenceMatch}>Compare & suggest</button></div>{reference && current && <div className="reference-metrics"><span>SESSION <b>{current.metrics.rmsDb.toFixed(1)} dB RMS</b></span><span>REFERENCE <b>{reference.metrics.rmsDb.toFixed(1)} dB RMS</b></span><span>LOW {current.metrics.low.toFixed(2)} / {reference.metrics.low.toFixed(2)}</span><span>WIDTH {current.metrics.stereoWidth.toFixed(2)} / {reference.metrics.stereoWidth.toFixed(2)}</span></div>}{referenceResult && <div className="result-box">{referenceResult}</div>}</div></section>
        </div>
      </>}

      {active === 'podcast' && <>
        <SectionTitle eyebrow="SPOKEN-WORD WORKSPACE" title="Podcast & voice" detail="Transcript-led editing, clip discovery, multilingual production and delivery coaching." />
        <div className="feature-grid podcast-grid">
          <section className="panel feature-card wide-card"><div className="feature-icon violet"><BookOpen /></div><span className="eyebrow">EDIT BY TEXT · 04</span><h3>Transcript editor</h3><p>Edit your transcript and use the cut controls to remove a selected phrase from the current working range. Accurate word-level ripple editing needs a timestamped transcript from the configured transcription provider.</p><div className="transcript-toolbar"><span>{transcriptStatus}</span><div className="inline-form"><button className="ghost-btn" disabled={aiBusy} onClick={transcribe}>{aiBusy ? <LoaderCircle className="spin" size={14} /> : <Mic size={14} />} Transcribe audio</button><button className="ghost-btn" onClick={startLiveTranscript}><Mic2 size={14} /> {liveTranscribing ? 'Listening…' : 'Live transcript'}</button></div></div><textarea className="transcript-area" value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Paste or transcribe your episode here. Select text and use the edit action below…" />{transcriptSegments.length > 0 && <div className="chapter-list">{transcriptSegments.map((seg, i) => <div key={i}><span>{seg.text}</span><b>{fmt(seg.start)}–{fmt(seg.end)}</b><button onClick={() => { if (!current) return; const edited = spliceBuffer(current.buffer, seg.start, seg.end); addGeneratedTrack(`${current.name} · text edit ${i + 1}`, edited, 'Text edit'); }}>Remove from audio</button></div>)}</div>}<div className="inline-form"><button className="ghost-btn" onClick={() => { const el = document.querySelector('.transcript-area') as HTMLTextAreaElement; const a = el?.selectionStart ?? 0, b = el?.selectionEnd ?? 0; if (a === b) return notify('Select the phrase you want to remove in the transcript first.'); setTranscript(t => t.slice(0, a) + t.slice(b)); notify('Transcript phrase removed. For precise audio ripple edits, use word timestamps from a transcription provider.'); }}><Minus size={14} /> Remove selected phrase</button><button className="ghost-btn" onClick={() => setTranscript(t => t.replace(/\s+/g, ' ').trim())}>Clean spacing</button><span className="helper">Transcript edits are text-only unless word timestamps are supplied.</span></div></section>
          <section className="panel feature-card"><div className="feature-icon blue"><ScissorsIcon /></div><span className="eyebrow">AUTO CHAPTERS & CLIPS · 14</span><h3>Find the moments</h3><p>Detect pauses and likely chapter boundaries, then export useful ranges with captions added in a later editorial pass.</p><button className="primary block-btn" onClick={makeChapters}><Activity size={15} /> Analyze chapters & clips</button>{chapterList.length > 0 && <div className="chapter-list">{chapterList.map((c, i) => <div key={i}><span>Chapter {i + 1}</span><b>{fmt(c.start)} – {fmt(c.end)}</b><button onClick={() => { setClipStart(c.start); setClipEnd(c.end); if (audioRef.current && current) { selectTrack(current.id); audioRef.current.currentTime = c.start; } setActive('studio'); }}>Open</button></div>)}</div>}<div className="field-grid"><label>Clip start (sec)<input type="number" min="0" value={clipStart} onChange={e => setClipStart(+e.target.value)} /></label><label>Clip end (sec)<input type="number" min="0" value={clipEnd} onChange={e => setClipEnd(+e.target.value)} /></label></div><button className="ghost-btn block-btn" disabled={!current} onClick={() => exportMix(clipStart, clipEnd, 'resonance-social-clip')}><Download size={14} /> Export selected clip</button><button className="text-btn" onClick={exportCaptions}>Export captions (.srt) →</button></section>
          <section className="panel feature-card"><div className="feature-icon green"><Gauge /></div><span className="eyebrow">PACE COACH · 16</span><h3>Delivery feedback</h3><p>Review speaking speed, filler words and energy after a recording.</p><div className="field-note">Words are counted from the transcript and compared with recording duration.</div><button className="primary block-btn" onClick={runPaceCoach}>Analyze delivery</button>{paceResult && <div className="result-box">{paceResult}</div>}</section>
          <section className="panel feature-card"><div className="feature-icon orange"><LanguagesIcon /></div><span className="eyebrow">LANGUAGE DUBBING · 15</span><h3>Publish in another language</h3><p>Translate and render spoken audio with a compatible dubbing provider. Speaker permission is mandatory.</p><label className="field-label">Target language<select value={dubLanguage} onChange={e => setDubLanguage(e.target.value)}><option>Hindi</option><option>Marathi</option><option>English</option><option>Spanish</option><option>French</option><option>German</option><option>Japanese</option></select></label><label className="field-label">Speaker consents (select every speaker)<select multiple value={selectedDubConsents} onChange={e => setSelectedDubConsents(Array.from(e.target.selectedOptions).map(o => o.value))}>{consents.filter(c => c.active && ['dubbing', 'voice-cloning', 'all-audio-edits'].includes(c.purpose)).map(c => <option key={c._id} value={c._id}>{c.speaker} · {c.purpose}</option>)}</select></label><button className="primary block-btn" disabled={aiBusy} onClick={dub}><Radio size={15} /> Submit dubbing job</button><small className="helper">Requires a dubbing/voice model gateway and active consent record.</small><button className="text-btn" onClick={() => { setActive('consent'); loadConsents(); }}>Manage speaker permissions →</button></section>
        </div>
      </>}

      {active === 'repair' && <>
        <SectionTitle eyebrow="RESTORATION & CLEANUP" title="Repair suite" detail="Improve capture quality, align sources and keep edits natural." />
        <div className="feature-grid">
          <section className="panel feature-card"><div className="feature-icon blue"><Waves /></div><span className="eyebrow">ROOM DOCTOR · 07</span><h3>Acoustic check</h3><p>Capture a short microphone sample and get practical room-treatment suggestions.</p><button className="primary block-btn" onClick={runRoomDoctor}><Mic size={15} /> Listen to my room</button>{roomResult && <div className="result-box">{roomResult}</div>}</section>
          <section className="panel feature-card"><div className="feature-icon cyan"><AudioWaveform /></div><span className="eyebrow">MULTI-MIC AUTO-SYNC · 08</span><h3>Align recordings</h3><p>Choose multiple recordings of the same event. Resonance estimates their offsets and compares average signal level.</p><label className="upload-drop"><Upload size={16} /><span>{syncFiles.length ? `${syncFiles.length} files selected` : 'Select multiple audio files'}</span><input type="file" accept="audio/*" multiple onChange={e => setSyncFiles(Array.from(e.target.files || []))} /></label><button className="primary block-btn" disabled={aiBusy} onClick={multiSync}>Estimate sync offsets</button>{syncResult && <><pre className="result-box pre-wrap">{syncResult}</pre><button className="ghost-btn block-btn" onClick={() => syncPreview && addGeneratedTrack('Multi-mic auto-sync composite', syncPreview, 'Multi-mic Auto-Sync')}>Add clean-source composite to session</button></>}</section>
          <section className="panel feature-card"><div className="feature-icon pink"><Activity /></div><span className="eyebrow">BREATH & MOUTH NOISE · 09</span><h3>Natural noise control</h3><p>Use a gentle expander/noise gate. Keep the threshold conservative to avoid chopping breaths and consonants.</p>{current && <Slider label="Soft gate threshold" value={settings.gate} min={0} max={0.08} step={0.002} onChange={(v: number) => updateCurrentSettings({ gate: v }, 'Breath and mouth-noise control updated')} />}<button className="ghost-btn block-btn" onClick={() => updateCurrentSettings({ gate: 0.008 }, 'Gentle cleanup applied')}>Apply a gentle cleanup starting point</button><small className="helper">This is dynamics processing, not a dedicated breath classifier or spectral denoiser.</small></section>
          <section className="panel feature-card"><div className="feature-icon orange"><Bandage /></div><span className="eyebrow">VOICE REPAIR · 06</span><h3>Repair a spoken moment</h3><p>Replace a mistake or missing phrase by regenerating only that moment in the speaker's voice, with explicit permission and disclosure.</p><textarea className="compact-textarea" value={repairText} onChange={e => setRepairText(e.target.value)} /><label className="field-label">Active voice repair consent<select value={selectedConsent} onChange={e => setSelectedConsent(e.target.value)}><option value="">Select active consent…</option>{consents.filter(c => c.active && ['voice-repair', 'voice-cloning', 'all-audio-edits'].includes(c.purpose)).map(c => <option key={c._id} value={c._id}>{c.speaker} · {c.purpose}</option>)}</select></label><button className="primary block-btn" disabled={aiBusy} onClick={voiceRepair}><WandSparkles size={15} /> Submit voice repair</button><small className="helper">Requires an enabled provider. Output must be watermarked and labeled as AI-edited.</small></section>
        </div>
      </>}

      {active === 'workflow' && <>
        <SectionTitle eyebrow="PROJECT OPERATIONS" title="Workflow & collaboration" detail="Keep creative decisions traceable, repeat production steps and collect feedback in context." />
        <div className="workflow-grid">
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PROJECT LIBRARY</span><h3>Saved sessions</h3></div><button className="icon-btn" onClick={loadProjectsAndRecipes}><RefreshCw size={14} /></button></div><p className="muted">Open a project and continue editing its server-stored audio tracks.</p><div className="saved-recipes">{savedProjects.map(p => <div key={p._id}><span><b>{p.name}</b><small>{(p.tracks || []).length} tracks · {new Date(p.updatedAt || p.createdAt).toLocaleDateString()}</small></span><button className="text-btn" onClick={() => openProject(p)}>Open <Play size={12} /></button></div>)}{!savedProjects.length && <small className="muted">No server projects yet. Save your current session to create one.</small>}</div></section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">VERSION TIME-TRAVEL · 17</span><h3>Session checkpoints</h3></div><button className="ghost-btn" onClick={saveVersionToServer}><Plus size={14} /> Save checkpoint</button></div><p className="muted">Restore earlier mix settings and compare the session timeline. Audio is not duplicated in each local snapshot.</p><div className="version-list">{versions.slice(0, 12).map((v, i) => <div className="version-row" key={i}><div className="version-marker"><History size={14} /></div><div><b>{v.label}</b><small>{new Date(v.createdAt).toLocaleString()}</small></div><button className="text-btn" onClick={() => previewVersion(v)}>Preview</button><button className="text-btn" onClick={() => restoreVersion(v)}>Restore</button></div>)}{versionPreviewUrl && <audio className="preview-audio" controls src={versionPreviewUrl} />}{!versions.length && <div className="muted">Your checkpoints will appear here as you edit.</div>}</div></section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">REVIEW LINKS · 18</span><h3>Collaborate on a mix</h3></div><MessageSquare size={17} /></div><p className="muted">Create a private share link so a client or bandmate can leave timestamped comments.</p><button className="primary block-btn" onClick={createReviewLink}><Link2 size={15} /> Create review link</button>{reviewUrl && <div className="share-result"><span>{reviewUrl}</span><button className="icon-btn" onClick={() => navigator.clipboard?.writeText(reviewUrl)}><Copy size={14} /></button></div>}<div className="comment-preview"><b>Feedback task list</b><small>Comments can be resolved in the review API; use the review link to collect notes at exact times.</small></div></section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RUN RECIPES · 19</span><h3>Production recipes</h3></div><ListMusic size={17} /></div><p className="muted">Save and run a repeatable chain across every loaded track.</p><input className="full-input" value={recipeName} onChange={e => setRecipeName(e.target.value)} placeholder="Recipe name" /><div className="recipe-steps">{['cleanup', 'compress', 'warm', 'clarity', 'master'].map(s => <label key={s}><input type="checkbox" checked={recipeSteps.includes(s)} onChange={e => setRecipeSteps(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s))} /> {s}</label>)}</div><button className="primary block-btn" onClick={saveRecipe}><Save size={14} /> Save recipe</button><div className="saved-recipes">{recipes.map(r => <div key={r._id || r.id}><span><b>{r.name}</b><small>{r.steps.map(s => s.type).join(' → ')}</small></span><button className="text-btn" onClick={() => runRecipe(r)}>Run <Play size={12} /></button></div>)}</div></section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">CREDIT PREVIEW · 20</span><h3>Estimate before running</h3></div><Zap size={17} /></div><p className="muted">Preview estimated provider cost and processing time before sending media to a model service.</p><label className="field-label">Operation<select value={creditFeature} onChange={e => { setCreditFeature(e.target.value); setCreditEstimate(null); }}><option value="mix">Describe-to-Mix</option><option value="transcribe">Transcription</option><option value="stems">Stem separation</option><option value="voice-repair">Voice repair</option><option value="dubbing">Language dubbing</option></select></label><button className="primary block-btn" onClick={estimateCredits}>Estimate cost & time</button>{creditEstimate && <div className="credit-result"><span>Indicative cost</span><b>${Number(creditEstimate.estimateUsd || 0).toFixed(4)}</b><span>Estimated processing</span><b>{creditEstimate.estimateMinutes || '—'} min</b><small>{creditEstimate.note}</small></div>}<button className="ghost-btn block-btn" disabled={!current} onClick={makePreview}><Play size={14} /> Create low-cost local preview</button>{previewUrl && <audio className="preview-audio" controls src={previewUrl} />}</section>
        </div>
      </>}

      {active === 'consent' && <>
        <SectionTitle eyebrow="TRUST & PROVENANCE" title="Consent vault" detail="Record, review and revoke permissions for voice repair, cloning and dubbing." action={<button className="ghost-btn" onClick={loadConsents}><RefreshCw size={14} /> Refresh records</button>} />
        <div className="consent-layout"><section className="panel consent-form"><div className="panel-heading"><div><span className="eyebrow">NEW PERMISSION RECORD</span><h3>Register speaker consent</h3></div><ShieldCheck size={18} /></div><p className="muted">Only record permission you have actually received. Store the signed release or evidence reference, not a private identity document.</p><label className="field-label">Speaker / rights holder<input value={consentSpeaker} onChange={e => setConsentSpeaker(e.target.value)} placeholder="Name or approved speaker ID" /></label><label className="field-label">Permitted purpose<select value={consentPurpose} onChange={e => setConsentPurpose(e.target.value)}><option value="voice-repair">Voice repair</option><option value="voice-cloning">Voice cloning</option><option value="dubbing">Dubbing</option><option value="all-audio-edits">All audio edits</option></select></label><label className="field-label">Evidence reference<input value={consentEvidence} onChange={e => setConsentEvidence(e.target.value)} placeholder="Signed release reference / contract ID" /></label><button className="primary block-btn" onClick={createConsent}><ShieldCheck size={15} /> Save consent record</button><small className="helper">Protected server actions check that the relevant consent is active before they run.</small></section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">PERMISSIONS REGISTER</span><h3>Speaker permissions</h3></div><span className="small-badge">AUDITABLE</span></div><div className="consent-list">{consents.map(c => <div className="consent-row" key={c._id}><div className={`consent-state ${c.active ? 'active' : 'revoked'}`}><ShieldCheck size={17} /></div><div className="consent-details"><b>{c.speaker}</b><small>{c.purpose} · {c.evidence || 'No evidence reference'} · {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}</small></div><span className={`state-label ${c.active ? 'active' : 'revoked'}`}>{c.active ? 'ACTIVE' : 'REVOKED'}</span>{c.active && <button className="text-btn danger" onClick={() => revokeConsent(c._id)}>Revoke</button>}</div>)}{!consents.length && <EmptyState title="No consent records loaded" body="Refresh to load records from the connected database, or register a permission above." action={<button className="ghost-btn" onClick={loadConsents}>Load consent vault</button>} />}</div></section>
        </div>
        <div className="safety-notice"><ShieldCheck size={18} /><div><b>Responsible voice editing</b><p>Consent is purpose-specific and revocable. The provider integration must label and watermark synthetic or repaired speech. A consent record is an audit aid; it is not legal advice or proof that a permission is legally sufficient.</p></div></div>
      </>}
      <footer className="app-footer"><span>RESONANCE 1.0.0 · AUDIO SESSION</span><span>Non-destructive controls · AI edits disclosed · Local-first workflow</span></footer>
    </main>
    {toast && <div className="toast"><Check size={15} />{toast}<button onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}

function ScissorsIcon() { return <FileMusic />; }
function LanguagesIcon() { return <Radio />;}
