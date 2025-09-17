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

The renderer defaults to mocked pipeline data so you can explore the UI without
running the Python backend. To connect it to the real API, create a `.env`
file at the repository root (or export variables in your shell) with:

```env
VITE_BACKEND_MODE=api
VITE_API_BASE_URL=http://localhost:8000
```

`VITE_BACKEND_MODE=mock` restores the simulated pipeline. Adjust
`VITE_API_BASE_URL` if the FastAPI service is exposed on a different host or
port.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
