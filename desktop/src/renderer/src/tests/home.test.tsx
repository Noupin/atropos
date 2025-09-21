import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  active: true
}

const INACTIVE_ACCOUNT: AccountSummary = {
  id: 'account-disabled',
  displayName: 'Disabled Account',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [createPlatform()],
  active: false
}

const ACCOUNT_WITHOUT_PLATFORMS: AccountSummary = {
  id: 'account-empty',
  displayName: 'No Platforms',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [],
  active: true
}

const ACCOUNT_WITH_DISABLED_PLATFORM: AccountSummary = {
  id: 'account-platform-disabled',
  displayName: 'Platform Disabled',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [createPlatform({ active: false })],
  active: true
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
  ...overrides
})

describe('Home account selection', () => {
  beforeEach(() => {
    startPipelineJobMock.mockReset()
    startPipelineJobMock.mockResolvedValue({ jobId: 'test-job' })
    subscribeToPipelineEventsMock.mockReset()
    subscribeToPipelineEventsMock.mockReturnValue(vi.fn())
  })

  it('requires an account selection before starting processing', () => {
    render(
      <Home
        registerSearch={() => {}}
        initialState={createInitialState()}
        onStateChange={() => {}}
        accounts={[AVAILABLE_ACCOUNT, ACCOUNT_WITHOUT_PLATFORMS]}
      />
    )

    fireEvent.change(screen.getByLabelText(/video url/i), {
      target: { value: 'https://www.youtube.com/watch?v=example' }
    })
    const form = screen.getByLabelText(/account/i).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    expect(screen.getByText(/select an account to start processing/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/account/i)).toHaveAttribute('aria-invalid', 'true')
    expect(startPipelineJobMock).not.toHaveBeenCalled()
  })

  it('passes the selected account when starting the pipeline job', async () => {
    render(
      <Home
        registerSearch={() => {}}
        initialState={createInitialState()}
        onStateChange={() => {}}
        accounts={[AVAILABLE_ACCOUNT]}
      />
    )

    const videoUrl = 'https://www.youtube.com/watch?v=another'
    const accountId = AVAILABLE_ACCOUNT.id

    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: accountId } })
    fireEvent.change(screen.getByLabelText(/video url/i), { target: { value: videoUrl } })
    const form = screen.getByLabelText(/account/i).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

  await waitFor(() => expect(startPipelineJobMock).toHaveBeenCalledTimes(1))
  expect(startPipelineJobMock).toHaveBeenCalledWith({ account: accountId, url: videoUrl })
  })

  it('filters the account dropdown to active accounts with active platforms', () => {
    render(
      <Home
        registerSearch={() => {}}
        initialState={createInitialState()}
        onStateChange={() => {}}
        accounts={[
          AVAILABLE_ACCOUNT,
          INACTIVE_ACCOUNT,
          ACCOUNT_WITHOUT_PLATFORMS,
          ACCOUNT_WITH_DISABLED_PLATFORM
        ]}
      />
    )

    const select = screen.getByLabelText(/account/i)
    const options = within(select).getAllByRole('option')
    const optionValues = options.map((option) => (option as HTMLOptionElement).value)
    expect(optionValues).toEqual(['', AVAILABLE_ACCOUNT.id])
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

    render(
      <Home
        registerSearch={() => {}}
        initialState={createInitialState()}
        onStateChange={() => {}}
        accounts={[AVAILABLE_ACCOUNT]}
      />
    )

    const accountSelect = screen.getByLabelText(/account/i)
    fireEvent.change(accountSelect, { target: { value: AVAILABLE_ACCOUNT.id } })
    fireEvent.change(screen.getByLabelText(/video url/i), {
      target: { value: 'https://www.youtube.com/watch?v=example' }
    })
    const form = accountSelect.closest('form')
    expect(form).not.toBeNull()
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
    expect(timelineScope.getByText(/creator hub/i)).toBeInTheDocument()
    expect(timelineScope.getByText(/duration 0:32/i)).toBeInTheDocument()
  })

  it('surfaces clip batch progress updates for multi-clip steps', async () => {
    const unsubscribeMock = vi.fn()
    let handlers: PipelineEventHandlers | null = null

    subscribeToPipelineEventsMock.mockImplementation((_jobId, providedHandlers) => {
      handlers = providedHandlers
      return unsubscribeMock
    })

    render(
      <Home
        registerSearch={() => {}}
        initialState={createInitialState()}
        onStateChange={() => {}}
        accounts={[AVAILABLE_ACCOUNT]}
      />
    )

    const accountSelect = screen.getByLabelText(/account/i)
    fireEvent.change(accountSelect, {
      target: { value: AVAILABLE_ACCOUNT.id }
    })
    fireEvent.change(screen.getByLabelText(/video url/i), {
      target: { value: 'https://www.youtube.com/watch?v=example' }
    })

    const form = accountSelect.closest('form')
    expect(form).not.toBeNull()
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
