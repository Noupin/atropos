import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Home from '../pages/Home'
import { createInitialPipelineSteps } from '../data/pipeline'
import type {
  AccountPlatformConnection,
  AccountSummary,
  HomePipelineState
} from '../types'
import type { PipelineEventHandlers } from '../services/pipelineApi'

const { startPipelineJobMock, subscribeToPipelineEventsMock } = vi.hoisted(() => ({
  startPipelineJobMock: vi.fn(),
  subscribeToPipelineEventsMock: vi.fn()
}))

vi.mock('../services/pipelineApi', async () => {
  const actual = await vi.importActual<typeof import('../services/pipelineApi')>(
    '../services/pipelineApi'
  )
  return {
    ...actual,
    startPipelineJob: startPipelineJobMock,
    subscribeToPipelineEvents: subscribeToPipelineEventsMock
  }
})

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

const createInitialState = (overrides: Partial<HomePipelineState> = {}): HomePipelineState => ({
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
  awaitingReview: false,
  lastRunProducedNoClips: false,
  ...overrides
})

const renderHome = (props: ComponentProps<typeof Home>) =>
  render(
    <MemoryRouter>
      <Home onStartPipeline={vi.fn()} onResumePipeline={vi.fn()} {...props} />
    </MemoryRouter>
  )

afterEach(() => {
  cleanup()
})

describe('Home account selection', () => {
  beforeEach(() => {
    startPipelineJobMock.mockReset()
    startPipelineJobMock.mockResolvedValue({ jobId: 'test-job' })
    subscribeToPipelineEventsMock.mockReset()
    subscribeToPipelineEventsMock.mockReturnValue(vi.fn())
  })

  it('requires an account selection before starting processing', () => {
    renderHome({
      registerSearch: () => {},
      initialState: createInitialState(),
      onStateChange: () => {},
      accounts: [AVAILABLE_ACCOUNT, ACCOUNT_WITHOUT_PLATFORMS]
    })

    const videoUrlInput = screen.getByLabelText(/video url/i)
    fireEvent.change(videoUrlInput, {
      target: { value: 'https://www.youtube.com/watch?v=example' }
    })
    const form = videoUrlInput.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    expect(
      screen.getByText(/select an account from the top navigation to start processing/i)
    ).toBeInTheDocument()
    expect(startPipelineJobMock).not.toHaveBeenCalled()
  })

  it('passes the selected account when starting the pipeline job', async () => {
    const baseProps = {
      registerSearch: () => {},
      onStateChange: () => {},
      accounts: [AVAILABLE_ACCOUNT],
      onStartPipeline: vi.fn(),
      onResumePipeline: vi.fn()
    }
    const { rerender } = render(
      <MemoryRouter>
        <Home {...baseProps} initialState={createInitialState()} />
      </MemoryRouter>
    )

    rerender(
      <MemoryRouter>
        <Home
          {...baseProps}
          initialState={createInitialState({ selectedAccountId: AVAILABLE_ACCOUNT.id })}
        />
      </MemoryRouter>
    )

    const videoUrl = 'https://www.youtube.com/watch?v=another'
    const accountId = AVAILABLE_ACCOUNT.id

    const videoUrlInput = screen.getByLabelText(/video url/i)
    const form = videoUrlInput.closest('form')
    expect(form).not.toBeNull()
    await waitFor(() => {
      const statusRegion = within(form as HTMLFormElement).getByText((content, element) => {
        return element?.getAttribute('aria-live') === 'polite'
      })
      expect(statusRegion).toHaveTextContent(/Processing as Creator Hub\./i)
    })
    fireEvent.change(videoUrlInput, { target: { value: videoUrl } })
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => expect(startPipelineJobMock).toHaveBeenCalledTimes(1))
    expect(startPipelineJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ account: accountId, url: videoUrl, tone: null })
    )
  })

  it('surfaces guidance when no active accounts are available', () => {
    renderHome({
      registerSearch: () => {},
      initialState: createInitialState(),
      onStateChange: () => {},
      accounts: [INACTIVE_ACCOUNT, ACCOUNT_WITHOUT_PLATFORMS, ACCOUNT_WITH_DISABLED_PLATFORM]
    })

    expect(screen.getByText(/no active accounts available/i)).toBeInTheDocument()
    expect(
      screen.getByText(/enable an account with an active platform from your profile/i)
    ).toBeInTheDocument()
  })
})

