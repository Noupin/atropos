import type { ChangeEvent, FC, FormEvent } from 'react'

type MetadataModeViewProps = {
  title: string
  description: string
  callToAction: string
  tags: string
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCallToActionChange: (value: string) => void
  onTagsChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

const MetadataModeView: FC<MetadataModeViewProps> = ({
  title,
  description,
  callToAction,
  tags,
  onTitleChange,
  onDescriptionChange,
  onCallToActionChange,
  onTagsChange,
  onSubmit
}) => {
  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onTitleChange(event.target.value)
  }

  const handleDescriptionChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onDescriptionChange(event.target.value)
  }

  const handleCallToActionChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onCallToActionChange(event.target.value)
  }

  const handleTagsChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onTagsChange(event.target.value)
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm"
      onSubmit={onSubmit}
    >
      <h3 className="text-base font-semibold text-[var(--fg)]">Metadata</h3>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
          Title
        </span>
        <input
          value={title}
          onChange={handleTitleChange}
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
          onChange={handleDescriptionChange}
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
          onChange={handleCallToActionChange}
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
          onChange={handleTagsChange}
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

export default MetadataModeView
