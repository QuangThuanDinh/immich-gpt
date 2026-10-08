# Configuration reference

This guide explains how immich-gpt reads configuration, which settings can be overridden in the UI, and what each environment variable does.

## Configuration model

immich-gpt combines three kinds of configuration:

1. Docker or process environment variables
2. values stored in the application database
3. runtime defaults in the backend settings model

## Precedence rules

### Per-user UI settings override environment defaults

These values can be saved in the UI and take precedence over matching environment variables for that user:

- Immich URL
- Immich API key
- provider definitions
- behavior toggles such as allowing new tags and allowing new album names

This makes environment variables a good way to provide sane defaults, while still letting each user customize their own setup.

### Environment variables still control server-level behavior

These remain process-level settings:

- `SECRET_KEY`
- `SESSION_COOKIE_SECURE`
- `SESSION_COOKIE_NAME`
- `SESSION_COOKIE_SAMESITE`
- `DATABASE_URL`
- `REDIS_URL`
- `WORKER_CONCURRENCY`
- `CORS_ORIGINS`
- `LOG_LEVEL`
- `RATELIMIT_ENABLED`

## Deployment modes

| Mode | What changes |
|------|--------------|
| Single container | Default mode; jobs run in-process via a thread pool |
| Redis plus RQ | Set `REDIS_URL`; job execution moves to RQ workers |
| Frontend dev server | Set `CORS_ORIGINS` if the frontend is served from a different origin |
| HTTPS behind reverse proxy | Set `SESSION_COOKIE_SECURE=true` |

## Docker Compose variables

These variables are primarily used by `.env.example` and `docker-compose.yml`.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/mnt/user/appdata/immich-gpt` | Host path mounted to `/data` for the SQLite database, settings, job history, routing data, and generated secret |
| `LOG_DIR` | unset | Optional host path mounted to `/logs` for persistent rotating logs |
| `APP_PORT` | `8000` | Host port mapped to container port `8000` |
| `IMMICH_GPT_IMAGE` | `ghcr.io/quangthuandinh/immich-gpt:0.6.28` | Image tag used by `docker-compose.yml` |

## Core runtime variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./data/immich_gpt.db` | Database URL for local or non-container runs |
| `ALLOW_PRIVATE_SERVICE_URLS` | `false` | Set `true` to allow Immich or AI provider URLs that resolve to private/LAN addresses |
| `ROUTING_PLAN_PAGE_SIZE` | `20` | Photos shown per Routing Plan review page (1–100) |
| `SECRET_KEY` | none | Session-signing secret; must be strong and at least 32 characters if set directly |
| `SESSION_COOKIE_NAME` | `session_id` | Name of the session cookie |
| `SESSION_COOKIE_SECURE` | `false` | Must be `true` for HTTPS deployments; leave `false` for plain HTTP |
| `SESSION_COOKIE_SAMESITE` | `strict` | SameSite policy for the session cookie |
| `CORS_ORIGINS` | empty | Comma-separated allowed origins for split frontend and API setups |
| `LOG_LEVEL` | `INFO` | Root logger level |
| `RATELIMIT_ENABLED` | `true` | Enables API rate limiting |
| `DEBUG` | `false` | Backend debug flag |

### Local services and Routing Plan page size

Use these settings when Immich, Ollama, LiteLLM, or another configured service
is hosted on your local network, and to control the number of photos loaded on
each Routing Plan review page:

```env
ALLOW_PRIVATE_SERVICE_URLS=true
ROUTING_PLAN_PAGE_SIZE=20
```

`ALLOW_PRIVATE_SERVICE_URLS` defaults to `false` to protect against
server-side request forgery. Enable it only when the configured private or LAN
services are trusted. `ROUTING_PLAN_PAGE_SIZE` accepts values from `1` through
`100` and defaults to `20`.

## Immich and provider defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `IMMICH_URL` | empty | Default Immich base URL |
| `IMMICH_API_KEY` | empty | Default Immich API key |
| `OPENAI_API_KEY` | empty | Default OpenAI API key when using env-based OpenAI configuration |
| `OPENAI_MODEL` | `gpt-4o` | Default OpenAI model |

## Job and worker variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | empty | Optional Redis connection string for RQ mode. When set, the FastAPI process auto-starts an in-process RQ worker thread so the same single container drains the queue. |
| `WORKER_CONCURRENCY` | `2` | Thread count. In default mode this sizes the in-process `ThreadPoolExecutor`. In RQ mode it sizes the in-process RQ worker pool (one `SimpleWorker` thread per slot). |

## Image-processing variables

