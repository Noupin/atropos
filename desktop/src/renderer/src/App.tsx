import { useCallback, useEffect, useState } from 'react'
import type { FC, RefObject } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import Search from './components/Search'
import ClipPage from './pages/Clip'
import Home from './pages/Home'
import Profile from './pages/Profile'
import { createInitialPipelineSteps } from './data/pipeline'
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

const sortAccounts = (items: AccountSummary[]): AccountSummary[] =>
  [...items].sort((a, b) => a.displayName.localeCompare(b.displayName))

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
    activeJobId: null
  }))
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [authStatus, setAuthStatus] = useState<AuthPingSummary | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') {
      return true
    }
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const root = document.documentElement
    if (!root.classList.contains('dark')) {
      root.classList.add('dark')
    }
    setIsDark(root.classList.contains('dark'))
    document.title = 'Atropos'
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
    if (root.classList.contains('dark')) {
      root.classList.remove('dark')
      setIsDark(false)
    } else {
      root.classList.add('dark')
      setIsDark(true)
    }
  }, [])

  const navLinkClassName = useCallback(
    ({ isActive }: { isActive: boolean }) =>
      `rounded-lg px-3 py-1.5 text-sm transition ${
        isActive
          ? 'bg-[color:color-mix(in_srgb,var(--card)_80%,transparent)] text-[var(--fg)] shadow-sm'
          : 'text-[var(--muted)] hover:bg-white/10 hover:text-[var(--fg)]'
      }`,
    []
  )

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header className="border-b border-white/10 bg-[color:color-mix(in_srgb,var(--card)_40%,transparent)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg)]">Atropos</h1>
              <nav
                aria-label="Primary navigation"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-1"
              >
                <NavLink to="/" end className={navLinkClassName}>
                  Library
                </NavLink>
                <NavLink to="/profile" className={navLinkClassName}>
                  Profile
                </NavLink>
              </nav>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="self-start rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] md:self-auto"
              aria-label="Toggle theme"
            >
              {isDark ? 'Switch to light' : 'Switch to dark'}
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
      <main className="flex flex-1 justify-center bg-[var(--bg)] text-[var(--fg)]">
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
          <Route path="/clip/:id" element={<ClipPage registerSearch={registerSearch} />} />
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
