import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '../pages/Profile'
import type {
  AccessCheckResult,
  AccountPlatformConnection,
  AccountSummary,
  AuthPingSummary
} from '../types'

vi.mock('../components/MarbleSelect', () => {
  return {
    default: ({
      options,
      value,
      onChange,
      id,
      name
    }: {
      options: Array<{ value: string; label: string }>
      value: string | null
      onChange: (value: string) => void
      id?: string
      name?: string
    }) => (
      <select
        data-testid={id ?? name ?? 'marble-select'}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          Select option
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }
})

const paymentsMocks = vi.hoisted(() => ({
  fetchSubscriptionStatus: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn()
}))

const trialMocks = vi.hoisted(() => ({
  startTrial: vi.fn(),
  claimTrial: vi.fn()
}))

vi.mock('../services/paymentsApi', () => ({
  fetchSubscriptionStatus: paymentsMocks.fetchSubscriptionStatus,
  createCheckoutSession: paymentsMocks.createCheckoutSession,
  createBillingPortalSession: paymentsMocks.createBillingPortalSession
}))

vi.mock('../services/trialAccess', () => ({
  startTrial: trialMocks.startTrial,
  claimTrial: trialMocks.claimTrial,
  consumeTrial: vi.fn()
}))

const createPlatform = (
  overrides: Partial<AccountPlatformConnection> = {}
): AccountPlatformConnection => ({
  platform: 'youtube',
  label: 'YouTube Channel',
  status: 'active',
  connected: true,
  tokenPath: '/tokens/account-1/youtube.json',
  addedAt: '2025-05-01T12:00:00Z',
  lastVerifiedAt: '2025-05-02T08:00:00Z',
  active: true,
  ...overrides
})

const sampleAccounts: AccountSummary[] = [
  {
    id: 'account-1',
    displayName: 'Creator Hub',
    description: 'Primary publishing account',
    createdAt: '2025-05-01T12:00:00Z',
    platforms: [createPlatform()],
    active: true,
    tone: null,
    effectiveTone: 'funny'
  },
  {
    id: 'account-2',
    displayName: 'Brand Studio',
    description: null,
    createdAt: '2025-05-01T12:00:00Z',
    platforms: [],
    active: true,
    tone: 'tech',
    effectiveTone: 'tech'
  }
]

const sampleAuthStatus: AuthPingSummary = {
  status: 'ok',
  checkedAt: '2025-05-02T09:00:00Z',
  accounts: 2,
  connectedPlatforms: 1,
  totalPlatforms: 1,
  message: 'All connected platforms look healthy.'
}

const sampleAccessStatus: AccessCheckResult = {
  allowed: true,
  entitled: true,
  mode: 'subscription',
  reason: null,
  expiresAt: '2025-06-02T09:05:00Z',
  snapshot: { status: 'active', cancel_at_period_end: false },
  customerEmail: 'owner@example.com'
}

describe('Profile page', () => {
  const createAccountMock = vi.fn()
  const addPlatformMock = vi.fn()
  const refreshAccountsMock = vi.fn()
  const updateAccountMock = vi.fn()
  const deleteAccountMock = vi.fn()
  const updatePlatformMock = vi.fn()
  const deletePlatformMock = vi.fn()
  const refreshAccessStatusMock = vi.fn()

  const originalWindowOpen = window.open

  afterEach(() => {
    cleanup()
    window.open = originalWindowOpen
  })

  beforeEach(() => {
    createAccountMock.mockReset()
    addPlatformMock.mockReset()
    refreshAccountsMock.mockReset()
    updateAccountMock.mockReset()
    deleteAccountMock.mockReset()
    updatePlatformMock.mockReset()
    deletePlatformMock.mockReset()
    refreshAccountsMock.mockResolvedValue(undefined)
    refreshAccessStatusMock.mockReset()
    refreshAccessStatusMock.mockResolvedValue(undefined)

    paymentsMocks.fetchSubscriptionStatus.mockReset()
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValue({
      status: 'active',
      planId: 'plan_123',
      planName: 'Pro Plan',
      renewsAt: '2025-06-01T10:00:00Z',
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null
    })

    paymentsMocks.createCheckoutSession.mockReset()
    paymentsMocks.createCheckoutSession.mockResolvedValue({ url: 'https://stripe.test/checkout' })
    paymentsMocks.createBillingPortalSession.mockReset()
    paymentsMocks.createBillingPortalSession.mockResolvedValue({ url: 'https://stripe.test/portal' })

  trialMocks.startTrial.mockReset()
  trialMocks.startTrial.mockResolvedValue({
    allowed: true,
    started: true,
    total: 3,
    remaining: 3,
    usedAt: null,
    deviceHash: 'device-123'
  })
    trialMocks.claimTrial.mockReset()
  trialMocks.claimTrial.mockResolvedValue({
    token: { token: 'trial-token', exp: Math.floor(Date.now() / 1000) + 900 },
    snapshot: {
      allowed: true,
      started: true,
      total: 3,
      remaining: 2,
      usedAt: null,
      deviceHash: 'device-123'
      }
    })

    window.open = vi.fn() as typeof window.open
  })

  const renderProfile = (overrides: Partial<ComponentProps<typeof Profile>> = {}) =>
    render(
      <Profile
        registerSearch={() => {}}
        accounts={sampleAccounts}
        accountsError={null}
        authStatus={sampleAuthStatus}
        authError={null}
        accessStatus={sampleAccessStatus}
        accessError={null}
        isCheckingAccess={false}
        isLoadingAccounts={false}
        onCreateAccount={createAccountMock}
        onAddPlatform={addPlatformMock}
        onUpdateAccount={updateAccountMock}
        onDeleteAccount={deleteAccountMock}
        onUpdatePlatform={updatePlatformMock}
        onDeletePlatform={deletePlatformMock}
        onRefreshAccounts={refreshAccountsMock}
        onRefreshAccessStatus={refreshAccessStatusMock}
        {...overrides}
      />
    )

  it('displays authentication status, billing, and connected platforms', () => {
    renderProfile()

    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText(/Connected platforms across/i)).toHaveTextContent('1/1')
    expect(paymentsMocks.fetchSubscriptionStatus).toHaveBeenCalledWith('atropos-desktop-dev')
    expect(screen.getByRole('button', { name: /Manage billing/i })).toBeInTheDocument()

    const creatorCard = screen.getAllByTestId('account-card-account-1')[0]
    const scope = within(creatorCard)
    expect(scope.getByText('YouTube Channel')).toBeVisible()
    expect(scope.getByText(/Authenticated/i)).toBeVisible()
    expect(scope.getByText('Tone: Funny')).toBeVisible()
  })

  it('submits a new account with trimmed values', async () => {
    createAccountMock.mockResolvedValueOnce(sampleAccounts[0])

    renderProfile()

    const addAccountButton = screen.getByRole('button', { name: /^Add account$/i })
    fireEvent.click(addAccountButton)

    const accountNameInput = screen.getByLabelText(/Account name/i)
    fireEvent.change(accountNameInput, {
      target: { value: '  New Account  ' }
    })
    const descriptionInput = screen.getByLabelText(/Description/i)
    fireEvent.change(descriptionInput, {
      target: { value: '  Description here  ' }
    })

    const createButton = screen.getByRole('button', { name: /Create account/i })
    fireEvent.click(createButton)

    await waitFor(() => expect(createAccountMock).toHaveBeenCalledTimes(1))
    expect(createAccountMock).toHaveBeenCalledWith({
      displayName: 'New Account',
      description: 'Description here'
    })

    expect(await screen.findByText(/Account created successfully/i)).toBeInTheDocument()
  })

  it('connects an Instagram platform using username and password', async () => {
    addPlatformMock.mockResolvedValueOnce(sampleAccounts[1])

    renderProfile()

    const brandCard = screen.getAllByTestId('account-card-account-2')[0]
    const scope = within(brandCard)
    const addPlatformButton = scope.getByRole('button', { name: /^Add platform$/i })
    fireEvent.click(addPlatformButton)

    const platformSelect = scope.getByLabelText(/Platform/i)
    fireEvent.change(platformSelect, { target: { value: 'instagram' } })
    fireEvent.change(scope.getByLabelText(/Label \(optional\)/i), {
      target: { value: 'Brand Instagram' }
    })
    fireEvent.change(scope.getByLabelText(/Username/i), { target: { value: 'creator' } })
    fireEvent.change(scope.getByLabelText(/Password/i), { target: { value: 'secret' } })

    const connectButton = scope.getByRole('button', { name: /Connect platform/i })
    fireEvent.click(connectButton)

    await waitFor(() => expect(addPlatformMock).toHaveBeenCalledTimes(1))
    expect(addPlatformMock).toHaveBeenCalledWith('account-2', {
      platform: 'instagram',
      label: 'Brand Instagram',
      credentials: { username: 'creator', password: 'secret' }
    })
  })

  it('shows validation errors when Instagram credentials are missing', () => {
    renderProfile()

    const brandCard = screen.getAllByTestId('account-card-account-2')[0]
    const scope = within(brandCard)
    const addPlatformButton = scope.getByRole('button', { name: /^Add platform$/i })
    fireEvent.click(addPlatformButton)

    const platformSelect = scope.getByLabelText(/Platform/i)
    fireEvent.change(platformSelect, { target: { value: 'instagram' } })

    const connectButton = scope.getByRole('button', { name: /Connect platform/i })
    fireEvent.click(connectButton)

    expect(scope.getByText(/Enter your Instagram username and password/i)).toBeVisible()
    expect(addPlatformMock).not.toHaveBeenCalled()
  })

  it('toggles an account active state', async () => {
    const disabledAccount: AccountSummary = {
      ...sampleAccounts[0],
      active: false,
      platforms: sampleAccounts[0].platforms.map((platform) => ({
        ...platform,
        active: false,
        connected: false,
        status: 'disabled'
      }))
    }
    updateAccountMock.mockResolvedValueOnce(disabledAccount)

    renderProfile()

    const creatorCard = screen.getAllByTestId('account-card-account-1')[0]
    const scope = within(creatorCard)
    fireEvent.click(scope.getByRole('button', { name: /Expand|Collapse/i }))
    const toggleButton = scope.getByRole('button', { name: /Disable account/i })
    fireEvent.click(toggleButton)

    await waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))
    expect(updateAccountMock).toHaveBeenCalledWith('account-1', { active: false })
    expect(await scope.findByText(/Account disabled successfully/i)).toBeInTheDocument()
  })

  it('updates the account tone override', async () => {
    const updatedAccount: AccountSummary = {
      ...sampleAccounts[1],
      tone: 'science',
      effectiveTone: 'science'
    }
    updateAccountMock.mockResolvedValueOnce(updatedAccount)

    renderProfile()

    const brandCard = screen.getAllByTestId('account-card-account-2')[0]
    const scope = within(brandCard)

    const toneSelect = scope.getByLabelText(/^Tone$/i)
    fireEvent.change(toneSelect, { target: { value: 'science' } })

    await waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))
    expect(updateAccountMock).toHaveBeenCalledWith('account-2', { tone: 'science' })
    expect(await scope.findByText(/Tone set to Science/i)).toBeInTheDocument()
  })

  it('disables and removes a platform connection', async () => {
    const disabledPlatformAccount: AccountSummary = {
      ...sampleAccounts[0],
      platforms: [
        {
          ...createPlatform({
            platform: 'youtube',
            status: 'disabled',
            active: false,
            connected: false
          })
        }
      ]
    }
    updatePlatformMock.mockResolvedValueOnce(disabledPlatformAccount)
    deletePlatformMock.mockResolvedValueOnce({ ...disabledPlatformAccount, platforms: [] })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    try {
      renderProfile()

      const creatorCard = screen.getAllByTestId('account-card-account-1')[0]
      const scope = within(creatorCard)

      fireEvent.click(scope.getByRole('button', { name: /Expand|Collapse/i }))

      const disableButton = await scope.findByRole('button', { name: /^Disable$/i })
      fireEvent.click(disableButton)

      await waitFor(() => expect(updatePlatformMock).toHaveBeenCalledTimes(1))
      expect(updatePlatformMock).toHaveBeenCalledWith('account-1', 'youtube', { active: false })
      expect(await scope.findByText(/YouTube disabled successfully/i)).toBeInTheDocument()

      const removeButton = await scope.findByRole('button', { name: /^Remove$/i })
      fireEvent.click(removeButton)

      await waitFor(() => expect(deletePlatformMock).toHaveBeenCalledTimes(1))
      expect(deletePlatformMock).toHaveBeenCalledWith('account-1', 'youtube')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('opens Stripe checkout when subscribing', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'inactive',
      planId: null,
      planName: null,
      renewsAt: null,
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null
    })

    renderProfile({
      accessStatus: {
        ...sampleAccessStatus,
        allowed: false,
        entitled: false,
        mode: 'none',
        reason: 'Subscription required to continue using Atropos.',
        snapshot: { status: 'inactive' }
      }
    })

    expect(await screen.findByLabelText(/Billing email address/i)).toHaveValue('owner@example.com')
    const checkoutButton = await screen.findByRole('button', { name: /^Subscribe$/i })
    fireEvent.click(checkoutButton)

    await waitFor(() => expect(paymentsMocks.createCheckoutSession).toHaveBeenCalledTimes(1))
    expect(paymentsMocks.createCheckoutSession).toHaveBeenCalledWith({
      userId: 'atropos-desktop-dev',
      email: 'owner@example.com'
    })
    expect(window.open).toHaveBeenCalledWith('https://stripe.test/checkout', '_blank', 'noopener')

    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(paymentsMocks.fetchSubscriptionStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(refreshAccessStatusMock).toHaveBeenCalledTimes(1))
  })

  it('allows entering a billing email before subscribing when none is stored', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'inactive',
      planId: null,
      planName: null,
      renewsAt: null,
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null
    })

    renderProfile({
      accessStatus: {
        ...sampleAccessStatus,
        allowed: false,
        entitled: false,
        mode: 'none',
        reason: 'Subscription required to continue using Atropos.',
        customerEmail: null,
        snapshot: { status: 'inactive' }
      }
    })

    const emailField = await screen.findByLabelText(/Billing email address/i)
    expect(emailField).toHaveValue('')

    const subscribeButton = await screen.findByRole('button', { name: /^Subscribe$/i })
    expect(subscribeButton).toBeDisabled()

    fireEvent.change(emailField, { target: { value: 'new-owner@example.com' } })
    expect(subscribeButton).not.toBeDisabled()

    fireEvent.click(subscribeButton)

    await waitFor(() => expect(paymentsMocks.createCheckoutSession).toHaveBeenCalledTimes(1))
    expect(paymentsMocks.createCheckoutSession).toHaveBeenCalledWith({
      userId: 'atropos-desktop-dev',
      email: 'new-owner@example.com'
    })
    expect(window.open).toHaveBeenCalledWith('https://stripe.test/checkout', '_blank', 'noopener')
  })

  it('prefers the access entitlement when determining the billing CTA', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'inactive',
      planId: null,
      planName: null,
      renewsAt: null,
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null
    })

    renderProfile({ accessStatus: { ...sampleAccessStatus } })

    const manageButton = await screen.findByRole('button', { name: /Manage billing/i })
    expect(manageButton).toBeInTheDocument()
    expect(screen.getByText(/Access active/i)).toBeVisible()
  })

  it('shows subscribe when access is disabled despite an active subscription response', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'active',
      planId: 'plan_123',
      planName: 'Pro Plan',
      renewsAt: '2025-06-01T10:00:00Z',
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null
    })

    renderProfile({
      accessStatus: {
        ...sampleAccessStatus,
        allowed: false,
        entitled: false,
        mode: 'none',
        reason: 'Subscription is no longer active.',
        snapshot: { status: 'inactive' }
      }
    })

    const subscribeButton = await screen.findByRole('button', { name: /^Subscribe$/i })
    expect(subscribeButton).toBeInTheDocument()
    expect(screen.getByText(/Access disabled/i)).toBeVisible()
  })

  it('opens the billing portal when managing billing', async () => {
    renderProfile()

    const billingButton = screen.getByRole('button', { name: /Manage billing/i })
    fireEvent.click(billingButton)

    await waitFor(() => expect(paymentsMocks.createBillingPortalSession).toHaveBeenCalledTimes(1))
    expect(paymentsMocks.createBillingPortalSession).toHaveBeenCalledWith({
      userId: 'atropos-desktop-dev'
    })
    expect(window.open).toHaveBeenCalledWith('https://stripe.test/portal', '_blank', 'noopener')

    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(paymentsMocks.fetchSubscriptionStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(refreshAccessStatusMock).toHaveBeenCalledTimes(1))
  })

  it('shows trial onboarding UI when no subscription is active', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'inactive',
      planId: null,
      planName: null,
      renewsAt: null,
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null,
      trial: {
        allowed: true,
        started: false,
        total: 3,
        remaining: 3,
        usedAt: null,
        deviceHash: null
      }
    })

    renderProfile({
      accessStatus: {
        ...sampleAccessStatus,
        allowed: false,
        entitled: false,
        mode: 'none',
        reason: 'Subscription required to continue using Atropos.',
        snapshot: { status: 'inactive' }
      }
    })

    expect(
      await screen.findByText(/Try Atropos free with three renders/i)
    ).toBeInTheDocument()
    const startButton = await screen.findByRole('button', { name: /Start 3-video Trial/i })
    expect(startButton).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Subscribe$/i })).toBeInTheDocument()

    fireEvent.click(startButton)
    await waitFor(() => expect(trialMocks.startTrial).toHaveBeenCalledWith('atropos-desktop-dev'))
  })

  it('hides trial onboarding when the trial is not allowed', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'inactive',
      planId: null,
      planName: null,
      renewsAt: null,
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null,
      trial: {
        allowed: false,
        started: false,
        total: 3,
        remaining: 0,
        usedAt: null,
        deviceHash: null
      }
    })

    renderProfile({
      accessStatus: {
        ...sampleAccessStatus,
        allowed: false,
        entitled: false,
        mode: 'none',
        reason: 'Subscription required to continue using Atropos.',
        snapshot: { status: 'inactive' }
      }
    })

    expect(await screen.findByRole('button', { name: /^Subscribe$/i })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText(/Try Atropos free with three renders/i)).not.toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /Start 3-video Trial/i })).not.toBeInTheDocument()
    expect(trialMocks.startTrial).not.toHaveBeenCalled()
  })

  it('shows remaining trial renders without manual actions once the trial has started', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'inactive',
      planId: null,
      planName: null,
      renewsAt: null,
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null,
      trial: {
        allowed: true,
        started: true,
        total: 3,
        remaining: 2,
        usedAt: null,
        deviceHash: 'device-123'
      }
    })

    renderProfile({
      accessStatus: {
        ...sampleAccessStatus,
        allowed: true,
        entitled: false,
        mode: 'trial',
        expiresAt: null,
        reason: null,
        snapshot: { status: 'trialing', remaining: 2 }
      }
    })

    expect(await screen.findByText(/Trial mode — 2 of 3 left/i)).toBeInTheDocument()
    expect(screen.getByText(/Trial access — 2 left/i)).toBeInTheDocument()
    expect(screen.getByText(/Trial renders are applied automatically/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Use trial/i })).not.toBeInTheDocument()
    expect(trialMocks.claimTrial).not.toHaveBeenCalled()
  })

  it('disables the trial action when all renders are exhausted', async () => {
    paymentsMocks.fetchSubscriptionStatus.mockResolvedValueOnce({
      status: 'inactive',
      planId: null,
      planName: null,
      renewsAt: null,
      cancelAt: null,
      trialEndsAt: null,
      latestInvoiceUrl: null,
      trial: {
        allowed: true,
        started: true,
        total: 3,
        remaining: 0,
        usedAt: null,
        deviceHash: 'device-123'
      }
    })

    renderProfile({
      accessStatus: {
        ...sampleAccessStatus,
        allowed: false,
        entitled: false,
        mode: 'none',
        reason: 'Trial remaining: 0 of 3. Subscribe to continue using Atropos.',
        snapshot: { status: 'inactive', remaining: 0 }
      }
    })

    expect(await screen.findByText(/Trial mode — 0 of 3 left/i)).toBeInTheDocument()
    expect(
      screen.getByText(/You have used all trial renders. Subscribe to continue/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Trial exhausted/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trial exhausted/i })).not.toBeInTheDocument()
  })
})

