import '@testing-library/jest-dom/vitest'
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { HomePipelineState, PipelineStep } from '../types'

const navigateMock = vi.fn()
let capturedOptions: any = null
const FIXED_TIMESTAMP = '2024-01-01T00:00:00.000Z'

const createClipStepWithTotals = (step: PipelineStep, totalClips: number, completed: number): PipelineStep => ({
  ...step,
  clipProgress: { completed, total: totalClips },
  substeps: step.substeps.map((substep) => ({
    ...substep,
    totalClips,
    completedClips: Math.min(substep.completedClips, totalClips)
  }))
})

const createActiveAccount = (id: string, displayName = 'Creator Account') => ({
  id,
  displayName,
  description: null,
  createdAt: FIXED_TIMESTAMP,
  platforms: [
    {
      platform: 'youtube',
      label: 'YouTube',
      status: 'active',
      connected: true,
      tokenPath: null,
      addedAt: FIXED_TIMESTAMP,
      lastVerifiedAt: FIXED_TIMESTAMP,
      active: true
    }
  ],
  active: true,
  tone: null,
  effectiveTone: null,
  defaultLayoutId: null
})

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock
  }
})

const fetchAccountsMock = vi.hoisted(() => vi.fn(async () => []))

const uiStateContainer = {
  value: {
    activeTab: '/',
    activeAccountId: null as string | null,
    library: {
      expandedAccountIds: [] as string[],
      expandedProjectIds: [] as string[],
      selectedClipId: null as string | null,
      pageCounts: {} as Record<string, number>,
      scrollTop: 0,
      activeAccountId: null as string | null,
      pageSize: 20,
      accountScrollPositions: {} as Record<string, number>
    }
  }
}

const updateUiStateMock = vi.fn((updater: (prev: typeof uiStateContainer.value) => typeof uiStateContainer.value) => {
  uiStateContainer.value = updater(uiStateContainer.value)
})

const homePropsContainer = {
  latest: null as any
}

const marbleSelectPropsContainer = {
  latest: null as any
}

vi.mock('../state/uiState', () => ({
  useUiState: () => ({
    state: uiStateContainer.value,
    updateState: updateUiStateMock
  })
}))

vi.mock('../state/usePipelineProgress', () => ({
  __esModule: true,
  default: (options: any) => {
    capturedOptions = options
    return { startPipeline: vi.fn(), resumePipeline: vi.fn(), cleanup: vi.fn() }
  }
}))

vi.mock('../state/access', () => ({
  useAccess: () => ({
    state: {
      isLoading: false,
      isSubscriptionActive: true,
      isTrialActive: false,
      isOffline: false,
      accessTokenExpiresAt: null,
      pendingConsumption: false
    },
    markTrialRunPending: vi.fn(),
    finalizeTrialRun: vi.fn()
  })
}))

vi.mock('../services/accountsApi', () => ({
  fetchAccounts: fetchAccountsMock,
  pingAuth: vi.fn(async () => null),
  createAccount: vi.fn(),
  addPlatformToAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountPlatform: vi.fn(),
  deleteAccountPlatform: vi.fn()
}))

vi.mock('../components/Search', () => ({
  __esModule: true,
  default: () => <div data-testid="search" />
}))

vi.mock('../components/MarbleSelect', () => ({
  __esModule: true,
  default: (props: any) => {
    marbleSelectPropsContainer.latest = props
    return <div data-testid="marble-select" />
  }
}))

vi.mock('../components/TrialBadge', () => ({
  __esModule: true,
  default: () => <div data-testid="trial-badge" />
}))

vi.mock('../pages/Home', () => ({
  __esModule: true,
  default: (props: any) => {
    homePropsContainer.latest = props
    return <div data-testid="home" />
  }
}))

vi.mock('../pages/Library', () => ({
  __esModule: true,
  default: () => <div data-testid="library" />
}))

vi.mock('../pages/Profile', () => ({
  __esModule: true,
  default: () => <div data-testid="profile" />
}))

