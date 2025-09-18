import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../pages/Home'
import { createInitialPipelineSteps } from '../data/pipeline'
import type { AccountPlatformConnection, AccountSummary, HomePipelineState } from '../types'

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
    const [startButton] = screen.getAllByRole('button', { name: /start processing/i })
    fireEvent.click(startButton)

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
    const [startButton] = screen.getAllByRole('button', { name: /start processing/i })
    fireEvent.click(startButton)

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
