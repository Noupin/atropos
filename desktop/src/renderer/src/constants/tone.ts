export type ToneValue =
  | 'funny'
  | 'science'
  | 'history'
  | 'tech'
  | 'health'
  | 'conspiracy'
  | 'politics'

export const TONE_OPTIONS: Array<{ value: ToneValue; label: string }> = [
  { value: 'funny', label: 'Funny' },
  { value: 'science', label: 'Science' },
  { value: 'history', label: 'History' },
  { value: 'tech', label: 'Tech' },
  { value: 'health', label: 'Health' },
  { value: 'conspiracy', label: 'Conspiracy' },
  { value: 'politics', label: 'Politics' }
]

export const TONE_LABELS: Record<string, string> = TONE_OPTIONS.reduce(
  (labels, option) => ({
    ...labels,
    [option.value]: option.label
  }),
  {}
)
