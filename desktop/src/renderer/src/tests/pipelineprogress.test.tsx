import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PipelineProgress from '../components/PipelineProgress'
import type { PipelineStep } from '../types'

const mockSteps: PipelineStep[] = [
  {
    id: 'download-video',
    title: 'Download source video',
    description: 'Retrieve the video file.',
    durationMs: 1000,
    status: 'completed',
    progress: 1,
    clipProgress: null,
    etaSeconds: null,
    clipStage: false,
    substeps: []
  },
  {
    id: 'produce-clips',
    title: 'Produce final clips',
    description: 'Cut clips, render them, and prepare descriptions.',
    durationMs: 1000,
    status: 'running',
    progress: 0.5,
    clipProgress: { completed: 2, total: 5 },
    etaSeconds: 45,
    clipStage: true,
    substeps: [
      {
        id: 'cut-clips',
        title: 'Cut clips',
        description: 'Trim the source video according to clip timing.',
        status: 'completed',
        progress: 1,
        etaSeconds: null
      },
      {
        id: 'generate-subtitles',
        title: 'Generate subtitles',
        description: 'Produce subtitles for each clip.',
        status: 'running',
        progress: 0.4,
        etaSeconds: 60
      },
      {
        id: 'render-verticals',
        title: 'Render vertical formats',
        description: 'Render the vertical video output.',
        status: 'pending',
        progress: 0,
        etaSeconds: null
      }
    ]
  },
  {
    id: 'transcript',
    title: 'Generate transcript',
    description: 'Build the transcript file.',
    durationMs: 1000,
    status: 'pending',
    progress: 0,
    clipProgress: null,
    etaSeconds: null,
    clipStage: false,
    substeps: []
  }
]

describe('PipelineProgress', () => {
  it('renders pipeline summary and step details', () => {
    expect(mockSteps.map((step) => step.title)).toEqual([
      'Download source video',
      'Produce final clips',
      'Generate transcript'
    ])
    render(<PipelineProgress steps={mockSteps} />)

    expect(screen.getByLabelText(/pipeline progress overview/i)).toBeInTheDocument()
    expect(screen.getByText(/pipeline progress/i)).toBeInTheDocument()
    expect(screen.getByText(/running step 2 of 3/i)).toBeInTheDocument()
    expect(screen.getByText(/currently running: produce final clips/i)).toBeInTheDocument()

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', '50')

    const stepList = screen.getByTestId('pipeline-steps')
    expect(stepList).toHaveClass('grid')

    const steps = within(stepList).getAllByRole('button', { name: /step \d/i })
    expect(steps).toHaveLength(mockSteps.length)

    const produceButton = within(stepList).getByRole('button', { name: /produce final clips/i })
    expect(produceButton).toHaveAttribute('aria-expanded', 'true')

    const transcriptButton = within(stepList).getByRole('button', { name: /generate transcript/i })
    expect(within(transcriptButton).getByText(/0%/i)).toBeInTheDocument()

    fireEvent.click(transcriptButton)
    expect(transcriptButton).toHaveAttribute('aria-expanded', 'true')
    const transcriptProgress = within(stepList).getByTestId('step-progress-transcript')
    expect(within(transcriptProgress).getByText('0%')).toBeInTheDocument()

    expect(within(stepList).getByText(/clips 2\/5/i)).toBeInTheDocument()
    const substepsList = within(stepList).getByTestId('substeps-produce-clips')
    expect(within(substepsList).getByText(/generate subtitles/i)).toBeInTheDocument()
    expect(within(substepsList).getByText(/substep a/i)).toBeInTheDocument()
    expect(within(stepList).getAllByText(/40%/i).length).toBeGreaterThan(0)
    expect(within(stepList).getAllByText(/≈1m remaining/i).length).toBeGreaterThan(0)
    const produceStepProgress = within(stepList).getByTestId('step-progress-produce-clips')
    expect(produceStepProgress).toHaveAccessibleName(/produce final clips progress/i)
  })
})
