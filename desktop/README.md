# Atropos

Atropos is an Electron application with React and TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Backend integration

The renderer now targets the FastAPI backend by default. It assumes the API is
reachable on `http://127.0.0.1:8000` (or the hostname serving the UI, if
available) and gracefully falls back to that loopback address when the
application is packaged. Start the backend with:

```bash
uvicorn server.app:app --reload --host 127.0.0.1 --port 8000
```

If the service is listening on a different host or port, create a `.env` file
at the repository root (or export variables in your shell) to override the base
URL:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_BILLING_API_BASE_URL=https://dev.api.atropos-video.com
```

If not specified, the billing endpoints target `https://dev.api.atropos-video.com`
during development and `https://api.atropos-video.com` for packaged builds.
Override `VITE_BILLING_API_BASE_URL` when you need to point at a different
environment.

Set `VITE_BACKEND_MODE=mock` to explore the UI with simulated pipeline events
when the Python server is unavailable. Remove the variable (or set it to `api`)
to return to the live backend.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
