import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { listAccountClips, resolveAccountClipsDirectory } from './clipLibrary'
import { registerDeepLinks } from './deeplink'
import { getDeviceHash, getDeviceId, getDeviceIdentityChannel } from '../lib/deviceId'

type NavigationCommand = 'back' | 'forward'

type NavigationState = {
  canGoBack: boolean
  canGoForward: boolean
}

let mainWindow: BrowserWindow | null = null
let navigationState: NavigationState = { canGoBack: false, canGoForward: false }

const sendNavigationCommand = (direction: NavigationCommand): void => {
  if (!mainWindow) {
    return
  }

  mainWindow.webContents.send('navigation:command', direction)
}

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

    if (input.code === 'BrowserBack' || input.button === 'back') {
      if (navigationState.canGoBack) {
        event.preventDefault()
        sendNavigationCommand('back')
      }
      return
    }

    if (input.code === 'BrowserForward' || input.button === 'forward') {
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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

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
  ipcMain.on(getDeviceIdentityChannel(), (event) => {
    try {
      const deviceId = getDeviceId()
      const deviceHash = getDeviceHash()
      event.returnValue = { deviceId, deviceHash }
    } catch (error) {
      console.error('Failed to resolve device identity', error)
      event.returnValue = {
        deviceId: '',
        deviceHash: ''
      }
    }
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

  createWindow()

  registerDeepLinks()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
