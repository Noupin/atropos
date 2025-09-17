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

const STATUS_HELPERS = {
  active: 'Connection is healthy and ready to publish.',
  expiring: 'Refresh authentication soon to avoid interruptions.',
  disconnected: 'Reconnect this account to resume scheduling uploads.'
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
      const toggleButton = within(panel).getByRole('button', {
        name: `Expand ${account.displayName} details`
      })
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
      const summarySection = within(panel).getByTestId(`account-summary-${account.id}`)
      expect(summarySection).toBeVisible()

      const totals = getAccountTotals(account.id)
      expect(summarySection).toHaveTextContent(totals.readyVideos.toLocaleString())
      expect(summarySection).toHaveTextContent(totals.dailyUploadTarget.toLocaleString())

      const coverage = getCoverageExpectations(totals.readyVideos, totals.dailyUploadTarget)
      const coverageLabel = within(summarySection).getByText(coverage.label)
      const coverageElement = coverageLabel.closest('[title]')
      expect(coverageElement).not.toBeNull()
      expect(coverageElement).toHaveAttribute('title', coverage.description)

      if (account.platforms.length > 0) {
        const platformTags = within(panel).getByTestId(`account-platform-tags-${account.id}`)
        const platformItems = within(platformTags).getAllByRole('listitem')
        expect(platformItems).toHaveLength(account.platforms.length)

        account.platforms.forEach((platform) => {
          const label = within(platformTags).getByText(platform.name)
          const tooltipHost = label.closest('[title]')
          expect(tooltipHost).not.toBeNull()
          expect(tooltipHost).toHaveAttribute(
            'title',
            `${platform.name}: ${STATUS_LABELS[platform.status]}`
          )
        })
      } else {
        expect(
          within(panel).getByText('No platforms connected yet.', { selector: 'p' })
        ).toBeInTheDocument()
      }
    })
  })

  it('switches platform tabs without changing next uploads and reveals platform specific recovery details', () => {
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

    const aggregatedUploads = multiPlatformAccount.platforms.flatMap(
      (platform) => platform.upcomingUploads
    )
    const nextUploadsToggle = within(panel).getByRole('button', { name: /Next uploads/i })
    if (nextUploadsToggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(nextUploadsToggle)
    }

    const upcomingSection = within(panel).getByTestId(
      `account-upcoming-${multiPlatformAccount.id}`
    )
    expect(upcomingSection).toBeVisible()
    let videos = within(upcomingSection).getAllByTestId('profile-upload-video')
    expect(videos).toHaveLength(aggregatedUploads.length)

    const targetPlatform = multiPlatformAccount.platforms[1]
    const tab = within(panel).getByRole('tab', { name: new RegExp(targetPlatform.name, 'i') })
    fireEvent.click(tab)
    expect(tab).toHaveAttribute('aria-selected', 'true')

    if (targetPlatform.status === 'disconnected') {
      expect(
        within(panel).getByRole('button', {
          name: new RegExp(`Reconnect ${targetPlatform.name}`, 'i')
        })
      ).toBeVisible()
    } else if (targetPlatform.statusMessage) {
      expect(
        within(panel).getByText(targetPlatform.statusMessage, { selector: 'p' })
      ).toBeVisible()
    }

    const helperText = within(panel).getByText(STATUS_HELPERS[targetPlatform.status], {
      selector: 'p'
    })
    expect(helperText).toBeVisible()

    const missedUploadsSection = within(panel).getByTestId(
      `missed-uploads-${targetPlatform.id}`
    )
    expect(missedUploadsSection.children.length).toBe(targetPlatform.missedUploads.length)

    videos = within(upcomingSection).getAllByTestId('profile-upload-video')
    expect(videos).toHaveLength(aggregatedUploads.length)
  })
})
