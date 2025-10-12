const VIEW_STATE_STORAGE_KEY = 'atropos:view-state'
const CURRENT_VERSION = 1

type Primitive = string | number | boolean | null | undefined

type JsonRecord = { [key: string]: Primitive | JsonRecord | JsonRecord[] }

export type LibraryViewState = {
  query: string
  collapsedAccountIds: string[]
  collapsedProjectIds: string[]
  selectedClipId: string | null
}

export type HomeViewState = {
  selectedAccountId: string | null
  selectedClipId: string | null
}

export type AppViewState = {
  version: number
  activePath: string
  library: LibraryViewState
  home: HomeViewState
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const normaliseStringArray = (value: string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (!seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

export const createDefaultLibraryViewState = (): LibraryViewState => ({
  query: '',
  collapsedAccountIds: [],
  collapsedProjectIds: [],
  selectedClipId: null
})

export const createDefaultHomeViewState = (): HomeViewState => ({
  selectedAccountId: null,
  selectedClipId: null
})

export const createDefaultViewState = (): AppViewState => ({
  version: CURRENT_VERSION,
  activePath: '/',
  library: createDefaultLibraryViewState(),
  home: createDefaultHomeViewState()
})

const sanitiseLibraryViewState = (value: unknown): LibraryViewState => {
  const defaults = createDefaultLibraryViewState()
  if (!value || typeof value !== 'object') {
    return defaults
  }
  const record = value as JsonRecord
  const query = typeof record.query === 'string' ? record.query : defaults.query
  const collapsedAccountIds = isStringArray(record.collapsedAccountIds)
    ? normaliseStringArray(record.collapsedAccountIds)
    : defaults.collapsedAccountIds
  const collapsedProjectIds = isStringArray(record.collapsedProjectIds)
    ? normaliseStringArray(record.collapsedProjectIds)
    : defaults.collapsedProjectIds
  const selectedClipId =
    typeof record.selectedClipId === 'string' && record.selectedClipId.length > 0
      ? record.selectedClipId
      : null

  return {
    query,
    collapsedAccountIds,
    collapsedProjectIds,
    selectedClipId
  }
}

const sanitiseHomeViewState = (value: unknown): HomeViewState => {
  const defaults = createDefaultHomeViewState()
  if (!value || typeof value !== 'object') {
    return defaults
  }
  const record = value as JsonRecord
  const selectedAccountId =
    typeof record.selectedAccountId === 'string' && record.selectedAccountId.length > 0
      ? record.selectedAccountId
      : null
  const selectedClipId =
    typeof record.selectedClipId === 'string' && record.selectedClipId.length > 0
      ? record.selectedClipId
      : null

  return {
    selectedAccountId,
    selectedClipId
  }
}

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return null
  }
  return window.localStorage
}

export const loadViewState = (): AppViewState | null => {
  const storage = getStorage()
  if (!storage) {
    return null
  }
  try {
    const raw = storage.getItem(VIEW_STATE_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as JsonRecord
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const version = typeof parsed.version === 'number' ? parsed.version : 0
    if (version !== CURRENT_VERSION) {
      return null
    }
    const activePath = typeof parsed.activePath === 'string' ? parsed.activePath : '/'
    return {
      version: CURRENT_VERSION,
      activePath,
      library: sanitiseLibraryViewState(parsed.library),
      home: sanitiseHomeViewState(parsed.home)
    }
  } catch (error) {
    console.warn('Unable to load persisted view state', error)
    storage.removeItem(VIEW_STATE_STORAGE_KEY)
    return null
  }
}

export const saveViewState = (state: AppViewState): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    const payload = JSON.stringify(state)
    storage.setItem(VIEW_STATE_STORAGE_KEY, payload)
  } catch (error) {
    console.warn('Unable to persist view state', error)
  }
}

export const resetViewState = (): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }
  storage.removeItem(VIEW_STATE_STORAGE_KEY)
}
