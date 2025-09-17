import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Profile from '../pages/Profile'
import { PROFILE_ACCOUNTS } from '../mock/accounts'

const STATUS_LABELS = {
  active: 'Authenticated',
  expiring: 'Expiring soon',
  disconnected: 'Not connected'
} as const satisfies Record<string, string>

const getAccountTotals = (accountId: string) => {
  const account = PROFILE_ACCOUNTS.find((item) => item.id === accountId)
  if (!account) {
    throw new Error(`Unknown account: ${accountId}`)
  }

  return account.platforms.reduce(
    (totals, platform) => ({
      readyVideos: totals.readyVideos + platform.readyVideos,
      dailyUploadTarget: totals.dailyUploadTarget + platform.dailyUploadTarget
    }),
    { readyVideos: 0, dailyUploadTarget: 0 }
  )
}

const getCoverageExpectations = (readyVideos: number, dailyUploadTarget: number) => {
  if (dailyUploadTarget <= 0) {
    return {
      label: '—',
      description: 'Set a daily upload schedule across your platforms to estimate coverage.'
    }
  }

  const days = readyVideos / dailyUploadTarget
  return {
    label: `${days.toFixed(1)} days`,
    description: 'Combined coverage across all connected platforms.'
  }
}

describe('Profile page', () => {
  it('displays aggregate metrics and platform statuses for each account when collapsed', () => {
    render(<Profile registerSearch={() => {}} />)

    PROFILE_ACCOUNTS.forEach((account) => {
      const panel = screen.getByTestId(`account-panel-${account.id}`)
      const collapseButton = within(panel).getByRole('button', {
        name: `Collapse ${account.displayName} details`
      })
      fireEvent.click(collapseButton)

      const summarySection = within(panel).getByTestId(`account-summary-${account.id}`)
      expect(summarySection).toBeVisible()

      const totals = getAccountTotals(account.id)
      expect(summarySection).toHaveTextContent(totals.readyVideos.toLocaleString())
      expect(summarySection).toHaveTextContent(totals.dailyUploadTarget.toLocaleString())

      const coverage = getCoverageExpectations(totals.readyVideos, totals.dailyUploadTarget)
      expect(summarySection).toHaveTextContent(coverage.label)
      expect(summarySection).toHaveTextContent(coverage.description)

      if (account.platforms.length > 0) {
        const platformItems = within(summarySection).getAllByRole('listitem')
        expect(platformItems).toHaveLength(account.platforms.length)

        account.platforms.forEach((platform) => {
          expect(summarySection).toHaveTextContent(platform.name)
          expect(summarySection).toHaveTextContent(platform.readyVideos.toLocaleString())
          expect(summarySection).toHaveTextContent(platform.dailyUploadTarget.toLocaleString())
          expect(summarySection).toHaveTextContent(STATUS_LABELS[platform.status])
        })
      } else {
        expect(summarySection).toHaveTextContent(
          'Connect a platform to manage scheduling for this account.'
        )
      }
    })
  })

  it('switches platform tabs to show platform specific details', () => {
    render(<Profile registerSearch={() => {}} />)

    const multiPlatformAccount = PROFILE_ACCOUNTS.find((account) => account.platforms.length > 1)
    expect(multiPlatformAccount).toBeDefined()
    if (!multiPlatformAccount) {
      return
    }

    const panels = screen.getAllByTestId(`account-panel-${multiPlatformAccount.id}`)
    expect(panels.length).toBeGreaterThan(0)
    const panel = panels[0]

    const toggleButton = within(panel).getByRole('button', {
      name: new RegExp(`${multiPlatformAccount.displayName} details`, 'i')
    })
    if (toggleButton.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(toggleButton)
    }

    const initialPlatform = multiPlatformAccount.platforms[0]
    let videos = within(panel).getAllByTestId('profile-upload-video')
    expect(videos).toHaveLength(initialPlatform.upcomingUploads.length)

    const targetPlatform = multiPlatformAccount.platforms[1]
    const tab = within(panel).getByRole('tab', { name: new RegExp(targetPlatform.name, 'i') })
    fireEvent.click(tab)
    expect(tab).toHaveAttribute('aria-selected', 'true')

    const platformSummary = within(panel).getByTestId(`platform-summary-${targetPlatform.id}`)
    expect(platformSummary).toHaveTextContent(targetPlatform.readyVideos.toLocaleString())
    expect(platformSummary).toHaveTextContent(targetPlatform.dailyUploadTarget.toLocaleString())

    videos = within(panel).getAllByTestId('profile-upload-video')
    expect(videos).toHaveLength(targetPlatform.upcomingUploads.length)
  })
})
