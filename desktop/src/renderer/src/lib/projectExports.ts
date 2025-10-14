import type { ClipProjectTarget } from '../types'

export const PROJECT_EXPORT_OPTIONS: Array<{ target: ClipProjectTarget; label: string }> = [
  { target: 'final_cut', label: 'Final Cut Pro' },
  { target: 'premiere', label: 'Premiere Pro' },
  { target: 'resolve', label: 'DaVinci Resolve' }
]

export const getProjectExportLabel = (target: ClipProjectTarget): string => {
  const match = PROJECT_EXPORT_OPTIONS.find((option) => option.target === target)
  return match ? match.label : target
}
