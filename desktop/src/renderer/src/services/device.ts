export const getDeviceHash = async (): Promise<string> => {
  if (typeof window === 'undefined') {
    throw new Error('Device hash is not available in this environment.')
  }

  if (!window.api || typeof window.api.getDeviceHash !== 'function') {
    throw new Error('Device hash bridge is unavailable.')
  }

  const hash = await window.api.getDeviceHash()
  if (typeof hash !== 'string' || hash.trim().length === 0) {
    throw new Error('Received an invalid device hash from the main process.')
  }

  return hash
}
