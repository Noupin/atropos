const STORAGE_KEY = 'atropos:device-hash'

const generateDeviceHash = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const getOrCreateDeviceHash = (): string => {
  if (typeof window === 'undefined') {
    throw new Error('Device hash is only available in renderer context.')
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && stored.trim().length > 0) {
      return stored
    }
  } catch (error) {
    console.warn('Unable to read stored device hash.', error)
  }

  const hash = generateDeviceHash()
  try {
    window.localStorage.setItem(STORAGE_KEY, hash)
  } catch (error) {
    console.warn('Unable to persist device hash.', error)
  }
  return hash
}
