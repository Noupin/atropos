import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Home from '../pages/Home'
import { createInitialPipelineSteps } from '../data/pipeline'
import { AccessProvider } from '../state/access'
import type { AccessStatusPayload } from '../services/licensing'
import type {
  AccountPlatformConnection,
  AccountSummary,
  HomePipelineState
} from '../types'
import type { PipelineStep } from '../types'

const licensingMocks = vi.hoisted(() => {
  const accessStatus: AccessStatusPayload = {
    deviceHash: 'device-test',
    access: { source: 'subscription', isActive: true },
    subscription: {
      customerId: 'cus_test',
      subscriptionId: 'sub_test',
      status: 'active',
      currentPeriodEnd: new Date('2025-05-03T09:00:00Z').toISOString(),
      cancelAtPeriodEnd: false,
      priceId: 'price_test',
      updatedAt: new Date('2025-05-02T09:00:00Z').toISOString()
    },
    trial: {
      totalRuns: 3,
      remainingRuns: 3,
      isTrialAllowed: true,
      startedAt: new Date('2025-05-01T09:00:00Z').toISOString()
    },
    transfer: {
      status: 'none',
      email: null,
      initiatedAt: null,
      expiresAt: null,
      completedAt: null,
      targetDeviceHash: null
    }
  }
  return {
    accessStatus,
    fetchAccessStatusMock: vi.fn(async () => accessStatus)
  }
})

vi.mock('../services/device', () => ({
  getOrCreateDeviceHash: () => 'device-test'
}))

vi.mock('../services/licensing', () => ({
  fetchTrialStatus: vi.fn(async () => licensingMocks.accessStatus.trial),
  startTrial: vi.fn(async () => licensingMocks.accessStatus.trial),
  consumeTrial: vi.fn(async () => licensingMocks.accessStatus.trial),
  fetchAccessStatus: licensingMocks.fetchAccessStatusMock,
  createSubscriptionCheckout: vi.fn(async () => ({
    sessionId: 'sess_test',
    checkoutUrl: 'https://example.com/checkout'
  })),
  createBillingPortalSession: vi.fn(async () => ({
    portalUrl: 'https://example.com/portal'
  }))
}))

const createPlatform = (
  overrides: Partial<AccountPlatformConnection> = {}
): AccountPlatformConnection => ({
  platform: 'youtube',
  label: 'YouTube Channel',
  status: 'active',
  connected: true,
  tokenPath: '/tokens/account/youtube.json',
  addedAt: new Date('2024-05-01T12:00:00Z').toISOString(),
  lastVerifiedAt: new Date('2024-05-02T12:00:00Z').toISOString(),
  active: true,
  ...overrides
})

const AVAILABLE_ACCOUNT: AccountSummary = {
  id: 'account-active',
  displayName: 'Creator Hub',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [createPlatform()],
  active: true,
  tone: null,
  effectiveTone: 'funny'
}

const INACTIVE_ACCOUNT: AccountSummary = {
  id: 'account-disabled',
  displayName: 'Disabled Account',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [createPlatform()],
  active: false,
  tone: null,
  effectiveTone: 'funny'
}

const ACCOUNT_WITHOUT_PLATFORMS: AccountSummary = {
  id: 'account-empty',
  displayName: 'No Platforms',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [],
  active: true,
  tone: null,
  effectiveTone: 'funny'
}

const ACCOUNT_WITH_DISABLED_PLATFORM: AccountSummary = {
  id: 'account-platform-disabled',
  displayName: 'Platform Disabled',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [createPlatform({ active: false })],
  active: true,
  tone: null,
  effectiveTone: 'funny'
}

const SECONDARY_AVAILABLE_ACCOUNT: AccountSummary = {
  ...AVAILABLE_ACCOUNT,
  id: 'account-secondary',
  displayName: 'Second Creator Hub',
  platforms: [createPlatform()]
}

