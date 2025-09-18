import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../pages/Home'
import { createInitialPipelineSteps } from '../data/pipeline'
import type { HomePipelineState } from '../types'
import { PROFILE_ACCOUNTS } from '../mock/accounts'

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
      <Home registerSearch={() => {}} initialState={createInitialState()} onStateChange={() => {}} />
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
      <Home registerSearch={() => {}} initialState={createInitialState()} onStateChange={() => {}} />
    )

    const videoUrl = 'https://www.youtube.com/watch?v=another'
    const accountId = PROFILE_ACCOUNTS[0]?.id ?? 'account-1'

    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: accountId } })
    fireEvent.change(screen.getByLabelText(/video url/i), { target: { value: videoUrl } })
    const [startButton] = screen.getAllByRole('button', { name: /start processing/i })
    fireEvent.click(startButton)

    await waitFor(() => expect(startPipelineJobMock).toHaveBeenCalledTimes(1))
    expect(startPipelineJobMock).toHaveBeenCalledWith({ account: accountId, url: videoUrl })
  })
})
