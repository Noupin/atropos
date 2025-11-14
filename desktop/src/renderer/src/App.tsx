import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC, MouseEvent, ReactNode, RefObject } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import MarbleSelect from './components/MarbleSelect'
import TrialBadge from './components/TrialBadge'
import ClipPage from './pages/Clip'
import VideoPage from './pages/VideoPage'
import Home from './pages/Home'
import Library from './pages/Library'
import Profile from './pages/Profile'
import Settings, { type SettingsHeaderAction } from './pages/Settings'
import { createInitialPipelineSteps } from './data/pipeline'
import { BACKEND_MODE } from './config/backend'
import useNavigationHistory from './hooks/useNavigationHistory'
import usePipelineProgress from './state/usePipelineProgress'
import { useAccess } from './state/access'
import {
  clamp01,
  summarisePipelineProgress,
  type PipelineOverallStatus
} from './lib/pipelineProgress'
import type {
  AccountSummary,
  AuthPingSummary,
  Clip,
  HomePipelineState,
  SupportedPlatform
} from './types'
import { useUiState } from './state/uiState'
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

type NavItemBadgeVariant = 'accent' | 'info' | 'success' | 'error'

type NavItemBadge = {
  label: string
  variant?: NavItemBadgeVariant
}

type NavItemProgress = {
  fraction: number
  status: PipelineOverallStatus
  srLabel?: string
}

type PendingLibraryProject = {
  jobId: string
  accountId: string | null
  projectId: string
  title: string
  completedClips: number
  totalClips: number | null
}

type NavItemLabelProps = {
  label: string
  isActive: boolean
  badge?: NavItemBadge | null
  progress?: NavItemProgress | null
  children?: ReactNode
}

type LibraryAttachment = {
  key: 'video-trim' | 'video-metadata' | 'video-upload'
  label: string
  ariaLabel: string
  srText: string | null
  variant: 'edit' | 'video'
  indicator?: ReactNode
  to?: string
  end?: boolean
  state?: unknown
}

type LibraryAttachmentLabelProps = {
  label: string
  srText: string | null
  variant: LibraryAttachment['variant']
  isActive: boolean
  isLastAttachment: boolean
  indicator?: ReactNode
}

const LegacyClipEditRedirect: FC = () => {
  const { id } = useParams<{ id: string }>()
  if (!id) {
    return <Navigate to="/library" replace />
  }
  const encodedId = encodeURIComponent(id)
  return <Navigate to={`/video/${encodedId}?mode=trim`} replace />
}

const LegacyWorkspaceRedirect: FC = () => {
  const { id } = useParams<{ id: string }>()
  if (!id) {
    return <Navigate to="/library" replace />
  }
  const encodedId = encodeURIComponent(id)
  return <Navigate to={`/video/${encodedId}?mode=trim`} replace />
}

const LegacyVideoPathRedirect: FC = () => {
  const { id, legacyMode } = useParams<{ id: string; legacyMode?: string }>()
  if (!id) {
    return <Navigate to="/library" replace />
  }
  const mode = legacyMode === 'metadata' || legacyMode === 'upload' ? legacyMode : 'trim'
  const encodedId = encodeURIComponent(id)
  return <Navigate to={`/video/${encodedId}?mode=${mode}`} replace />
}

const badgeVariantClasses: Record<NavItemBadgeVariant, string> = {
  accent:
    'border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--accent)_80%,transparent)] text-[color:var(--accent-contrast)]',
  info:
    'border-[color:color-mix(in_srgb,var(--info-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--info-soft)_78%,transparent)] text-[color:color-mix(in_srgb,var(--info-strong)_88%,var(--accent-contrast))]',
  success:
    'border-[color:color-mix(in_srgb,var(--success-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--success-soft)_80%,transparent)] text-[color:color-mix(in_srgb,var(--success-strong)_90%,var(--accent-contrast))]',
  error:
    'border-[color:color-mix(in_srgb,var(--error-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--error-soft)_78%,transparent)] text-[color:color-mix(in_srgb,var(--error-strong)_90%,var(--accent-contrast))]'
}

const progressStatusClasses: Record<PipelineOverallStatus, string> = {
  idle: 'bg-[color:var(--edge-soft)]',
  active: 'bg-[color:var(--info-strong)]',
  completed: 'bg-[color:var(--success-strong)]',
  failed: 'bg-[color:var(--error-strong)]'
}

