import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC, RefObject } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import Search from './components/Search'
import ClipPage from './pages/Clip'
import ClipEdit from './pages/ClipEdit'
import Home from './pages/Home'
import Library from './pages/Library'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
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

type PlatformPayload = {
  platform: SupportedPlatform
  label?: string | null
  credentials?: Record<string, unknown>
}

const THEME_STORAGE_KEY = 'atropos:theme'

const sortAccounts = (items: AccountSummary[]): AccountSummary[] =>
  [...items].sort((a, b) => a.displayName.localeCompare(b.displayName))

const NavItemLabel: FC<{ label: string; isActive: boolean }> = ({ label, isActive }) => (
  <span className="flex flex-col items-center gap-1">
    <span>{label}</span>
    <span
      aria-hidden
      className={`h-0.5 w-8 rounded-full transition ${
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
  const [isDark, setIsDark] = useState(false)

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
    async (accountId: string, payload: { active?: boolean }) => {
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
      `group relative rounded-[14px] px-3 py-1.5 text-sm transition ${
        isActive
          ? 'bg-[color:color-mix(in_srgb,var(--panel-strong)_70%,transparent)] text-[var(--fg)] shadow-[0_10px_24px_rgba(43,42,40,0.12)]'
          : 'text-[var(--muted)] hover:bg-[color:color-mix(in_srgb,var(--panel)_55%,transparent)] hover:text-[var(--fg)]'
      }`,
    []
  )

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header className="border-b border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] backdrop-blur-md">
        <div className="flex w-full flex-col gap-4 px-6 py-5 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-[var(--fg)]">Atropos</h1>
              <nav
                aria-label="Primary navigation"
                className="flex items-center gap-2 rounded-[18px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] p-1 shadow-[0_18px_34px_rgba(43,42,40,0.16)] backdrop-blur"
              >
                <NavLink to="/" end className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Home" isActive={isActive} />}
                </NavLink>
                <NavLink to="/library" className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Library" isActive={isActive} />}
                </NavLink>
                <NavLink to="/settings" className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Settings" isActive={isActive} />}
                </NavLink>
                <NavLink to="/profile" className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Profile" isActive={isActive} />}
                </NavLink>
              </nav>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="self-start rounded-[14px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--fg)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] transition hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--panel-strong)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--panel)] md:self-auto"
              aria-label="Toggle theme"
            >
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
          <Search
            ref={searchInputRef}
            value={searchValue}
            onChange={handleSearchChange}
            disabled={!searchBridge}
          />
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
              />
            }
          />
          <Route
            path="/library"
            element={
              <Library
                registerSearch={registerSearch}
                accounts={accounts}
                selectedAccountId={homeState.selectedAccountId}
                onSelectAccount={handleSelectAccount}
                isLoadingAccounts={isLoadingAccounts}
              />
            }
          />
          <Route path="/clip/:id" element={<ClipPage registerSearch={registerSearch} />} />
          <Route path="/clip/:id/edit" element={<ClipEdit registerSearch={registerSearch} />} />
          <Route path="/settings" element={<Settings registerSearch={registerSearch} />} />
          <Route
            path="/profile"
            element={
              <Profile
                registerSearch={registerSearch}
                accounts={accounts}
                accountsError={accountsError}
                authStatus={authStatus}
                authError={authError}
                isLoadingAccounts={isLoadingAccounts}
                onCreateAccount={handleCreateAccount}
                onAddPlatform={handleAddPlatform}
                onUpdateAccount={handleUpdateAccount}
                onDeleteAccount={handleDeleteAccount}
                onUpdatePlatform={handleUpdatePlatform}
                onDeletePlatform={handleDeletePlatform}
                onRefreshAccounts={refreshAccounts}
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
              />
            }
          />
        </Routes>
      </main>
    </div>
  )
}

export default App
