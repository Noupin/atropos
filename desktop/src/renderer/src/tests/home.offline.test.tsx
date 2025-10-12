import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Home from '../pages/Home'
import { createInitialPipelineSteps } from '../data/pipeline'
import type { AccountSummary, HomePipelineState } from '../types'
import type { AccessState } from '../state/accessTypes'
import type { TransferStatePayload } from '../services/licensing'

const AVAILABLE_ACCOUNT: AccountSummary = {
  id: 'account-active',
  displayName: 'Creator Hub',
  description: null,
  createdAt: new Date().toISOString(),
  platforms: [
    {
      platform: 'youtube',
      label: 'YouTube Channel',
      status: 'active',
      connected: true,
      tokenPath: '/tokens/account/youtube.json',
      addedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      active: true
    }
  ],
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
  selectedAccountId: AVAILABLE_ACCOUNT.id,
  accountError: null,
  activeJobId: null,
  reviewMode: false,
  awaitingReview: false,
  lastRunProducedNoClips: false,
  lastRunClipSummary: null,
  lastRunClipStatus: null,
  ...overrides
})

const defaultTransferState: TransferStatePayload = {
  status: 'none',
  email: null,
  initiatedAt: null,
  expiresAt: null,
  completedAt: null,
  targetDeviceHash: null
}

const baseAccessState: AccessState = {
  deviceHash: 'device-test',
  subscription: null,
  trial: { totalRuns: 3, remainingRuns: 1, startedAt: new Date().toISOString() },
  access: { source: 'trial', isActive: true },
  transfer: defaultTransferState,
  isSubscriptionActive: false,
  isTrialActive: true,
  isAccessActive: false,
  isOffline: true,
  isOfflineLocked: false,
  offlineExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  offlineRemainingMs: 6 * 60 * 60 * 1000,
  offlineLastVerifiedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  isLoading: false,
  lastError: null,
  pendingConsumption: false,
  pendingConsumptionStage: null
}

const accessStateRef: { current: AccessState } = { current: baseAccessState }

const refresh = async () => {}
const markTrialRunPending = () => {}
const finalizeTrialRun = async () => {}

vi.mock('../state/access', () => ({
  useAccess: () => ({
    state: accessStateRef.current,
    deviceHash: accessStateRef.current.deviceHash,
    refresh,
    markTrialRunPending,
    finalizeTrialRun
  })
}))

describe('Home offline access handling', () => {
  it('prevents trial users from starting the pipeline while offline', async () => {
    accessStateRef.current = { ...baseAccessState }

    render(
      <MemoryRouter>
        <Home
          registerSearch={() => {}}
          initialState={createInitialState({ videoUrl: 'https://youtu.be/example' })}
          onStateChange={() => {}}
          accounts={[AVAILABLE_ACCOUNT]}
          onStartPipeline={() => {}}
          onResumePipeline={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      const startButtons = screen.getAllByRole('button', { name: /start processing/i })
      startButtons.forEach((button) => expect(button).toBeDisabled())
    })
    expect(
      screen.getByText(/trial runs require an internet connection/i)
    ).toBeInTheDocument()
  })

  it('allows subscribed users to keep running during the offline grace period', async () => {
    accessStateRef.current = {
      ...baseAccessState,
      subscription: {
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        priceId: 'price_test',
        updatedAt: null
      },
      access: { source: 'subscription', isActive: true },
      isSubscriptionActive: true,
      isTrialActive: false,
      isAccessActive: true
    }

    render(
      <MemoryRouter>
        <Home
          registerSearch={() => {}}
          initialState={createInitialState({ videoUrl: 'https://youtu.be/example' })}
          onStateChange={() => {}}
          accounts={[AVAILABLE_ACCOUNT]}
          onStartPipeline={() => {}}
          onResumePipeline={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      const startButtons = screen.getAllByRole('button', { name: /start processing/i })
      expect(startButtons.some((button) => !(button as HTMLButtonElement).disabled)).toBe(true)
    })
    expect(
      screen.getByText(/offline mode — reconnect within/i)
    ).toBeInTheDocument()
  })

  it('locks processing once the offline grace period expires', async () => {
    accessStateRef.current = {
      ...baseAccessState,
      isOfflineLocked: true,
      offlineRemainingMs: 0
    }

    const startPipelineSpy = vi.fn()

    render(
      <MemoryRouter>
        <Home
          registerSearch={() => {}}
          initialState={createInitialState({ videoUrl: 'https://youtu.be/example' })}
          onStateChange={() => {}}
          accounts={[AVAILABLE_ACCOUNT]}
          onStartPipeline={startPipelineSpy}
          onResumePipeline={() => {}}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/offline access expired/i)).toBeInTheDocument()
    })

    const headings = screen.getAllByText(/process a new video/i)
    const form = headings[0]?.closest('form') ?? null
    expect(form).not.toBeNull()
    if (form) {
      fireEvent.submit(form)
    }

    expect(startPipelineSpy).not.toHaveBeenCalled()
  })
})
