import type {
  ChangeEvent,
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from 'react'
import { formatDuration } from '../../lib/format'
import type { Clip } from '../../types'
import type { SaveStepState } from './saveSteps'

type OffsetReference = {
  startBase: number
  endBase: number
  startLabel: string
  endLabel: string
  startTitle: string
  endTitle: string
}

type TrimModeViewProps = {
  clip: Clip | null
  timelineRef: RefObject<HTMLDivElement>
  originalOverlayLayer: string
  renderedOverlayLayer: string
  originalOverlayLeftInset: string
  originalOverlayRightInset: string
  renderedOverlayLeftInset: string
  renderedOverlayRightInset: string
  originalStartMarkerPercent: number
  originalEndMarkerPercent: number
  renderedStartMarkerPercent: number
  renderedEndMarkerPercent: number
  currentOverlayLeftInset: string
  currentOverlayRightInset: string
  showStartTooltip: boolean
  showEndTooltip: boolean
  startPercent: number
  endPercent: number
  startOffsetTooltip: string
  endOffsetTooltip: string
  startHandleValueMin: number
  startHandleValueMax: number
  endHandleValueMin: number
  endHandleValueMax: number
  rangeStart: number
  rangeEnd: number
  windowStart: number
  windowEnd: number
  startAriaValueText: string
  endAriaValueText: string
  onHandlePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: 'start' | 'end'
  ) => void
  onHandlePointerMove: (
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: 'start' | 'end'
  ) => void
  onHandlePointerEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHandleKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    kind: 'start' | 'end'
  ) => void
  onHandleBlur: () => void
  onSnapToOriginal: () => void
  onSnapToRendered: () => void
  shouldShowRenderedOverlay: boolean
  formattedStartOffset: string
  formattedEndOffset: string
  onRangeInputChange: (event: ChangeEvent<HTMLInputElement>, kind: 'start' | 'end') => void
  onRangeInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  onRangeInputBlur: () => void
  offsetReference: OffsetReference
  durationSeconds: number
  durationWithinLimits: boolean
  minClipDurationSeconds: number
  maxClipDurationSeconds: number
  durationWithinSweetSpot: boolean
  sweetSpotMinSeconds: number
  sweetSpotMaxSeconds: number
  expandAmount: number
  onExpandAmountChange: (event: ChangeEvent<HTMLInputElement>) => void
  onExpandLeft: () => void
  onExpandRight: () => void
  onSave: () => Promise<void> | void
  onReset: () => void
  isSaving: boolean
  isLoadingClip: boolean
  shouldShowSaveSteps: boolean
  saveSteps: SaveStepState[]
  saveError: string | null
  saveSuccess: string | null
}

