# immich-gpt

<p align="center">
  <img src="frontend/public/logo.png" alt="immich-gpt logo" width="320" />
</p>

**AI metadata enrichment, face-aware captions, and review-first photo routing for Immich.**

immich-gpt is a self-hosted web app that connects to your Immich library, pulls thumbnails and metadata, asks an AI model for descriptions, tags, and routing destinations, and lets you approve every write-back before it reaches Immich.

**Version 0.6.33** switches to OIDC-only login with automatic migration of
existing accounts by `preferred_username`. Back up your database and configure
your private OIDC provider before upgrading.

## Enhancements in this fork

Compared with the original project, this fork includes:

- [x] Custom API base URLs for OpenAI, Azure OpenAI, and OpenRouter
- [x] Responsive, mobile-friendly pages and review workflows
- [x] A persistent Evaluation workspace for testing tags and routing destinations with normalized scoring
- [x] Portable JSON import and export for Evaluation settings and complete Routing Tree configurations
- [x] Configurable per-user parallel AI processing for Evaluation and Routing jobs
- [x] Improved routing-plan review with grouped and per-item actions plus immediate approved write-back
- [x] Authoritative Immich tag, people, and face-region synchronization with secure person thumbnails
- [x] Face-aware natural captions that use trusted Immich identities without asking the AI to recognize people
- [x] Identity-caption validation with one corrective retry and privacy-conscious job logs
- [x] Quick, Normal, and Full sync modes for efficient uploads, reconciliation, and complete rehydration
- [x] Quick Sync + Route behavior that fetches and routes only newly uploaded assets
- [x] Pre-hydration Live Photo companion filtering to avoid repeated detail and face requests

## Key highlights

🧠 AI-driven — built to let AI do the heavy lifting instead of making you sort your library like it’s 2012. Compatible with OpenAI, Ollama and OpenRouter.

🗂️ Automatic album classification — helps sort assets into albums and sub-albums so your Immich library feels organized.

🏷️ Metadata enrichment — generates useful descriptions and tags to make search, browsing, and rediscovery easier.

🔒 Safe by design — private Immich URLs are not exposed to external providers.

🏠 Local-friendly — works with self-hosted Ollama, so you can keep things close to home

## Table of contents

