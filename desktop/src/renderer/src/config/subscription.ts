const DEFAULT_SUBSCRIPTION_URL = 'https://atropos-video.com/subscribe'

const normaliseUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(candidate)
    url.hash = ''
    return url.toString()
  } catch (error) {
    return null
  }
}

const resolvedSubscriptionUrl =
  normaliseUrl(import.meta.env.VITE_SUBSCRIPTION_URL) ?? DEFAULT_SUBSCRIPTION_URL

export const getSubscriptionUrl = (): string => resolvedSubscriptionUrl
