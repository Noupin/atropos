import type { AccessEnvelope } from '../../../common/access/schema'

type AccessBridge = {
  fetchAccessStatus(deviceHash: string): Promise<AccessEnvelope>
  consumeTrialCredit(deviceHash: string): Promise<AccessEnvelope>
}

const accessError = () =>
  new Error('The licensing bridge is unavailable in the current desktop session.')

const getAccessBridge = (): AccessBridge => {
  if (typeof window === 'undefined') {
    throw accessError()
  }

  const api = window.api as Partial<AccessBridge> | undefined
  if (
    !api ||
    typeof api.fetchAccessStatus !== 'function' ||
    typeof api.consumeTrialCredit !== 'function'
  ) {
    throw accessError()
  }

  return {
    fetchAccessStatus: api.fetchAccessStatus.bind(window.api),
    consumeTrialCredit: api.consumeTrialCredit.bind(window.api)
  }
}

export const fetchAccessStatus = async (deviceHash: string): Promise<AccessEnvelope> => {
  const bridge = getAccessBridge()
  return await bridge.fetchAccessStatus(deviceHash)
}

export const consumeTrialCredit = async (deviceHash: string): Promise<AccessEnvelope> => {
  const bridge = getAccessBridge()
  return await bridge.consumeTrialCredit(deviceHash)
}
