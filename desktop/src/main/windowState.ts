import { app, BrowserWindow, screen } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import type { Display, Rectangle } from 'electron'

const WINDOW_STATE_FILE = 'window-state.json'

export const DEFAULT_WINDOW_BOUNDS: Pick<Rectangle, 'width' | 'height'> = {
  width: 900,
  height: 670
}

type StoredWindowState = {
  bounds?: Partial<Rectangle> | null
  isMaximized?: boolean
}

type LoadedWindowState = {
  bounds: Rectangle | null
  isMaximized: boolean
}

const getWindowStatePath = (): string => resolve(app.getPath('userData'), WINDOW_STATE_FILE)

const intersects = (rect: Rectangle, area: Rectangle): boolean => {
  const rectRight = rect.x + rect.width
  const rectBottom = rect.y + rect.height
  const areaRight = area.x + area.width
  const areaBottom = area.y + area.height

  return rectRight > area.x && rect.x < areaRight && rectBottom > area.y && rect.y < areaBottom
}

const sanitizeNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }
  return Math.round(value)
}

const sanitizeDimension = (value: unknown): number | null => {
  const sanitized = sanitizeNumber(value)
  if (sanitized === null || sanitized <= 0) {
    return null
  }
  return sanitized
}

const resolveDisplayArea = (display: Display): Rectangle => {
  return display.workArea ?? display.bounds
}

const sanitizeBounds = (
  bounds: Partial<Rectangle> | null | undefined,
  displays: Display[]
): Rectangle | null => {
  if (!bounds) {
    return null
  }

  const width = sanitizeDimension(bounds.width)
  const height = sanitizeDimension(bounds.height)
  const x = sanitizeNumber(bounds.x)
  const y = sanitizeNumber(bounds.y)

  if (width === null || height === null || x === null || y === null) {
    return null
  }

  const candidate: Rectangle = { x, y, width, height }

  if (displays.length === 0) {
    return candidate
  }

  for (const display of displays) {
    const area = resolveDisplayArea(display)
    if (intersects(candidate, area)) {
      return candidate
    }
  }

  return null
}

const readStoredWindowState = (): StoredWindowState | null => {
  try {
    const raw = readFileSync(getWindowStatePath(), 'utf-8')
    const parsed = JSON.parse(raw) as StoredWindowState
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[window-state] failed to read window state', error)
    }
    return null
  }
}

export const loadWindowState = (): LoadedWindowState => {
  const stored = readStoredWindowState()
  const displays = screen.getAllDisplays()
  const bounds = sanitizeBounds(stored?.bounds ?? null, displays)

  return {
    bounds,
    isMaximized: Boolean(stored?.isMaximized)
  }
}

const writeWindowState = (state: LoadedWindowState): void => {
  try {
    writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf-8')
  } catch (error) {
    console.error('[window-state] failed to save window state', error)
  }
}

const captureWindowState = (window: BrowserWindow): LoadedWindowState | null => {
  if (window.isDestroyed()) {
    return null
  }

  const displays = screen.getAllDisplays()
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  const sanitizedBounds = sanitizeBounds(bounds, displays)

  if (!sanitizedBounds) {
    return null
  }

  return {
    bounds: sanitizedBounds,
    isMaximized: window.isMaximized()
  }
}

const persistWindowState = (window: BrowserWindow): void => {
  const state = captureWindowState(window)
  if (!state) {
    return
  }
  writeWindowState(state)
}

export const trackWindowState = (window: BrowserWindow): void => {
  let pendingSave: NodeJS.Timeout | null = null

  const scheduleSave = (): void => {
    if (window.isDestroyed()) {
      return
    }
    if (pendingSave) {
      clearTimeout(pendingSave)
    }
    pendingSave = setTimeout(() => {
      pendingSave = null
      persistWindowState(window)
    }, 250)
  }

  const immediateSave = (): void => {
    if (pendingSave) {
      clearTimeout(pendingSave)
      pendingSave = null
    }
    persistWindowState(window)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', immediateSave)
  window.on('unmaximize', scheduleSave)
  window.on('restore', scheduleSave)
  window.on('close', immediateSave)
  window.on('closed', () => {
    if (pendingSave) {
      clearTimeout(pendingSave)
      pendingSave = null
    }
  })
}

export const __testing = {
  intersects,
  sanitizeBounds
}
