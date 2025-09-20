import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FC } from 'react'
import {
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  type AccountPlatformConnection,
  type AccountSummary,
  type AuthPingSummary,
  type SearchBridge,
  type SupportedPlatform
} from '../types'
import { timeAgo } from '../lib/format'

const PLATFORM_TOKEN_FILES: Record<SupportedPlatform, string> = {
  tiktok: 'tiktok.json',
  youtube: 'youtube.json',
  instagram: 'instagram_session.json'
}

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
  onUpdateAccount: (accountId: string, payload: { active?: boolean }) => Promise<AccountSummary>
  onDeleteAccount: (accountId: string) => Promise<void>
  onUpdatePlatform: (
    accountId: string,
    platform: SupportedPlatform,
    payload: { active?: boolean }
  ) => Promise<AccountSummary>
  onDeletePlatform: (accountId: string, platform: SupportedPlatform) => Promise<AccountSummary>
  onRefreshAccounts: () => Promise<void>
}

type AccountCardProps = {
  account: AccountSummary
  onAddPlatform: ProfileProps['onAddPlatform']
  onUpdateAccount: ProfileProps['onUpdateAccount']
  onDeleteAccount: ProfileProps['onDeleteAccount']
  onUpdatePlatform: ProfileProps['onUpdatePlatform']
  onDeletePlatform: ProfileProps['onDeletePlatform']
}

const statusColors: Record<string, string> = {
  ok: 'bg-emerald-400/20 text-emerald-200 border-emerald-400/60',
  degraded: 'bg-amber-400/20 text-amber-100 border-amber-400/60',
  disabled: 'bg-slate-500/20 text-slate-200 border-slate-500/60'
}

