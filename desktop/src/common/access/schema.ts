export type TrialRecord = {
  allowed: boolean
  remaining_runs: number
  started_at: string | null
}

export type AccessEnvelope = {
  trial: TrialRecord
  access: {
    active: boolean
  }
  consumed?: boolean
}

export const isTrialRecord = (value: unknown): value is TrialRecord => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Partial<TrialRecord>
  return (
    typeof record.allowed === 'boolean' &&
    typeof record.remaining_runs === 'number' &&
    Number.isFinite(record.remaining_runs) &&
    (record.started_at === null || typeof record.started_at === 'string')
  )
}

export const isAccessEnvelope = (value: unknown): value is AccessEnvelope => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const envelope = value as Partial<AccessEnvelope>
  if (!envelope.trial || typeof envelope.access !== 'object' || envelope.access === null) {
    return false
  }

  const active = (envelope.access as { active?: unknown }).active
  if (typeof active !== 'boolean') {
    return false
  }

  return isTrialRecord(envelope.trial)
}