- [Enhancements in this fork](#enhancements-in-this-fork)
- [What immich-gpt does](#what-immich-gpt-does)
- [Documentation map](#documentation-map)
- [Quick start](#quick-start)
- [Typical workflow](#typical-workflow)
- [Features](#features)
- [Deployment options](#deployment-options)
- [Configuration overview](#configuration-overview)
- [API and health endpoints](#api-and-health-endpoints)
- [Architecture](#architecture)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

## What immich-gpt does

immich-gpt helps you enrich and organize large photo libraries without giving up control.

### Better metadata

For each synced asset, immich-gpt can suggest:

- a routing destination
- a natural-language description
- search-friendly tags
- an album or cleanup action

### Smarter organization

The routing tree lets you control what approval means for each kind of asset:

- **Virtual**: keep the classification inside immich-gpt only
- **Immich Album**: map approved assets into a specific Immich album
- **Review only**: flag items for manual review without writing to Immich
- **Immich Trash**: build a review-first cleanup workflow

### Routing plans before write-back

Routing plans let you:

- approve as-is
- review grouped destinations by confidence and rule outcome
- apply approved metadata, tags, albums, or trash actions
- reject the suggestion
- run a fresh plan when you want another pass

## Documentation map

Start here, then jump to the guide that matches your job.

| Guide | What it covers |
|------|-----------------|
| [`docs/getting-started.md`](docs/getting-started.md) | First install, first login, and a safe first workflow |
| [`DOCKER.md`](DOCKER.md) | Docker Compose, `docker run`, Unraid, Redis workers, upgrades |
| [`docs/reverse-proxy.md`](docs/reverse-proxy.md) | Nginx, Caddy, Traefik, HTTPS, and SSE buffering |
| [`docs/configuration.md`](docs/configuration.md) | Environment variables, provider settings, cookies, workers, CORS |
| [`docs/architecture.md`](docs/architecture.md) | System design, data flow, jobs, storage, and write-back |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Startup, OIDC login, Immich connectivity, SSE, providers |
| [`docs/development.md`](docs/development.md) | Local development, tests, frontend build, and Alembic |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute changes to the project |

## Quick start

The fastest path is Docker Compose.

1. Copy the sample environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set at minimum:

   - `IMMICH_URL`
   - `IMMICH_API_KEY`
   - `DATA_DIR`
   - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`

   `SECRET_KEY` can be left blank in Docker deployments. The container will generate one on first boot and persist it under `/data/.secret_key`.

3. Start the app:

   ```bash
   docker compose up -d
   ```

4. Open `http://localhost:8000`.

5. Select **Sign in with OIDC**. On a database with no accounts, the first OIDC user becomes admin.

6. Open **Settings** and configure:

   - your Immich connection
   - your preferred AI provider
   - whether new tags and new album names may be created

7. Go to **Dashboard** and run **Sync + Route**.

8. Open **Routing plans**, review the grouped decisions, approve or reject items, then apply the approved changes.

OIDC requires HTTPS except for loopback development. Set `SESSION_COOKIE_SECURE=true`
for HTTPS deployments; the OIDC callback also forces Secure application cookies when its configured URL is HTTPS.

For full install details, read [`docs/getting-started.md`](docs/getting-started.md) and [`DOCKER.md`](DOCKER.md).

## OIDC-only authentication and existing accounts

Login uses your **existing private OIDC provider**. All provider usernames are
accepted: there is no local email, domain, group or username allowlist, and no
verified-email requirement. The provider must supply a non-empty
`preferred_username` in the signed ID token or a subject-matched UserInfo
response. Configure the existing application entirely through environment:

```dotenv
OIDC_ISSUER=https://identity.example.com/realms/private
OIDC_CLIENT_ID=immich-gpt
OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET
OIDC_REDIRECT_URI=https://photos-ai.example.com/api/auth/oidc/callback
OIDC_TOKEN_AUTH_METHOD=client_secret_basic
SESSION_COOKIE_SECURE=true
```

Register a confidential web client with Authorization Code flow, PKCE S256 and
the exact callback URL. The callback path is fixed; its public origin depends
on your deployment. Issuer values must exactly match discovery metadata.
`client_secret_post` is also supported. Native backend configuration is read
from `backend/.env` or process environment; Compose forwards the root `.env`
settings. For Vite development, use a loopback callback on the browser's
frontend origin, such as `http://localhost:3000/api/auth/oidc/callback`.
No configuration enables username/password login: missing OIDC configuration
shows a configuration error, and partial configuration stops startup.

**Existing accounts migrate automatically on their first successful OIDC login.**
The provider's `preferred_username` must exactly match the old username
(case-sensitive, not the email). The existing user ID, role, active/disabled
status and all owned data/settings remain unchanged. After linking, the
provider issuer + subject identify that account permanently; later username
changes from that same identity update its display/login username without
moving its data. A different identity cannot take an already-linked username.
Username/email collisions fail explicitly rather than merging accounts.
You must control usernames at the provider, since first-time username matching
grants access to the matching account, including an existing administrator.

New identities create normal user accounts and personal defaults. Email is
optional and is not used to link accounts. Only on a completely empty database
does the first OIDC login create the initial admin. Administrators may still
pre-create exact usernames to assign roles and may disable/delete accounts.
This does not make Immich data shared between users: existing per-user
isolation remains.

The database migration adds OIDC identity/session fields, makes email/password
storage optional, clears password-change flags, and invalidates old sessions
and reset tokens. Linking an existing account clears its stored password hash.
The username/password, password-reset/change and setup endpoints and UI are
removed; there is no password fallback. **Back up the persistent database
before upgrading**, confirm provider usernames match existing account names,
and configure OIDC before deploying the new image. A downgrade after creating
or linking OIDC-only accounts requires operator credential restoration; it
fails explicitly instead of deleting accounts or inventing credentials.

Authentication stays in the existing FastAPI process/container. The approved
new dependencies are `Authlib==1.9.5` and `itsdangerous==2.2.0`, with Authlib's
JOSE dependencies; the existing HTTPX and cryptography libraries are reused.
Install/build from `backend/requirements.txt` as before. No service, daemon,
container, port, identity-provider bundle or worker is added. The existing
background-job execution path does not change. At login, the backend makes
outbound HTTPS requests to the configured provider's discovery, token, JWKS
and sometimes UserInfo endpoints. Use your existing reverse proxy for HTTPS;
no proxy is installed by this change.

Ten-minute OIDC state/nonce/PKCE data uses a signed HttpOnly SameSite=Lax
cookie (Secure for HTTPS); provider tokens are not stored in it or in the
database. ID tokens are signature/issuer/audience/expiry/nonce validated.
Application sessions retain their existing database-backed 24-hour idle and
seven-day maximum lifetime and cookie policy. Logout revokes the app session,
not the provider SSO session. Uvicorn callback access logs redact the query;
configure your existing proxy to omit callback query strings from its logs too.
Provider access revocation is enforced at the next OIDC login; disable a local
account to revoke its active application sessions immediately.

Deploy a newly built image and recreate the existing app container with the
environment above; old published/running images do not change automatically.
Start/stop commands remain `docker compose up -d` / `docker compose stop app`;
native development still uses Uvicorn and Vite. Publishing a release does not
deploy it to your server or configure your identity provider.

## Typical workflow

### 1. Connect Immich and your provider

In **Settings**, save your Immich URL and API key, then add an AI provider:

- **OpenAI**
- **OpenRouter**
- **Ollama**

Immich settings saved in the UI are stored in the database and override `IMMICH_URL` and `IMMICH_API_KEY` environment values for that user.

### 2. Create a routing tree

A simple starter set is:

- **Family** with child leaves for common people or events
- **Travel** with child leaves for destinations or trip types
- **Receipts** as a virtual destination
- **Favourites Archive** as an Immich album destination
- **Trash candidates** as an Immich trash destination

Each routing leaf can define its own criteria, custom prompt guidance, priority, destination, confidence thresholds, and automation rules.

### 3. Pick a sync scope

From **Dashboard**, choose:

- **All Photos & Videos**
- **Favourites Only**
- **Specific Albums**

Then choose a workflow:

- **Sync Only**
- **Sync + Route**
- **Route Only**

**Quick Sync** is the default sync action and fetches uploads since the last
successful scan. Its menu offers Normal Sync for complete inventory
reconciliation and Full Sync for complete metadata rehydration. **Sync + Route**
also uses Quick Sync. For a first run, use Normal or Full Sync once before
relying on Quick Sync.

### 4. Review and apply a routing plan

In **Routing plans**, results are grouped as applied, ready to approve, needs review, trash candidates, rejected by rules, or failed. You can:

- approve grouped items and write their configured changes to Immich immediately
- reject grouped items without changing Immich
- inspect destination paths and counts
- retry items approved by older versions
- run a new plan when routing rules change

### 5. Roll out gradually

A safe rollout looks like this:

1. start with a small routing tree
2. run on favourites or specific albums first
3. review the early routing plans closely
4. refine criteria, prompts, thresholds, and automation rules
5. expand to more of the library

## Features

### AI-first pipeline

- one AI call per asset with image plus metadata context
- structured JSON responses with schema validation
- bad provider responses are surfaced as errors instead of silently ignored

### Image handling

- thumbnails are fetched server-side from Immich
- images are converted to base64 data URLs before being sent to providers
- private Immich URLs are never passed directly to external AI services

### Routing tree

- nested destinations for broad categories and specific leaves
- per-leaf positive and negative criteria
- destination-specific metadata and write-back options
- optional custom prompt guidance and prompt preview
- import and export the complete root and leaf configuration as portable JSON

### Evaluation

- save representative Immich images with expected tags and destinations
- verify required tags, forbidden tags, and routing destinations with normalized scoring
- run dry-run AI evaluations without creating plans or writing changes to Immich
- import and export Evaluation settings without including results or scores

### Routing plan workflow

- recent plan history with status and item counts
- grouped result states for review
- grouped approve and reject actions
- auto-apply for high-confidence results
- apply approved items to Immich

### Jobs and progress

- live progress tracking
- configurable per-user parallel AI processing for Evaluation and Routing jobs
- job logs in the UI
- job states such as `queued`, `syncing_assets`, `preparing_image`, `classifying_ai`, `writing_results`, and `completed`
- pause, resume, and cancel support

### Write-back safeguards

- explicit approval before write-back
- audit logging for important actions
- failures are visible instead of swallowed
- external library limitations are detected and warned

## Deployment options

| Option | Best for |
|--------|----------|
| Docker Compose | Most users and home labs |
| Unraid Community Apps | Unraid users who want a template-driven install |
| `docker run` | Small manual deployments |
| Redis + RQ worker | Advanced setups that already run Redis |
| Local development | Contributors working on backend or frontend changes |

immich-gpt runs as a single container by default. Background jobs use an in-process `ThreadPoolExecutor`, so Redis is optional rather than required.

## Configuration overview

The project supports both environment-based defaults and per-user settings in the UI.

### Most important settings

| Setting | Purpose |
|--------|---------|
| `IMMICH_URL` | Base URL of your Immich instance |
| `IMMICH_API_KEY` | Immich API key |
| `SECRET_KEY` | Session-signing secret; auto-generated in Docker if blank |
| `SESSION_COOKIE_SECURE` | Must be `true` behind HTTPS, `false` for plain HTTP |
| `OPENAI_API_KEY` | Optional default OpenAI key |
| `OPENAI_MODEL` | Default OpenAI model |
| `TZ` | IANA timezone for displayed timestamps and job log clocks (default: `UTC`) |
| `REDIS_URL` | Optional Redis for RQ worker mode |
| `WORKER_CONCURRENCY` | Thread count for built-in background jobs |
| `LOG_LEVEL` | Logging verbosity |

UI settings take precedence for:

- Immich connection details
- provider definitions
- behaviour toggles such as allowing new tags and new albums

The full configuration reference lives in [`docs/configuration.md`](docs/configuration.md).

## API and health endpoints

Useful built-in endpoints:

| Endpoint | Purpose |
|---------|---------|
| `/health` | Basic health check |
| `/api/health` | Health check under the API namespace |
| `/docs` | Interactive OpenAPI docs |
| `/redoc` | Alternative API reference UI |

Core API areas include:

- `/api/auth`
- `/api/settings`
- `/api/routing`
- `/api/assets`
- `/api/jobs`
- `/api/albums`
- `/api/thumbnails`

## Architecture

```text
┌─────────────┐    ┌──────────────────────┐    ┌────────────┐
│   Browser   │───▶│   FastAPI (Python)   │───▶│   Immich   │
│  React SPA  │    │                      │    │   Server   │
└─────────────┘    │  auth + settings     │    └────────────┘
                   │  sync + job control  │
                   │  AI classification   │───▶ AI provider
                   │  routing plans       │
                   │  approved write-back │     (OpenAI /
                   └──────────────────────┘      OpenRouter /
                          │                      Ollama)
                          ▼
                     SQLite DB
                (persistent volume)
```

FastAPI serves the API and, in production, the built React frontend from `backend/static`. SQLite stores users, settings, routing nodes, routing plans, synced assets, jobs, and audit logs. Optional Redis can be added when you want RQ workers.

For a deeper architecture walkthrough, see [`docs/architecture.md`](docs/architecture.md).

## Development

### Backend

```bash
cd backend
python3 -m pytest tests/ -v
```

### Frontend

```bash
cd frontend
npm test
npm run lint
npx tsc --noEmit
```

### Frontend production build

```bash
cd frontend
npx vite build
```

That build writes static assets into `backend/static` so FastAPI can serve the SPA in production.

See [`docs/development.md`](docs/development.md) for local run commands, migrations, and contributor workflow details.

## Roadmap

- [x] Asset detail view with synced tags and recognized people
- [x] Immich face and people metadata, including face bounding boxes
- [x] Video thumbnail display through the authenticated Immich thumbnail proxy
- [ ] Duplicate and junk heuristic pre-filter
- [ ] Automated Evaluation suites and regression thresholds
- [ ] Additional OIDC account-management integrations

The roadmap is directional and may change as Immich APIs and provider capabilities evolve.

## License

This project is licensed under the GNU Affero General Public License v3.0. See [`LICENSE`](LICENSE) for the full text.

If you modify immich-gpt and let users interact with that modified version over a network, AGPL-3.0 requires you to make the corresponding source code of that version available to those users.
