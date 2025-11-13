import '@testing-library/jest-dom/vitest'
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { HomePipelineState, PipelineStep } from '../types'
import { fetchAccounts } from '../services/accountsApi'

const navigateMock = vi.fn()
let capturedOptions: any = null

const createDefaultUiState = () => ({
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
})

const createClipStepWithTotals = (step: PipelineStep, totalClips: number, completed: number): PipelineStep => ({
  ...step,
  clipProgress: { completed, total: totalClips },
  substeps: step.substeps.map((substep) => ({
    ...substep,
    totalClips,
    completedClips: Math.min(substep.completedClips, totalClips)
  }))
})

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock
  }
})

const uiStateContainer = {
  value: createDefaultUiState()
}

const updateUiStateMock = vi.fn((updater: (prev: typeof uiStateContainer.value) => typeof uiStateContainer.value) => {
  uiStateContainer.value = updater(uiStateContainer.value)
})

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
      pendingConsumption: false
    },
    markTrialRunPending: vi.fn(),
    finalizeTrialRun: vi.fn()
  })
}))

vi.mock('../services/accountsApi', () => ({
  fetchAccounts: vi.fn(async () => []),
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
  default: () => <div data-testid="marble-select" />
}))

vi.mock('../components/TrialBadge', () => ({
  __esModule: true,
  default: () => <div data-testid="trial-badge" />
}))

vi.mock('../pages/Home', () => ({
  __esModule: true,
  default: () => <div data-testid="home" />
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
  uiStateContainer.value = createDefaultUiState()
  updateUiStateMock.mockClear()
  vi.mocked(fetchAccounts).mockClear()
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
})

describe('App account selection persistence', () => {
  it('restores the previously active account when it is still available', async () => {
    const accountId = 'account-123'
    uiStateContainer.value.activeAccountId = accountId

    vi.mocked(fetchAccounts).mockResolvedValueOnce([
      {
        id: accountId,
        displayName: 'Creator One',
        description: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        platforms: [
          {
            platform: 'youtube',
            label: 'YouTube',
            status: 'active',
            connected: true,
            tokenPath: null,
            addedAt: '2024-01-01T00:00:00.000Z',
            lastVerifiedAt: null,
            active: true
          }
        ],
        active: true,
        tone: null,
        effectiveTone: null,
        defaultLayoutId: null
      }
    ])

    render(
      <MemoryRouter>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(capturedOptions).not.toBeNull()
      expect(capturedOptions.state.selectedAccountId).toBe(accountId)
    })
  })
})
