export const formatConfigValue = (value: unknown): string => {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    try {
      return JSON.stringify(value)
    } catch (error) {
      return String(value)
    }
  }
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

export const countDecimalPlaces = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  const text = value.toString()
  if (!text.includes('.')) {
    return 0
  }
  return text.split('.')[1]?.length ?? 0
}

export const formatNumberForStep = (value: number, step: number): string => {
  if (!Number.isFinite(value)) {
    return ''
  }
  if (!Number.isFinite(step) || step <= 0) {
    return value.toString()
  }
  const decimals = countStepDecimals(step)
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString()
}

export const countStepDecimals = (step: number): number => {
  if (!Number.isFinite(step)) {
    return 0
  }
  const normalised = step.toString()
  if (normalised.includes('e')) {
    const [base, exponent] = normalised.split('e')
    const decimals = base.includes('.') ? base.split('.')[1].length : 0
    const exponentValue = Number.parseInt(exponent, 10)
    return Math.max(decimals - exponentValue, 0)
  }
  const [, fractional = ''] = normalised.split('.')
  return fractional.length
}

