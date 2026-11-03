# Resonance — AI-Powered Audio Studio

A full-stack audio production workspace built with React + TypeScript, Web Audio API, Express, MongoDB and optional AI model providers. It ships as **one deployable application**: the Express service serves the built React UI and the `/api` routes from the same origin.

## What is included

| Area | Included capability | Runs locally without a model provider? |
|---|---|---|
| Studio | Multitrack import, playback, waveform, per-track EQ, gain, compression, delay, reverb, gate, stereo width, trim, WAV export, version snapshots | Yes |
| Describe-to-Mix | Natural-language mix commands, visible setting changes, OpenAI-backed suggestion mode, local rule fallback | Yes (rule fallback); OpenAI improves interpretation |
| Reference Match | Compare loudness and estimated tonal/stereo measurements; apply editable starting-point settings | Yes |
| Explain My Mix | Peak/RMS/clipping/band estimates and practical suggestions | Yes; OpenAI explanation optional |
| Agent Band | Editable kick, snare, hats, bass and chord-bed stems plus arrangement suggestion | Yes (procedural generation) |
| Edit by Text | Editable transcript, timestamped segment removal into a new audio track, browser speech-recognition input | Browser/provider dependent for transcript timestamps |
| Voice Repair | Consent-gated provider job; provider output can be added to the session | Requires compatible voice-repair gateway |
| Room Doctor | Microphone capture, informal clap/decay estimate and room-treatment advice | Yes; requires microphone permission |
| Multi-mic Auto-Sync | Estimate onset offsets, align recordings, choose the cleaner source in half-second blocks, create a composite | Yes |
| Breath/Mouth Noise | Adjustable gentle expander/noise-gate control | Yes; not a dedicated spectral breath classifier |
| Sound Search | Local procedural SFX generator; optional licensed catalog/provider search | Local generator works; catalog needs provider |
| Mood Painter | Editable energy curve and generated backing bed | Yes (procedural) |
| Instant Stems | Vocals/drums/bass/other request and import returned stems | Requires Demucs/MDX-compatible gateway |
| Teach Your Style | Learn a settings profile from three of your mixes | Yes (settings-based profile, not neural model training) |
| Podcast Tools | Silence-based chapters, range clips, SRT caption sidecar, transcript, pace/filler coach | Yes; transcription timestamps need provider/OpenAI |
| Language Dubbing | Consent-gated translated voice job | Requires compatible dubbing gateway |
| Version Time-Travel | Local snapshots and server checkpoints for mix settings | Yes; MongoDB for server sync |
| Review Links | Share link, shared audio playback, timestamped comments | MongoDB + server-stored media |
| Run Recipes | Save/reuse production steps across all loaded tracks | Yes locally; MongoDB sync optional |
| Credit Preview | Indicative cost/time estimate and local 8-second processing preview | Yes |
| AI Disclosure | AI-edited track labels and JSON metadata sidecar on export | Yes |
| Consent Vault | Purpose-specific consent records, protected server checks and revocation | MongoDB required |

## Run in GitHub Codespaces (recommended for browser-based development)

This repository includes a Dev Container configuration. It starts a Node.js 22 workspace and MongoDB 7 automatically, installs the npm workspaces, and forwards the web/API ports. You do not need to install Node.js or MongoDB on your own computer.

### 1. Put the project on GitHub

1. Download and extract the Resonance ZIP, then create a new empty repository on GitHub.
2. Upload the extracted project contents (the `package.json`, `apps/`, `.devcontainer/`, and other project files must be at the repository root), or push them with Git.
3. On the repository page, select **Code → Codespaces → Create codespace on main**.

### 2. Start the studio

When the Codespace finishes building, open its terminal and run:

```bash
npm run dev
```

The command starts both the Express API and Vite web app. In the **Ports** panel, open port **5173** (Resonance Web App). Port **8080** is the API and can be used for its health check at `/api/health`. MongoDB runs privately inside the Codespace on the `mongo` service; its connection is preconfigured.

