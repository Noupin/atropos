# TikTok Autouploader

> **Warning**: This integration uses headless browser automation to post to
> TikTok. It may violate TikTok's platform terms and is provided only for local
> desktop use. Do not expose this feature in a multi-tenant or commercial SaaS
> setting.

This module wraps the [`tiktokautouploader`](https://pypi.org/project/tiktokautouploader/)
package so uploads can continue while our official API application is under
review.

## Usage

1. Install browser binaries supported by the library (Chromium, Chrome or Edge).
2. Set `TIKTOK_UPLOAD_BACKEND=autouploader` (default) and run the uploader as
   usual.
3. On first run the script will open a browser window and prompt you to log in.
   Cookies are saved to `server/tokens/tiktok_cookies.json` for future runs.

## Caveats

- The session relies on persisted cookies; if they expire you must log in again.
- CAPTCHA challenges require manual resolution.
- The first login is easiest on a local machine with a display; copy the cookies
  file into the mounted tokens directory when running in Docker.
