import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PipelineProgress from '../components/PipelineProgress'
import type { PipelineStep } from '../types'

const mockSteps: PipelineStep[] = [
  {
    id: 'download',
    title: 'Download source video',
    description: 'Retrieve the video file.',
    durationMs: 1000,
    status: 'completed',
    progress: 1,
    clipProgress: null,
    etaSeconds: null
  },
  {
    id: 'audio',
    title: 'Ensure audio track',
    description: 'Acquire the audio track.',
    durationMs: 1000,
    status: 'running',
    progress: 0.4,
    clipProgress: null,
    etaSeconds: 45
  },
  {
    id: 'transcript',
    title: 'Generate transcript',
    description: 'Build the transcript file.',
    durationMs: 1000,
    status: 'pending',
    progress: 0,
    clipProgress: null,
    etaSeconds: null
  }
]

describe('PipelineProgress', () => {
  it('renders pipeline summary and step details', () => {
    render(<PipelineProgress steps={mockSteps} />)

    expect(screen.getByLabelText(/pipeline progress overview/i)).toBeInTheDocument()
    expect(screen.getByText(/pipeline progress/i)).toBeInTheDocument()
    expect(screen.getByText(/running step 2 of 3/i)).toBeInTheDocument()
    expect(screen.getByText(/currently running: ensure audio track/i)).toBeInTheDocument()

    const completedSteps = screen.getByTestId('completed-steps')
    expect(within(completedSteps).getByText(/step 1/i)).toBeInTheDocument()
    expect(within(completedSteps).getByText(/download source video/i)).toBeInTheDocument()

    const activeStepCard = screen.getByTestId('active-step')
    expect(within(activeStepCard).getByText(/step 2: ensure audio track/i)).toBeInTheDocument()
    expect(within(activeStepCard).getByText('40%')).toBeInTheDocument()
    expect(within(activeStepCard).getByText(/≈45s remaining/i)).toBeInTheDocument()

    const upcomingSteps = screen.getByTestId('upcoming-steps')
    expect(within(upcomingSteps).getByText(/step 3/i)).toBeInTheDocument()
    expect(within(upcomingSteps).getByText(/generate transcript/i)).toBeInTheDocument()

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', '47')
  })
})
