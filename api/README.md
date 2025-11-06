# Atropos API service

The `api/` package exposes the lightweight Flask application that powers the
marketing site subscription form and the optional social-metric scrape
fallbacks.

## Run the API locally

1. Create (and activate) a Python 3.11 virtual environment.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Start the Flask development server on a local port (default `5001`):

   ```bash
   FLASK_APP=api.app:app FLASK_RUN_PORT=5001 flask run --reload
   ```

   The server listens on `http://127.0.0.1:5001` by default. Adjust
   `FLASK_RUN_PORT` if that port is in use.

   When `/data` isn't writable (common on macOS), the app automatically falls
   back to storing subscriber data under `api/.localdata/`. Set
   `SUBSCRIBERS_FILE` or `UNSUB_TOKENS_FILE` to point at explicit storage
   locations if you need to override the defaults.

## Hooking up the marketing site

When developing the static site under `web/`, set
`localApiBaseUrl` in your `web/js/social.config.js` file to point at the
running Flask server:

```js
window.atroposSocialConfig = {
  localApiBaseUrl: "http://127.0.0.1:5001",
  // ... platform configuration ...
};
```

The social metrics loader only uses the scrape fallback when the page is loaded
from a local hostname (e.g., `127.0.0.1`, `localhost`, `*.local`, or the
`file://` protocol). Remote builds continue to rely solely on the official
platform APIs.
