import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
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
    progress: 1
  },
  {
    id: 'audio',
    title: 'Ensure audio track',
    description: 'Acquire the audio track.',
    durationMs: 1000,
    status: 'running',
    progress: 0.4
  },
  {
    id: 'transcript',
    title: 'Generate transcript',
    description: 'Build the transcript file.',
    durationMs: 1000,
    status: 'pending',
    progress: 0
  }
]

describe('PipelineProgress', () => {
  it('renders pipeline summary and step details', () => {
    render(<PipelineProgress steps={mockSteps} />)

    expect(screen.getByLabelText(/pipeline progress overview/i)).toBeInTheDocument()
    expect(screen.getByText(/pipeline progress/i)).toBeInTheDocument()
    expect(screen.getByText(/running step 2 of 3/i)).toBeInTheDocument()
    expect(screen.getByText(/step 1: download source video/i)).toBeInTheDocument()
    expect(screen.getByText(/ensure audio track — 40%/i)).toBeInTheDocument()

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', '47')
  })
})
