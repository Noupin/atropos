import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC, RefObject } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Search from './components/Search'
import MarbleSelect from './components/MarbleSelect'
import ClipPage from './pages/Clip'
import ClipEdit from './pages/ClipEdit'
import Home from './pages/Home'
import Library from './pages/Library'
import Profile from './pages/Profile'
import Settings, { type SettingsHeaderAction } from './pages/Settings'
import { createInitialPipelineSteps } from './data/pipeline'
import useNavigationHistory from './hooks/useNavigationHistory'
import type {
  AccountSummary,
  AuthPingSummary,
  HomePipelineState,
  SearchBridge,
  SupportedPlatform
} from './types'
import {
  addPlatformToAccount,
  createAccount,
  deleteAccount as deleteAccountApi,
  deleteAccountPlatform,
  fetchAccounts,
  pingAuth,
  updateAccount as updateAccountApi,
  updateAccountPlatform
} from './services/accountsApi'
import { verifyDesktopAccess, type AccessSnapshot } from './services/accessControl'

type PlatformPayload = {
  platform: SupportedPlatform
  label?: string | null
  credentials?: Record<string, unknown>
}

const THEME_STORAGE_KEY = 'atropos:theme'
const ACCESS_REFRESH_INTERVAL_MS = 60_000

const sortAccounts = (items: AccountSummary[]): AccountSummary[] =>
  [...items].sort((a, b) => a.displayName.localeCompare(b.displayName))

type NavItemLabelProps = {
  label: string
  isActive: boolean
  badge?: string | null
}

const NavItemLabel: FC<NavItemLabelProps> = ({ label, isActive, badge }) => (
  <span className="relative flex h-full items-center justify-center">
    {badge ? (
      <span
        aria-hidden
        className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--accent)_80%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-contrast)] shadow-[0_10px_18px_rgba(43,42,40,0.18)]"
      >
        {badge}
      </span>
    ) : null}
    <span className="leading-none">
      {label}
      {badge ? <span className="sr-only"> ({badge})</span> : null}
    </span>
    <span
      aria-hidden
      className={`pointer-events-none absolute left-1/2 bottom-1 h-0.5 w-8 -translate-x-1/2 rounded-full transition ${
        isActive
          ? 'bg-[color:var(--accent)] opacity-100'
          : 'bg-[color:var(--edge-soft)] opacity-0 group-hover:opacity-60'
      }`}
    />
  </span>
)

type AppProps = {
  searchInputRef: RefObject<HTMLInputElement | null>
}

