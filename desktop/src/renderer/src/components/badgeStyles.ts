const baseClassName =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold leading-none shadow-[0_6px_14px_rgba(43,42,40,0.16)]'

type BadgeVariant =
  | 'accent'
  | 'error'
  | 'info'
  | 'neutral'
  | 'success'
  | 'warning'

const variantClassNames: Record<BadgeVariant, string> = {
  success:
    'border-[color:color-mix(in_srgb,var(--success-strong)_65%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--success-soft)_82%,transparent)] text-[color:color-mix(in_srgb,var(--success-strong)_92%,var(--accent-contrast))]',
  accent:
    'border-[color:color-mix(in_srgb,var(--accent)_65%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--accent)_80%,transparent)] text-[color:color-mix(in_srgb,var(--accent)_90%,var(--accent-contrast))]',
  error:
    'border-[color:color-mix(in_srgb,var(--error-strong)_65%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--error-soft)_82%,transparent)] text-[color:color-mix(in_srgb,var(--error-strong)_92%,var(--accent-contrast))]',
  neutral:
    'border-[color:color-mix(in_srgb,var(--edge-soft)_90%,transparent)] bg-[color:color-mix(in_srgb,var(--panel)_80%,transparent)] text-[color:color-mix(in_srgb,var(--muted)_88%,var(--fg))]',
  warning:
    'border-[color:color-mix(in_srgb,var(--warning-strong)_60%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--warning-soft)_80%,transparent)] text-[color:color-mix(in_srgb,var(--warning-strong)_92%,var(--accent-contrast))]',
  info:
    'border-[color:color-mix(in_srgb,var(--info)_60%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--info-soft)_82%,transparent)] text-[color:color-mix(in_srgb,var(--info)_92%,var(--accent-contrast))]'
}

export const getBadgeClassName = (variant: BadgeVariant, extraClassName?: string): string =>
  [baseClassName, variantClassNames[variant], extraClassName].filter(Boolean).join(' ')

export type { BadgeVariant }
