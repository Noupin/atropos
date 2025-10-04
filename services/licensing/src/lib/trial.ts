import { LicensingEnv, TrialRecord, readTrialRecord, resolveTrialLimit, writeTrialRecord } from './kv'

const nowIsoString = (): string => new Date().toISOString()

export const ensureTrialRecord = async (
  env: LicensingEnv,
  deviceHash: string
): Promise<TrialRecord> => {
  const existing = await readTrialRecord(env, deviceHash)
  if (existing) {
    return existing
  }

  const limit = resolveTrialLimit(env)
  const fresh: TrialRecord = {
    allowed: limit > 0,
    remaining_runs: limit,
    started_at: nowIsoString()
  }

  await writeTrialRecord(env, deviceHash, fresh)
  return fresh
}

export const consumeTrialRun = async (
  env: LicensingEnv,
  deviceHash: string
): Promise<{ record: TrialRecord; consumed: boolean }> => {
  const current = await ensureTrialRecord(env, deviceHash)
  if (!current.allowed || current.remaining_runs <= 0) {
    if (current.allowed && current.remaining_runs <= 0) {
      const exhausted: TrialRecord = {
        ...current,
        allowed: false,
        remaining_runs: 0
      }
      await writeTrialRecord(env, deviceHash, exhausted)
      return { record: exhausted, consumed: false }
    }
    return { record: current, consumed: false }
  }

  const nextRemaining = Math.max(0, current.remaining_runs - 1)
  const nextRecord: TrialRecord = {
    ...current,
    remaining_runs: nextRemaining,
    allowed: nextRemaining > 0
  }

  await writeTrialRecord(env, deviceHash, nextRecord)
  return { record: nextRecord, consumed: true }
}

export const toClientTrialPayload = (record: TrialRecord): TrialRecord => ({
  allowed: record.allowed,
  remaining_runs: record.remaining_runs,
  started_at: record.started_at
})
