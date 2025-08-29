# Bulk Video Upload Tool

This repository includes a minimal framework for bulk uploading short videos
with captions to multiple social platforms. The orchestrator script scans a
folder for video files and paired caption text files, normalises captions, and
then uploads the pairs to each enabled platform.

## Setup

1. Create a ``.env`` file in the repository root with API secrets and a
   ``TOKEN_FERNET_KEY`` used to encrypt the token store. Each provider requires
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

2. Optional: create ``upload_config.json`` with non-secret identifiers such as
   page or channel IDs required by providers. See ``upload_config.example.json``
   for the structure.

3. Place the videos and caption files in the folder specified by
   ``UPLOAD_FOLDER`` in ``scripts/run_bulk_upload.py`` (defaults to
   ``upload_queue``). For each ``video.mp4`` provide a caption file named
   ``video_description.txt`` or ``video.txt`` in the same directory.

## Running

Install dependencies from ``requirements.txt`` and run:

```bash
python scripts/run_bulk_upload.py
```

The script logs ``PLAN``/``OK``/``ERR`` lines and prints a summary of uploads
per platform.

