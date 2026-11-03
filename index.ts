import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';
import mongoose, { Schema, Model } from 'mongoose';
import multer from 'multer';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import { nanoid } from 'nanoid';
import OpenAI from 'openai';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || path.resolve(process.cwd(), '../../.env') });
const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 8080);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/api/media', express.static(uploadDir, { fallthrough: false, maxAge: '1d' }));

const ProjectSchema = new Schema({
  name: { type: String, required: true }, description: String,
  tracks: { type: [Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
}, { minimize: false });
const VersionSchema = new Schema({ projectId: { type: Schema.Types.ObjectId, required: true, index: true }, label: String, snapshot: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now } });
const RecipeSchema = new Schema({ name: { type: String, required: true }, description: String, steps: { type: [Schema.Types.Mixed], default: [] }, createdAt: { type: Date, default: Date.now } });
const CommentSchema = new Schema({ projectId: { type: Schema.Types.ObjectId, index: true }, shareId: { type: String, index: true }, author: String, body: { type: String, required: true }, time: Number, resolved: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now } });
const ConsentSchema = new Schema({ speaker: { type: String, required: true }, purpose: { type: String, required: true }, evidence: String, scope: [String], active: { type: Boolean, default: true }, revokedAt: Date, createdAt: { type: Date, default: Date.now } });
const ShareSchema = new Schema({ projectId: { type: Schema.Types.ObjectId, required: true, index: true }, shareId: { type: String, unique: true }, createdAt: { type: Date, default: Date.now } });
const Project: Model<any> = mongoose.models.Project || mongoose.model('Project', ProjectSchema);
const Version: Model<any> = mongoose.models.Version || mongoose.model('Version', VersionSchema);
const Recipe: Model<any> = mongoose.models.Recipe || mongoose.model('Recipe', RecipeSchema);
const Comment: Model<any> = mongoose.models.Comment || mongoose.model('Comment', CommentSchema);
const Consent: Model<any> = mongoose.models.Consent || mongoose.model('Consent', ConsentSchema);
const Share: Model<any> = mongoose.models.Share || mongoose.model('Share', ShareSchema);

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(8)}${path.extname(file.originalname).replace(/[^.a-zA-Z0-9]/g, '')}`)
});
const maxBytes = Number(process.env.MAX_UPLOAD_MB || 250) * 1024 * 1024;
const upload = multer({ storage, limits: { fileSize: maxBytes }, fileFilter: (_req, file, cb) => {
  const allowed = /^(audio|video)\//.test(file.mimetype) || /\.(mp3|wav|aiff?|flac|ogg|m4a|mp4|mov|webm)$/i.test(file.originalname);
  cb(allowed ? null : new Error('Only audio and video media files are accepted.'), allowed);
} });

function dbRequired(_req: Request, res: Response, next: () => void) {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database is not connected. Start MongoDB or set MONGODB_URI.' });
  next();
}
function simpleMixCommand(prompt: string) {
  const p = prompt.toLowerCase();
  const settings: Record<string, number> = {};
  const notes: string[] = [];
  if (/warm|warmer|body|thicker/.test(p)) { settings.low = 2.2; settings.mid = -0.5; notes.push('Added gentle low warmth and softened the midrange.'); }
  if (/bright|brightness|air|sparkle|harsh/.test(p)) { settings.high = /harsh/.test(p) ? -2 : 1.8; notes.push(/harsh/.test(p) ? 'Reduced high frequencies to tame harshness.' : 'Added a subtle high-frequency lift.'); }
  if (/behind|quieter|lower|down|less loud/.test(p)) { settings.gain = -3; notes.push('Lowered the track by 3 dB.'); }
  if (/louder|forward|upfront|more present/.test(p)) { settings.gain = 2; notes.push('Raised the track by 2 dB.'); }
  if (/wide|wider|stereo/.test(p)) { settings.width = 1.25; notes.push('Suggested a wider stereo image.'); }
  if (/compress|even out|consistent/.test(p)) { settings.compression = 0.45; notes.push('Applied moderate dynamic control.'); }
  if (/reverb|space|room/.test(p)) { settings.reverb = 0.2; notes.push('Added a small amount of space.'); }
  if (/remove noise|noise/.test(p)) { settings.gate = 0.015; notes.push('Enabled gentle noise gating.'); }
  if (!notes.length) notes.push('No specific control was recognized. Try “warmer”, “brighter”, “quieter”, “wider”, “more compressed”, or “add a little reverb”.');
  return { settings, explanation: notes.join(' '), source: 'local-rule-engine' };
}
async function callGateway(feature: string, payload: any) {
  if (!process.env.MODEL_GATEWAY_URL) throw new Error(`${feature} requires MODEL_GATEWAY_URL with a compatible model provider configured.`);
  const response = await fetch(`${process.env.MODEL_GATEWAY_URL.replace(/\/$/, '')}/${feature}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.MODEL_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.MODEL_GATEWAY_TOKEN}` } : {}) }, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${feature} provider returned ${response.status}`);
  return data;
}

