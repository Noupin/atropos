export interface TrialRecord {
  allowed: boolean
  remaining_runs: number
  started_at: string
}

export interface LicensingEnv {
  KV_LICENSE_NAMESPACE: {
    get(key: string): Promise<string | null>
    put(key: string, value: string): Promise<void>
  }
  TRIAL_MAX_PER_DEVICE?: string
}

const TRIAL_KEY_PREFIX = 'trial:'
const DEFAULT_TRIAL_RUNS = 3

const buildTrialKey = (deviceHash: string): string => `${TRIAL_KEY_PREFIX}${deviceHash}`

const isTrialRecord = (value: unknown): value is TrialRecord => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Partial<TrialRecord>
  return (
    typeof record.allowed === 'boolean' &&
    typeof record.remaining_runs === 'number' &&
    Number.isFinite(record.remaining_runs) &&
    record.remaining_runs >= 0 &&
    typeof record.started_at === 'string' &&
    record.started_at.length > 0
  )
}

export const readTrialRecord = async (
  env: LicensingEnv,
  deviceHash: string
): Promise<TrialRecord | null> => {
  const raw = await env.KV_LICENSE_NAMESPACE.get(buildTrialKey(deviceHash))
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (isTrialRecord(parsed)) {
      return parsed
    }
  } catch (error) {
    console.error('Failed to parse trial record', error)
  }

  return null
}

export const writeTrialRecord = async (
  env: LicensingEnv,
  deviceHash: string,
  record: TrialRecord
): Promise<void> => {
  await env.KV_LICENSE_NAMESPACE.put(buildTrialKey(deviceHash), JSON.stringify(record))
}

export const resolveTrialLimit = (env: LicensingEnv): number => {
  const raw = env.TRIAL_MAX_PER_DEVICE
  if (!raw) {
    return DEFAULT_TRIAL_RUNS
  }

  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_TRIAL_RUNS
  }

  return parsed
}
