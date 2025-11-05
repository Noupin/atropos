import type { ChangeEvent, FC, FormEvent } from 'react'
import { PLATFORM_LABELS, SUPPORTED_PLATFORMS, type SupportedPlatform } from '../../types'

type UploadStatus = 'idle' | 'ready' | 'scheduled'

type UploadModeViewProps = {
  selectedPlatforms: SupportedPlatform[]
  onTogglePlatform: (platform: SupportedPlatform) => void
  platformNotes: string
  onPlatformNotesChange: (value: string) => void
  onSaveDistribution: (event: FormEvent<HTMLFormElement>) => void
  onScheduleUpload: (event: FormEvent<HTMLFormElement>) => void
  uploadStatus: UploadStatus
  uploadStatusLabel: string
}

const UploadModeView: FC<UploadModeViewProps> = ({
  selectedPlatforms,
  onTogglePlatform,
  platformNotes,
  onPlatformNotesChange,
  onSaveDistribution,
  onScheduleUpload,
  uploadStatus,
  uploadStatusLabel
}) => {
  const handlePlatformNotesChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onPlatformNotesChange(event.target.value)
  }

  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm">
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-[var(--fg)]">Upload plan</h3>
        <p className="text-xs text-[var(--muted)]">Choose destinations and let us handle the scheduling.</p>
      </div>
      <form className="space-y-3" onSubmit={onSaveDistribution}>
        <h4 className="text-sm font-semibold text-[var(--fg)]">Distribution</h4>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_PLATFORMS.map((platform) => {
            const isActive = selectedPlatforms.includes(platform)
            return (
              <button
                key={platform}
                type="button"
                onClick={() => onTogglePlatform(platform)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? 'border-[var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] text-[var(--fg)]'
                    : 'border-white/10 text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]'
                }`}
              >
                {PLATFORM_LABELS[platform]}
              </button>
            )
          })}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
            Platform notes
          </span>
          <textarea
            value={platformNotes}
            onChange={handlePlatformNotesChange}
            className="min-h-[72px] w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </label>
        <button
          type="submit"
          className="marble-button marble-button--secondary w-full justify-center px-4 py-2 text-sm font-semibold"
        >
          Save distribution
        </button>
      </form>
      <div className="h-px w-full bg-white/10" />
      <form className="space-y-3" onSubmit={onScheduleUpload}>
        <h4 className="text-sm font-semibold text-[var(--fg)]">Upload schedule</h4>
        <p className="text-xs text-[var(--muted)]">{uploadStatusLabel}</p>
        <button
          type="submit"
          className="marble-button marble-button--primary w-full justify-center px-4 py-2 text-sm font-semibold"
          disabled={uploadStatus === 'scheduled'}
        >
          {uploadStatus === 'scheduled' ? 'Upload scheduled' : 'Schedule upload'}
        </button>
      </form>
    </div>
  )
}

export default UploadModeView
