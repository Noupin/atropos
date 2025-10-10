export type BadgeVariant = 'neutral' | 'accent' | 'info' | 'success' | 'error'

export const badgeBaseClassName =
  'inline-flex items-center justify-center gap-1 truncate whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] shadow-[0_10px_18px_rgba(43,42,40,0.18)]'

export const badgeVariantClassNames: Record<BadgeVariant, string> = {
  neutral:
    'border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_82%,transparent)] text-[color:var(--muted)]',
  accent:
    'border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--accent)_80%,transparent)] text-[color:var(--accent-contrast)]',
  info:
    'border-[color:color-mix(in_srgb,var(--info-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--info-soft)_78%,transparent)] text-[color:color-mix(in_srgb,var(--info-strong)_88%,var(--accent-contrast))]',
  success:
    'border-[color:color-mix(in_srgb,var(--success-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--success-soft)_80%,transparent)] text-[color:color-mix(in_srgb,var(--success-strong)_90%,var(--accent-contrast))]',
  error:
    'border-[color:color-mix(in_srgb,var(--error-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--error-soft)_78%,transparent)] text-[color:color-mix(in_srgb,var(--error-strong)_90%,var(--accent-contrast))]'
}

export const getBadgeClassName = (variant: BadgeVariant = 'neutral', extraClassName?: string): string =>
  `${badgeBaseClassName} ${badgeVariantClassNames[variant]}${extraClassName ? ` ${extraClassName}` : ''}`
