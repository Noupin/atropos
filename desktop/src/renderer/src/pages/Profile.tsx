import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
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
  onRefreshAccounts: () => Promise<void>
}

type AccountCardProps = {
  account: AccountSummary
  onAddPlatform: ProfileProps['onAddPlatform']
}

const statusColors: Record<string, string> = {
  ok: 'bg-emerald-400/20 text-emerald-200 border-emerald-400/60',
  degraded: 'bg-amber-400/20 text-amber-100 border-amber-400/60'
}

const platformStatusStyles: Record<string, string> = {
  active: 'bg-emerald-400/10 text-emerald-200 border-emerald-400/40',
  disconnected: 'bg-rose-500/10 text-rose-100 border-rose-500/40'
}

const AccountCard: FC<AccountCardProps> = ({ account, onAddPlatform }) => {
  const [selectedPlatform, setSelectedPlatform] = useState<SupportedPlatform | ''>('')
  const [label, setLabel] = useState('')
  const [credentials, setCredentials] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
  }, [account.platforms.length])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!selectedPlatform) {
        setError('Select a platform to connect.')
        return
      }

      let parsedCredentials: Record<string, unknown> | undefined
      if (credentials.trim().length > 0) {
        try {
          parsedCredentials = JSON.parse(credentials) as Record<string, unknown>
        } catch (parseError) {
          setError('Credentials must be valid JSON.')
          return
        }
      }

      setIsSubmitting(true)
      setError(null)
      setSuccess(null)
      try {
        await onAddPlatform(account.id, {
          platform: selectedPlatform,
          label: label.trim().length > 0 ? label.trim() : undefined,
          credentials: parsedCredentials
        })
        const platformName = PLATFORM_LABELS[selectedPlatform]
        setSuccess(`${platformName} connected successfully.`)
        setSelectedPlatform('')
        setLabel('')
        setCredentials('')
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : 'Unable to connect this platform. Please try again.'
        setError(message)
      } finally {
        setIsSubmitting(false)
      }
    },
    [account.id, credentials, label, onAddPlatform, selectedPlatform]
  )

  const renderStatusTag = (platform: AccountPlatformConnection) => {
    const labelText = platform.connected ? 'Authenticated' : 'Needs attention'
    const style = platformStatusStyles[platform.status] ?? platformStatusStyles.disconnected
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}
      >
        <span className={`h-2 w-2 rounded-full ${platform.connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
        {labelText}
      </span>
    )
  }

  return (
    <div
      data-testid={`account-card-${account.id}`}
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xl font-semibold text-[var(--fg)]">{account.displayName}</h3>
            <p className="text-xs text-[var(--muted)]">
              Connected {formatTimestamp(account.createdAt)}
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--muted)]">
            {account.platforms.length} platform{account.platforms.length === 1 ? '' : 's'}
          </span>
        </div>
        {account.description ? (
          <p className="text-sm text-[var(--muted)]">{account.description}</p>
        ) : null}
      </div>

      {account.platforms.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {account.platforms.map((platform) => (
            <li
              key={platform.platform}
              className="flex flex-col gap-1 rounded-lg border border-white/10 bg-black/20 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--fg)]">{platform.label}</span>
                {renderStatusTag(platform)}
              </div>
              <p className="text-xs text-[var(--muted)]">
                Last verified: {formatTimestamp(platform.lastVerifiedAt ?? null)}
              </p>
            </li>
          ))}
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
              }}
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
            Credentials JSON (optional)
            <textarea
              value={credentials}
              onChange={(event) => setCredentials(event.target.value)}
              placeholder='{"accessToken": "..."}'
              className="min-h-[96px] rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </label>
          {error ? <p className="text-xs font-medium text-rose-400">{error}</p> : null}
          {success ? <p className="text-xs font-medium text-emerald-300">{success}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
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
              Connected platforms: {connectedPlatforms}/{totalPlatforms}
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
              <AccountCard key={account.id} account={account} onAddPlatform={onAddPlatform} />
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