const createInitialState = (overrides: Partial<HomePipelineState> = {}): HomePipelineState => ({
  videoUrl: '',
  localFilePath: null,
  urlError: null,
  pipelineError: null,
  steps: createInitialPipelineSteps(),
  isProcessing: false,
  clips: [],
  selectedClipId: null,
  selectedAccountId: null,
  selectedTone: null,
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
  },
  ...overrides
})

const renderHome = (props: Partial<ComponentProps<typeof Home>> = {}) => {
  const mergedProps: ComponentProps<typeof Home> = {
    initialState: createInitialState(),
    onStateChange: () => {},
    accounts: [],
    onStartPipeline: vi.fn(),
    onResumePipeline: vi.fn(),
    ...props
  }

  return render(
    <AccessProvider>
      <MemoryRouter>
        <Home {...mergedProps} />
      </MemoryRouter>
    </AccessProvider>
  )
}

afterEach(() => {
  cleanup()
})

describe('Home account selection', () => {
  it('requires a tone selection before starting without an account', () => {
    const startPipelineSpy = vi.fn()
    renderHome({
      initialState: createInitialState(),
      accounts: [AVAILABLE_ACCOUNT, ACCOUNT_WITHOUT_PLATFORMS],
      onStartPipeline: startPipelineSpy
    })

    const videoUrlInput = screen.getByLabelText(/video url/i)
    fireEvent.change(videoUrlInput, {
      target: { value: 'https://www.youtube.com/watch?v=example' }
    })
    const form = videoUrlInput.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    expect(screen.getByText(/select a tone before starting without an account/i)).toBeInTheDocument()
    expect(startPipelineSpy).not.toHaveBeenCalled()
  })

  it('passes the selected account when starting the pipeline job', async () => {
    const startPipelineSpy = vi.fn()
    const baseProps = {
      onStateChange: () => {},
      accounts: [AVAILABLE_ACCOUNT],
      onStartPipeline: startPipelineSpy,
      onResumePipeline: vi.fn()
    }
    const { rerender } = render(
      <AccessProvider>
        <MemoryRouter>
          <Home {...baseProps} initialState={createInitialState()} />
        </MemoryRouter>
      </AccessProvider>
    )

    rerender(
      <AccessProvider>
        <MemoryRouter>
          <Home
            {...baseProps}
            initialState={createInitialState({ selectedAccountId: AVAILABLE_ACCOUNT.id })}
          />
        </MemoryRouter>
      </AccessProvider>
    )

    const videoUrl = 'https://www.youtube.com/watch?v=another'
    const accountId = AVAILABLE_ACCOUNT.id

    const videoUrlInput = screen.getByLabelText(/video url/i)
    const form = videoUrlInput.closest('form')
    expect(form).not.toBeNull()
    await waitFor(() => {
      const statusRegion = within(form as HTMLFormElement).getByText((_content, element) => {
        return element?.getAttribute('aria-live') === 'polite'
      })
      expect(statusRegion).toHaveTextContent(/Account · Creator Hub/i)
      expect(statusRegion).toHaveTextContent(/Tone · Funny/i)
    })
    fireEvent.change(videoUrlInput, { target: { value: videoUrl } })
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => expect(startPipelineSpy).toHaveBeenCalledTimes(1))
    expect(startPipelineSpy).toHaveBeenCalledWith({ url: videoUrl }, accountId, null, false)
  })

  it('prefers a selected local file over the pasted URL', async () => {
    const startPipelineSpy = vi.fn()
    const openVideoFile = vi.fn().mockResolvedValue('/Users/operator/video.mp4')
    const originalApi = window.api
    // @ts-expect-error test override for API shim
    window.api = { ...(originalApi ?? {}), openVideoFile }

    try {
      renderHome({
        initialState: createInitialState({ selectedAccountId: AVAILABLE_ACCOUNT.id }),
        accounts: [AVAILABLE_ACCOUNT],
        onStartPipeline: startPipelineSpy
      })

      const localFileTab = screen.getByRole('tab', { name: /local file/i })
      fireEvent.click(localFileTab)

      const chooseButton = screen.getByRole('button', { name: /choose local video/i })
      fireEvent.click(chooseButton)
      await waitFor(() => expect(openVideoFile).toHaveBeenCalledTimes(1))

      const startButton = screen.getByRole('button', { name: /start processing/i })
      await waitFor(() => expect(startButton).not.toBeDisabled())

      const form = chooseButton.closest('form')
      expect(form).not.toBeNull()
      fireEvent.submit(form as HTMLFormElement)

      await waitFor(() => expect(startPipelineSpy).toHaveBeenCalledTimes(1))
      expect(startPipelineSpy).toHaveBeenCalledWith(
        { filePath: '/Users/operator/video.mp4' },
        AVAILABLE_ACCOUNT.id,
        null,
        false
      )
    } finally {
      // @ts-expect-error restore testing shim
      window.api = originalApi
    }
  })

  it('surfaces guidance when no active accounts are available', () => {
    renderHome({
      initialState: createInitialState(),
      onStateChange: () => {},
      accounts: [INACTIVE_ACCOUNT, ACCOUNT_WITHOUT_PLATFORMS, ACCOUNT_WITH_DISABLED_PLATFORM]
    })

    expect(screen.getByText(/general workspace/i)).toBeInTheDocument()
    expect(
      screen.getByText(/connect an account later to unlock account-specific folders/i)
    ).toBeInTheDocument()
  })

  it('retains the pasted link when switching accounts', async () => {
    let latestState = createInitialState({ selectedAccountId: AVAILABLE_ACCOUNT.id })
    const handleStateChangeWrapper = (next: HomePipelineState) => {
      latestState = next
    }

    const baseProps = {
      accounts: [AVAILABLE_ACCOUNT, SECONDARY_AVAILABLE_ACCOUNT],
      onStartPipeline: vi.fn(),
      onResumePipeline: vi.fn()
    }

    const { rerender } = render(
      <AccessProvider>
        <MemoryRouter>
          <Home
            {...baseProps}
            initialState={latestState}
            onStateChange={handleStateChangeWrapper}
          />
        </MemoryRouter>
      </AccessProvider>
    )

    const videoUrl = 'https://www.youtube.com/watch?v=retained'
    const videoUrlInput = screen.getByLabelText(/video url/i)
    fireEvent.change(videoUrlInput, { target: { value: videoUrl } })
    latestState = { ...latestState, videoUrl }

    rerender(
      <AccessProvider>
        <MemoryRouter>
          <Home
            {...baseProps}
            initialState={{ ...latestState, selectedAccountId: SECONDARY_AVAILABLE_ACCOUNT.id }}
            onStateChange={handleStateChangeWrapper}
          />
        </MemoryRouter>
      </AccessProvider>
    )

    expect(screen.getByDisplayValue(videoUrl)).toBeInTheDocument()
  })
})