function signToken(payload: string) { return createHmac('sha256', process.env.TOKEN_SECRET || process.env.ACCESS_PASSWORD || 'resonance-local-secret').update(payload).digest('base64url'); }
function validToken(token: string) {
  const [payload, signature] = token.split('.'); if (!payload || !signature) return false;
  const expected = signToken(payload); const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return Number(data.exp) > Date.now(); } catch { return false; }
}
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'resonance-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', ai: openai ? 'openai-configured' : 'local-fallback', modelGateway: Boolean(process.env.MODEL_GATEWAY_URL), authRequired: Boolean(process.env.ACCESS_PASSWORD) }));
app.post('/api/auth/login', (req, res) => {
  const configured = process.env.ACCESS_PASSWORD;
  if (!configured) return res.json({ token: '', authRequired: false });
  const incoming = Buffer.from(String(req.body.password || '')), expected = Buffer.from(configured);
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) return res.status(401).json({ error: 'Incorrect access password.' });
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  return res.json({ token: `${payload}.${signToken(payload)}`, authRequired: true });
});
app.use('/api', (req, res, next) => {
  if (!process.env.ACCESS_PASSWORD || req.path === '/health' || req.path === '/auth/login' || req.path.startsWith('/review/')) return next();
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!validToken(token)) return res.status(401).json({ error: 'Authentication required. Sign in to Resonance.' });
  next();
});
app.get('/api/auth/verify', (_req, res) => res.json({ ok: true }));
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media file uploaded.' });
  res.status(201).json({ id: nanoid(), name: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, url: `${req.protocol}://${req.get('host')}/api/media/${path.basename(req.file.path)}`, storedName: path.basename(req.file.path) });
});
app.post('/api/ai/describe-mix', async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Describe the change you want to hear.' });
  if (!openai) return res.json(simpleMixCommand(prompt));
  try {
    const completion = await openai.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.2, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'You are a careful audio mix assistant. Return JSON with settings (only numeric keys gain, low, mid, high, compression, reverb, delay, gate, width; gain in dB; EQ in dB; compression 0..1; reverb/delay 0..1; gate 0..0.1; width 0.5..1.5), explanation (short), and cautions (array). Do not claim to hear audio you have not received. Do not invent source analysis.' },
      { role: 'user', content: prompt }
    ] });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    res.json({ settings: parsed.settings || {}, explanation: parsed.explanation || 'Mix settings suggested.', cautions: parsed.cautions || [], source: 'openai' });
  } catch (e: any) { res.status(502).json({ error: `AI suggestion failed: ${e.message}`, fallback: simpleMixCommand(prompt) }); }
});
app.post('/api/ai/explain-mix', async (req, res) => {
  const metrics = req.body.metrics || {};
  const issues: string[] = [];
  if (Number(metrics.low) > 0.48) issues.push('Low-frequency energy is dominant; check kick/bass masking around 80–250 Hz.');
  if (Number(metrics.high) > 0.42) issues.push('High-frequency energy is pronounced; inspect vocal sibilance and cymbal harshness.');
  if (Number(metrics.peakDb) > -0.5) issues.push('Peak level is close to 0 dBFS; leave headroom to avoid clipping.');
  if (Number(metrics.rmsDb) < -26) issues.push('Average level is very quiet; consider compression or gain staging.');
  if (!issues.length) issues.push('No obvious level or spectral warning from the supplied measurements. Listen on multiple speakers before finalizing.');
  if (openai) {
    try {
      const c = await openai.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.25, messages: [{ role: 'system', content: 'Explain audio mix measurements plainly. Do not claim to hear audio. Give practical, cautious suggestions.' }, { role: 'user', content: JSON.stringify({ metrics, detected: issues }) }] });
      return res.json({ explanation: c.choices[0]?.message?.content || issues.join(' '), findings: issues, source: 'openai' });
    } catch { /* fall through to deterministic analysis */ }
  }
  res.json({ explanation: issues.join(' '), findings: issues, source: 'signal-analysis' });
});
app.post('/api/transcribe', async (req, res) => {
  try {
    if (openai && req.body.mediaUrl) {
      const filename = path.basename(new URL(String(req.body.mediaUrl), 'http://localhost').pathname);
      const filePath = path.join(uploadDir, filename);
      if (!fs.existsSync(filePath)) throw new Error('Uploaded media could not be found on the server.');
      if (fs.statSync(filePath).size > 25 * 1024 * 1024) throw new Error('OpenAI transcription accepts uploads up to 25 MB. Compress the audio or configure a transcription gateway for larger media.');
      const result = await openai.audio.transcriptions.create({ file: createReadStream(filePath), model: process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1', response_format: 'verbose_json', timestamp_granularities: ['segment'] });
      const verbose = result as any;
      return res.json({ text: verbose.text || '', segments: Array.isArray(verbose.segments) ? verbose.segments.map((s: any) => ({ start: s.start, end: s.end, text: s.text })) : [], language: verbose.language || 'unknown', provider: 'openai-whisper' });
    }
    return res.json(await callGateway('transcribe', req.body));
  } catch (e: any) { return res.status(501).json({ error: e.message, hint: 'Configure OPENAI_API_KEY or a transcription model gateway, or use browser speech recognition.' }); }
});
app.post('/api/sound-search', async (req, res) => {
  try { return res.json(await callGateway('sound-search', req.body)); }
  catch (e: any) { return res.status(501).json({ error: e.message, hint: 'Connect a licensed sound-effects search/generation service, or use the local procedural generator.' }); }
});
app.post('/api/stems', async (req, res) => {
  try { return res.json(await callGateway('stems', req.body)); }
  catch (e: any) { return res.status(501).json({ error: e.message, hint: 'Configure a Demucs/MDX-compatible separation service. No fake stems will be generated.' }); }
});
app.post('/api/voice/repair', dbRequired, async (req, res) => {
  const consentId = String(req.body.consentId || '');
  const consent = await Consent.findOne({ _id: consentId, active: true, purpose: { $in: ['voice-repair', 'voice-cloning', 'all-audio-edits'] } });
  if (!consent) return res.status(403).json({ error: 'Active, purpose-specific speaker consent is required before voice repair.' });
  try { return res.json(await callGateway('voice-repair', { ...req.body, consentVerified: true, aiDisclosureRequired: true, watermarkRequired: true })); }
  catch (e: any) { return res.status(501).json({ error: e.message }); }
});
app.post('/api/dub', dbRequired, async (req, res) => {
  const consentIds: string[] = Array.isArray(req.body.consentIds) ? req.body.consentIds : [];
  const active = await Consent.countDocuments({ _id: { $in: consentIds }, active: true, purpose: { $in: ['dubbing', 'voice-cloning', 'all-audio-edits'] } });
  if (!consentIds.length || active !== consentIds.length) return res.status(403).json({ error: 'Every speaker must have active dubbing consent.' });
  try { return res.json(await callGateway('dub', { ...req.body, consentVerified: true, disclosureRequired: true })); }
  catch (e: any) { return res.status(501).json({ error: e.message }); }
});
app.post('/api/ai/credit-estimate', (req, res) => {
  const seconds = Math.max(0, Number(req.body.durationSeconds || 0));
  const feature = String(req.body.feature || 'mix');
  const rates: Record<string, number> = { transcribe: 0.006, stems: 0.02, dubbing: 0.04, 'voice-repair': 0.025, mix: 0.001 };
  const rate = rates[feature] ?? 0.005;
  res.json({ feature, durationSeconds: seconds, estimateUsd: Number((seconds / 60 * rate).toFixed(4)), estimateMinutes: Math.max(1, Math.ceil(seconds / 60 * (feature === 'stems' ? 4 : 1))), note: process.env.MODEL_GATEWAY_URL ? 'Estimate is indicative; provider billing may differ.' : 'Local audio tools are free. Provider-based features remain disabled until a model gateway is configured.' });
});

app.use('/api/projects', dbRequired);
app.get('/api/projects', async (_req, res) => res.json(await Project.find().sort({ updatedAt: -1 }).limit(100)));
app.post('/api/projects', async (req, res) => { const project = await Project.create({ name: String(req.body.name || 'Untitled session'), description: req.body.description || '', tracks: req.body.tracks || [] }); res.status(201).json(project); });
app.get('/api/projects/:id', async (req, res) => { const project = await Project.findById(req.params.id); return project ? res.json(project) : res.status(404).json({ error: 'Project not found.' }); });
app.patch('/api/projects/:id', async (req, res) => { const p = await Project.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true, runValidators: true }); return p ? res.json(p) : res.status(404).json({ error: 'Project not found.' }); });
app.delete('/api/projects/:id', async (req, res) => { await Project.findByIdAndDelete(req.params.id); await Version.deleteMany({ projectId: req.params.id }); res.status(204).end(); });
app.post('/api/projects/:id/versions', async (req, res) => res.status(201).json(await Version.create({ projectId: req.params.id, label: req.body.label || 'Snapshot', snapshot: req.body.snapshot })));
app.get('/api/projects/:id/versions', async (req, res) => res.json(await Version.find({ projectId: req.params.id }).sort({ createdAt: -1 }).limit(100)));
app.post('/api/projects/:id/share', async (req, res) => { let s = await Share.findOne({ projectId: req.params.id }); if (!s) s = await Share.create({ projectId: req.params.id, shareId: nanoid(12) }); res.json({ shareId: s.shareId, url: `${process.env.PUBLIC_APP_URL || 'http://localhost:5173'}/review/${s.shareId}` }); });
app.use('/api/review', dbRequired);
app.get('/api/review/:shareId', async (req, res) => { const s = await Share.findOne({ shareId: req.params.shareId }); if (!s) return res.status(404).json({ error: 'Review link not found.' }); const p = await Project.findById(s.projectId); const comments = await Comment.find({ shareId: req.params.shareId }).sort({ createdAt: 1 }); res.json({ project: p, comments }); });
app.post('/api/review/:shareId/comments', async (req, res) => { const s = await Share.findOne({ shareId: req.params.shareId }); if (!s) return res.status(404).json({ error: 'Review link not found.' }); const c = await Comment.create({ shareId: req.params.shareId, projectId: s.projectId, author: req.body.author || 'Guest', body: String(req.body.body || ''), time: Number(req.body.time || 0) }); res.status(201).json(c); });
app.patch('/api/comments/:id', async (req, res) => { const c = await Comment.findByIdAndUpdate(req.params.id, { resolved: Boolean(req.body.resolved) }, { new: true }); return c ? res.json(c) : res.status(404).json({ error: 'Comment not found.' }); });

