import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import { PROFILE_ACCOUNTS } from '../mock/accounts'
import type { AccountProfile, AccountStatus, SearchBridge } from '../types'
import { formatDuration } from '../lib/format'

const STATUS_STYLES: Record<
  AccountStatus,
  { avatar: string; badge: string; label: string; helper: string }
> = {
  active: {
    avatar: 'border-emerald-400 bg-emerald-400/10 text-emerald-200',
    badge: 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
    label: 'Authenticated',
    helper: 'Connection is healthy and ready to publish.'
  },
  expiring: {
    avatar: 'border-amber-400 bg-amber-400/10 text-amber-200',
    badge: 'border border-amber-400/40 bg-amber-400/10 text-amber-200',
    label: 'Expiring soon',
    helper: 'Refresh authentication soon to avoid interruptions.'
  },
  disconnected: {
    avatar: 'border-rose-500 bg-rose-500/10 text-rose-200',
    badge: 'border border-rose-500/40 bg-rose-500/10 text-rose-200',
    label: 'Not connected',
    helper: 'Reconnect this account to resume scheduling uploads.'
  }
}

const formatScheduleTime = (isoDate: string): string =>
  new Date(isoDate).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

const computeCoverage = (account: AccountProfile): { daysLabel: string; description: string } => {
  if (account.dailyUploadTarget <= 0) {
    return {
      daysLabel: '—',
      description: 'Set a daily upload schedule to estimate coverage.'
    }
  }

  const days = account.readyVideos / account.dailyUploadTarget
  return {
    daysLabel: `${days.toFixed(1)} days`,
    description: 'Estimated runway based on your current schedule.'
  }
}

type ProfileProps = {
  registerSearch: (bridge: SearchBridge | null) => void
}

const Profile: FC<ProfileProps> = ({ registerSearch }) => {
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    registerSearch(null)
    return () => registerSearch(null)
  }, [registerSearch])

  const summary = useMemo(() => {
    const totalReady = PROFILE_ACCOUNTS.reduce((sum, account) => sum + account.readyVideos, 0)
    const active = PROFILE_ACCOUNTS.filter((account) => account.status === 'active').length
    const attention = PROFILE_ACCOUNTS.filter((account) => account.status !== 'active').length
    return {
      totalReady,
      active,
      attention
    }
  }, [])

  const toggleAccount = useCallback((accountId: string) => {
    setCollapsedAccounts((current) => {
      const next = new Set(current)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
      }
      return next
    })
  }, [])

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-[var(--fg)]">Profile</h1>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          Manage the accounts connected to Atropos and review your upcoming content pipeline. You currently
          have {PROFILE_ACCOUNTS.length} authenticated account{PROFILE_ACCOUNTS.length === 1 ? '' : 's'} with
          {' '}
          {summary.totalReady.toLocaleString()} ready video{summary.totalReady === 1 ? '' : 's'}.
        </p>
        <p className="text-sm text-[var(--muted)]">
          Active connections: {summary.active}/{PROFILE_ACCOUNTS.length}.{' '}
          {summary.attention > 0
            ? `${summary.attention} account${summary.attention === 1 ? ' needs' : 's need'} your attention.`
            : 'All accounts are healthy.'}
        </p>
      </header>
      <div className="flex flex-col gap-6">
        {PROFILE_ACCOUNTS.map((account) => {
          const status = STATUS_STYLES[account.status]
          const isCollapsed = collapsedAccounts.has(account.id)
          const coverage = computeCoverage(account)
          const detailsId = `profile-${account.id}`

          return (
            <article
              key={account.id}
              data-testid={`account-panel-${account.id}`}
              className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_85%,transparent)] p-6 shadow-sm"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex flex-1 items-start gap-4">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-full border-2 font-semibold ${status.avatar}`}
                    aria-hidden="true"
                  >
                    {account.initials}
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-[var(--fg)]">{account.displayName}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.badge}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[var(--muted)]">{account.platform}</p>
                    {account.statusMessage ? (
                      <p className="text-xs text-[var(--muted)]">{account.statusMessage}</p>
                    ) : null}
                    <p className="text-xs text-[var(--muted)]">{status.helper}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAccount(account.id)}
                  className="self-start rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  aria-expanded={!isCollapsed}
                  aria-controls={detailsId}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${account.displayName} details`}
                >
                  {isCollapsed ? 'Expand' : 'Collapse'}
                </button>
              </div>
              <div
                id={detailsId}
                hidden={isCollapsed}
                className="mt-6 flex flex-col gap-6"
                aria-hidden={isCollapsed}
              >
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Ready videos
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold text-[var(--fg)]">
                      {account.readyVideos.toLocaleString()}
                    </dd>
                    <p className="mt-1 text-xs text-[var(--muted)]">Ready to publish immediately.</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Daily target
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold text-[var(--fg)]">
                      {account.dailyUploadTarget.toLocaleString()} per day
                    </dd>
                    <p className="mt-1 text-xs text-[var(--muted)]">Scheduled uploads for this channel.</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Coverage
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold text-[var(--fg)]">{coverage.daysLabel}</dd>
                    <p className="mt-1 text-xs text-[var(--muted)]">{coverage.description}</p>
                  </div>
                </dl>
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-[var(--fg)]">Next uploads</h3>
                  {account.upcomingUploads.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {account.upcomingUploads.map((upload) => (
                        <article
                          key={upload.id}
                          className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_92%,transparent)] p-3"
                        >
                          <div className="aspect-video overflow-hidden rounded-lg border border-white/10 bg-black/60">
                            <video
                              data-testid="profile-upload-video"
                              controls
                              preload="metadata"
                              className="h-full w-full object-cover"
                            >
                              <source src={upload.videoUrl} type="video/mp4" />
                              Your browser does not support the video tag.
                            </video>
                          </div>
                          <div className="flex flex-col gap-1">
                            <h4 className="text-sm font-medium text-[var(--fg)]">{upload.title}</h4>
                            <p className="text-xs text-[var(--muted)]">Scheduled {formatScheduleTime(upload.scheduledFor)}</p>
                            <p className="text-xs text-[var(--muted)]">Duration {formatDuration(upload.durationSec)}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--muted)]">No upcoming uploads are scheduled for this account.</p>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default Profile
