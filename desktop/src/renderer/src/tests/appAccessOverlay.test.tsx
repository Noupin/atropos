import '@testing-library/jest-dom/vitest'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AccessCheckResult } from '../types'

const { verifyDesktopAccessMock, fetchAccountsMock, pingAuthMock } = vi.hoisted(() => ({
  verifyDesktopAccessMock: vi.fn<[], Promise<AccessCheckResult>>(),
  fetchAccountsMock: vi.fn(),
  pingAuthMock: vi.fn()
}))

vi.mock('../components/Search', () => ({
  default: () => <div data-testid="search" />
}))

vi.mock('../components/MarbleSelect', () => ({
  default: () => <div data-testid="marble-select" />
}))

vi.mock('../pages/Home', () => ({
  default: () => <div>Home route</div>
}))

vi.mock('../pages/Library', () => ({
  default: () => <div>Library route</div>
}))

vi.mock('../pages/Clip', () => ({
  default: () => <div>Clip route</div>
}))

vi.mock('../pages/ClipEdit', () => ({
  default: () => <div>Clip edit route</div>
}))

vi.mock('../pages/Settings', () => ({
  __esModule: true,
  default: () => <div>Settings route</div>,
  SettingsHeaderAction: {} as never
}))

vi.mock('../pages/Profile', () => ({
  default: () => <div>Profile route</div>
}))

vi.mock('../hooks/useNavigationHistory', () => ({
  __esModule: true,
  default: () => {}
}))

vi.mock('../services/accountsApi', () => ({
  fetchAccounts: fetchAccountsMock,
  pingAuth: pingAuthMock,
  createAccount: vi.fn(),
  addPlatformToAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountPlatform: vi.fn(),
  deleteAccountPlatform: vi.fn()
}))

vi.mock('../services/accessControl', () => ({
  verifyDesktopAccess: verifyDesktopAccessMock
}))

vi.mock('../services/paymentsApi', () => ({
  fetchSubscriptionStatus: vi.fn().mockResolvedValue(null),
  createCheckoutSession: vi.fn().mockResolvedValue({}),
  createBillingPortalSession: vi.fn().mockResolvedValue({})
}))

import App from '../App'

describe('App access overlay behaviour', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia

    fetchAccountsMock.mockResolvedValue([])
    pingAuthMock.mockResolvedValue({ message: 'Authenticated', status: 'ok' })
    verifyDesktopAccessMock.mockResolvedValue({
      allowed: false,
      status: 'inactive',
      reason: 'Subscription required.'
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the blocking overlay on non-profile routes when access is denied', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    await waitFor(() => expect(verifyDesktopAccessMock).toHaveBeenCalled())

    expect(
      await screen.findByRole('button', { name: /Open billing settings/i })
    ).toBeInTheDocument()
  })

  it('does not render the blocking overlay on the profile route', async () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    await waitFor(() => expect(verifyDesktopAccessMock).toHaveBeenCalled())
    await screen.findByText('Profile route')

    expect(
      screen.queryByRole('button', { name: /Open billing settings/i })
    ).not.toBeInTheDocument()
  })

  it('allows navigation when trial renders remain', async () => {
    verifyDesktopAccessMock.mockResolvedValueOnce({
      allowed: true,
      status: 'trialing',
      subscriptionStatus: 'trialing',
      subscriptionPlan: 'trial',
      reason: null,
      checkedAt: new Date().toISOString(),
      expiresAt: null,
      customerEmail: null
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <App searchInputRef={{ current: null }} />
      </MemoryRouter>
    )

    await waitFor(() => expect(verifyDesktopAccessMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Open billing settings/i })).not.toBeInTheDocument()
  })
})