describe('Home pipeline rendering', () => {
  it('renders clips and metadata from the provided state', () => {
    const clipCreatedAt = new Date('2024-06-01T12:00:00Z').toISOString()
    const clip: ReturnType<typeof createInitialState>['clips'][number] = {
      id: 'clip-1',
      title: 'Space wonders',
      channel: 'Creator Hub',
      description: 'Full video: https://youtube.com/watch?v=example\n#space',
      durationSec: 32,
      sourceDurationSeconds: 1800,
      createdAt: clipCreatedAt,
      sourceUrl: 'https://youtube.com/watch?v=example',
      sourceTitle: 'Original science video',
      sourcePublishedAt: new Date('2024-05-20T10:00:00Z').toISOString(),
      views: 120_000,
      quote: 'Mind-blowing fact',
      reason: 'High energy moment',
      rating: 4.5,
      playbackUrl: 'https://cdn.atropos.dev/clip.mp4',
      previewUrl: 'https://cdn.atropos.dev/clip-preview.mp4',
      thumbnail: 'https://cdn.atropos.dev/clip.jpg',
      videoId: 'video-1',
      videoTitle: 'Original science video',
      timestampUrl: 'https://youtube.com/watch?v=example&t=123',
      timestampSeconds: 123,
      accountId: AVAILABLE_ACCOUNT.id,
      startSeconds: 120,
      endSeconds: 152,
      originalStartSeconds: 120,
      originalEndSeconds: 152,
      hasAdjustments: false
    }

    const initialState = createInitialState({
      selectedAccountId: AVAILABLE_ACCOUNT.id,
      clips: [clip],
      selectedClipId: clip.id,
      isProcessing: false
    })

    render(
      <AccessProvider>
        <MemoryRouter>
          <Home
            onStateChange={() => {}}
            accounts={[AVAILABLE_ACCOUNT]}
            onStartPipeline={vi.fn()}
            onResumePipeline={vi.fn()}
            initialState={initialState}
          />
        </MemoryRouter>
      </AccessProvider>
    )

    const timelineItem = screen.getAllByText(/space wonders/i)[0].closest('li')
    expect(timelineItem).not.toBeNull()
    const timelineScope = within(timelineItem as HTMLElement)
    const metadata = timelineScope.getByText(/creator hub/i)
    expect(metadata).toBeInTheDocument()
    expect(metadata).toHaveTextContent(/0:32/)
  })

  it('surfaces clip batch progress details for multi-clip steps', () => {
    const baseSteps = createInitialPipelineSteps()
    const steps: PipelineStep[] = baseSteps.map((step, index) => {
      if (index < baseSteps.length - 1) {
        return { ...step, status: 'completed', progress: 1, etaSeconds: null }
      }
      return {
        ...step,
        status: 'running',
        progress: 0.4,
        etaSeconds: 90,
        clipProgress: { completed: 2, total: 5 },
        substeps: step.substeps.map((substep, subIndex) => {
          if (subIndex === 1) {
            return {
              ...substep,
              status: 'running',
              progress: 0.4,
              etaSeconds: 45,
              completedClips: 2,
              totalClips: 5,
              activeClipIndex: 2
            }
          }
          return {
            ...substep,
            status: 'completed',
            progress: 1,
            etaSeconds: null,
            completedClips: 5,
            totalClips: 5,
            activeClipIndex: null
          }
        })
      }
    })

    const initialState = createInitialState({
      selectedAccountId: AVAILABLE_ACCOUNT.id,
      steps,
      isProcessing: true
    })

    render(
      <AccessProvider>
        <MemoryRouter>
          <Home
            onStateChange={() => {}}
            accounts={[AVAILABLE_ACCOUNT]}
            onStartPipeline={vi.fn()}
            onResumePipeline={vi.fn()}
            initialState={initialState}
          />
        </MemoryRouter>
      </AccessProvider>
    )

    const [stepsList] = screen.getAllByTestId('pipeline-steps')
    expect(within(stepsList).getByText(/produce final clips/i)).toBeInTheDocument()
    expect(within(stepsList).getByText(/clips 2\/5/i)).toBeInTheDocument()
    expect(within(stepsList).getByText(/clip 2\/5/i)).toBeInTheDocument()
    expect(within(stepsList).getByText(/2\/5 clips done/i)).toBeInTheDocument()
    expect(within(stepsList).getAllByText(/40%/i).length).toBeGreaterThan(0)
  })
})

describe('Home pipeline alerts', () => {
  it('shows a banner when the last run rendered no clips', () => {
    renderHome({
      initialState: createInitialState({
        lastRunProducedNoClips: true,
        lastRunClipStatus: 'rendered_none',
        lastRunClipSummary: { expected: 3, rendered: 0 }
      }),
      onStateChange: () => {},
      accounts: [AVAILABLE_ACCOUNT],
      onStartPipeline: vi.fn(),
      onResumePipeline: vi.fn()
    })

    expect(screen.getByText(/no clips were rendered/i)).toBeInTheDocument()
    expect(screen.getByText(/attempted to render 3 clips\./i)).toBeInTheDocument()
    expect(
      screen.getByText(/tried to render 3 clips, but none of them succeeded/i)
    ).toBeInTheDocument()
  })
})