const platformStatusStyles: Record<string, string> = {
  active: 'bg-emerald-400/10 text-emerald-200 border-emerald-400/40',
  disconnected: 'bg-rose-500/10 text-rose-100 border-rose-500/40',
  disabled: 'bg-slate-500/10 text-slate-200 border-slate-500/40'
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
  const [updatingPlatform, setUpdatingPlatform] = useState<SupportedPlatform | null>(null)
  const [removingPlatform, setRemovingPlatform] = useState<SupportedPlatform | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const isAccountActive = account.active

  const availablePlatforms = useMemo(
    () =>
      SUPPORTED_PLATFORMS.filter(
        (platform) => !account.platforms.some((item) => item.platform === platform)
      ),
    [account.platforms]
  )

  useEffect(() => {
    setSuccess(null)
    setError(null)
  }, [account.platforms.length, account.active])

  const detailsId = `account-${account.id}-details`

  const resetCredentialFields = useCallback(() => {
    setInstagramUsername('')
    setInstagramPassword('')
    setTiktokClientKey('')
    setTiktokClientSecret('')
  }, [])

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
        setSuccess(updated.active ? 'Account enabled successfully.' : 'Account disabled successfully.')
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
    const style = platformStatusStyles[platform.status] ?? platformStatusStyles.disconnected
    const indicatorClass = !isPlatformActive
      ? 'bg-slate-400'
      : platform.connected
      ? 'bg-emerald-400'
      : 'bg-rose-400'
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}
      >
        <span className={`h-2 w-2 rounded-full ${indicatorClass}`} />
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

  return (
    <div
      data-testid={`account-card-${account.id}`}
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => {
                setIsCollapsed((previous) => !previous)
              }}
              aria-expanded={!isCollapsed}
              aria-controls={detailsId}
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-sm text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
            >
              <span aria-hidden="true">{isCollapsed ? '+' : '−'}</span>
              <span className="sr-only">{isCollapsed ? 'Expand account' : 'Collapse account'}</span>
            </button>
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--muted)]">
              {account.platforms.length} platform{account.platforms.length === 1 ? '' : 's'}
            </span>
            {!isAccountActive ? (
              <span className="rounded-full border border-amber-400/60 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-100">
                Disabled
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {isCollapsed ? (
        <div id={detailsId} className="flex flex-col gap-3">
          {!isAccountActive ? (
            <p className="text-xs text-amber-100">Enable this account to resume authentication.</p>
          ) : null}
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
            <p className="text-xs text-[var(--muted)]">No platforms are connected yet.</p>
          )}
        </div>
      ) : (
        <div id={detailsId} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleToggleAccountActive()
              }}
              disabled={isTogglingAccount || isDeletingAccount}
              className="rounded-lg border border-white/15 px-3 py-1 text-xs font-medium text-[var(--fg)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="rounded-lg border border-rose-500/60 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeletingAccount ? 'Removing…' : 'Remove account'}
            </button>
          </div>

          {!isAccountActive ? (
            <p className="rounded-lg border border-dashed border-amber-400/60 bg-amber-400/10 p-3 text-xs text-amber-100">
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
                        <span className="text-sm font-semibold text-[var(--fg)]">{platform.label}</span>
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
                          className="rounded-lg border border-white/15 px-3 py-1 text-xs font-medium text-[var(--fg)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
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
                          className="rounded-lg border border-rose-500/60 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
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
              No platforms are connected yet. Use the form below to authenticate a platform.
            </p>
          )}

          {availablePlatforms.length > 0 ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-[var(--fg)]">Add a platform</h4>
                {selectedPlatform ? (
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-[var(--muted)]">
                    Authenticating {PLATFORM_LABELS[selectedPlatform]}
                  </span>
                ) : null}
              </div>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
                Platform
                <select
                  value={selectedPlatform}
                  onChange={(event) => {
                    const { value } = event.target
                    setSelectedPlatform((value as SupportedPlatform) || '')
                    setError(null)
                    setSuccess(null)
                    resetCredentialFields()
                  }}
                  disabled={!isAccountActive || isSubmitting}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Select a platform</option>
                  {availablePlatforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {PLATFORM_LABELS[platform]}
                    </option>
                  ))}
                </select>
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
                <p className="text-xs text-amber-100">Enable this account to connect new platforms.</p>
              ) : null}
              {error ? <p className="text-xs font-medium text-rose-400">{error}</p> : null}
              {success ? <p className="text-xs font-medium text-emerald-300">{success}</p> : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting || !isAccountActive}
                  className="rounded-lg border border-transparent bg-[var(--ring)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Connecting…' : 'Connect platform'}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              All supported platforms are connected for this account.
            </p>
          )}
        </div>
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
  isLoadingAccounts,
  onCreateAccount,
  onAddPlatform,
  onUpdateAccount,
  onDeleteAccount,
  onUpdatePlatform,
  onDeletePlatform,
  onRefreshAccounts
}) => {
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountDescription, setNewAccountDescription] = useState('')
  const [newAccountError, setNewAccountError] = useState<string | null>(null)
  const [newAccountSuccess, setNewAccountSuccess] = useState<string | null>(null)
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)

  useEffect(() => {
    registerSearch(null)
    return () => registerSearch(null)
  }, [registerSearch])

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
          description: newAccountDescription.trim().length > 0 ? newAccountDescription.trim() : undefined
        })
        setNewAccountName('')
        setNewAccountDescription('')
        setNewAccountSuccess('Account created successfully. You can now add platforms below.')
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
  const totalPlatforms = authStatus?.totalPlatforms ?? accounts.reduce(
    (total, account) => total + account.platforms.length,
    0
  )
  const totalAccounts = authStatus?.accounts ?? accounts.length
  const accountLabel = totalAccounts === 1 ? 'account' : 'accounts'

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-[var(--fg)]">Profile</h1>
        <p className="text-sm text-[var(--muted)]">
          Manage authenticated accounts and connect platforms for publishing. Accounts determine where
          processed videos will be delivered.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                    authStatus ? statusColors[authStatus.status] ?? statusColors.degraded : 'border-white/10 bg-white/5 text-[var(--muted)]'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      authStatus?.status === 'ok' ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  {authStatus ? authStatus.message : authError ?? 'Checking authentication status…'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void onRefreshAccounts()
                }}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                Refresh
              </button>
            </div>
            <div className="text-xs text-[var(--muted)]">
              Connected platforms across {totalAccounts} {accountLabel}: {connectedPlatforms}/
              {totalPlatforms}
            </div>
            {authError && !authStatus ? (
              <p className="text-xs font-medium text-rose-400">{authError}</p>
            ) : null}
            {accountsError ? (
              <p className="text-xs font-medium text-rose-400">{accountsError}</p>
            ) : null}
          </div>

          <form
            onSubmit={handleCreateAccount}
            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6"
          >
            <h2 className="text-lg font-semibold text-[var(--fg)]">Create a new account</h2>
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
            {newAccountError ? (
              <p className="text-xs font-medium text-rose-400">{newAccountError}</p>
            ) : null}
            {newAccountSuccess ? (
              <p className="text-xs font-medium text-emerald-300">{newAccountSuccess}</p>
            ) : null}
            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={isCreatingAccount}
                className="rounded-lg border border-transparent bg-[var(--ring)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingAccount ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </form>

          {isLoadingAccounts ? (
            <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6 text-sm text-[var(--muted)]">
              Loading accounts…
            </div>
          ) : null}

          {!isLoadingAccounts && accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_40%,transparent)] p-6 text-sm text-[var(--muted)]">
              No accounts are connected yet. Create an account above to begin adding platforms.
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
          <h3 className="text-base font-semibold text-[var(--fg)]">Supported platforms</h3>
          <ul className="flex flex-col gap-3">
            {SUPPORTED_PLATFORMS.map((platform) => (
              <li key={platform} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-black/20 p-3">
                <span className="text-sm font-medium text-[var(--fg)]">{PLATFORM_LABELS[platform]}</span>
                <p>
                  Tokens are stored under{' '}
                  <code className="font-mono text-xs text-[var(--fg)]">
                    tokens/&lt;account&gt;/{PLATFORM_TOKEN_FILES[platform]}
                  </code>
                  Ensure credentials remain valid to publish successfully.
                </p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  )
}

export default Profile
