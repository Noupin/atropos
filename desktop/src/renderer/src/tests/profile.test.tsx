import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Profile from '../pages/Profile'
import { PROFILE_ACCOUNTS } from '../mock/accounts'

describe('Profile page', () => {
  it('shows each account summary with coverage and videos', () => {
    render(<Profile registerSearch={() => {}} />)

    expect(screen.getByRole('heading', { level: 1, name: /profile/i })).toBeInTheDocument()

    PROFILE_ACCOUNTS.forEach((account) => {
      const panels = screen.getAllByTestId(`account-panel-${account.id}`)
      expect(panels.length).toBeGreaterThan(0)
      const panel = panels[0]
      const panelQueries = within(panel)

      expect(panelQueries.getByText(account.displayName)).toBeInTheDocument()
      expect(panelQueries.getByText(/Ready videos/i)).toBeInTheDocument()
      expect(panelQueries.getByText(account.readyVideos.toLocaleString())).toBeInTheDocument()

      const coverageLabel =
        account.dailyUploadTarget > 0
          ? `${(account.readyVideos / account.dailyUploadTarget).toFixed(1)} days`
          : '—'
      expect(panelQueries.getByText(coverageLabel)).toBeInTheDocument()

      const videos = panelQueries.getAllByTestId('profile-upload-video')
      expect(videos).toHaveLength(account.upcomingUploads.length)
    })
  })

  it('toggles details visibility when collapsing an account', () => {
    render(<Profile registerSearch={() => {}} />)

    const account = PROFILE_ACCOUNTS[0]
    const panels = screen.getAllByTestId(`account-panel-${account.id}`)
    expect(panels.length).toBeGreaterThan(0)
    const panel = panels[0]

    const collapseButton = within(panel).getByRole('button', {
      name: `Collapse ${account.displayName} details`
    })
    expect(within(panel).getByText(/Next uploads/i)).toBeVisible()

    fireEvent.click(collapseButton)

    const expandButton = within(panel).getByRole('button', {
      name: `Expand ${account.displayName} details`
    })
    expect(within(panel).getByText(/Next uploads/i)).not.toBeVisible()

    fireEvent.click(expandButton)

    expect(within(panel).getByText(/Next uploads/i)).toBeVisible()
  })
})
