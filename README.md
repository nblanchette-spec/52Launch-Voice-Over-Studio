# 52Launch Production Studio

52Launch Production Studio is an internal agency production pipeline and storyboard OS built with React, Vite, and Express. It manages the end-to-end commercial workflow from client intake and Brand Bible creation to Creative Briefs, Shot Boards, Storyboard Frames, Frame Checks, Video Studio renders, Voiceover generation, Shoot Plans, and Master PDF / Google Drive deliverables.

## Prerequisites & Package Management

- **Node.js `>=24.12`** (required for the reviewed Firebase dependency stack and direct TypeScript execution via `node server.ts` in production).
- **Package Manager**: Use **npm** (`npm ci` in production and CI, `npm install` when updating dependencies). Do not use Bun or reintroduce `bun.lock`.

## Environment Variables

`.env` is loaded automatically at server startup before any module reads `DATA_DIR` or model settings. Leave `NODE_ENV` unset in `.env` so `npm run dev` runs in development mode (`npm start` sets `NODE_ENV=production` automatically).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Required for Gemini Direct & VoxCraft TTS | — | Google Gemini API key (see **AI Model Defaults & Key Requirements** below). |
| `FAL_KEY` | Yes (for image/video/upscale & Fal LLM fallback) | — | fal.ai API key for storyboard frames, Video Studio renders, Topaz upscaling, and Fal OpenRouter LLM fallback. |
| `APP_USERNAME` | When Basic Auth is enabled | `admin` | HTTP Basic Auth username protecting pages and `/api/*`. |
| `APP_PASSWORD` | Yes in production (unless handled upstream) | — | HTTP Basic Auth password. Production refuses to start if unset unless `ALLOW_UNAUTHENTICATED=true`. |
| `ALLOW_UNAUTHENTICATED` | No | `false` | Keep `false` in standalone deployments. Only set `true` when an upstream reverse proxy / SSO layer enforces login. |
| `DATA_DIR` | No | `./data` | Directory where project JSON records and uploaded/generated assets are stored. |
| `PORT` | No | `3000` | HTTP port the Express server listens on. |
| `GEMINI_TEXT_MODEL` | No | `gemini-3.5-flash-lite` | Override for the direct Google Gemini text/JSON model. |
| `FAL_GEMINI_MODEL` | No | `google/gemini-3.5-flash-lite` | Override for the Fal/OpenRouter text/vision fallback model. |

## AI Model Defaults & Key Requirements

- **Direct Gemini text/JSON default**: `gemini-3.5-flash-lite` (override via `GEMINI_TEXT_MODEL`).
- **Fal / OpenRouter fallback default**: `google/gemini-3.5-flash-lite` (override via `FAL_GEMINI_MODEL`).
- **Features that still require a direct `GEMINI_API_KEY`**:
  - **VoxCraft Voiceover TTS** (`/api/pipeline/vo/*`, models `gemini-3.8-flash-lite-tts` and `gemini-3.8-flash-tts`) calls the direct Gemini API (`@google/genai`) and has no Fal fallback.
  - **Google Direct AI routing mode** (`google_direct`) and the primary direct-Gemini leg of `auto` mode (including native multimodal inline PDF analysis prior to text-extraction fallback).

## Google Drive, Firebase & OAuth Setup (52Launch Staging / Production)

App access (`Authorization: Basic ...`) and Google Drive access (`X-Google-Drive-Token`) are strictly separated:
- A Google Drive token never grants access to the studio on its own.
- Drive OAuth tokens stay in browser memory only and clear on page reload or expiry; the Save Destination section prompts users to reconnect when needed.
- If a destination folder URL or ID is explicitly selected and cannot be accessed or written, the server surfaces the error rather than saving into another folder. In `NODE_ENV=production`, the server never falls back to personal My Drive.

Before handing staging to team members, configure the 52Launch-owned Firebase and Google Cloud project:

1. **Firebase Web Config**: Supply the 52Launch-owned Firebase web app config in `firebase-applet-config.json` (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). Do not commit personal accounts or non-52Launch keys.
2. **Firebase Console**:
   - Enable **Authentication -> Sign-in method -> Google**.
   - Under **Authentication -> Settings -> Authorized domains**, add your exact internal staging and production hostnames.
3. **Google Cloud Console (OAuth & Drive API)**:
   - Enable the **Google Drive API** on the project.
   - Configure the **OAuth consent screen** (Internal for Google Workspace `@52launch.com` or External with authorized test/published users) requesting scopes:
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/drive.metadata.readonly`
     - `https://www.googleapis.com/auth/drive.readonly`
   - Add the staging/production origin (`https://your-staging-host`) and Firebase `authDomain` handler to the Web OAuth Client's **Authorized JavaScript origins** / **Authorized redirect URIs**.
4. **Google Shared Drive Permissions**:
   - Grant each studio operator (e.g. `@52launch.com` accounts) **Content Manager** (or Manager) access on the intended 52Launch Shared Drive or project folder so reading intake files and uploading PDFs/frames succeed without silent fallbacks.

## Running Locally & Testing

1. Clean install dependencies with npm:
   ```bash
   npm ci
   ```
2. Create `.env` from `.env.example` and populate keys (`APP_USERNAME`, `APP_PASSWORD`, `GEMINI_API_KEY`, `FAL_KEY`).
3. Start development mode (Express + Vite middleware on port `3000`):
   ```bash
   npm run dev
   ```
4. Run verification checks:
   ```bash
   npm run lint
   npm run build
   npm run test:smoke
   ```

## Production & Staging Deployment Topology

1. Install dependencies cleanly and build the frontend bundle:
   ```bash
   npm ci
   npm run build
   ```
2. Start the production server (`NODE_ENV=production node server.ts`):
   ```bash
   npm start
   ```

### Required Operational Constraints

- **Single Express Instance**: Run a single Express server process against `DATA_DIR`. `project.json` writes are atomic (temp file + rename) to prevent partial-file corruption on crash, but atomic renames do not resolve simultaneous-edit conflicts across concurrent users or multiple server replicas.
- **Persistent Writable `DATA_DIR`**: Mount `DATA_DIR` on a persistent disk/volume with read/write permissions. Container filesystems are ephemeral and lose project JSON records and uploaded/generated assets across restarts or deploys.
- **Scheduled Backups**: Back up `DATA_DIR` on a schedule (and use `.52launch-backup` exports / Google Drive sync for project redundancy).
- **HTTPS & Access Gate**: Always serve behind TLS (`https://`) in front of the HTTP Basic Auth gate (`APP_USERNAME` + `APP_PASSWORD`) so Basic Auth credentials and `X-Google-Drive-Token` headers are encrypted in transit.