const TrimModeView: FC<TrimModeViewProps> = ({
  clip,
  timelineRef,
  originalOverlayLayer,
  renderedOverlayLayer,
  originalOverlayLeftInset,
  originalOverlayRightInset,
  renderedOverlayLeftInset,
  renderedOverlayRightInset,
  originalStartMarkerPercent,
  originalEndMarkerPercent,
  renderedStartMarkerPercent,
  renderedEndMarkerPercent,
  currentOverlayLeftInset,
  currentOverlayRightInset,
  showStartTooltip,
  showEndTooltip,
  startPercent,
  endPercent,
  startOffsetTooltip,
  endOffsetTooltip,
  startHandleValueMin,
  startHandleValueMax,
  endHandleValueMin,
  endHandleValueMax,
  rangeStart,
  rangeEnd,
  windowStart,
  windowEnd,
  startAriaValueText,
  endAriaValueText,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerEnd,
  onHandleKeyDown,
  onHandleBlur,
  onSnapToOriginal,
  onSnapToRendered,
  shouldShowRenderedOverlay,
  formattedStartOffset,
  formattedEndOffset,
  onRangeInputChange,
  onRangeInputKeyDown,
  onRangeInputBlur,
  offsetReference,
  durationSeconds,
  durationWithinLimits,
  minClipDurationSeconds,
  maxClipDurationSeconds,
  durationWithinSweetSpot,
  sweetSpotMinSeconds,
  sweetSpotMaxSeconds,
  expandAmount,
  onExpandAmountChange,
  onExpandLeft,
  onExpandRight,
  onSave,
  onReset,
  isSaving,
  isLoadingClip,
  shouldShowSaveSteps,
  saveSteps,
  saveError,
  saveSuccess
}) => {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-[var(--fg)]">Refine clip boundaries</h1>
        <p className="text-sm text-[var(--muted)]">
          Drag the handles or enter precise timestamps to trim the clip before regenerating
          subtitles and renders.
        </p>
      </div>
      <div className="space-y-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            Clip window
          </div>
          <div ref={timelineRef} className="relative mt-6 h-2 rounded-full bg-[color:var(--clip-track)] shadow-inner">
            <div
              className={`pointer-events-none absolute -top-1 -bottom-1 ${originalOverlayLayer} rounded-none bg-[color:color-mix(in_srgb,var(--clip-original)_65%,transparent)]`}
              style={{
                left: originalOverlayLeftInset,
                right: originalOverlayRightInset
              }}
              aria-hidden="true"
            />
            {shouldShowRenderedOverlay ? (
              <div
                className={`pointer-events-none absolute -top-1 -bottom-1 ${renderedOverlayLayer} rounded-none bg-[color:color-mix(in_srgb,var(--clip-rendered)_65%,transparent)]`}
                style={{
                  left: renderedOverlayLeftInset,
                  right: renderedOverlayRightInset
                }}
                aria-hidden="true"
              />
            ) : null}
            <div
              className="pointer-events-none absolute -top-3 -bottom-3 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-original-marker)]"
              style={{ left: `${originalStartMarkerPercent}%` }}
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -top-3 -bottom-3 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-original-marker)]"
              style={{ left: `${originalEndMarkerPercent}%` }}
              aria-hidden="true"
            />
            {shouldShowRenderedOverlay ? (
              <div
                className="pointer-events-none absolute -top-2 -bottom-2 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-rendered-marker)]"
                style={{ left: `${renderedStartMarkerPercent}%` }}
                aria-hidden="true"
              />
            ) : null}
            {shouldShowRenderedOverlay ? (
              <div
                className="pointer-events-none absolute -top-2 -bottom-2 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-rendered-marker)]"
                style={{ left: `${renderedEndMarkerPercent}%` }}
                aria-hidden="true"
              />
            ) : null}
            <div
              className="pointer-events-none absolute -top-1 -bottom-1 z-40 rounded-full bg-[color:var(--clip-current)]"
              style={{ left: currentOverlayLeftInset, right: currentOverlayRightInset }}
            />
            {showStartTooltip ? (
              <div
                className="pointer-events-none absolute -top-7 z-50 -translate-x-1/2 rounded-md bg-black/85 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--clip-tooltip-text)] shadow-lg"
                style={{ left: `${startPercent}%` }}
              >
                {startOffsetTooltip}
              </div>
            ) : null}
            {showEndTooltip ? (
              <div
                className="pointer-events-none absolute -top-7 z-50 -translate-x-1/2 rounded-md bg-black/85 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--clip-tooltip-text)] shadow-lg"
                style={{ left: `${endPercent}%` }}
              >
                {endOffsetTooltip}
              </div>
            ) : null}
            <button
              type="button"
              role="slider"
              aria-label="Adjust clip start"
              aria-valuemin={startHandleValueMin}
              aria-valuemax={startHandleValueMax}
              aria-valuenow={rangeStart}
              aria-valuetext={startAriaValueText}
              onPointerDown={(event) => onHandlePointerDown(event, 'start')}
              onPointerMove={(event) => onHandlePointerMove(event, 'start')}
              onPointerUp={onHandlePointerEnd}
              onPointerCancel={onHandlePointerEnd}
              onKeyDown={(event) => onHandleKeyDown(event, 'start')}
              onBlur={onHandleBlur}
              className="absolute top-1/2 z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--clip-handle-border)] bg-[color:var(--clip-handle)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] hover:bg-[color:var(--clip-handle-hover)]"
              style={{ left: `${startPercent}%` }}
            >
              <span className="sr-only">Drag to adjust start</span>
            </button>
            <button
              type="button"
              role="slider"
              aria-label="Adjust clip end"
              aria-valuemin={endHandleValueMin}
              aria-valuemax={endHandleValueMax}
              aria-valuenow={rangeEnd}
              aria-valuetext={endAriaValueText}
              onPointerDown={(event) => onHandlePointerDown(event, 'end')}
              onPointerMove={(event) => onHandlePointerMove(event, 'end')}
              onPointerUp={onHandlePointerEnd}
              onPointerCancel={onHandlePointerEnd}
              onKeyDown={(event) => onHandleKeyDown(event, 'end')}
              onBlur={onHandleBlur}
              className="absolute top-1/2 z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--clip-handle-border)] bg-[color:var(--clip-handle)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] hover:bg-[color:var(--clip-handle-hover)]"
              style={{ left: `${endPercent}%` }}
            >
              <span className="sr-only">Drag to adjust end</span>
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            <button
              type="button"
              onClick={onSnapToOriginal}
              disabled={!clip}
              className="flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-inherit transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] enabled:hover:border-white/10 enabled:hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)] enabled:hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="h-2 w-6 rounded-full bg-[color:var(--clip-original)]" aria-hidden="true" />
              Original range
            </button>
            {shouldShowRenderedOverlay ? (
              <button
                type="button"
                onClick={onSnapToRendered}
                disabled={!clip}
                className="flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-inherit transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] enabled:hover:border-white/10 enabled:hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)] enabled:hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="h-2 w-6 rounded-full bg-[color:var(--clip-rendered)]" aria-hidden="true" />
                Rendered output
              </button>
            ) : null}
            <span className="flex items-center gap-2">
              <span className="h-2 w-6 rounded-full bg-[color:var(--clip-current)]" aria-hidden="true" />
              Current window
            </span>
          </div>
          <div className="flex justify-between text-xs text-[var(--muted)]">
            <span>{formatDuration(windowStart)}</span>
            <span>{formatDuration(windowEnd)}</span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            Start offset (s)
            <input
              type="text"
              inputMode="decimal"
              pattern="[-+]?\\d*\\.?\\d*"
              value={formattedStartOffset}
              onChange={(event) => onRangeInputChange(event, 'start')}
              onKeyDown={onRangeInputKeyDown}
              onBlur={onRangeInputBlur}
              title={`Absolute start ${formatDuration(rangeStart)}`}
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <span className="text-[10px] font-normal uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
              Relative to the {offsetReference.startLabel}
            </span>
            <span className="text-[10px] font-normal text-[color:color-mix(in_srgb,var(--muted)_60%,transparent)]">
              {offsetReference.startTitle} {formatDuration(offsetReference.startBase)} → Current {formatDuration(rangeStart)}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            End offset (s)
            <input
              type="text"
              inputMode="decimal"
              pattern="[-+]?\\d*\\.?\\d*"
              value={formattedEndOffset}
              onChange={(event) => onRangeInputChange(event, 'end')}
              onKeyDown={onRangeInputKeyDown}
              onBlur={onRangeInputBlur}
              title={`Absolute end ${formatDuration(rangeEnd)}`}
              className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <span className="text-[10px] font-normal uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
              Relative to the {offsetReference.endLabel}
            </span>
            <span className="text-[10px] font-normal text-[color:color-mix(in_srgb,var(--muted)_60%,transparent)]">
              {offsetReference.endTitle} {formatDuration(offsetReference.endBase)} → Current {formatDuration(rangeEnd)}
            </span>
          </label>
        </div>
        <div className="flex flex-col gap-2 text-sm text-[var(--muted)]">
          <div className="flex items-center justify-between">
            <span>Adjusted duration</span>
            <span className="font-semibold text-[var(--fg)]">{formatDuration(durationSeconds)}</span>
          </div>
          {!durationWithinLimits ? (
            <div className="flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] px-3 py-2 text-xs text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]">
              <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--error-strong)]" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold uppercase tracking-wide">Outside clip limits</p>
                <p>
                  Clips must stay between {minClipDurationSeconds.toFixed(0)}s and {maxClipDurationSeconds.toFixed(0)}s. Adjust the boundaries to bring this clip back in range. Current duration: {formatDuration(durationSeconds)}.
                </p>
              </div>
            </div>
          ) : null}
          {durationWithinLimits && !durationWithinSweetSpot ? (
            <div className="flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge))] bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning-contrast)]">
              <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--warning-strong)]" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold uppercase tracking-wide">Outside sweet spot</p>
                <p>
                  The recommended sweet spot is {sweetSpotMinSeconds.toFixed(0)}–{sweetSpotMaxSeconds.toFixed(0)} seconds. Tweaking the boundaries can help this clip land inside the preferred window. Current duration: {formatDuration(durationSeconds)}.
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            <label className="flex items-center gap-2">
              Expand window (seconds)
              <input
                type="number"
                min={0}
                step={0.5}
                value={expandAmount}
                onChange={onExpandAmountChange}
                className="w-20 rounded-lg border border-white/10 bg-[var(--card)] px-2 py-1 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onExpandLeft}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                Expand left
              </button>
              <button
                type="button"
                onClick={onExpandRight}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                Expand right
              </button>
            </div>
          </div>
          <p className="text-xs">
            Expanding the window lets you pull the clip start earlier or extend the ending without moving the saved boundaries.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || isLoadingClip}
          className="inline-flex items-center justify-center rounded-[14px] border border-transparent bg-[color:var(--ring)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)] shadow-[0_18px_36px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--ring-strong)_75%,var(--ring))] hover:shadow-[0_24px_48px_rgba(15,23,42,0.36)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Save adjustments'}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center rounded-[14px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--fg)] shadow-[0_12px_24px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 hover:border-[var(--ring)] hover:bg-[color:color-mix(in_srgb,var(--panel-strong)_72%,transparent)] hover:text-[color:var(--accent)] hover:shadow-[0_18px_36px_rgba(15,23,42,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
        >
          Reset to original
        </button>
      </div>
      {shouldShowSaveSteps ? (
        <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-4 text-sm text-[var(--muted)]">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Rebuilding assets</h2>
          <ol className="mt-3 space-y-3">
            {saveSteps.map((step) => {
              const isCompleted = step.status === 'completed'
              const isRunning = step.status === 'running'
              const isFailed = step.status === 'failed'
              const indicatorClasses = isCompleted
                ? 'border-[color:color-mix(in_srgb,var(--success-strong)_45%,var(--edge))] bg-[color:var(--success-soft)] text-[color:color-mix(in_srgb,var(--success-strong)_85%,var(--accent-contrast))]'
                : isFailed
                  ? 'border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]'
                  : isRunning
                    ? 'border-[var(--ring)] text-[var(--ring)]'
                    : 'border-white/15 text-[var(--muted)]'
              return (
                <li key={step.id} className="flex items-start gap-3">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${indicatorClasses}`}
                    aria-hidden
                  >
                    {isRunning ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : isCompleted ? (
                      '✓'
                    ) : isFailed ? (
                      '!'
                    ) : (
                      '•'
                    )}
                  </span>
                  <div>
                    <p className="font-medium text-[var(--fg)]">{step.label}</p>
                    <p className="text-xs">{step.description}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}
      {saveError ? (
        <p className="text-sm text-[color:color-mix(in_srgb,var(--error-strong)_82%,var(--accent-contrast))]">{saveError}</p>
      ) : null}
      {saveSuccess ? (
        <p className="text-sm text-[color:color-mix(in_srgb,var(--success-strong)_82%,var(--accent-contrast))]">{saveSuccess}</p>
      ) : null}
    </>
  )
}

export default TrimModeView