describe('Home pipeline events', () => {
  beforeEach(() => {
    startPipelineJobMock.mockReset()
    startPipelineJobMock.mockResolvedValue({ jobId: 'test-job' })
    subscribeToPipelineEventsMock.mockReset()
  })

  it('adds clips from clip_ready events and surfaces description text', async () => {
    const unsubscribeMock = vi.fn()
    let handlers: PipelineEventHandlers | null = null

    subscribeToPipelineEventsMock.mockImplementation((_jobId, providedHandlers) => {
      handlers = providedHandlers
      return unsubscribeMock
    })

    const baseProps = {
      registerSearch: () => {},
      onStateChange: () => {},
      accounts: [AVAILABLE_ACCOUNT],
      onStartPipeline: vi.fn(),
      onResumePipeline: vi.fn()
    }
    const { rerender } = render(
      <MemoryRouter>
        <Home {...baseProps} initialState={createInitialState()} />
      </MemoryRouter>
    )

    rerender(
      <MemoryRouter>
        <Home
          {...baseProps}
          initialState={createInitialState({ selectedAccountId: AVAILABLE_ACCOUNT.id })}
        />
      </MemoryRouter>
    )

    const videoUrlInput = screen.getByLabelText(/video url/i)
    const form = videoUrlInput.closest('form')
    expect(form).not.toBeNull()
    await waitFor(() => {
      const statusRegion = within(form as HTMLFormElement).getByText((content, element) => {
        return element?.getAttribute('aria-live') === 'polite'
      })
      expect(statusRegion).toHaveTextContent(/Processing as Creator Hub\./i)
    })
    fireEvent.change(videoUrlInput, {
      target: { value: 'https://www.youtube.com/watch?v=example' }
    })
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => expect(startPipelineJobMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(subscribeToPipelineEventsMock).toHaveBeenCalledTimes(1))
    expect(handlers).not.toBeNull()
    const timestamp = Date.now()

    act(() => {
      handlers?.onEvent({ type: 'pipeline_started', timestamp } as any)
    })

    act(() => {
      handlers?.onEvent({
        type: 'clip_ready',
        step: 'step_7_descriptions_1',
        timestamp,
        data: {
          clip_id: 'clip-1',
          title: 'Space wonders',
          channel: 'Creator Hub',
          description: 'Full video: https://youtube.com/watch?v=example\n#space',
          duration_seconds: 32,
          source_duration_seconds: 1800,
          created_at: new Date('2024-06-01T12:00:00Z').toISOString(),
          source_url: 'https://youtube.com/watch?v=example',
          source_title: 'Original science video',
          source_published_at: new Date('2024-05-20T10:00:00Z').toISOString(),
          views: 120_000,
          quote: 'Mind-blowing fact',
          reason: 'High energy moment',
          rating: 4.5
        }
      } as any)
    })

    const timelineItem = screen.getAllByText(/space wonders/i)[0].closest('li')
    expect(timelineItem).not.toBeNull()
    const timelineScope = within(timelineItem as HTMLElement)
    const metadata = timelineScope.getByText(/creator hub/i)
    expect(metadata).toBeInTheDocument()
    expect(metadata).toHaveTextContent(/0:32/)
  })

  it('surfaces clip batch progress updates for multi-clip steps', async () => {
    const unsubscribeMock = vi.fn()
    let handlers: PipelineEventHandlers | null = null

    subscribeToPipelineEventsMock.mockImplementation((_jobId, providedHandlers) => {
      handlers = providedHandlers
      return unsubscribeMock
    })

    const baseProps = {
      registerSearch: () => {},
      onStateChange: () => {},
      accounts: [AVAILABLE_ACCOUNT],
      onStartPipeline: vi.fn(),
      onResumePipeline: vi.fn()
    }
    const { rerender } = render(
      <MemoryRouter>
        <Home {...baseProps} initialState={createInitialState()} />
      </MemoryRouter>
    )

    rerender(
      <MemoryRouter>
        <Home
          {...baseProps}
          initialState={createInitialState({ selectedAccountId: AVAILABLE_ACCOUNT.id })}
        />
      </MemoryRouter>
    )

    const videoUrlInput = screen.getByLabelText(/video url/i)
    const form = videoUrlInput.closest('form')
    expect(form).not.toBeNull()
    await waitFor(() => {
      const statusRegion = within(form as HTMLFormElement).getByText((content, element) => {
        return element?.getAttribute('aria-live') === 'polite'
      })
      expect(statusRegion).toHaveTextContent(/Processing as Creator Hub\./i)
    })

    fireEvent.change(videoUrlInput, {
      target: { value: 'https://www.youtube.com/watch?v=example' }
    })

    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => expect(startPipelineJobMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(subscribeToPipelineEventsMock).toHaveBeenCalledTimes(1))
    expect(handlers).not.toBeNull()

    const timestamp = Date.now()

    act(() => {
      handlers?.onEvent({ type: 'pipeline_started', timestamp } as any)
      handlers?.onEvent({ type: 'step_completed', step: 'step_1_download', timestamp } as any)
      handlers?.onEvent({ type: 'step_completed', step: 'step_2_audio', timestamp } as any)
      handlers?.onEvent({ type: 'step_completed', step: 'step_3_transcribe', timestamp } as any)
      handlers?.onEvent({ type: 'step_completed', step: 'step_4_silences', timestamp } as any)
      handlers?.onEvent({ type: 'step_completed', step: 'step_5_segments', timestamp } as any)
      handlers?.onEvent({ type: 'step_completed', step: 'step_6_candidates', timestamp } as any)
      handlers?.onEvent({
        type: 'step_progress',
        step: 'step_7_subtitles_2',
        timestamp,
        data: { progress: 0.4, completed: 2, total: 5 }
      } as any)
      handlers?.onEvent({
        type: 'step_progress',
        step: 'step_7_produce',
        timestamp,
        data: { progress: 0.4, completed: 2, total: 5 }
      } as any)
    })

    const [stepsList] = screen.getAllByTestId('pipeline-steps')
    expect(within(stepsList).getByText(/produce final clips/i)).toBeInTheDocument()
    expect(within(stepsList).getByText(/clips 2\/5/i)).toBeInTheDocument()
    expect(within(stepsList).getByText(/clip 2\/5/i)).toBeInTheDocument()
    expect(within(stepsList).getByText(/2\/5 clips done/i)).toBeInTheDocument()
    expect(within(stepsList).getAllByText(/40%/i).length).toBeGreaterThan(0)
  })
})
