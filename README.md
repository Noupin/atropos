# Bulk Video Upload Tool

This repository includes a minimal framework for bulk uploading short videos
with captions to multiple social platforms. The orchestrator script scans a
folder for video files and paired caption text files, normalizes captions, and
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

## Docker Automation

`docker compose build uploader`
`docker compose up -d --force-recreate uploader`

To view logs after upping with -d
`docker compose logs -f uploader`

## TikTok backend

TikTok uploads use a browser automation path by default. Set
`TIKTOK_UPLOAD_BACKEND=api` to use the official API instead. Browser uploads rely
on persisted cookies stored in `server/tokens/tiktok_cookies.json` and are
controlled via additional `TIKTOK_AUTO_*` environment variables (see
`server/config.py` for defaults).
