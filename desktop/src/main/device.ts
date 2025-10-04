import { createHash } from 'crypto'
import os from 'os'

let cachedHash: string | null = null

const buildDeviceSignature = (): string => {
  const parts: string[] = []
  parts.push(os.hostname())
  parts.push(os.platform())
  parts.push(os.arch())
  parts.push(os.release())
  parts.push(String(os.totalmem()))

  try {
    const cpus = os.cpus()
    if (cpus && cpus.length > 0) {
      parts.push(String(cpus.length))
      parts.push(cpus[0]?.model ?? '')
    }
  } catch (error) {
    console.warn('Unable to read CPU information for device fingerprint.', error)
  }

  try {
    const network = os.networkInterfaces()
    const interfaceKeys = Object.keys(network).sort()
    interfaceKeys.forEach((key) => {
      const addresses = network[key]
      if (!addresses) {
        return
      }
      addresses.forEach((address) => {
        if (address.mac && address.mac !== '00:00:00:00:00:00') {
          parts.push(address.mac)
        }
      })
    })
  } catch (error) {
    console.warn('Unable to read network information for device fingerprint.', error)
  }

  return parts.join('::')
}

export const getDeviceHash = (): string => {
  if (cachedHash) {
    return cachedHash
  }

  const signature = buildDeviceSignature()
  const hash = createHash('sha256').update(signature).digest('hex')
  cachedHash = hash
  return hash
}
