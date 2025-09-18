import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Profile from '../pages/Profile'
import type { AccountSummary, AuthPingSummary } from '../types'

const sampleAccounts: AccountSummary[] = [
  {
    id: 'account-1',
    displayName: 'Creator Hub',
    description: 'Primary publishing account',
    createdAt: '2025-05-01T12:00:00Z',
    platforms: [
      {
        platform: 'youtube',
        label: 'YouTube Channel',
        status: 'active',
        connected: true,
        tokenPath: '/tokens/account-1/youtube.json',
        addedAt: '2025-05-01T12:00:00Z',
        lastVerifiedAt: '2025-05-02T08:00:00Z'
      }
    ]
  },
  {
    id: 'account-2',
    displayName: 'Brand Studio',
    description: null,
    createdAt: '2025-05-01T12:00:00Z',
    platforms: []
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

describe('Profile page', () => {
  const createAccountMock = vi.fn()
  const addPlatformMock = vi.fn()
  const refreshAccountsMock = vi.fn()

  beforeEach(() => {
    createAccountMock.mockReset()
    addPlatformMock.mockReset()
    refreshAccountsMock.mockReset()
    refreshAccountsMock.mockResolvedValue(undefined)
  })

  const renderProfile = (overrides: Partial<ComponentProps<typeof Profile>> = {}) =>
    render(
      <Profile
        registerSearch={() => {}}
        accounts={sampleAccounts}
        accountsError={null}
        authStatus={sampleAuthStatus}
        authError={null}
        isLoadingAccounts={false}
        onCreateAccount={createAccountMock}
        onAddPlatform={addPlatformMock}
        onRefreshAccounts={refreshAccountsMock}
        {...overrides}
      />
    )

  it('displays authentication status and connected platforms', () => {
    renderProfile()

    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText(/Connected platforms:/i)).toHaveTextContent('1/1')

    const accountCards = screen.getAllByText(/Creator Hub|Brand Studio/)
    expect(accountCards).toHaveLength(2)

    const creatorCard = accountCards[0].closest('[class*="rounded-2xl"]')
    expect(creatorCard).not.toBeNull()
    if (creatorCard) {
      const scope = within(creatorCard)
      expect(scope.getByText('YouTube Channel')).toBeVisible()
      expect(scope.getByText(/Authenticated/i)).toBeVisible()
    }
  })

  it('submits a new account with trimmed values', async () => {
    createAccountMock.mockResolvedValueOnce(sampleAccounts[0])

    renderProfile()

    const [accountNameInput] = screen.getAllByLabelText(/Account name/i)
    fireEvent.change(accountNameInput, {
      target: { value: '  New Account  ' }
    })
    const [descriptionInput] = screen.getAllByLabelText(/Description/i)
    fireEvent.change(descriptionInput, {
      target: { value: '  Description here  ' }
    })

    const [createButton] = screen.getAllByRole('button', { name: /Create account/i })
    fireEvent.click(createButton)

    await waitFor(() => expect(createAccountMock).toHaveBeenCalledTimes(1))
    expect(createAccountMock).toHaveBeenCalledWith({
      displayName: 'New Account',
      description: 'Description here'
    })

    expect(await screen.findByText(/Account created successfully/i)).toBeInTheDocument()
  })

  it('parses JSON credentials when connecting a new platform', async () => {
    addPlatformMock.mockResolvedValueOnce(sampleAccounts[1])

    renderProfile()

    const brandCard = screen.getAllByTestId('account-card-account-2')[0]
    const scope = within(brandCard)
    const [platformSelect] = scope.getAllByLabelText(/Platform/i)
    fireEvent.change(platformSelect, { target: { value: 'tiktok' } })
    fireEvent.change(scope.getByLabelText(/Label \(optional\)/i), { target: { value: 'Brand TikTok' } })
    fireEvent.change(scope.getByLabelText(/Credentials JSON/i), {
      target: { value: '{"accessToken":"123"}' }
    })

    const [connectButton] = scope.getAllByRole('button', { name: /Connect platform/i })
    fireEvent.click(connectButton)

    await waitFor(() => expect(addPlatformMock).toHaveBeenCalledTimes(1))
    expect(addPlatformMock).toHaveBeenCalledWith('account-2', {
      platform: 'tiktok',
      label: 'Brand TikTok',
      credentials: { accessToken: '123' }
    })
  })

  it('shows validation errors when credentials JSON is invalid', () => {
    renderProfile()

    const brandCard = screen.getAllByTestId('account-card-account-2')[0]
    const scope = within(brandCard)
    const [platformSelect] = scope.getAllByLabelText(/Platform/i)
    fireEvent.change(platformSelect, { target: { value: 'instagram' } })
    fireEvent.change(scope.getByLabelText(/Credentials JSON/i), {
      target: { value: 'invalid-json' }
    })

    const [connectButton] = scope.getAllByRole('button', { name: /Connect platform/i })
    fireEvent.click(connectButton)

    expect(scope.getByText(/Credentials must be valid JSON/i)).toBeVisible()
    expect(addPlatformMock).not.toHaveBeenCalled()
  })
})
