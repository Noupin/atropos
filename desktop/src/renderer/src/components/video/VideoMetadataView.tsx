import type { FC, FormEvent } from 'react'

export type VideoMetadataViewProps = {
  title: string
  description: string
  callToAction: string
  tags: string
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCallToActionChange: (value: string) => void
  onTagsChange: (value: string) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
}

const VideoMetadataView: FC<VideoMetadataViewProps> = ({
  title,
  description,
  callToAction,
  tags,
  onTitleChange,
  onDescriptionChange,
  onCallToActionChange,
  onTagsChange,
  onSave
}) => {
  return (
    <form
      className="space-y-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm"
      onSubmit={onSave}
    >
      <h3 className="text-base font-semibold text-[var(--fg)]">Metadata</h3>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
          Title
        </span>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          placeholder="Give this clip a headline"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
          Description
        </span>
        <textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className="min-h-[96px] w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          placeholder="Set the stage for viewers"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
          Call to action
        </span>
        <input
          value={callToAction}
          onChange={(event) => onCallToActionChange(event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          placeholder="Invite viewers to keep watching"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
          Tags
        </span>
        <input
          value={tags}
          onChange={(event) => onTagsChange(event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          placeholder="Add comma-separated keywords"
        />
      </label>
      <button
        type="submit"
        className="marble-button marble-button--primary w-full justify-center px-4 py-2 text-sm font-semibold"
      >
        Save details
      </button>
    </form>
  )
}

export default VideoMetadataView
