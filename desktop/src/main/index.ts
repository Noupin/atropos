import { app, shell, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { pathToFileURL } from 'url'
import icon from '../../resources/icon.png?asset'
import { listAccountClips, resolveAccountClipsDirectory } from './clipLibrary'

type NavigationCommand = 'back' | 'forward'

type NavigationState = {
  canGoBack: boolean
  canGoForward: boolean
}

const DEEP_LINK_SCHEME = 'atropos'

let mainWindow: BrowserWindow | null = null
let navigationState: NavigationState = { canGoBack: false, canGoForward: false }
let pendingDeepLinks: string[] = []

type RendererResolution = {
  candidates: string[]
  resolvedIndexPath: string | null
  resolvedRootPath: string | null
}

let rendererResolution: RendererResolution | null = null
let rendererMissingAlerted = false

const buildRendererCandidates = (): string[] => {
  const candidateBases = [
    join(__dirname, '../renderer'),
    join(__dirname, '../../renderer'),
    join(process.resourcesPath, 'app.asar', 'out', 'renderer'),
    join(process.resourcesPath, 'app.asar', 'renderer'),
    join(process.resourcesPath, 'app', 'out', 'renderer'),
    join(process.resourcesPath, 'out', 'renderer'),
    join(process.resourcesPath, 'renderer')
  ]

  if (app.isReady()) {
    const appPath = app.getAppPath()
    candidateBases.push(join(appPath, 'out', 'renderer'))
    candidateBases.push(join(appPath, 'renderer'))
  }

  const candidates = new Set<string>()
  for (const base of candidateBases) {
    candidates.add(join(base, 'index.html'))
  }

  return Array.from(candidates)
}

const resolveRendererPaths = (): RendererResolution => {
  const candidates = buildRendererCandidates()

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return {
          candidates,
          resolvedIndexPath: candidate,
          resolvedRootPath: dirname(candidate)
        }
      }
    } catch (error) {
      console.error('[renderer-load] failed to stat candidate', candidate, error)
    }
  }

  return {
    candidates,
    resolvedIndexPath: null,
    resolvedRootPath: null
  }
}

const notifyMissingRenderer = (candidates: string[]): void => {
  if (rendererMissingAlerted) {
    return
  }
  rendererMissingAlerted = true
  const message = ['Renderer bundle not found. Checked paths:']
    .concat(candidates)
    .join('\n • ')
  console.error('[renderer-load] renderer entry missing\n', message)
  if (app.isReady()) {
    dialog.showErrorBox('Renderer assets missing', message)
  }
}

const getRendererResolution = (): RendererResolution => {
  if (rendererResolution?.resolvedIndexPath && !existsSync(rendererResolution.resolvedIndexPath)) {
    rendererResolution = null
  }

  if (!rendererResolution) {
    rendererResolution = resolveRendererPaths()
  }

  return rendererResolution
}

const loadRenderer = async (window: BrowserWindow): Promise<void> => {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    console.info('[renderer-load] dev mode URL', devUrl)
    await window.loadURL(devUrl)
    return
  }

  const resolution = getRendererResolution()
  console.info('[renderer-load] __dirname', __dirname)
  console.info('[renderer-load] resourcesPath', process.resourcesPath)
  console.info('[renderer-load] candidate paths', resolution.candidates)

  if (resolution.resolvedIndexPath) {
    console.info('[renderer-load] resolved index path', resolution.resolvedIndexPath)
    const fileUrl = pathToFileURL(resolution.resolvedIndexPath).toString()
    console.info('[renderer-load] attempting file URL', fileUrl)
    try {
      await window.loadURL(fileUrl)
      console.info('[renderer-load] loaded renderer via file URL', fileUrl)
      return
    } catch (error) {
      console.error('[renderer-load] failed to load file URL', fileUrl, error)
    }
  } else {
    notifyMissingRenderer(resolution.candidates)
  }

  if (!resolution.resolvedRootPath) {
    notifyMissingRenderer(resolution.candidates)
  }

  const fallbackUrl = 'app://index.html'
  console.info('[renderer-load] falling back to app protocol', fallbackUrl)
  await window.loadURL(fallbackUrl)
  console.info('[renderer-load] loaded renderer via app protocol', fallbackUrl)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

const focusMainWindow = (): void => {
  if (!mainWindow) {
    return
  }
  if (mainWindow.isDestroyed()) {
    mainWindow = null
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }
  mainWindow.focus()
}

const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) {
  app.quit()
  process.exit(0)
}