### 3. Optional AI provider keys

The studio's local audio tools work without AI credentials. To enable OpenAI-powered mix suggestions and transcription, create a root `.env` file and add your key:

```bash
cp .env.example .env
```

Then set `OPENAI_API_KEY` in `.env` and replace the sample `ACCESS_PASSWORD` and `TOKEN_SECRET` values with your own values. The studio login password is the value you set for `ACCESS_PASSWORD`. The Codespaces MongoDB environment setting takes precedence over the example file's `localhost` connection string. Restart `npm run dev` after changing environment variables. High-compute stem separation, voice repair and dubbing still require a compatible `MODEL_GATEWAY_URL` and token, as documented below.

### 4. Save your work

Codespaces is backed by your GitHub repository. Commit and push your changes from the terminal:

```bash
git add .
git commit -m "Set up Resonance audio studio"
git push
```

**Codespaces note:** keep port 5173 private unless you intentionally want to expose the studio. The Dev Container uses a local-development token secret and does not enable password protection by default. Before making the app public or deploying it for real users, configure a strong `ACCESS_PASSWORD`, a unique `TOKEN_SECRET`, a managed MongoDB database, persistent media storage, and HTTPS. Do not commit `.env` or API keys.

## Quick start (Docker — recommended)

Requirements: Docker Desktop or Docker Engine with the Compose plugin.

```bash
cd resonance
cp .env.example .env
```

Edit `.env`. Set at least a private studio password and a long random token secret before exposing the app:

```dotenv
ACCESS_PASSWORD=use-a-long-private-password
TOKEN_SECRET=use-a-long-random-secret-at-least-32-characters
```

Then start the complete application and database:

```bash
docker compose up --build
```

Open **http://localhost:8080**. MongoDB and uploaded media are persisted in named Docker volumes. To stop the app:

```bash
docker compose down
```

To remove the database and uploaded media too (destructive):

```bash
docker compose down -v
```

## Local developer mode

Requirements: Node.js 22+ and MongoDB 7+.

```bash
cp .env.example .env
# Set MONGODB_URI, ACCESS_PASSWORD and TOKEN_SECRET in .env
npm install
npm run dev
```

Frontend: `http://localhost:5173` (Vite proxies `/api` to `http://localhost:8080`). API: `http://localhost:8080/api/health`.

Production single-container build:

```bash
docker build -t resonance-audio-studio .
docker run --rm -p 8080:8080 \
  -e MONGODB_URI='mongodb+srv://…' \
  -e ACCESS_PASSWORD='…' \
  -e TOKEN_SECRET='…' \
  -v resonance_uploads:/app/uploads \
  resonance-audio-studio
```

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and select the repository (the included `render.yaml` defines the Docker web service).
3. Set `MONGODB_URI` to a MongoDB Atlas connection string.
4. Set `PUBLIC_APP_URL` to the deployed HTTPS URL, without a trailing slash.
5. Set `ACCESS_PASSWORD` and `TOKEN_SECRET` to strong unique secrets.
6. Add `OPENAI_API_KEY` to enable OpenAI-backed Describe-to-Mix explanations and timestamped Whisper transcription.
7. For persistent uploads, attach a persistent disk mounted at `/app/uploads`. The container filesystem on many hosted platforms is ephemeral; without persistent storage, uploaded media may be lost on redeploy/restart.
8. Configure `MODEL_GATEWAY_URL` and `MODEL_GATEWAY_TOKEN` for stem separation, synthetic voice repair, dubbing or licensed SFX search (details below).

A managed MongoDB database and persistent media storage are production requirements for collaboration, consent records and durable uploads. Do not use the in-memory/local-browser fallback as a multi-user production database.

## AI provider configuration

`OPENAI_API_KEY` enables:

- Natural-language mix setting suggestions (`gpt-4o-mini` by default; configure `OPENAI_MODEL` to change it).
- Plain-language explanation of measured mix metrics.
- Whisper transcription with timestamped segments (`OPENAI_TRANSCRIBE_MODEL=whisper-1`) for transcript-led editing and pace coaching. The OpenAI transcription upload limit is 25 MB; larger files need compression or an external gateway. The current API reference notes that `whisper-1` timestamp support is deprecated after February 26, 2027, so configure a timestamp-capable gateway before then if you need segment-level editing long-term.

The app deliberately uses a **provider gateway contract** for high-compute or voice-identity features instead of pretending these are built into a browser. Set `MODEL_GATEWAY_URL` to the base URL of a trusted service that implements these endpoints. The app sends JSON requests and, when set, the `Authorization: Bearer $MODEL_GATEWAY_TOKEN` header.

| Gateway path | Request fields | Expected response |
|---|---|---|
| `POST /stems` | `mediaUrl`, `filename`, `stems: [vocals, drums, bass, other]` | `{ "stems": [{ "type": "vocals", "name": "vocals.wav", "url": "https://…" }] }` |
| `POST /voice-repair` | `mediaUrl`, `instruction`, `consentId`, `consentVerified`, `watermarkRequired` | `{ "url": "https://…", "name": "repaired.wav", "message": "…" }` |
| `POST /dub` | `mediaUrl`, `targetLanguage`, `consentIds`, `consentVerified`, `disclosureRequired` | `{ "url": "https://…", "name": "dubbed.wav", "message": "…" }` |
| `POST /sound-search` | `query`, `license: "cleared-only"` | `{ "url": "https://…", "name": "sound.wav" }` |
| `POST /transcribe` | `mediaUrl`, `language` | `{ "text": "…", "segments": [{ "start": 0, "end": 2.4, "text": "…" }] }` |

The provider must return downloadable media URLs accessible to the browser. For generated/repaired voices, the provider must apply the agreed watermark and return provenance metadata where supported. Only use voices and audio for which you have the necessary rights and consent. Resonance checks active consent records for voice repair and dubbing before forwarding those jobs; your provider must still enforce its own safeguards.

## Important implementation boundaries

- EQ, gain, compression, gate, simple delay/reverb, width, trim, WAV rendering, synthetic SFX, the Agent Band, mood bed, multi-mic alignment and local session operations run in the browser.
- Reference matching and Explain My Mix use lightweight signal measurements. They are practical starting points, not a replacement for calibrated mastering analysis or critical listening.
- The local breath control is a gentle dynamics gate/expander, not a neural de-breath/noise-removal model.
- Room Doctor gives an informal clap-decay estimate, not a calibrated RT60 measurement.
- Voice repair, voice cloning, dubbing and source separation are model-provider jobs. They are surfaced in the UI and API contract but are not falsely simulated when no provider is configured.
- Credit figures are indicative placeholders based on the included rate table. They are not a provider quote or billing guarantee.
- WAV exports include a `.json` sidecar recording AI-assisted status and processing settings. Keep the sidecar with the audio when sharing.
- The single `ACCESS_PASSWORD` protects studio API actions. Review URLs are bearer links and can be forwarded; rotate/revoke by deleting the share record in MongoDB if a link is exposed. For enterprise or public multi-user deployment, add per-user authentication, role-based authorization, rate limiting and audit retention.

## Useful endpoints

- `GET /api/health` — API/database/provider status.
- `POST /api/auth/login` — obtain a 7-day studio access token when `ACCESS_PASSWORD` is set.
- `POST /api/upload` — upload media to the server media volume.
- `/api/projects`, `/api/recipes`, `/api/consents` — persistent project/workflow/consent records.
- `/api/review/:shareId` — public bearer-link review page data and comments.

## License and rights

Use this code as a starting point for your own studio. You are responsible for ensuring that source recordings, reference tracks, generated outputs, voice likenesses, SFX assets, and model providers are appropriately licensed and consented.