const App: FC<AppProps> = ({ searchInputRef }) => {
  const [searchBridge, setSearchBridge] = useState<SearchBridge | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [homeState, setHomeState] = useState<HomePipelineState>(() => ({
    videoUrl: '',
    urlError: null,
    pipelineError: null,
    steps: createInitialPipelineSteps(),
    isProcessing: false,
    clips: [],
    selectedClipId: null,
    selectedAccountId: null,
    accountError: null,
    activeJobId: null,
    reviewMode: false,
    awaitingReview: false
  }))
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [authStatus, setAuthStatus] = useState<AuthPingSummary | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [accessStatus, setAccessStatus] = useState<AccessSnapshot | null>(null)
  const [accessCheckError, setAccessCheckError] = useState<string | null>(null)
  const [isCheckingAccess, setIsCheckingAccess] = useState(true)
  const [isDark, setIsDark] = useState(false)
  const [settingsHeaderAction, setSettingsHeaderAction] = useState<SettingsHeaderAction | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useNavigationHistory()
  const availableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.active && account.platforms.some((platform) => platform.active)
      ),
    [accounts]
  )

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    let storedTheme: string | null = null
    try {
      storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    } catch (error) {
      console.warn('Unable to read saved theme preference.', error)
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const shouldUseDark = storedTheme ? storedTheme === 'dark' : prefersDark

    root.classList.toggle('dark', shouldUseDark)
    root.style.setProperty('color-scheme', shouldUseDark ? 'dark' : 'light')
    setIsDark(shouldUseDark)
    document.title = 'Atropos'

    const handleSystemThemeChange = (event: MediaQueryListEvent): void => {
      try {
        if (window.localStorage.getItem(THEME_STORAGE_KEY)) {
          return
        }
      } catch (error) {
        console.warn('Unable to access saved theme preference.', error)
        return
      }
      const nextIsDark = event.matches
      root.classList.toggle('dark', nextIsDark)
      root.style.setProperty('color-scheme', nextIsDark ? 'dark' : 'light')
      setIsDark(nextIsDark)
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', handleSystemThemeChange)

    return () => media.removeEventListener('change', handleSystemThemeChange)
  }, [])

  const refreshAuthStatus = useCallback(async () => {
    try {
      const statusPayload = await pingAuth()
      setAuthStatus(statusPayload)
      setAuthError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify authentication.'
      setAuthError(message)
    }
  }, [])

  const refreshAccessStatus = useCallback(async () => {
    setIsCheckingAccess(true)
    try {
      const result = (await verifyDesktopAccess()) as AccessSnapshot
      setAccessStatus(result)
      setAccessCheckError(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to verify access permissions.'
      setAccessStatus(null)
      setAccessCheckError(message)
    } finally {
      setIsCheckingAccess(false)
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    setIsLoadingAccounts(true)
    try {
      const items = await fetchAccounts()
      setAccounts(sortAccounts(items))
      setAccountsError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load connected accounts.'
      setAccountsError(message)
    } finally {
      setIsLoadingAccounts(false)
    }
  }, [])

  useEffect(() => {
    let intervalId: number | null = null
    void refreshAccessStatus()

    if (typeof window !== 'undefined') {
      intervalId = window.setInterval(() => {
        void refreshAccessStatus()
      }, ACCESS_REFRESH_INTERVAL_MS)
    }

    return () => {
      if (intervalId !== null && typeof window !== 'undefined') {
        window.clearInterval(intervalId)
      }
    }
  }, [refreshAccessStatus])

  useEffect(() => {
    void refreshAccounts()
    void refreshAuthStatus()
  }, [refreshAccounts, refreshAuthStatus])

  useEffect(() => {
    setHomeState((prev) => {
      const activeAccountIds = new Set(availableAccounts.map((account) => account.id))

      if (availableAccounts.length === 1) {
        const soleAccountId = availableAccounts[0].id
        if (prev.selectedAccountId !== soleAccountId) {
          return {
            ...prev,
            selectedAccountId: soleAccountId,
            accountError: null
          }
        }
        return prev
      }

      if (prev.selectedAccountId && !activeAccountIds.has(prev.selectedAccountId)) {
        return {
          ...prev,
          selectedAccountId: null,
          clips: [],
          selectedClipId: null,
          accountError: null
        }
      }

      return prev
    })
  }, [availableAccounts, setHomeState])

  const handleSelectAccount = useCallback(
    (accountId: string | null) => {
      setHomeState((prev) => {
        const didChange = prev.selectedAccountId !== accountId
        const shouldReset = didChange || !accountId

        if (!didChange && !shouldReset && prev.accountError === null) {
          return prev
        }

        return {
          ...prev,
          selectedAccountId: accountId,
          accountError: null,
          clips: shouldReset ? [] : prev.clips,
          selectedClipId: shouldReset ? null : prev.selectedClipId
        }
      })
    },
    [setHomeState]
  )

  const handleCreateAccount = useCallback(
    async (payload: { displayName: string; description?: string | null }) => {
      try {
        const account = await createAccount(payload)
        setAccounts((prev) => sortAccounts([...prev.filter((item) => item.id !== account.id), account]))
        setAccountsError(null)
        void refreshAuthStatus()
        return account
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to create the account. Please try again.'
        setAccountsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [refreshAuthStatus]
  )

  const handleAddPlatform = useCallback(
    async (accountId: string, payload: PlatformPayload) => {
      try {
        const account = await addPlatformToAccount(accountId, payload)
        setAccounts((prev) => sortAccounts(prev.map((item) => (item.id === account.id ? account : item))))
        setAccountsError(null)
        void refreshAuthStatus()
        return account
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to connect the selected platform. Please try again.'
        setAccountsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [refreshAuthStatus]
  )

  const handleUpdateAccount = useCallback(
    async (
      accountId: string,
      payload: { active?: boolean; tone?: string | null }
    ) => {
      try {
        const account = await updateAccountApi(accountId, payload)
        setAccounts((prev) => sortAccounts(prev.map((item) => (item.id === account.id ? account : item))))
        setAccountsError(null)
        void refreshAuthStatus()
        return account
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to update the account. Please try again.'
        setAccountsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [refreshAuthStatus]
  )

  const handleDeleteAccount = useCallback(
    async (accountId: string) => {
      try {
        await deleteAccountApi(accountId)
        setAccounts((prev) => prev.filter((item) => item.id !== accountId))
        setAccountsError(null)
        void refreshAuthStatus()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to remove the account. Please try again.'
        setAccountsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [refreshAuthStatus]
  )

  const handleUpdatePlatform = useCallback(
    async (accountId: string, platform: SupportedPlatform, payload: { active?: boolean }) => {
      try {
        const account = await updateAccountPlatform(accountId, platform, payload)
        setAccounts((prev) => sortAccounts(prev.map((item) => (item.id === account.id ? account : item))))
        setAccountsError(null)
        void refreshAuthStatus()
        return account
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to update the platform. Please try again.'
        setAccountsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [refreshAuthStatus]
  )

  const handleDeletePlatform = useCallback(
    async (accountId: string, platform: SupportedPlatform) => {
      try {
        const account = await deleteAccountPlatform(accountId, platform)
        setAccounts((prev) => sortAccounts(prev.map((item) => (item.id === account.id ? account : item))))
        setAccountsError(null)
        void refreshAuthStatus()
        return account
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to remove the platform. Please try again.'
        setAccountsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [refreshAuthStatus]
  )

  const registerSearch = useCallback((bridge: SearchBridge | null) => {
    setSearchBridge(bridge)
    setSearchValue(bridge?.getQuery() ?? '')
  }, [])

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value)
      searchBridge?.onQueryChange(value)
    },
    [searchBridge]
  )

  const toggleTheme = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }
    const root = document.documentElement
    const nextIsDark = !root.classList.contains('dark')
    root.classList.toggle('dark', nextIsDark)
    root.style.setProperty('color-scheme', nextIsDark ? 'dark' : 'light')
    setIsDark(nextIsDark)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextIsDark ? 'dark' : 'light')
    } catch (error) {
      console.warn('Unable to persist theme preference.', error)
    }
  }, [])

  const navLinkClassName = useCallback(
    ({ isActive }: { isActive: boolean }) =>
      `group relative inline-flex h-10 items-center justify-center rounded-[14px] px-4 text-sm font-medium transition ${
        isActive
          ? 'bg-[color:color-mix(in_srgb,var(--panel-strong)_70%,transparent)] text-[var(--fg)] shadow-[0_10px_24px_rgba(43,42,40,0.12)]'
          : 'text-[var(--muted)] hover:bg-[color:color-mix(in_srgb,var(--panel)_55%,transparent)] hover:text-[var(--fg)]'
      }`,
    []
  )

  const isLibraryRoute = location.pathname.startsWith('/library')
  const isClipEditRoute = /^\/clip\/[^/]+\/edit$/.test(location.pathname)
  const isSettingsRoute = location.pathname.startsWith('/settings')
  const isProfileRoute = location.pathname.startsWith('/profile')
  const showOverlay =
    !isProfileRoute &&
    (isCheckingAccess || accessStatus?.allowed === false || (!accessStatus && !!accessCheckError))
  const overlayTitle = isCheckingAccess
    ? 'Verifying access…'
    : accessStatus?.allowed === false
      ? accessStatus?.mode === 'subscription'
        ? 'Subscription required'
        : 'Trial unavailable'
      : 'Unable to verify access'
  const overlayMessage = isCheckingAccess
    ? 'Hold tight while we confirm your access permissions.'
    : accessStatus?.allowed === false
      ? accessStatus?.reason ?? 'No active subscription. Open billing to continue.'
      : accessCheckError ?? 'An unexpected error occurred while validating access.'
  const showBackButton = location.pathname.startsWith('/clip/')

  const accountSelectOptions = useMemo(() => {
    if (availableAccounts.length === 0) {
      return []
    }

    return availableAccounts.map((account) => ({
      value: account.id,
      label: account.displayName
    }))
  }, [availableAccounts])

  const accountSelectValue = useMemo(() => {
    if (accountSelectOptions.length === 0) {
      return null
    }

    const exists = availableAccounts.some((account) => account.id === homeState.selectedAccountId)
    return exists ? homeState.selectedAccountId : null
  }, [
    accountSelectOptions.length,
    availableAccounts,
    homeState.selectedAccountId
  ])

  const handleAccountSelectFromHeader = useCallback(
    (value: string) => {
      handleSelectAccount(value)
    },
    [handleSelectAccount]
  )

  const handleHeaderBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--fg)]">
      {showOverlay && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur">
          <div className="max-w-md rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_75%,transparent)] p-6 text-center shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            <h2 className="text-xl font-semibold text-[var(--fg)]">{overlayTitle}</h2>
            <p className="mt-3 text-sm text-[var(--muted)]">{overlayMessage}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  navigate('/profile')
                }}
                className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
                disabled={isCheckingAccess}
              >
                Open billing settings
              </button>
              <button
                type="button"
                onClick={() => {
                  void refreshAccessStatus()
                }}
                className="marble-button marble-button--outline px-4 py-2 text-sm font-semibold"
                disabled={isCheckingAccess}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-[60] border-b border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] backdrop-blur-md">
        <div className="flex w-full flex-col gap-4 px-6 py-5 lg:px-8">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {showBackButton ? (
                <button
                  type="button"
                  onClick={handleHeaderBack}
                  className="inline-flex items-center justify-center rounded-[14px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] px-3 py-1.5 text-sm font-medium text-[var(--fg)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] transition hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--panel-strong)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--panel)]"
                >
                  Back
                </button>
              ) : null}
              <h1 className="inline-flex items-center text-3xl font-semibold leading-none tracking-tight text-[var(--fg)]">
                Atropos
              </h1>
              <nav
                aria-label="Primary navigation"
                className="inline-flex h-12 items-center gap-2 rounded-[18px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] p-1 shadow-[0_18px_34px_rgba(43,42,40,0.16)] backdrop-blur"
              >
                <NavLink to="/" end className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Home" isActive={isActive} />}
                </NavLink>
                <NavLink to="/library" className={navLinkClassName}>
                  {({ isActive }) => (
                    <NavItemLabel
                      label="Library"
                      isActive={isActive}
                      badge={isClipEditRoute ? 'Edit mode' : null}
                    />
                  )}
                </NavLink>
                <NavLink to="/profile" className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Profile" isActive={isActive} />}
                </NavLink>
                <NavLink to="/settings" className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Settings" isActive={isActive} />}
                </NavLink>
              </nav>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              {isLibraryRoute ? (
                <div className="min-w-[220px] flex-1 basis-full sm:basis-auto sm:max-w-md">
                  <Search
                    ref={searchInputRef}
                    value={searchValue}
                    onChange={handleSearchChange}
                    disabled={!searchBridge}
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                {isSettingsRoute && settingsHeaderAction ? (
                  <button
                    type="button"
                    onClick={settingsHeaderAction.onSave}
                    className="inline-flex items-center justify-center rounded-[14px] bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--panel)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={settingsHeaderAction.isSaving || settingsHeaderAction.dirtyCount === 0}
                  >
                    {settingsHeaderAction.isSaving
                      ? 'Saving…'
                      : settingsHeaderAction.dirtyCount > 0
                        ? `Save changes (${settingsHeaderAction.dirtyCount})`
                        : 'Save changes'}
                  </button>
                ) : null}
                <div className="min-w-[200px] sm:min-w-[220px]">
                  <MarbleSelect
                    aria-label="Account selection"
                    value={accountSelectValue}
                    options={accountSelectOptions}
                    onChange={(value) => handleAccountSelectFromHeader(value)}
                    placeholder={
                      isLoadingAccounts
                        ? 'Loading accounts…'
                        : accountSelectOptions.length === 0
                          ? 'No available accounts'
                          : 'Select an account'
                    }
                    disabled={isLoadingAccounts || accountSelectOptions.length === 0}
                  />
                </div>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="rounded-[14px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--fg)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] transition hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--panel-strong)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--panel)]"
                  aria-label="Toggle theme"
                >
                  {isDark ? 'Light mode' : 'Dark mode'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 bg-[var(--bg)] text-[var(--fg)]">
        <Routes>
          <Route
            path="/"
            element={
              <Home
                registerSearch={registerSearch}
                initialState={homeState}
                onStateChange={setHomeState}
                accounts={accounts}
                onTrialConsumed={refreshAccessStatus}
              />
            }
          />
          <Route
            path="/library"
            element={
              <Library
                registerSearch={registerSearch}
                accounts={accounts}
                isLoadingAccounts={isLoadingAccounts}
              />
            }
          />
          <Route path="/clip/:id" element={<ClipPage registerSearch={registerSearch} />} />
          <Route path="/clip/:id/edit" element={<ClipEdit registerSearch={registerSearch} />} />
          <Route
            path="/settings"
            element={
              <Settings
                registerSearch={registerSearch}
                accounts={accounts}
                onRegisterHeaderAction={setSettingsHeaderAction}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <Profile
                registerSearch={registerSearch}
                accounts={accounts}
                accountsError={accountsError}
                authStatus={authStatus}
                authError={authError}
                accessStatus={accessStatus}
                accessError={accessCheckError}
                isCheckingAccess={isCheckingAccess}
                isLoadingAccounts={isLoadingAccounts}
                onCreateAccount={handleCreateAccount}
                onAddPlatform={handleAddPlatform}
                onUpdateAccount={handleUpdateAccount}
                onDeleteAccount={handleDeleteAccount}
                onUpdatePlatform={handleUpdatePlatform}
                onDeletePlatform={handleDeletePlatform}
                onRefreshAccounts={refreshAccounts}
                onRefreshAccessStatus={refreshAccessStatus}
              />
            }
          />
          <Route
            path="*"
            element={
              <Home
                registerSearch={registerSearch}
                initialState={homeState}
                onStateChange={setHomeState}
                accounts={accounts}
                onTrialConsumed={refreshAccessStatus}
              />
            }
          />
        </Routes>
      </main>
    </div>
  )
}

export default App
