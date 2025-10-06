import { session } from 'electron'

const configureTlsFallback = (): void => {
  const defaultSession = session.defaultSession

  if (!defaultSession) {
    return
  }

  try {
    defaultSession.setSSLConfig({
      minVersion: 'tls1.2',
      maxVersion: 'tls1.3',
      versionFallbackEnabled: true
    })
  } catch (error) {
    console.warn('Failed to configure TLS fallback for licensing requests.', error)
  }
}

export const initializeSecurity = (): void => {
  configureTlsFallback()
}