app.use('/api/recipes', dbRequired);
app.get('/api/recipes', async (_req, res) => res.json(await Recipe.find().sort({ createdAt: -1 })));
app.post('/api/recipes', async (req, res) => res.status(201).json(await Recipe.create({ name: String(req.body.name || 'Untitled recipe'), description: req.body.description || '', steps: req.body.steps || [] })));
app.delete('/api/recipes/:id', async (req, res) => { await Recipe.findByIdAndDelete(req.params.id); res.status(204).end(); });
app.use('/api/consents', dbRequired);
app.get('/api/consents', async (_req, res) => res.json(await Consent.find().sort({ createdAt: -1 })));
app.post('/api/consents', async (req, res) => {
  const speaker = String(req.body.speaker || '').trim(), purpose = String(req.body.purpose || '').trim();
  if (!speaker || !purpose) return res.status(400).json({ error: 'Speaker identity and consent purpose are required.' });
  res.status(201).json(await Consent.create({ speaker, purpose, evidence: req.body.evidence || '', scope: Array.isArray(req.body.scope) ? req.body.scope : [] }));
});
app.post('/api/consents/:id/revoke', async (req, res) => { const c = await Consent.findByIdAndUpdate(req.params.id, { active: false, revokedAt: new Date() }, { new: true }); return c ? res.json(c) : res.status(404).json({ error: 'Consent record not found.' }); });

const webDist = path.resolve(process.env.WEB_DIST || '../../apps/web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}
app.use((err: any, _req: Request, res: Response, _next: any) => {
  const status = err instanceof multer.MulterError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 400;
  res.status(status).json({ error: err.message || 'Request failed.' });
});

async function start() {
  if (process.env.NODE_ENV === 'production') {
    const missing = ['MONGODB_URI', 'ACCESS_PASSWORD', 'TOKEN_SECRET'].filter(k => !process.env[k]);
    if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  if (process.env.MONGODB_URI) {
    try { await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }); console.log('MongoDB connected'); }
    catch (e) { console.error('MongoDB connection failed; API will run but database features will return 503.', e); }
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Resonance API listening on ${PORT}`));
}
start();
