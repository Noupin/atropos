import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import {
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  type AccessCheckResult,
  type AccountPlatformConnection,
  type AccountSummary,
  type AuthPingSummary,
  type SearchBridge,
  type SubscriptionLifecycleStatus,
  type SubscriptionStatus,
  type SupportedPlatform
} from '../types'
import { TONE_LABELS, TONE_OPTIONS } from '../constants/tone'
import { timeAgo } from '../lib/format'
import MarbleSelect from '../components/MarbleSelect'
import {
  createBillingPortalSession,
  createCheckoutSession,
  fetchSubscriptionStatus,
  claimTrialRender,
  startTrial
} from '../services/paymentsApi'
import {
  getAccessControlConfig,
  getStoredTrialToken,
  setStoredTrialToken,
  TRIAL_UPDATE_EVENT,
  getDeviceHash,
  getTrialUsageState,
  type TrialTokenCacheEntry
} from '../services/accessControl'

const PLATFORM_TOKEN_FILES: Record<SupportedPlatform, string> = {
  tiktok: 'tiktok.json',
  youtube: 'youtube.json',
  instagram: 'instagram_session.json'
}

const MISSING_BILLING_EMAIL_ERROR =
  'A billing email address is required before starting checkout.'

const normalizeBillingError = (value: string): string => {
  const message = value.trim()

  if (message.length === 0) {
    return 'Billing details are currently unavailable. Refresh to try again.'
  }

  if (message.toLowerCase() === 'not found') {
    return 'No Stripe subscription is linked to this account yet. Start a subscription below to unlock access.'
  }

  const hasTerminalPunctuation = /[.!?]$/.test(message)
  const suffix = hasTerminalPunctuation ? '' : '.'

  return `${message}${suffix} Try refreshing or update your billing information below.`
}

const PORTAL_ELIGIBLE_STATUSES = new Set<SubscriptionLifecycleStatus>([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused'
])

const SUBSCRIPTION_REFRESH_EVENT = 'atropos:refresh-subscription'

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return '—'
  }
  try {
    const date = new Date(value)
    return `${date.toLocaleString()} (${timeAgo(value)})`
  } catch (error) {
    return value
  }
}

type ProfileProps = {
  registerSearch: (bridge: SearchBridge | null) => void
  accounts: AccountSummary[]
  accountsError: string | null
  authStatus: AuthPingSummary | null
  authError: string | null
  accessStatus: AccessCheckResult | null
  accessError: string | null
  isCheckingAccess: boolean
  isLoadingAccounts: boolean
  onCreateAccount: (payload: {
    displayName: string
    description?: string | null
  }) => Promise<AccountSummary>
  onAddPlatform: (
    accountId: string,
    payload: {
      platform: SupportedPlatform
      label?: string | null
      credentials?: Record<string, unknown>
    }
  ) => Promise<AccountSummary>
  onUpdateAccount: (
    accountId: string,
    payload: { active?: boolean; tone?: string | null }
  ) => Promise<AccountSummary>
  onDeleteAccount: (accountId: string) => Promise<void>
  onUpdatePlatform: (
    accountId: string,
    platform: SupportedPlatform,
    payload: { active?: boolean }
  ) => Promise<AccountSummary>
  onDeletePlatform: (accountId: string, platform: SupportedPlatform) => Promise<AccountSummary>
  onRefreshAccounts: () => Promise<void>
  onRefreshAccessStatus: () => Promise<void>
}

type AccountCardProps = {
  account: AccountSummary
  onAddPlatform: ProfileProps['onAddPlatform']
  onUpdateAccount: ProfileProps['onUpdateAccount']
  onDeleteAccount: ProfileProps['onDeleteAccount']
  onUpdatePlatform: ProfileProps['onUpdatePlatform']
  onDeletePlatform: ProfileProps['onDeletePlatform']
}

const authStatusStyles: Record<string, { pill: string; dot: string }> = {
  ok: {
    pill: 'status-pill status-pill--success',
    dot: 'status-pill__dot status-pill__dot--success'
  },
  degraded: {
    pill: 'status-pill status-pill--warning',
    dot: 'status-pill__dot status-pill__dot--warning'
  },
  disabled: {
    pill: 'status-pill status-pill--neutral',
    dot: 'status-pill__dot status-pill__dot--muted'
  }
}

const platformStatusStyles: Record<string, { pill: string; dot: string }> = {
  active: {
    pill: 'status-pill status-pill--success',
    dot: 'status-pill__dot status-pill__dot--success'
  },
  disconnected: {
    pill: 'status-pill status-pill--error',
    dot: 'status-pill__dot status-pill__dot--error'
  },
  disabled: {
    pill: 'status-pill status-pill--neutral',
    dot: 'status-pill__dot status-pill__dot--muted'
  }
}

const accessBadgeVariants: Record<string, { pill: string; dot: string }> = {
  success: {
    pill: 'status-pill status-pill--success',
    dot: 'status-pill__dot status-pill__dot--success'
  },
  warning: {
    pill: 'status-pill status-pill--warning',
    dot: 'status-pill__dot status-pill__dot--warning'
  },
  error: {
    pill: 'status-pill status-pill--error',
    dot: 'status-pill__dot status-pill__dot--error'
  },
  neutral: {
    pill: 'status-pill status-pill--neutral',
    dot: 'status-pill__dot status-pill__dot--muted'
  }
}

