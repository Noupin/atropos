# Bulk Video Upload Tool

This repository includes a minimal framework for bulk uploading short videos
with captions to multiple social platforms. The orchestrator script scans a
folder for video files and paired caption text files, normalises captions, and
then uploads the pairs to each enabled platform.
All core modules now live under the `server/` directory. For example:

```python
from common.env import load_env
```

## Setup

1. Create a `.env` file in the repository root with API secrets and a
   `TOKEN_FERNET_KEY` used to encrypt the token store. Each provider requires
   its own credentials:

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

2. Optional: create `upload_config.json` with non-secret identifiers such as
   page or channel IDs required by providers. See `upload_config.example.json`
   for the structure.

3. Place the videos and caption files in the folder specified by
   `UPLOAD_FOLDER` in `server/scripts/run_bulk_upload.py` (defaults to
   `upload_queue`). For each `video.mp4` provide a caption file named
   `video.txt` in the same directory.

## Running

Install dependencies from `requirements.txt` and run:

```bash
python -m server.scripts.run_bulk_upload
```

The script logs `PLAN`/`OK`/`ERR` lines and prints a summary of uploads
per platform.

### API Server

The processing pipeline can also be driven through a FastAPI service that
emits real-time progress updates over WebSockets. Start the server with:

```bash
uvicorn server.app:app --reload
```

Submit jobs via `POST /api/jobs` with JSON payloads containing the `url`,
optional `account`, and optional `tone`. Subscribe to
`ws://<host>/ws/jobs/<job_id>` to receive step-by-step events without polling.
Use `GET /api/jobs/<job_id>` for a simple completion status if needed.

## Docker Automation

`docker compose build uploader`
`docker compose up -d --force-recreate uploader`

To view logs after upping with -d
`docker compose logs -f uploader`

## Video Inventory

Check how many prepared videos are available for each account and the number of
days they will last given the current cron schedule:

```bash
python server/video_inventory.py
```

### Multiple Accounts

Place projects for different upload accounts under `out/<account>/<project>`.
When the upload scripts are run without an explicit account name, the account is
now inferred from this folder structure and the matching tokens are loaded from
`server/tokens/<account>`.

## Configuration Notes

- Window context overlap is set via `WINDOW_CONTEXT_PERCENTAGE` in `server/config.py` as a
  fraction of each window's duration.
- Legacy chunk-based LLM settings (`MAX_LLM_CHARS`, `LLM_API_TIMEOUT`, and related
  options) now live at the bottom of `server/config.py` and are deprecated.
- Candidate overlap enforcement can be toggled with `ENFORCE_NON_OVERLAP` in
  `server/config.py`.
- The render layout for generated shorts can be selected via `RENDER_LAYOUT` in
  `server/config.py`. Available options are `centered`, `centered_with_corners`,
  `no_zoom`, and `left_aligned`.
- Set `DELETE_UPLOADED_CLIPS` in `server/config.py` to automatically remove
  rendered clip files after successful uploads. The desktop upload controls can
  override this setting for individual clips when needed.

## Git Reversion

git reset --hard 1f1447a524813af10a18b2426d1674b227dc0bcb
git push --force-with-lease origin main