vi.mock('../pages/Settings', () => ({
  __esModule: true,
  default: () => <div data-testid="settings" />
}))

vi.mock('../pages/Clip', () => ({
  __esModule: true,
  default: () => <div data-testid="clip" />
}))

vi.mock('../pages/ClipEdit', () => ({
  __esModule: true,
  default: () => <div data-testid="clip-edit" />
}))

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }) as MediaQueryList
  }
})

beforeEach(() => {
  capturedOptions = null
  navigateMock.mockReset()
  fetchAccountsMock.mockResolvedValue([])
  updateUiStateMock.mockClear()
  uiStateContainer.value = {
    activeTab: '/',
    activeAccountId: null,
    library: {
      expandedAccountIds: [],
      expandedProjectIds: [],
      selectedClipId: null,
      pageCounts: {},
      scrollTop: 0,
      activeAccountId: null,
      pageSize: 20,
      accountScrollPositions: {}
    }
  }
  homePropsContainer.latest = null
  marbleSelectPropsContainer.latest = null
})

describe('App library navigation behaviour', () => {
  it('navigates to the library when a single clip is expected', () => {
    render(
      <MemoryRouter>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    expect(capturedOptions).not.toBeNull()
    act(() => {
      capturedOptions.onFirstClipReady?.({ jobId: 'job-single' })
    })

    expect(navigateMock).toHaveBeenCalledWith('/library')
  })

  it('defers navigation when multiple clips are expected', () => {
    render(
      <MemoryRouter>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    expect(capturedOptions).not.toBeNull()
    act(() => {
      capturedOptions.setState((prev: HomePipelineState) => {
        const updatedSteps = prev.steps.map((step) =>
          step.id === 'produce-clips' ? createClipStepWithTotals(step, 3, 1) : step
        )
        return {
          ...prev,
          isProcessing: true,
          steps: updatedSteps
        }
      })
    })

    act(() => {
      capturedOptions.onFirstClipReady?.({ jobId: 'job-multi' })
    })

    expect(navigateMock).not.toHaveBeenCalledWith('/library')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('restores the stored account selection when available', async () => {
    const accountId = 'account-1'
    uiStateContainer.value = {
      ...uiStateContainer.value,
      activeAccountId: accountId
    }
    fetchAccountsMock.mockResolvedValue([createActiveAccount(accountId)])

    render(
      <MemoryRouter>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(homePropsContainer.latest?.initialState.selectedAccountId).toBe(accountId)
    })
    await waitFor(() => {
      expect(uiStateContainer.value.activeAccountId).toBe(accountId)
    })
  })

  it('does not clear the stored account while accounts are loading', async () => {
    const accountId = 'account-persisted'
    uiStateContainer.value = {
      ...uiStateContainer.value,
      activeAccountId: accountId
    }

    let resolveAccounts: ((accounts: any[]) => void) | null = null
    fetchAccountsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAccounts = resolve
        })
    )

    render(
      <MemoryRouter>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(uiStateContainer.value.activeAccountId).toBe(accountId)
    expect(resolveAccounts).not.toBeNull()

    await act(async () => {
      resolveAccounts?.([createActiveAccount(accountId)])
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(homePropsContainer.latest?.initialState.selectedAccountId).toBe(accountId)
    })
    await waitFor(() => {
      expect(uiStateContainer.value.activeAccountId).toBe(accountId)
    })
  })

  it('persists the account selection when the user picks an account', async () => {
    const accountId = 'account-7'
    fetchAccountsMock.mockResolvedValue([createActiveAccount(accountId)])

    render(
      <MemoryRouter>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(marbleSelectPropsContainer.latest).not.toBeNull()
    })

    act(() => {
      marbleSelectPropsContainer.latest.onChange(accountId, {
        value: accountId,
        label: 'Creator Account'
      })
    })

    await waitFor(() => {
      expect(uiStateContainer.value.activeAccountId).toBe(accountId)
    })
  })
})
