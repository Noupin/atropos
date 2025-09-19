import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '../pages/Profile'
import type { AccountPlatformConnection, AccountSummary, AuthPingSummary } from '../types'

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
    active: true
  },
  {
    id: 'account-2',
    displayName: 'Brand Studio',
    description: null,
    createdAt: '2025-05-01T12:00:00Z',
    platforms: [],
    active: true
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
  const updateAccountMock = vi.fn()
  const deleteAccountMock = vi.fn()
  const updatePlatformMock = vi.fn()
  const deletePlatformMock = vi.fn()

  beforeEach(() => {
    createAccountMock.mockReset()
    addPlatformMock.mockReset()
    refreshAccountsMock.mockReset()
    updateAccountMock.mockReset()
    deleteAccountMock.mockReset()
    updatePlatformMock.mockReset()
    deletePlatformMock.mockReset()
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
        onUpdateAccount={updateAccountMock}
        onDeleteAccount={deleteAccountMock}
        onUpdatePlatform={updatePlatformMock}
        onDeletePlatform={deletePlatformMock}
        onRefreshAccounts={refreshAccountsMock}
        {...overrides}
      />
    )

  it('displays authentication status and connected platforms', () => {
    renderProfile()

    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText(/Connected platforms:/i)).toHaveTextContent('1/1')

    const creatorCard = screen.getAllByTestId('account-card-account-1')[0]
    const scope = within(creatorCard)
    expect(scope.getByText('YouTube Channel')).toBeVisible()
    expect(scope.getByText(/Authenticated/i)).toBeVisible()
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

  it('connects an Instagram platform using username and password', async () => {
    addPlatformMock.mockResolvedValueOnce(sampleAccounts[1])

    renderProfile()

    const brandCard = screen.getAllByTestId('account-card-account-2')[0]
    const scope = within(brandCard)
    fireEvent.change(scope.getByLabelText(/Platform/i), { target: { value: 'instagram' } })
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
    fireEvent.change(scope.getByLabelText(/Platform/i), { target: { value: 'instagram' } })

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
    const toggleButton = scope.getByRole('button', { name: /Disable account/i })
    fireEvent.click(toggleButton)

    await waitFor(() => expect(updateAccountMock).toHaveBeenCalledTimes(1))
    expect(updateAccountMock).toHaveBeenCalledWith('account-1', { active: false })
    expect(await scope.findByText(/Account disabled successfully/i)).toBeInTheDocument()
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

      const disableButton = scope.getByRole('button', { name: /^Disable$/i })
      fireEvent.click(disableButton)

      await waitFor(() => expect(updatePlatformMock).toHaveBeenCalledTimes(1))
      expect(updatePlatformMock).toHaveBeenCalledWith('account-1', 'youtube', { active: false })
      expect(await scope.findByText(/YouTube disabled successfully/i)).toBeInTheDocument()

      const removeButton = scope.getByRole('button', { name: /^Remove$/i })
      fireEvent.click(removeButton)

      await waitFor(() => expect(deletePlatformMock).toHaveBeenCalledTimes(1))
      expect(deletePlatformMock).toHaveBeenCalledWith('account-1', 'youtube')
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
