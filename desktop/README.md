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

The renderer now targets the FastAPI backend by default. If the service is
listening on a different host or port, create a `.env` file at the repository
root (or export variables in your shell) to override the base URL:

```env
VITE_API_BASE_URL=http://localhost:8000
```

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