const NavItemLabel: FC<NavItemLabelProps> = ({ label, isActive, badge, progress, children }) => {
  const resolvedBadge = badge ? { label: badge.label, variant: badge.variant ?? 'accent' } : null
  const srProgressLabel = progress?.srLabel
    ?? (progress
        ? progress.status === 'completed'
          ? `${label} pipeline complete`
          : progress.status === 'failed'
            ? `${label} pipeline failed`
            : `${label} pipeline progress ${Math.round(clamp01(progress.fraction) * 100)}%`
        : null)
  const showProgress = progress && progress.status !== 'idle'
  const percent = showProgress ? Math.round(clamp01(progress.fraction) * 100) : 0
  const progressClass = progress ? progressStatusClasses[progress.status] : progressStatusClasses.idle

  return (
    <span className="relative flex h-full min-w-[72px] flex-col items-center justify-center px-2 text-center">
      {resolvedBadge ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] shadow-[0_10px_18px_rgba(43,42,40,0.18)] ${
            badgeVariantClasses[resolvedBadge.variant]
          }`}
        >
          {resolvedBadge.label}
        </span>
      ) : null}
      <span className="leading-none">
        {label}
        {resolvedBadge ? <span className="sr-only"> ({resolvedBadge.label})</span> : null}
      </span>
      {srProgressLabel ? <span className="sr-only">{srProgressLabel}</span> : null}
      {showProgress ? (
        <span
          aria-hidden
          className="pointer-events-none mt-1 flex h-1 w-12 items-center overflow-hidden rounded-full bg-[color:var(--edge-soft)]"
        >
          <span
            className={`block h-full ${progressClass} transition-all duration-300 ease-out`}
            style={{ width: `${percent}%` }}
          />
        </span>
      ) : (
        <span
          aria-hidden
          className={`pointer-events-none mt-1 block h-0.5 w-8 rounded-full transition ${
            isActive
              ? 'bg-[color:var(--accent)] opacity-100'
              : 'bg-[color:var(--edge-soft)] opacity-0 group-hover:opacity-60'
          }`}
        />
      )}
      {children}
    </span>
  )
}

const LibraryAttachmentLabel: FC<LibraryAttachmentLabelProps> = ({
  label,
  srText,
  variant,
  isActive,
  isLastAttachment,
  indicator
}) => {
  const surfaceTone =
    variant === 'video'
      ? 'bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--panel)_78%)] hover:bg-[color:color-mix(in_srgb,var(--accent)_18%,var(--panel)_80%)]'
      : 'bg-[color:color-mix(in_srgb,var(--panel)_78%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--panel-strong)_74%,transparent)]'
  const insetShadow = isActive
    ? 'shadow-[inset_2px_2px_6px_rgba(43,42,40,0.2),inset_-2px_-2px_6px_rgba(255,255,255,0.26),0_12px_26px_rgba(43,42,40,0.18)]'
    : 'shadow-[inset_2px_2px_6px_rgba(43,42,40,0.16),inset_-2px_-2px_6px_rgba(255,255,255,0.22)]'
  const edgeRounding = [
    'rounded-[16px]',
    'rounded-l-none',
    !isLastAttachment ? 'rounded-r-none' : null
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className="pointer-events-none relative inline-flex h-10 items-center">
      <span
        aria-hidden
        className={`pointer-events-none inline-flex h-10 min-w-[72px] items-center justify-center border border-[color:color-mix(in_srgb,var(--edge-soft)_82%,transparent)] px-5 text-sm font-medium leading-none text-[var(--fg)] transition ${surfaceTone} ${insetShadow} ${edgeRounding}`}
      >
        <span className="flex items-center gap-2">
          <span>{label}</span>
          {indicator ? (
            <span className="pointer-events-none inline-flex items-center justify-center text-[10px] font-semibold">
              {indicator}
            </span>
          ) : null}
        </span>
      </span>
      {srText ? <span className="sr-only">{srText}</span> : null}
    </span>
  )
}

type AppProps = {
  searchInputRef: RefObject<HTMLInputElement | null>
}

const App: FC<AppProps> = ({ searchInputRef }) => {
  const [homeState, setHomeState] = useState<HomePipelineState>(() => ({
    videoUrl: '',
    localFilePath: null,
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
    awaitingReview: false,
    lastRunProducedNoClips: false,
    lastRunClipSummary: null,
    lastRunClipStatus: null,
    downloads: {
      audioUrl: null,
      transcriptUrl: null,
      subtitlesUrl: null,
      sourceKind: null
    }
  }))
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [authStatus, setAuthStatus] = useState<AuthPingSummary | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(false)
  const [settingsHeaderAction, setSettingsHeaderAction] = useState<SettingsHeaderAction | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { state: uiState, updateState } = useUiState()
  const { state: accessState, markTrialRunPending, finalizeTrialRun } = useAccess()
  const accessRestricted =
    !accessState.isLoading &&
    !accessState.isSubscriptionActive &&
    !accessState.isTrialActive &&
    !accessState.isOffline
  const homeNavigationDisabled = accessRestricted
  const libraryNavigationDisabled = false
  const redirectedJobRef = useRef<string | null>(null)
  const lastActiveJobIdRef = useRef<string | null>(null)
  const hasRestoredTabRef = useRef(false)
  const hasHydratedAccountRef = useRef(false)
  const isOnHomePage = location.pathname === '/'

  const preventDisabledNavigation = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
  }, [])

  useNavigationHistory()

  useEffect(() => {
    if (hasRestoredTabRef.current) {
      return
    }
    hasRestoredTabRef.current = true
    const storedTab = uiState.activeTab
    if (storedTab && storedTab !== location.pathname) {
      navigate(storedTab, { replace: true })
    }
  }, [location.pathname, navigate, uiState.activeTab])

  useEffect(() => {
    if (!hasRestoredTabRef.current) {
      return
    }
    updateState((previous) => {
      if (previous.activeTab === location.pathname) {
        return previous
      }
      return { ...previous, activeTab: location.pathname }
    })
  }, [location.pathname, updateState])

  useEffect(() => {
    if (!hasHydratedAccountRef.current) {
      return
    }

    updateState((previous) => {
      if (previous.activeAccountId === homeState.selectedAccountId) {
        return previous
      }
      return { ...previous, activeAccountId: homeState.selectedAccountId }
    })
  }, [homeState.selectedAccountId, updateState])
  const availableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.active && account.platforms.some((platform) => platform.active)
      ),
    [accounts]
  )

  const isMockBackend = BACKEND_MODE === 'mock'

  const homeProgressSummary = useMemo(
    () => summarisePipelineProgress(homeState.steps),
    [homeState.steps]
  )

  const homeNavProgress = useMemo(() => {
    if (homeProgressSummary.status === 'idle') {
      return null
    }
    const fraction = homeProgressSummary.status === 'completed' ? 1 : clamp01(homeProgressSummary.fraction)
    const percent = Math.round(fraction * 100)
    const srLabel =
      homeProgressSummary.status === 'completed'
        ? 'Pipeline run complete'
        : homeProgressSummary.status === 'failed'
          ? `Pipeline run failed at ${percent}%`
          : `Pipeline progress ${percent}%`
    return {
      fraction,
      status: homeProgressSummary.status,
      srLabel
    }
  }, [homeProgressSummary])

  const homeNavBadge = useMemo(() => {
    if (homeProgressSummary.status === 'completed') {
      return { label: 'Done', variant: 'success' } satisfies NavItemBadge
    }
    if (homeProgressSummary.status === 'failed') {
      return { label: 'Failed', variant: 'error' } satisfies NavItemBadge
    }
    if (homeState.awaitingReview) {
      return { label: 'Needs review', variant: 'info' } satisfies NavItemBadge
    }
    return null
  }, [homeProgressSummary.status, homeState.awaitingReview])

  const clipProductionTargets = useMemo(() => {
    const clipStep = homeState.steps.find((step) => step.id === 'produce-clips')
    if (!clipStep) {
      return { expectedTotal: null, completed: 0 }
    }

    const clipProgress = clipStep.clipProgress
    const completedFromProgress = clipProgress ? Math.max(0, clipProgress.completed) : 0
    const totals = clipStep.substeps.map((substep) => Math.max(0, substep.totalClips))
    if (clipProgress) {
      totals.push(Math.max(0, clipProgress.total))
    }
    const expectedTotal = totals.reduce((max, value) => Math.max(max, value), 0)

    return {
      expectedTotal: expectedTotal > 0 ? expectedTotal : null,
      completed: completedFromProgress
    }
  }, [homeState.steps])

  const shouldDelayLibraryRedirect = useMemo(
    () =>
      clipProductionTargets.expectedTotal !== null &&
      clipProductionTargets.expectedTotal > 1 &&
      homeProgressSummary.status !== 'completed',
    [clipProductionTargets.expectedTotal, homeProgressSummary.status]
  )

  const handleFirstClipReady = useCallback(
    ({ jobId }: { jobId: string }) => {
      if (
        redirectedJobRef.current === jobId ||
        libraryNavigationDisabled ||
        shouldDelayLibraryRedirect
      ) {
        return
      }
      redirectedJobRef.current = jobId
      navigate('/library')
    },
    [navigate, libraryNavigationDisabled, shouldDelayLibraryRedirect]
  )

  const handlePipelineFinished = useCallback(
    ({
      jobId,
      success,
      producedClips
    }: {
      jobId: string
      success: boolean
      producedClips: number
    }) => {
      if (
        !success ||
        producedClips === 0 ||
        redirectedJobRef.current === jobId ||
        !isOnHomePage ||
        libraryNavigationDisabled
      ) {
        return
      }
      redirectedJobRef.current = jobId
      navigate('/library')
    },
    [isOnHomePage, navigate, libraryNavigationDisabled]
  )

  const { startPipeline, resumePipeline, cancelPipeline } = usePipelineProgress({
    state: homeState,
    setState: setHomeState,
    availableAccounts,
    markTrialRunPending,
    finalizeTrialRun,
    isTrialActive: accessState.isTrialActive,
    hasPendingTrialRun: accessState.pendingConsumption,
    isMockBackend,
    onFirstClipReady: handleFirstClipReady,
    onPipelineFinished: handlePipelineFinished
  })

  const homeRouteElement = useMemo(() => {
    if (accessRestricted) {
      return <Navigate to="/profile" replace state={{ reason: 'subscription-required' }} />
    }
    return (
      <Home
        initialState={homeState}
        onStateChange={setHomeState}
        accounts={accounts}
        onStartPipeline={startPipeline}
        onResumePipeline={resumePipeline}
        onCancelPipeline={cancelPipeline}
      />
    )
  }, [
    accessRestricted,
    accounts,
    homeState,
    cancelPipeline,
    resumePipeline,
    startPipeline
  ])

  useEffect(() => {
    const currentJobId = homeState.activeJobId
    if (currentJobId && currentJobId !== lastActiveJobIdRef.current) {
      redirectedJobRef.current = null
      lastActiveJobIdRef.current = currentJobId
      return
    }
    if (!currentJobId) {
      lastActiveJobIdRef.current = null
      redirectedJobRef.current = null
    }
  }, [homeState.activeJobId])

  const pendingLibraryProjects = useMemo(() => {
    if (!homeState.isProcessing || !homeState.activeJobId || homeState.clips.length === 0) {
      return [] as PendingLibraryProject[]
    }

    const completedClips = Math.max(
      homeState.clips.length,
      clipProductionTargets.completed
    )
    const totalClips =
      clipProductionTargets.expectedTotal !== null
        ? Math.max(clipProductionTargets.expectedTotal, completedClips)
        : null
    const latestClip = homeState.clips[0]
    const projectId = latestClip.videoId || latestClip.id
    const title = latestClip.videoTitle || latestClip.sourceTitle || latestClip.title

    return [
      {
        jobId: homeState.activeJobId,
        accountId: latestClip.accountId ?? null,
        projectId,
        title,
        completedClips,
        totalClips
      }
    ] satisfies PendingLibraryProject[]
  }, [
    clipProductionTargets,
    homeState.activeJobId,
    homeState.clips,
    homeState.isProcessing,
    homeState.steps
  ])

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
          hasHydratedAccountRef.current = true
          return {
            ...prev,
            selectedAccountId: soleAccountId,
            accountError: null
          }
        }
        return prev
      }

      if (prev.selectedAccountId && !activeAccountIds.has(prev.selectedAccountId)) {
        hasHydratedAccountRef.current = true
        return {
          ...prev,
          selectedAccountId: null,
          clips: [],
          selectedClipId: null,
          accountError: null
        }
      }

      if (
        !prev.selectedAccountId &&
        uiState.activeAccountId &&
        activeAccountIds.has(uiState.activeAccountId)
      ) {
        hasHydratedAccountRef.current = true
        return {
          ...prev,
          selectedAccountId: uiState.activeAccountId,
          accountError: null
        }
      }

      return prev
    })
  }, [availableAccounts, setHomeState, uiState.activeAccountId])

  const handleSelectAccount = useCallback(
    (accountId: string | null) => {
      hasHydratedAccountRef.current = true

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

      updateState((previous) => {
        if (previous.activeAccountId === accountId) {
          return previous
        }

        return { ...previous, activeAccountId: accountId }
      })
    },
    [setHomeState, updateState]
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
      payload: { active?: boolean; tone?: string | null; defaultLayoutId?: string | null }
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
    ({ isActive, disabled = false }: { isActive: boolean; disabled?: boolean }) => {
      const baseClass =
        'group relative inline-flex h-10 items-center justify-center rounded-[14px] px-4 text-sm font-medium transition'
      const activeClass = isActive
        ? ' bg-[color:color-mix(in_srgb,var(--panel-strong)_70%,transparent)] text-[var(--fg)] shadow-[0_10px_24px_rgba(43,42,40,0.12)]'
        : ' text-[var(--muted)] hover:bg-[color:color-mix(in_srgb,var(--panel)_55%,transparent)] hover:text-[var(--fg)]'
      const disabledClass = disabled
        ? ' pointer-events-none cursor-not-allowed opacity-60 hover:bg-transparent hover:text-[var(--muted)]'
        : ''
      return `${baseClass}${activeClass}${disabledClass}`
    },
    []
  )

  const isLibraryRoute = location.pathname.startsWith('/library')
  const isVideoRoute = /^\/video\//.test(location.pathname)
  const isSettingsRoute = location.pathname.startsWith('/settings')
  const isLibraryFamilyRoute = isLibraryRoute || isVideoRoute

  const videoLocationState =
    (isVideoRoute
      ? (location.state as { clip?: Clip; clipTitle?: string; accountId?: string | null } | null)
      : null) ?? null
  const videoClipTitle = useMemo(() => {
    if (!isVideoRoute) {
      return null
    }
    const title = videoLocationState?.clip?.title ?? videoLocationState?.clipTitle ?? null
    if (!title) {
      return null
    }
    return title.length <= 80 ? title : `${title.slice(0, 77).trimEnd()}…`
  }, [isVideoRoute, videoLocationState?.clip?.title, videoLocationState?.clipTitle])

  const videoMode = useMemo(() => {
    if (!isVideoRoute) {
      return null
    }
    const params = new URLSearchParams(location.search)
    const rawMode = params.get('mode')
    if (rawMode === 'metadata' || rawMode === 'upload') {
      return rawMode
    }
    return 'trim'
  }, [isVideoRoute, location.search])

  const currentLocationTarget = useMemo(
    () => ({ pathname: location.pathname, search: location.search, hash: location.hash }),
    [location.pathname, location.search, location.hash]
  )

  const libraryAttachments = useMemo(() => {
    if (!isVideoRoute) {
      return [] as LibraryAttachment[]
    }

    const match = location.pathname.match(/^\/video\/([^/]+)/)
    const clipSegment = match?.[1] ?? null

    if (!clipSegment || !videoMode) {
      return [] as LibraryAttachment[]
    }

    const navState = videoLocationState ? { ...videoLocationState } : undefined
    const tabDefinitions: Array<{ id: 'trim' | 'metadata' | 'upload'; label: string; ariaFallback: string }> = [
      { id: 'trim', label: 'Trim', ariaFallback: 'Trim video' },
      { id: 'metadata', label: 'Metadata', ariaFallback: 'Edit video metadata' },
      { id: 'upload', label: 'Upload', ariaFallback: 'Manage upload settings' }
    ]

    const activeDefinition = tabDefinitions.find((definition) => definition.id === videoMode)

    if (!activeDefinition) {
      return [] as LibraryAttachment[]
    }

    const to = `/video/${clipSegment}?mode=${activeDefinition.id}`

    return [
      {
        key: `video-${activeDefinition.id}`,
        label: activeDefinition.label,
        ariaLabel: videoClipTitle
          ? `${activeDefinition.label} for ${videoClipTitle}`
          : activeDefinition.ariaFallback,
        srText: videoClipTitle ? `Current video: ${videoClipTitle}` : null,
        variant: 'video',
        to,
        end: activeDefinition.id === 'trim',
        state: navState
      } satisfies LibraryAttachment
    ]
  }, [
    isVideoRoute,
    location.pathname,
    videoClipTitle,
    videoLocationState,
    videoMode
  ])

  const libraryNavLinkClassName = useCallback(
    ({ isActive }: { isActive: boolean }) => {
      const derivedActive = isActive || isLibraryFamilyRoute
      const base = navLinkClassName({ isActive: derivedActive, disabled: libraryNavigationDisabled })
      if (libraryAttachments.length === 0) {
        return base
      }
      return `${base} !rounded-r-none !bg-[color:color-mix(in_srgb,var(--panel)_76%,transparent)] !pr-4 !text-[var(--fg)] shadow-[0_18px_32px_rgba(43,42,40,0.18)]`
    },
    [
      isLibraryFamilyRoute,
      libraryAttachments.length,
      libraryNavigationDisabled,
      navLinkClassName
    ]
  )

  const libraryAttachmentNavLinkClassName = useCallback(
    (_: { isActive: boolean }) =>
      'group relative inline-flex h-10 items-center -ml-2 mr-2 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]',
    []
  )

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

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header className="sticky top-0 z-[60] border-b border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] backdrop-blur-md">
        <div className="flex w-full flex-col gap-4 px-6 py-5 lg:px-8">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="inline-flex items-center text-3xl font-semibold leading-none tracking-tight text-[var(--fg)]">
                Atropos
              </h1>
              <nav
                aria-label="Primary navigation"
                className="inline-flex h-12 items-center gap-2 rounded-[18px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] p-1 shadow-[0_18px_34px_rgba(43,42,40,0.16)] backdrop-blur"
              >
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    navLinkClassName({ isActive, disabled: homeNavigationDisabled })
                  }
                  aria-disabled={homeNavigationDisabled ? true : undefined}
                  tabIndex={homeNavigationDisabled ? -1 : undefined}
                  onClick={homeNavigationDisabled ? preventDisabledNavigation : undefined}
                >
                  {({ isActive }) => (
                    <NavItemLabel
                      label="Home"
                      isActive={isActive}
                      badge={homeNavBadge}
                      progress={homeNavProgress}
                    />
                  )}
                </NavLink>
                <NavLink
                  to="/library"
                  className={({ isActive }) => libraryNavLinkClassName({ isActive })}
                  aria-disabled={libraryNavigationDisabled ? true : undefined}
                  tabIndex={libraryNavigationDisabled ? -1 : undefined}
                  onClick={libraryNavigationDisabled ? preventDisabledNavigation : undefined}
                >
                  {({ isActive }) => (
                    <NavItemLabel
                      label="Library"
                      isActive={isActive || isLibraryFamilyRoute}
                    />
                  )}
                </NavLink>
                {libraryAttachments.map((attachment, index) => (
                  <NavLink
                    key={attachment.key}
                    to={attachment.to ?? currentLocationTarget}
                    end={attachment.end}
                    state={attachment.state}
                    className={libraryAttachmentNavLinkClassName}
                    aria-label={attachment.ariaLabel}
                  >
                    {({ isActive }) => (
                      <LibraryAttachmentLabel
                        label={attachment.label}
                        srText={attachment.srText}
                        variant={attachment.variant}
                        isActive={isActive}
                        isLastAttachment={index === libraryAttachments.length - 1}
                        indicator={attachment.indicator}
                      />
                    )}
                  </NavLink>
                ))}
                <NavLink to="/profile" className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Profile" isActive={isActive} />}
                </NavLink>
                <NavLink to="/settings" className={navLinkClassName}>
                  {({ isActive }) => <NavItemLabel label="Settings" isActive={isActive} />}
                </NavLink>
              </nav>
              <TrialBadge />
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
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
          <Route path="/" element={homeRouteElement} />
          <Route
            path="/library"
            element={
              <Library
                searchInputRef={searchInputRef}
                accounts={accounts}
                isLoadingAccounts={isLoadingAccounts}
                pendingProjects={pendingLibraryProjects}
              />
            }
          />
          <Route path="/video/:id/:legacyMode" element={<LegacyVideoPathRedirect />} />
          <Route path="/video/:id" element={<VideoPage />} />
          <Route path="/clip/:id" element={<ClipPage />} />
          <Route path="/clip/:id/edit" element={<LegacyClipEditRedirect />} />
          <Route path="/workspace/:id" element={<LegacyWorkspaceRedirect />} />
          <Route
            path="/settings"
            element={
              <Settings
                accounts={accounts}
                onRegisterHeaderAction={setSettingsHeaderAction}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <Profile
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
          <Route path="*" element={homeRouteElement} />
        </Routes>
      </main>
    </div>
  )
}

export default App