const AccountCard: FC<AccountCardProps> = ({
  account,
  onAddPlatform,
  onUpdateAccount,
  onDeleteAccount,
  onUpdatePlatform,
  onDeletePlatform
}) => {
  const [selectedPlatform, setSelectedPlatform] = useState<SupportedPlatform | ''>('')
  const [label, setLabel] = useState('')
  const [instagramUsername, setInstagramUsername] = useState('')
  const [instagramPassword, setInstagramPassword] = useState('')
  const [tiktokClientKey, setTiktokClientKey] = useState('')
  const [tiktokClientSecret, setTiktokClientSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTogglingAccount, setIsTogglingAccount] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [isUpdatingTone, setIsUpdatingTone] = useState(false)
  const [updatingPlatform, setUpdatingPlatform] = useState<SupportedPlatform | null>(null)
  const [removingPlatform, setRemovingPlatform] = useState<SupportedPlatform | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [isAddPlatformOpen, setIsAddPlatformOpen] = useState(false)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const isAccountActive = account.active

  const toneSelectOptions = useMemo(
    () => [
      { value: '', label: 'Use default tone' },
      ...TONE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
    ],
    []
  )

  const toneSelectValue = account.tone ?? ''
  const effectiveToneLabel = account.effectiveTone
    ? TONE_LABELS[account.effectiveTone] ?? account.effectiveTone
    : 'Default'
  const overrideToneLabel = account.tone ? TONE_LABELS[account.tone] ?? account.tone : null
  const toneBadgeTitle = account.tone
    ? 'Account-specific tone override'
    : 'Using the global clip tone'

  const availablePlatforms = useMemo(
    () =>
      SUPPORTED_PLATFORMS.filter(
        (platform) => !account.platforms.some((item) => item.platform === platform)
      ),
    [account.platforms]
  )

  const platformOptions = useMemo(
    () => availablePlatforms.map((platform) => ({ value: platform, label: PLATFORM_LABELS[platform] })),
    [availablePlatforms]
  )

  const resetCredentialFields = useCallback(() => {
    setInstagramUsername('')
    setInstagramPassword('')
    setTiktokClientKey('')
    setTiktokClientSecret('')
  }, [])

  useEffect(() => {
    setSuccess(null)
    setError(null)
  }, [account.platforms.length, account.active, account.tone])

  useEffect(() => {
    if (availablePlatforms.length === 0) {
      setIsAddPlatformOpen(false)
      setSelectedPlatform('')
      setLabel('')
      resetCredentialFields()
    }
  }, [availablePlatforms.length, resetCredentialFields])

  const detailsId = `account-${account.id}-details`
  const addPlatformFormId = `account-${account.id}-add-platform`

  const handlePlatformChange = useCallback(
    (nextValue: string) => {
      setSelectedPlatform((nextValue as SupportedPlatform) || '')
      setError(null)
      setSuccess(null)
      resetCredentialFields()
    },
    [resetCredentialFields, setError, setSuccess]
  )

  const handleToggleAddPlatform = useCallback(() => {
    setError(null)
    setSuccess(null)
    setIsAddPlatformOpen((previous) => {
      if (previous) {
        setSelectedPlatform('')
        setLabel('')
        resetCredentialFields()
      }
      return !previous
    })
  }, [resetCredentialFields, setError, setLabel, setSelectedPlatform, setSuccess])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!selectedPlatform) {
        setError('Select a platform to connect.')
        return
      }

      const trimmedLabel = label.trim()
      let payloadCredentials: Record<string, unknown> | undefined

      if (selectedPlatform === 'instagram') {
        const username = instagramUsername.trim()
        const password = instagramPassword.trim()
        if (!username || !password) {
          setError('Enter your Instagram username and password.')
          return
        }
        payloadCredentials = { username, password }
      } else if (selectedPlatform === 'tiktok') {
        payloadCredentials = {}
        if (tiktokClientKey.trim().length > 0) {
          payloadCredentials.clientKey = tiktokClientKey.trim()
        }
        if (tiktokClientSecret.trim().length > 0) {
          payloadCredentials.clientSecret = tiktokClientSecret.trim()
        }
      } else {
        payloadCredentials = {}
      }

      setIsSubmitting(true)
      setError(null)
      setSuccess(null)
      try {
        await onAddPlatform(account.id, {
          platform: selectedPlatform,
          label: trimmedLabel.length > 0 ? trimmedLabel : undefined,
          credentials: payloadCredentials
        })
        if (isMounted.current) {
          const platformName = PLATFORM_LABELS[selectedPlatform]
          setSuccess(`${platformName} connected successfully.`)
          setSelectedPlatform('')
          setLabel('')
          resetCredentialFields()
          setIsAddPlatformOpen(false)
        }
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : 'Unable to connect this platform. Please try again.'
        if (isMounted.current) {
          setError(message)
        }
      } finally {
        if (isMounted.current) {
          setIsSubmitting(false)
        }
      }
    },
    [
      account.id,
      instagramPassword,
      instagramUsername,
      label,
      onAddPlatform,
      resetCredentialFields,
      selectedPlatform,
      tiktokClientKey,
      tiktokClientSecret
    ]
  )

  const handleToggleAccountActive = useCallback(async () => {
    setError(null)
    setSuccess(null)
    setIsTogglingAccount(true)
    try {
      const updated = await onUpdateAccount(account.id, { active: !account.active })
      if (isMounted.current) {
        setSuccess(
          updated.active ? 'Account enabled successfully.' : 'Account disabled successfully.'
        )
      }
    } catch (toggleError) {
      const message =
        toggleError instanceof Error
          ? toggleError.message
          : 'Unable to update the account. Please try again.'
      if (isMounted.current) {
        setError(message)
      }
    } finally {
      if (isMounted.current) {
        setIsTogglingAccount(false)
      }
    }
  }, [account.active, account.id, onUpdateAccount])

  const handleDeleteAccount = useCallback(async () => {
    const confirmed = window.confirm(
      `Remove ${account.displayName}? This will delete all saved credentials for the account.`
    )
    if (!confirmed) {
      return
    }
    setError(null)
    setSuccess(null)
    setIsDeletingAccount(true)
    try {
      await onDeleteAccount(account.id)
    } catch (deleteError) {
      const message =
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to remove the account. Please try again.'
      if (isMounted.current) {
        setError(message)
      }
    } finally {
      if (isMounted.current) {
        setIsDeletingAccount(false)
      }
    }
  }, [account.displayName, account.id, onDeleteAccount])

  const handleToneChange = useCallback(
    async (nextValue: string) => {
      const normalised = nextValue === '' ? null : nextValue
      const current = account.tone ?? null
      if (normalised === current) {
        return
      }

      setError(null)
      setSuccess(null)
      setIsUpdatingTone(true)
      try {
        const updated = await onUpdateAccount(account.id, { tone: normalised })
        if (isMounted.current) {
          const updatedLabel = updated.tone
            ? TONE_LABELS[updated.tone] ?? updated.tone
            : null
          setSuccess(
            updatedLabel
              ? `Tone set to ${updatedLabel}.`
              : 'Tone override cleared. Using the default setting.'
          )
        }
      } catch (toneError) {
        const message =
          toneError instanceof Error
            ? toneError.message
            : 'Unable to update the tone. Please try again.'
        if (isMounted.current) {
          setError(message)
        }
      } finally {
        if (isMounted.current) {
          setIsUpdatingTone(false)
        }
      }
    },
    [account.id, account.tone, onUpdateAccount]
  )

  const handleTogglePlatformActive = useCallback(
    async (platformId: SupportedPlatform, nextActive: boolean) => {
      setError(null)
      setSuccess(null)
      setUpdatingPlatform(platformId)
      try {
        const updated = await onUpdatePlatform(account.id, platformId, { active: nextActive })
        if (isMounted.current) {
          const platformName = PLATFORM_LABELS[platformId]
          setSuccess(
            nextActive
              ? `${platformName} enabled successfully.`
              : `${platformName} disabled successfully.`
          )
        }
        return updated
      } catch (updateError) {
        const message =
          updateError instanceof Error
            ? updateError.message
            : 'Unable to update the platform. Please try again.'
        if (isMounted.current) {
          setError(message)
        }
        return null
      } finally {
        if (isMounted.current) {
          setUpdatingPlatform(null)
        }
      }
    },
    [account.id, onUpdatePlatform]
  )

  const handleRemovePlatform = useCallback(
    async (platformId: SupportedPlatform) => {
      const platformName = PLATFORM_LABELS[platformId]
      const confirmed = window.confirm(
        `Remove ${platformName}? This will delete saved credentials for the platform.`
      )
      if (!confirmed) {
        return
      }
      setError(null)
      setSuccess(null)
      setRemovingPlatform(platformId)
      try {
        await onDeletePlatform(account.id, platformId)
        if (isMounted.current) {
          setSuccess(`${platformName} removed successfully.`)
        }
      } catch (removeError) {
        const message =
          removeError instanceof Error
            ? removeError.message
            : 'Unable to remove the platform. Please try again.'
        if (isMounted.current) {
          setError(message)
        }
      } finally {
        if (isMounted.current) {
          setRemovingPlatform(null)
        }
      }
    },
    [account.id, onDeletePlatform]
  )

  const renderStatusTag = (platform: AccountPlatformConnection) => {
    const isPlatformActive = platform.active
    const labelText = !isPlatformActive
      ? 'Disabled'
      : platform.connected
        ? 'Authenticated'
        : 'Needs attention'
    const variant = !isPlatformActive
      ? platformStatusStyles.disabled
      : platform.connected
        ? platformStatusStyles.active
        : platformStatusStyles.disconnected
    return (
      <span className={`${variant.pill} text-xs`}> 
        <span className={variant.dot} aria-hidden="true" />
        {labelText}
      </span>
    )
  }

  const renderPlatformFields = () => {
    if (!selectedPlatform) {
      return (
        <p className="text-xs text-[var(--muted)]">
          Select a platform to see the authentication requirements.
        </p>
      )
    }
    if (selectedPlatform === 'instagram') {
      return (
        <>
          <p className="text-xs text-[var(--muted)]">
            Enter the Instagram login used for this creator account. A browser challenge may appear
            during authentication.
          </p>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
            Username
            <input
              value={instagramUsername}
              onChange={(event) => setInstagramUsername(event.target.value)}
              placeholder="creator@example"
              disabled={!isAccountActive || isSubmitting}
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
            Password
            <input
              type="password"
              value={instagramPassword}
              onChange={(event) => setInstagramPassword(event.target.value)}
              placeholder="••••••••"
              disabled={!isAccountActive || isSubmitting}
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </>
      )
    }
    if (selectedPlatform === 'tiktok') {
      return (
        <>
          <p className="text-xs text-[var(--muted)]">
            We will launch a browser window to complete TikTok OAuth. Provide overrides if you need
            to use a specific client key.
          </p>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
            Client key (optional)
            <input
              value={tiktokClientKey}
              onChange={(event) => setTiktokClientKey(event.target.value)}
              placeholder="aw6v..."
              disabled={!isAccountActive || isSubmitting}
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
            Client secret (optional)
            <input
              value={tiktokClientSecret}
              onChange={(event) => setTiktokClientSecret(event.target.value)}
              placeholder="Provide only if required"
              disabled={!isAccountActive || isSubmitting}
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </>
      )
    }
    return (
      <p className="text-xs text-[var(--muted)]">
        A browser window will open so you can approve YouTube access for this account.
      </p>
    )
  }

  const renderToneControls = () => (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--fg)]">Account tone</h4>
        <span className="text-xs text-[var(--muted)]">
          {overrideToneLabel ? `Override: ${overrideToneLabel}` : `Using default: ${effectiveToneLabel}`}
        </span>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
        Tone
        <MarbleSelect
          id={`tone-${account.id}`}
          name="tone"
          value={toneSelectValue}
          options={toneSelectOptions}
          onChange={handleToneChange}
          placeholder="Select a tone"
          disabled={isUpdatingTone}
        />
      </label>
      <p className="text-xs text-[var(--muted)]">
        Selecting a tone here overrides the global clip tone for this account. Choose 'Use default tone' to inherit the Settings value.
      </p>
    </div>
  )

  const feedbackMessage = success || error ? (
    <div className="flex flex-col gap-2">
      {success ? (
        <p className="text-xs font-medium text-[color:var(--success-strong)]">{success}</p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-[color:var(--error-strong)]">{error}</p>
      ) : null}
    </div>
  ) : null

  return (
    <div
      data-testid={`account-card-${account.id}`}
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="status-pill status-pill--neutral text-xs">
                {account.platforms.length} platform{account.platforms.length === 1 ? '' : 's'}
              </span>
              {account.effectiveTone || account.tone ? (
                <span className="status-pill status-pill--neutral text-xs" title={toneBadgeTitle}>
                  Tone: {effectiveToneLabel}
                </span>
              ) : null}
              {!isAccountActive ? (
                <span className="status-pill status-pill--warning text-xs font-semibold">
                  Disabled
                </span>
              ) : null}
            </div>
            <div>
              <h3 className="text-xl font-semibold text-[var(--fg)]">{account.displayName}</h3>
              <p className="text-xs text-[var(--muted)]">
                Connected {formatTimestamp(account.createdAt)}
              </p>
              {!isCollapsed && account.description ? (
                <p className="mt-1 text-sm text-[var(--muted)]">{account.description}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsCollapsed((previous) => !previous)
            }}
            aria-expanded={!isCollapsed}
            aria-controls={detailsId}
            className="marble-button marble-button--outline px-3 py-1 text-xs font-semibold"
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {feedbackMessage}

      {isCollapsed ? (
        <div id={detailsId} className="flex flex-col gap-3">
          {!isAccountActive ? (
            <p className="text-xs text-[color:var(--info-strong)]">
              Enable this account to resume authentication.
            </p>
          ) : null}
          {renderToneControls()}
          {account.platforms.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {account.platforms.map((platform) => (
                <li
                  key={platform.platform}
                  className="flex items-center gap-3 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-[var(--fg)]"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-[var(--fg)]">
                      {PLATFORM_LABELS[platform.platform]}
                    </span>
                    {platform.label && platform.label !== PLATFORM_LABELS[platform.platform] ? (
                      <span className="text-[10px] text-[var(--muted)]">{platform.label}</span>
                    ) : null}
                  </div>
                  {renderStatusTag(platform)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              No platforms are connected yet. Use Add platform below to connect one.
            </p>
          )}
        </div>
      ) : (
        <div id={detailsId} className="flex flex-col gap-4">
          {renderToneControls()}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleToggleAccountActive()
              }}
              disabled={isTogglingAccount || isDeletingAccount}
              className="marble-button marble-button--outline px-3 py-1 text-xs font-semibold"
            >
              {isTogglingAccount
                ? account.active
                  ? 'Disabling…'
                  : 'Enabling…'
                : account.active
                  ? 'Disable account'
                  : 'Enable account'}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDeleteAccount()
              }}
              disabled={isDeletingAccount || isTogglingAccount}
              className="marble-button marble-button--danger px-3 py-1 text-xs font-semibold"
            >
              {isDeletingAccount ? 'Removing…' : 'Remove account'}
            </button>
          </div>

          {!isAccountActive ? (
            <p className="rounded-lg border border-dashed border-[color:color-mix(in_srgb,var(--info)_35%,var(--edge))] bg-[color:var(--info-soft)] p-3 text-xs text-[color:var(--info-strong)]">
              This account is disabled. Enable it to resume authentication and publishing.
            </p>
          ) : null}

          {account.platforms.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {account.platforms.map((platform) => {
                const isPlatformUpdating = updatingPlatform === platform.platform
                const isPlatformRemoving = removingPlatform === platform.platform
                return (
                  <li
                    key={platform.platform}
                    className="flex flex-col gap-3 rounded-lg border border-white/10 bg-black/20 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-[var(--fg)]">
                          {platform.label}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {PLATFORM_LABELS[platform.platform]}
                        </span>
                      </div>
                      {renderStatusTag(platform)}
                    </div>
                    <p className="text-xs text-[var(--muted)]">
                      Last verified: {formatTimestamp(platform.lastVerifiedAt ?? null)}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-[var(--muted)]">
                        Added {formatTimestamp(platform.addedAt)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleTogglePlatformActive(platform.platform, !platform.active)
                          }}
                          disabled={isPlatformUpdating || isPlatformRemoving}
                          className="marble-button marble-button--outline px-3 py-1 text-xs font-semibold"
                        >
                          {isPlatformUpdating
                            ? platform.active
                              ? 'Disabling…'
                              : 'Enabling…'
                            : platform.active
                              ? 'Disable'
                              : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleRemovePlatform(platform.platform)
                          }}
                          disabled={isPlatformRemoving || isPlatformUpdating}
                          className="marble-button marble-button--danger px-3 py-1 text-xs font-semibold"
                        >
                          {isPlatformRemoving ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 bg-black/10 p-4 text-sm text-[var(--muted)]">
              No platforms are connected yet. Use the Add platform button below to authenticate a
              platform.
            </p>
          )}
        </div>
      )}

      {availablePlatforms.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-[var(--fg)]">Add a platform</h4>
              {isAddPlatformOpen && selectedPlatform ? (
                <span className="status-pill status-pill--neutral text-xs">
                  Authenticating {PLATFORM_LABELS[selectedPlatform]}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleToggleAddPlatform}
              className="marble-button marble-button--outline inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold"
              aria-expanded={isAddPlatformOpen}
              aria-controls={addPlatformFormId}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {isAddPlatformOpen ? '−' : '+'}
              </span>
              <span>{isAddPlatformOpen ? 'Cancel' : 'Add platform'}</span>
            </button>
          </div>
          {isAddPlatformOpen ? (
            <form id={addPlatformFormId} onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                Platform
                <MarbleSelect
                  id={`platform-${account.id}`}
                  name="platform"
                  value={selectedPlatform || null}
                  options={platformOptions}
                  onChange={handlePlatformChange}
                  placeholder="Select a platform"
                  disabled={!isAccountActive || isSubmitting}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                Label (optional)
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. Brand TikTok"
                  disabled={!isAccountActive || isSubmitting}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              {renderPlatformFields()}
              {!isAccountActive ? (
                <p className="text-xs text-[color:var(--info-strong)]">
                  Enable this account to connect new platforms.
                </p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting || !isAccountActive}
                  className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
                >
                  {isSubmitting ? 'Connecting…' : 'Connect platform'}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              Use <span className="font-semibold text-[var(--fg)]">Add platform</span> to connect another
              service.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          All supported platforms are connected for this account.
        </p>
      )}
    </div>
  )
}

const Profile: FC<ProfileProps> = ({
  registerSearch,
  accounts,
  accountsError,
  authStatus,
  authError,
  accessStatus,
  accessError,
  isCheckingAccess,
  isLoadingAccounts,
  onCreateAccount,
  onAddPlatform,
  onUpdateAccount,
  onDeleteAccount,
  onUpdatePlatform,
  onDeletePlatform,
  onRefreshAccounts,
  onRefreshAccessStatus
}) => {
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountDescription, setNewAccountDescription] = useState('')
  const [newAccountError, setNewAccountError] = useState<string | null>(null)
  const [newAccountSuccess, setNewAccountSuccess] = useState<string | null>(null)
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null)
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)
  const [billingEmailInput, setBillingEmailInput] = useState('')
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(false)
  const [isStartingCheckout, setIsStartingCheckout] = useState(false)
  const [isOpeningPortal, setIsOpeningPortal] = useState(false)
  const initialTrialToken = useMemo<TrialTokenCacheEntry | null>(getStoredTrialToken, [])
  const [pendingTrialToken, setPendingTrialToken] = useState<TrialTokenCacheEntry | null>(initialTrialToken)
  const [isStartingTrial, setIsStartingTrial] = useState(false)
  const [isClaimingTrial, setIsClaimingTrial] = useState(false)
  const [trialState, setTrialState] = useState(getTrialUsageState)
  const [trialError, setTrialError] = useState<string | null>(null)
  const [trialNotice, setTrialNotice] = useState<string | null>(
    initialTrialToken ? 'Trial token ready. Start a render to use it.' : null
  )
  const refreshOnFocusRef = useRef(false)

  const billingUserId = useMemo(() => getAccessControlConfig().clientId.trim(), [])
  const deviceHash = useMemo(() => getDeviceHash(), [])

  const handleToggleCreateAccount = useCallback(() => {
    setNewAccountError(null)
    setIsCreateAccountOpen((previous) => {
      const next = !previous
      if (next) {
        setNewAccountSuccess(null)
      } else {
        setNewAccountName('')
        setNewAccountDescription('')
      }
      return next
    })
  }, [setNewAccountDescription, setNewAccountError, setNewAccountName, setNewAccountSuccess])

  useEffect(() => {
    registerSearch(null)
    return () => registerSearch(null)
  }, [registerSearch])

  useEffect(() => {
    setBillingEmailInput(accessStatus?.customerEmail ?? '')
  }, [accessStatus?.customerEmail])

  useEffect(() => {
    if (pendingTrialToken) {
      setTrialNotice('Trial token ready. Start a render to use it.')
      setTrialError(null)
    } else if (!isClaimingTrial) {
      setTrialNotice(null)
    }
  }, [pendingTrialToken, isClaimingTrial])

  useEffect(() => {
    if (trialLocked) {
      setTrialError('Trial unavailable on this device. Subscribe to continue rendering.')
    } else if (trialError && trialError.startsWith('Trial unavailable')) {
      setTrialError(null)
    }
  }, [trialLocked, trialError])

  const loadSubscriptionStatus = useCallback(async () => {
    if (!billingUserId) {
      setSubscriptionStatus(null)
      setSubscriptionError('Billing is not configured for this installation.')
      return null
    }

    setIsLoadingSubscription(true)
    try {
      const status = await fetchSubscriptionStatus(billingUserId)
      setSubscriptionStatus(status)
      setSubscriptionError(null)
      setPendingTrialToken(getStoredTrialToken())
      setTrialState(getTrialUsageState())
      return status
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load billing information from Stripe.'
      setSubscriptionError(normalizeBillingError(message))
      return null
    } finally {
      setIsLoadingSubscription(false)
    }
  }, [billingUserId])

  useEffect(() => {
    void loadSubscriptionStatus()
  }, [loadSubscriptionStatus])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const refreshIfVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      void loadSubscriptionStatus()
    }

    const intervalId = window.setInterval(refreshIfVisible, 60_000)

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        refreshIfVisible()
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      window.clearInterval(intervalId)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [loadSubscriptionStatus])

  const handleCreateAccount = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const displayName = newAccountName.trim()
      if (displayName.length === 0) {
        setNewAccountError('Enter a name for the account.')
        return
      }
      setNewAccountError(null)
      setNewAccountSuccess(null)
      setIsCreatingAccount(true)
      try {
        await onCreateAccount({
          displayName,
          description:
            newAccountDescription.trim().length > 0 ? newAccountDescription.trim() : undefined
        })
        setNewAccountName('')
        setNewAccountDescription('')
        setNewAccountSuccess('Account created successfully. You can now add platforms below.')
        setIsCreateAccountOpen(false)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to create the account. Please try again.'
        setNewAccountError(message)
      } finally {
        setIsCreatingAccount(false)
      }
    },
    [newAccountDescription, newAccountName, onCreateAccount]
  )

  const connectedPlatforms = authStatus?.connectedPlatforms ?? 0
  const totalPlatforms =
    authStatus?.totalPlatforms ??
    accounts.reduce((total, account) => total + account.platforms.length, 0)
  const totalAccounts = authStatus?.accounts ?? accounts.length
  const accountLabel = totalAccounts === 1 ? 'account' : 'accounts'
  const authStatusVariant = authStatus
    ? authStatusStyles[authStatus.status] ?? authStatusStyles.degraded
    : null
  const authStatusPill = [
    authStatusVariant?.pill ?? 'status-pill status-pill--neutral',
    'text-xs',
    !authStatus ? 'text-[color:var(--muted)]' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const authStatusDot = authStatusVariant?.dot ?? 'status-pill__dot status-pill__dot--muted'

  const resolvedLifecycleStatus: SubscriptionLifecycleStatus = useMemo(() => {
    if (accessStatus?.status) {
      return accessStatus.status
    }
    if (subscriptionStatus?.status) {
      return subscriptionStatus.status
    }
    return 'inactive'
  }, [accessStatus?.status, subscriptionStatus?.status])

  const hasEntitledSubscription = useMemo(() => {
    if (accessStatus) {
      return accessStatus.allowed
    }
    if (subscriptionStatus?.status) {
      return PORTAL_ELIGIBLE_STATUSES.has(subscriptionStatus.status)
    }
    return false
  }, [accessStatus, subscriptionStatus?.status])

  const accessVariantKey = isCheckingAccess
    ? 'neutral'
    : hasEntitledSubscription
      ? resolvedLifecycleStatus === 'active'
        ? 'success'
        : resolvedLifecycleStatus === 'trialing' || resolvedLifecycleStatus === 'grace_period'
          ? 'warning'
          : resolvedLifecycleStatus === 'inactive'
            ? 'neutral'
            : 'warning'
      : accessStatus || subscriptionStatus || accessError
        ? 'error'
        : 'neutral'
  const accessVariant = accessBadgeVariants[accessVariantKey] ?? accessBadgeVariants.neutral

  const accessBadgeLabel = isCheckingAccess
    ? 'Checking access'
    : hasEntitledSubscription
      ? resolvedLifecycleStatus === 'active'
        ? 'Access active'
        : resolvedLifecycleStatus === 'trialing'
          ? 'Trial active'
          : resolvedLifecycleStatus === 'grace_period'
            ? 'Grace period'
            : 'Subscription attention'
      : accessStatus
        ? 'Access disabled'
        : accessError
          ? 'Access error'
          : 'Access required'

  const activePlanLabel = accessStatus?.subscriptionPlan ?? subscriptionStatus?.planName ?? null

  const accessSummaryText = isCheckingAccess
    ? 'Verifying access permissions…'
    : hasEntitledSubscription
      ? activePlanLabel
        ? `Access granted – ${activePlanLabel}`
        : 'Access granted.'
      : accessStatus?.reason ?? accessError ?? 'Subscription required to continue using Atropos.'

  const accessRenewalLabel = accessStatus?.expiresAt
    ? new Date(accessStatus.expiresAt).toLocaleString()
    : null

  const subscriptionPlanName = hasEntitledSubscription
    ? activePlanLabel ?? 'Current plan'
    : activePlanLabel ?? 'Not subscribed'
  const billingEmail = billingEmailInput.trim()
  const billingEmailLabel = billingEmail.length > 0 ? billingEmail : null

  const canManageBilling = hasEntitledSubscription

  const primaryCtaLabel = canManageBilling
    ? isOpeningPortal
      ? 'Opening portal…'
      : 'Manage billing'
    : isStartingCheckout
      ? 'Redirecting…'
      : 'Subscribe'

  const primaryCtaDisabled = canManageBilling
    ? isOpeningPortal
    : isStartingCheckout || billingEmail.length === 0

  const primaryCtaDescription = canManageBilling
    ? 'Manage billing opens the Stripe customer portal for existing subscriptions.'
    : billingEmail.length > 0
      ? 'Subscribe opens Stripe checkout to start a new plan.'
      : 'Enter a billing email address to enable Stripe checkout.'

  const trialInfo = subscriptionStatus?.trial ?? null
  const hasPendingTrial = pendingTrialToken !== null
  const remoteRemaining =
    typeof trialInfo?.remaining === 'number' && Number.isFinite(trialInfo.remaining)
      ? Math.max(0, Math.floor(trialInfo.remaining))
      : null
  const remoteTotal =
    typeof trialInfo?.total === 'number' && Number.isFinite(trialInfo.total)
      ? Math.max(0, Math.floor(trialInfo.total))
      : null
  const trialAllowed =
    !hasEntitledSubscription && ((trialInfo?.allowed ?? true) || trialState.started)
  const localRemaining = Math.max(0, trialState.remaining)
  const localTotal = Math.max(trialState.total, localRemaining)
  const trialRemaining = Math.max(0, remoteRemaining ?? localRemaining)
  const trialTotal = Math.max(remoteTotal ?? 0, localTotal, 3)
  const trialStarted =
    (trialInfo?.started ?? false) || trialState.started || trialRemaining > 0
  const trialLocked = trialState.locked
  const canRequestTrialToken = trialRemaining > 0
  const useTrialButtonDisabled =
    hasPendingTrial || isClaimingTrial || trialLocked || !canRequestTrialToken
  const trialButtonLabel = hasPendingTrial
    ? 'Trial ready – run a render'
    : isClaimingTrial
      ? 'Preparing…'
      : 'Use trial for next render'
  const showTrialStartCta = trialAllowed && !trialStarted
  const showTrialUseCta = trialAllowed && trialStarted
  const trialBannerText = `Trial mode — ${trialRemaining} of ${trialTotal} left`
  const startTrialButtonDisabled = isStartingTrial || trialLocked
  const startTrialLabel = isStartingTrial ? 'Starting…' : 'Start 3-video Trial'

  const handleRefreshBilling = useCallback(async () => {
    await loadSubscriptionStatus()
    try {
      await onRefreshAccessStatus()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh access permissions.'
      setSubscriptionError(normalizeBillingError(message))
    }
  }, [loadSubscriptionStatus, onRefreshAccessStatus])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleFocus = (): void => {
      if (refreshOnFocusRef.current) {
        refreshOnFocusRef.current = false
        void handleRefreshBilling()
      }
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [handleRefreshBilling])

  const handleStartTrial = useCallback(async () => {
    if (isStartingTrial || hasEntitledSubscription || !showTrialStartCta) {
      return
    }

    if (!billingUserId) {
      setTrialError('Billing is not configured for this installation.')
      return
    }

    setIsStartingTrial(true)
    setTrialError(null)
    setTrialNotice(null)

    try {
      await startTrial(billingUserId, deviceHash)
      setTrialState(getTrialUsageState())
      setTrialNotice('Trial activated. Claim a token when you are ready to render.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to activate the trial for this device.'
      setTrialError(normalizeBillingError(message))
    } finally {
      setIsStartingTrial(false)
    }
  }, [
    billingUserId,
    deviceHash,
    hasEntitledSubscription,
    isStartingTrial,
    showTrialStartCta
  ])

  const handleClaimTrial = useCallback(async () => {
    if (isClaimingTrial || pendingTrialToken) {
      return
    }

    if (!billingUserId) {
      setTrialError('Billing is not configured for this installation.')
      return
    }

    setIsClaimingTrial(true)
    setTrialError(null)
    setTrialNotice(null)

    try {
      const { token, exp } = await claimTrialRender(billingUserId, deviceHash)
      setStoredTrialToken({ token, exp, userId: billingUserId })
      setPendingTrialToken(getStoredTrialToken())
      setTrialState(getTrialUsageState())
      setTrialNotice('Trial token ready. Start a render to use it.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to claim the trial render.'
      setTrialError(normalizeBillingError(message))
    } finally {
      setIsClaimingTrial(false)
    }
  }, [billingUserId, deviceHash, isClaimingTrial, pendingTrialToken])

  const handleStartCheckout = useCallback(async () => {
    setSubscriptionError(null)
    if (!billingUserId) {
      setSubscriptionError('Billing is not configured for this installation.')
      return
    }

    if (!billingEmail) {
      setSubscriptionError(MISSING_BILLING_EMAIL_ERROR)
      return
    }

    setIsStartingCheckout(true)
    refreshOnFocusRef.current = false
    try {
      const session = await createCheckoutSession({
        userId: billingUserId,
        email: billingEmail
      })
      if (typeof window !== 'undefined' && session.url) {
        refreshOnFocusRef.current = true
        window.open(session.url, '_blank', 'noopener')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start the checkout session.'
      setSubscriptionError(message)
      refreshOnFocusRef.current = false
    } finally {
      setIsStartingCheckout(false)
    }
  }, [billingEmail, billingUserId])

  const handleOpenBillingPortal = useCallback(async () => {
    setSubscriptionError(null)
    if (!billingUserId) {
      setSubscriptionError('Billing is not configured for this installation.')
      return
    }

    setIsOpeningPortal(true)
    refreshOnFocusRef.current = false
    try {
      const session = await createBillingPortalSession({ userId: billingUserId })
      if (typeof window !== 'undefined' && session.url) {
        refreshOnFocusRef.current = true
        window.open(session.url, '_blank', 'noopener')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to open the billing portal.'
      setSubscriptionError(message)
      refreshOnFocusRef.current = false
    } finally {
      setIsOpeningPortal(false)
    }
  }, [billingUserId])

  useEffect(() => {
    const handleTrialStorageUpdate = () => {
      setPendingTrialToken(getStoredTrialToken())
      setTrialState(getTrialUsageState())
    }
    const handleSubscriptionRefreshEvent = () => {
      void handleRefreshBilling()
    }

    window.addEventListener(TRIAL_UPDATE_EVENT, handleTrialStorageUpdate)
    window.addEventListener(SUBSCRIPTION_REFRESH_EVENT, handleSubscriptionRefreshEvent)

    return () => {
      window.removeEventListener(TRIAL_UPDATE_EVENT, handleTrialStorageUpdate)
      window.removeEventListener(SUBSCRIPTION_REFRESH_EVENT, handleSubscriptionRefreshEvent)
    }
  }, [handleRefreshBilling])

  return (
    <section className="flex w-full flex-1 flex-col gap-8 px-6 py-10 lg:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-[var(--fg)]">Profile</h1>
        <p className="text-sm text-[var(--muted)]">
          Manage authenticated accounts and connect platforms for publishing. Accounts determine
          where processed videos will be delivered.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={authStatusPill}>
                  <span className={authStatusDot} aria-hidden="true" />
                  {authStatus
                    ? authStatus.message
                    : (authError ?? 'Checking authentication status…')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void onRefreshAccounts()
                }}
                className="marble-button marble-button--outline px-3 py-1.5 text-xs font-semibold"
              >
                Refresh
              </button>
            </div>
            <div className="text-xs text-[var(--muted)]">
              Connected platforms across {totalAccounts} {accountLabel}: {connectedPlatforms}/
              {totalPlatforms}
            </div>
            {authError && !authStatus ? (
              <p className="text-xs font-medium text-[color:var(--error-strong)]">{authError}</p>
            ) : null}
            {accountsError ? (
              <p className="text-xs font-medium text-[color:var(--error-strong)]">{accountsError}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--fg)]">Accounts</h2>
              <button
                type="button"
                onClick={handleToggleCreateAccount}
                className="marble-button marble-button--outline inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold"
                aria-expanded={isCreateAccountOpen}
                aria-controls="new-account-form"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {isCreateAccountOpen ? '−' : '+'}
                </span>
                <span>{isCreateAccountOpen ? 'Cancel' : 'Add account'}</span>
              </button>
            </div>
            {newAccountError ? (
              <p className="text-xs font-medium text-[color:var(--error-strong)]">{newAccountError}</p>
            ) : null}
            {newAccountSuccess ? (
              <p className="text-xs font-medium text-[color:var(--success-strong)]">{newAccountSuccess}</p>
            ) : null}
            {isCreateAccountOpen ? (
              <form id="new-account-form" onSubmit={handleCreateAccount} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                  Account name
                  <input
                    value={newAccountName}
                    onChange={(event) => {
                      setNewAccountName(event.target.value)
                      setNewAccountError(null)
                      setNewAccountSuccess(null)
                    }}
                    placeholder="e.g. Creator Hub"
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                  Description (optional)
                  <textarea
                    value={newAccountDescription}
                    onChange={(event) => {
                      setNewAccountDescription(event.target.value)
                      setNewAccountError(null)
                      setNewAccountSuccess(null)
                    }}
                    placeholder="Describe the content this account will publish"
                    className="min-h-[80px] rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <div className="flex items-center justify-end">
                  <button
                    type="submit"
                    disabled={isCreatingAccount}
                    className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
                  >
                    {isCreatingAccount ? 'Creating…' : 'Create account'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Add separate accounts to manage platforms for different brands or clients.
              </p>
            )}
          </div>

          {isLoadingAccounts ? (
            <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6 text-sm text-[var(--muted)]">
              Loading accounts…
            </div>
          ) : null}

          {!isLoadingAccounts && accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_40%,transparent)] p-6 text-sm text-[var(--muted)]">
              No accounts are connected yet. Use Add account above to begin adding platforms.
            </div>
          ) : null}

          <div className="flex flex-col gap-6">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onAddPlatform={onAddPlatform}
                onUpdateAccount={onUpdateAccount}
                onDeleteAccount={onDeleteAccount}
                onUpdatePlatform={onUpdatePlatform}
                onDeletePlatform={onDeletePlatform}
              />
            ))}
          </div>
        </div>

        <aside className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_50%,transparent)] p-6 text-sm text-[var(--muted)]">
          <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/20 p-4 text-left">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-[var(--fg)]">Access & billing</h3>
                <span className={`${accessVariant.pill} w-fit text-xs`}>
                  <span className={accessVariant.dot} aria-hidden="true" />
                  {accessBadgeLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleRefreshBilling()
                }}
                className="marble-button marble-button--outline px-3 py-1 text-xs font-semibold"
                disabled={isCheckingAccess || isLoadingSubscription}
              >
                {isCheckingAccess || isLoadingSubscription ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <p className="text-xs text-[var(--muted)]">
              <span className="font-semibold text-[var(--fg)]">Status:</span> {accessSummaryText}
            </p>
            <div className="flex flex-col gap-1 text-[11px] text-[var(--muted)]">
              {accessRenewalLabel ? (
                <p>
                  <span className="font-semibold text-[var(--fg)]">Access valid until:</span>{' '}
                  {accessRenewalLabel}
                </p>
              ) : null}
              {billingEmailLabel ? (
                <p>
                  <span className="font-semibold text-[var(--fg)]">Billing email:</span> {billingEmailLabel}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                Billing email address
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={billingEmailInput}
                  onChange={(event) => {
                    setBillingEmailInput(event.target.value)
                    setSubscriptionError((current) =>
                      current === MISSING_BILLING_EMAIL_ERROR ? null : current
                    )
                  }}
                  placeholder="name@example.com"
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
              <p className="text-[11px] text-[var(--muted)]">
                Stripe uses this email to send receipts and manage your subscription. We'll prefill it
                when starting checkout.
              </p>
            </div>
            {isLoadingSubscription ? (
              <p className="text-xs text-[var(--muted)]">Checking Stripe subscription…</p>
            ) : null}
            {subscriptionStatus ? (
              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Subscription details
                </h4>
                <dl className="grid gap-2 text-xs text-[var(--muted)]">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="font-semibold text-[var(--fg)]">Plan</dt>
                    <dd>{subscriptionPlanName}</dd>
                  </div>
                  {subscriptionStatus.renewsAt ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-semibold text-[var(--fg)]">Renews</dt>
                      <dd>{formatTimestamp(subscriptionStatus.renewsAt)}</dd>
                    </div>
                  ) : null}
                  {subscriptionStatus.trialEndsAt ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-semibold text-[var(--fg)]">Trial ends</dt>
                      <dd>{formatTimestamp(subscriptionStatus.trialEndsAt)}</dd>
                    </div>
                  ) : null}
                  {subscriptionStatus.cancelAt ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-semibold text-[var(--fg)]">Cancels</dt>
                      <dd>{formatTimestamp(subscriptionStatus.cancelAt)}</dd>
                    </div>
                  ) : null}
                  {trialInfo ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-semibold text-[var(--fg)]">Trial status</dt>
                      <dd>
                        {trialInfo.started
                          ? `${Math.max(0, trialInfo.remaining ?? 0)} of ${Math.max(
                              3,
                              trialInfo.total ?? 0,
                              trialState.total
                            )} remaining`
                          : trialInfo.allowed
                            ? 'Not started'
                            : 'Unavailable'}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
            {subscriptionStatus?.latestInvoiceUrl ? (
              <a
                href={subscriptionStatus.latestInvoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-[color:var(--accent)] hover:underline"
              >
                View latest invoice
              </a>
            ) : null}
            {subscriptionError ? (
              <p className="text-xs font-medium text-[color:var(--error-strong)]">{subscriptionError}</p>
            ) : null}
            {(!hasEntitledSubscription && trialAllowed) || trialNotice || trialError ? (
              <div className="flex flex-col gap-2">
                {showTrialStartCta ? (
                  <button
                    type="button"
                    onClick={() => {
                      void handleStartTrial()
                    }}
                    className="marble-button marble-button--outline px-3 py-1.5 text-xs font-semibold"
                    disabled={startTrialButtonDisabled}
                  >
                    {startTrialLabel}
                  </button>
                ) : null}
                {showTrialUseCta ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/10 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {trialBannerText}
                    </p>
                    {canRequestTrialToken ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleClaimTrial()
                        }}
                        className="marble-button marble-button--outline px-3 py-1.5 text-xs font-semibold"
                        disabled={useTrialButtonDisabled}
                      >
                        {trialButtonLabel}
                      </button>
                    ) : (
                      <p className="text-[10px] text-[var(--muted)]">
                        Trial exhausted. Subscribe to keep rendering.
                      </p>
                    )}
                  </div>
                ) : null}
                {trialNotice ? (
                  <p className="text-[10px] text-[var(--muted)]">{trialNotice}</p>
                ) : null}
                {trialError ? (
                  <p className="text-xs font-medium text-[color:var(--error-strong)]">{trialError}</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (canManageBilling) {
                    void handleOpenBillingPortal()
                  } else {
                    void handleStartCheckout()
                  }
                }}
                className="marble-button marble-button--primary px-3 py-1.5 text-xs font-semibold"
                disabled={primaryCtaDisabled}
              >
                {primaryCtaLabel}
              </button>
              <p className="text-[10px] text-[var(--muted)]">{primaryCtaDescription}</p>
              <p className="text-[10px] text-[var(--muted)]">
                Payments are processed securely by Stripe. After updating your subscription, use Refresh
                to sync access.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-[var(--fg)]">Supported platforms</h3>
            <ul className="flex flex-col gap-3">
              {SUPPORTED_PLATFORMS.map((platform) => (
                <li
                  key={platform}
                  className="flex flex-col gap-1 rounded-lg border border-white/10 bg-black/20 p-3"
                >
                  <span className="text-sm font-medium text-[var(--fg)]">
                    {PLATFORM_LABELS[platform]}
                  </span>
                  <p>
                    Tokens are stored under{' '}
                    <code className="font-mono text-xs text-[var(--fg)]">
                      tokens/&lt;account&gt;/{PLATFORM_TOKEN_FILES[platform]}
                    </code>
                    {'. '}
                    Ensure credentials remain valid to publish successfully.
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default Profile
