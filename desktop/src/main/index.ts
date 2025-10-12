import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { listAccountClips, resolveAccountClipsDirectory } from './clipLibrary'

type NavigationCommand = 'back' | 'forward'

type NavigationState = {
  canGoBack: boolean
  canGoForward: boolean
}

const DEEP_LINK_SCHEME = 'atropos'

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
let navigationState: NavigationState = { canGoBack: false, canGoForward: false }
const pendingDeepLinks: string[] = []
let hasMainWindowLoaded = false

const getDeepLinkFromArgv = (argv: string[]): string | undefined => {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const value = argv[index]
    if (value.startsWith(`${DEEP_LINK_SCHEME}://`)) {
      return value
    }
  }
  return undefined
}

const initialDeepLink = getDeepLinkFromArgv(process.argv)
if (initialDeepLink) {
  pendingDeepLinks.push(initialDeepLink)
}

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

const sendNavigationCommand = (direction: NavigationCommand): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('navigation:command', direction)
}

const enqueueDeepLink = (url: string): void => {
  if (!url.startsWith(`${DEEP_LINK_SCHEME}://`)) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed() || !hasMainWindowLoaded) {
    pendingDeepLinks.push(url)
    return
  }

  focusMainWindow()
  mainWindow.webContents.send('deeplink', url)
}

const flushPendingDeepLinks = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || pendingDeepLinks.length === 0) {
    return
  }

  focusMainWindow()
  const queuedUrls = pendingDeepLinks.splice(0, pendingDeepLinks.length)
  for (const url of queuedUrls) {
    mainWindow.webContents.send('deeplink', url)
  }
}

const ensureDefaultProtocolClient = (): void => {
  if (app.isDefaultProtocolClient(DEEP_LINK_SCHEME)) {
    return
  }

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1])])
    }
    return
  }

  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
}

app.on('second-instance', (event, argv) => {
  event.preventDefault()
  focusMainWindow()
  const deepLink = getDeepLinkFromArgv(argv)
  if (deepLink) {
    enqueueDeepLink(deepLink)
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  enqueueDeepLink(url)
})

const createMainWindow = (): BrowserWindow => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

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
  hasMainWindowLoaded = false

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    focusMainWindow()
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
    hasMainWindowLoaded = true
    flushPendingDeepLinks()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    hasMainWindowLoaded = false
  })

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  app.setName('Atropos')
  electronApp.setAppUserModelId('com.atropos.app')

  ensureDefaultProtocolClient()

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

  createMainWindow()

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
      return
    }

    focusMainWindow()
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
