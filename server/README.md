# Python Services

The Python codebase provides the ingestion, normalization, and upload pipeline that powers Atropos automation. It can be run directly via CLI scripts or through the FastAPI application consumed by the desktop client.

## Environment & configuration

Create a `.env` file at the repository root containing credentials and secrets. Minimum variables include:

```env
TOKEN_FERNET_KEY=base64-fernet-key-here
META_CLIENT_ID=...
META_CLIENT_SECRET=...
IG_BUSINESS_ID=...
FACEBOOK_PAGE_ID=...
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
SNAPCHAT_CLIENT_ID=...
SNAPCHAT_CLIENT_SECRET=...
SNAPCHAT_PROFILE_ID=...
X_CONSUMER_KEY=...
X_CONSUMER_SECRET=...
```

Additional non-secret identifiers (page/channel IDs, etc.) live in `upload_config.json` based on `upload_config.example.json`.

Key settings reside in `server/config.py`:

- `ENVIRONMENT` / `SERVER_ENV` – selects credential bundles and webhook hosts.
- `WINDOW_CONTEXT_PERCENTAGE` – window overlap as a fraction of duration.
- `RENDER_LAYOUT` – choose `centered`, `centered_with_corners`, `no_zoom`, or `left_aligned`.
- `DELETE_UPLOADED_CLIPS` – auto-delete rendered clips after successful uploads.
- Legacy LLM options (`MAX_LLM_CHARS`, etc.) remain for backward compatibility and are deprecated.

## Running the FastAPI service

```bash
uvicorn server.app:app --reload --host 127.0.0.1 --port 8787
```

The desktop app reads the API host from `VITE_API_BASE_URL`. In production, expose the service via a managed host (e.g., `https://api.atropos.dev`).

Routes are organized under `server/interfaces`. When adding a new route, create a module (e.g., `server/interfaces/jobs.py`) that exports a FastAPI `router` and include it in `server/app.py`.

## Bulk upload CLI workflow

The orchestration scripts scan a folder for video/caption pairs and upload them to enabled platforms.

1. Place media in the folder referenced by `UPLOAD_FOLDER` (default `upload_queue`). Each `video.mp4` should have a `video.txt` caption.
2. Run `python -m server.scripts.run_bulk_upload` to process the queue. Logs include `PLAN`/`OK`/`ERR` entries per platform.
3. Use `python server/video_inventory.py` to view inventory levels per account and forecast runout dates.
4. For scheduled uploads, run `python server/schedule_upload.py` or the appropriate automation script.

Multiple account support expects the structure `out/<account>/<project>`. Tokens load from `server/tokens/<account>` when an explicit account is not provided.

## Desktop integration

- `server/app.py` exposes REST and websocket endpoints for job management.
- Real-time progress updates stream over `ws://<host>/ws/jobs/<job_id>`.
- Jobs can also be polled via `GET /api/jobs/<job_id>` for completion status.
- Library clients can request paginated clips via `GET /api/clips?accountId=<id>&limit=<n>&cursor=<token>`.

## Extending services

- Add provider integrations under `server/integrations/<provider>.py` and register them with the pipeline orchestrator.
- Place shared utilities under `server/common/<topic>` with unit tests.
- Update or add ADRs when altering core pipeline behavior, provider support, or environment handling.