These are advanced runtime values that most users will never need to change.

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_IMAGE_BYTES` | `20971520` | Max image size sent to provider logic, in bytes |
| `THUMBNAIL_WIDTH` | `512` | Thumbnail width used for prepared images |
| `THUMBNAIL_HEIGHT` | `512` | Thumbnail height used for prepared images |

## `SECRET_KEY` behavior

`SECRET_KEY` is required by the backend settings validator. In normal Docker deployments, the entrypoint script handles this for you:

- if you set a valid `SECRET_KEY`, it is used directly
- if you leave it blank, the container generates one on first boot
- the generated key is stored in `/data/.secret_key`

Do not use placeholders such as:

- `change-me-in-production`
- `secret`
- `changeme`
- `insecure`
- `dev`

## Cookie and login behavior

`SESSION_COOKIE_SECURE` must match how the browser reaches the app:

- browser uses `http://...` -> set `SESSION_COOKIE_SECURE=false`
- browser uses `https://...` -> set `SESSION_COOKIE_SECURE=true`

If this is wrong, the browser will reject the session cookie and login will appear broken.

`SESSION_COOKIE_SAMESITE` defaults to `strict`, which is a sensible default for the app's normal same-origin deployment model.

## Immich settings

You can configure Immich two ways:

### Environment defaults

Useful for a single-user or preconfigured deployment:

- `IMMICH_URL`
- `IMMICH_API_KEY`

### Per-user UI settings

Useful for multi-user installs:

- users save their own Immich URL and API key in **Settings**
- the stored values override the environment defaults for that user
- the UI tests connectivity and returns an asset count

## Provider configuration

Provider definitions are stored per user in the database.

### Supported providers

- OpenAI
- OpenRouter
- Ollama

### Provider notes

#### OpenAI

- hosted provider
- typically uses an API key
- default model is `gpt-4o`
- accepts an optional custom OpenAI-compatible Base URL, used exactly as entered
- supports Azure OpenAI API roots such as
  `https://my-resource.openai.azure.com/openai/v1`; a resource origin without
  `/openai/v1` is also accepted for backward compatibility
  - Base URL + Deployment uses the Azure OpenAI v1 API
  - adding API Version uses the versioned AzureOpenAI deployment API; the
    resource origin is derived from either accepted Base URL form
- Azure deployment replaces the Model value, and model-list verification is skipped

#### OpenRouter

- hosted aggregator for many model vendors
- uses its own API key
- uses `https://openrouter.ai/api/v1` by default
- accepts an optional complete OpenAI-compatible API Base URL, used exactly as
  entered, such as `http://192.168.0.19:4000/v1` for LiteLLM
- private or local Base URLs require `ALLOW_PRIVATE_SERVICE_URLS=true`
- can list available models after the provider is saved

#### Ollama

- self-hosted local inference
- no API key required
- base URL usually looks like `http://localhost:11434`
- routing requires a vision-capable model; thumbnails are sent through Ollama's
  OpenAI-compatible `/v1/chat/completions` endpoint
- can list local models from the Ollama server after the provider is saved

## Behavior settings

The Settings UI exposes two important toggles:

| Setting | Default | Effect |
|---------|---------|--------|
| `allow_new_tags` | `true` | Lets AI propose tags that do not already exist |
| `allow_new_albums` | `true` | Lets AI propose new album names where the selected routing destination allows it |

When disabled, routing prompts and plan review logic become more restrictive and lean toward existing tags and albums.

## Database paths

Different run modes use different effective database paths:

- local backend run from `backend/`: `sqlite:///./data/immich_gpt.db`
- Docker Compose: `sqlite:////data/immich_gpt.db`

The Docker path is the one you usually want in production because `/data` is mounted to persistent storage.

## CORS

For the normal production setup, FastAPI serves both the API and the built frontend, so no special CORS configuration is needed.

Set `CORS_ORIGINS` only when the frontend runs from a different origin, for example:

```env
CORS_ORIGINS=http://localhost:3000,https://immich-gpt.example.com
```

## Logging

The app always logs to stdout.

If `/logs` exists inside the container, the backend also writes rotating logs to:

- `/logs/immich-gpt.log`

Mount a host path there if you want persistent log files.

## Health and API docs

Useful built-in endpoints:

- `/health`
- `/api/health`
- `/docs`
- `/redoc`

## Related guides

- Deployment details: [`../DOCKER.md`](../DOCKER.md)
- Reverse proxy setup: [`reverse-proxy.md`](reverse-proxy.md)
- Troubleshooting: [`troubleshooting.md`](troubleshooting.md)