const initialDeepLink = process.argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`))
if (initialDeepLink) {
  pendingDeepLinks.push(initialDeepLink)
}

const sendNavigationCommand = (direction: NavigationCommand): void => {
  if (!mainWindow) {
    return
  }

  mainWindow.webContents.send('navigation:command', direction)
}

const enqueueDeepLink = (url: string): void => {
  if (!url.startsWith(`${DEEP_LINK_SCHEME}://`)) {
    return
  }
  console.info('[deep-link] enqueue', url)
  if (mainWindow) {
    focusMainWindow()
    mainWindow.webContents.send('deep-link', url)
    return
  }
  pendingDeepLinks.push(url)
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
}

const flushPendingDeepLinks = (): void => {
  if (!mainWindow || pendingDeepLinks.length === 0) {
    return
  }
  focusMainWindow()
  for (const url of pendingDeepLinks) {
    mainWindow.webContents.send('deep-link', url)
  }
  pendingDeepLinks = []
}

app.on('second-instance', (_event, argv) => {
  console.info('[deep-link] second-instance event', {
    isReady: app.isReady(),
    hasWindow: Boolean(mainWindow)
  })
  if (mainWindow) {
    focusMainWindow()
  }
  const urlArg = argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`))
  if (urlArg) {
    console.info('[deep-link] second-instance url', urlArg)
    enqueueDeepLink(urlArg)
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  console.info('[deep-link] open-url event', url, {
    isReady: app.isReady(),
    hasWindow: Boolean(mainWindow)
  })
  enqueueDeepLink(url)
})

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    title: 'Atropos',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  navigationState = { canGoBack: false, canGoForward: false }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    flushPendingDeepLinks()
  })

  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') {
      if (navigationState.canGoBack) {
        sendNavigationCommand('back')
      }
      return
    }

    if (command === 'browser-forward') {
      if (navigationState.canGoForward) {
        sendNavigationCommand('forward')
      }
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'mouseDown') {
      return
    }

    const button = input.type === 'mouseDown' ? (input as { button?: string }).button : undefined

    if (input.code === 'BrowserBack' || button === 'back') {
      if (navigationState.canGoBack) {
        event.preventDefault()
        sendNavigationCommand('back')
      }
      return
    }

    if (input.code === 'BrowserForward' || button === 'forward') {
      if (navigationState.canGoForward) {
        event.preventDefault()
        sendNavigationCommand('forward')
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    flushPendingDeepLinks()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  void loadRenderer(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  app.setName('Atropos')
  electronApp.setAppUserModelId('com.atropos.app')

  if (!app.isPackaged) {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.on('navigation:state', (_event, state: NavigationState) => {
    navigationState = state
  })
  ipcMain.handle('clips:list', async (_event, accountId: string | null) => {
    try {
      return await listAccountClips(accountId)
    } catch (error) {
      console.error('Failed to list clips', error)
      return []
    }
  })
  ipcMain.handle('clips:open-folder', async (_event, accountId: string) => {
    try {
      const paths = await resolveAccountClipsDirectory(accountId)
      if (!paths) {
        return false
      }
      const result = await shell.openPath(paths.accountDir)
      if (typeof result === 'string' && result.length > 0) {
        console.error('Unable to open clips folder', result)
        return false
      }
      return true
    } catch (error) {
      console.error('Failed to open clips folder', error)
      return false
    }
  })

  if (!mainWindow) {
    const resolution = getRendererResolution()
    protocol.registerFileProtocol('app', (request, callback) => {
      const { resolvedRootPath } = getRendererResolution()
      const requestUrl = request.url.replace(/^app:\/\//, '')
      const [pathPart] = requestUrl.split('?')
      let decodedPath = pathPart
      try {
        decodedPath = decodeURIComponent(pathPart)
      } catch (error) {
        console.error('[renderer-load] failed to decode app:// path', pathPart, error)
      }
      const sanitized = decodedPath.replace(/^\/+/, '')
      const relativePath = sanitized.length === 0 ? 'index.html' : sanitized

      if (!resolvedRootPath) {
        notifyMissingRenderer(resolution.candidates)
        callback({ error: -6 })
        return
      }

      const filePath = join(resolvedRootPath, relativePath)
      callback(filePath)
    })
    console.info('[renderer-load] registered app:// protocol', {
      root: resolution.resolvedRootPath
    })
    createWindow()
  }

  app.on('activate', function () {
    if (mainWindow) {
      focusMainWindow()
      return
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
