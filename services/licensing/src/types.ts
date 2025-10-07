export interface TrialInfo {
  totalRuns: number
  remainingRuns: number
  startedAt: string
}

export interface TransferInfo {
  email: string
  token: string
  expiresAt: string
}

export interface DeviceRecord {
  trial: TrialInfo
  transfer?: TransferInfo
}

export interface Env {
  LICENSING_KV: KVNamespace
}

export interface TrialStatusResponse {
  totalRuns: number
  remainingRuns: number
  isTrialAllowed: boolean
}
