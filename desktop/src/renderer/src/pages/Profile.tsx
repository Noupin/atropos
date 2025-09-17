import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import { PROFILE_ACCOUNTS } from '../mock/accounts'
import type { AccountPlatform, AccountStatus, SearchBridge } from '../types'
import { formatDuration } from '../lib/format'

const STATUS_STYLES: Record<
  AccountStatus,
  { avatar: string; badge: string; label: string; helper: string; dot: string }
> = {
  active: {
    avatar: 'border-emerald-400 bg-emerald-400/10 text-emerald-200',
    badge: 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
    label: 'Authenticated',
    helper: 'Connection is healthy and ready to publish.',
    dot: 'bg-emerald-400'
  },
  expiring: {
    avatar: 'border-amber-400 bg-amber-400/10 text-amber-200',
    badge: 'border border-amber-400/40 bg-amber-400/10 text-amber-200',
    label: 'Expiring soon',
    helper: 'Refresh authentication soon to avoid interruptions.',
    dot: 'bg-amber-400'
  },
  disconnected: {
    avatar: 'border-rose-500 bg-rose-500/10 text-rose-200',
    badge: 'border border-rose-500/40 bg-rose-500/10 text-rose-200',
    label: 'Not connected',
    helper: 'Reconnect this account to resume scheduling uploads.',
    dot: 'bg-rose-500'
  }
}

const formatScheduleTime = (isoDate: string): string =>
  new Date(isoDate).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

const computeCoverage = (
  readyVideos: number,
  dailyUploadTarget: number,
  descriptions: { scheduled: string; none: string } = {
    scheduled: 'Estimated runway based on your current schedule.',
    none: 'Set a daily upload schedule to estimate coverage.'
  }
): { daysLabel: string; description: string } => {
  if (dailyUploadTarget <= 0) {
    return {
      daysLabel: '—',
      description: descriptions.none
    }
  }

  const days = readyVideos / dailyUploadTarget
  return {
    daysLabel: `${days.toFixed(1)} days`,
    description: descriptions.scheduled
  }
}

const aggregateStatus = (platforms: AccountPlatform[]): AccountStatus => {
  if (platforms.some((platform) => platform.status === 'disconnected')) {
    return 'disconnected'
  }
  if (platforms.some((platform) => platform.status === 'expiring')) {
    return 'expiring'
  }
  if (platforms.length === 0) {
    return 'disconnected'
  }
  return 'active'
}

const getAccountTotals = (platforms: AccountPlatform[]): {
  readyVideos: number
  dailyUploadTarget: number
} =>
  platforms.reduce(
    (totals, platform) => ({
      readyVideos: totals.readyVideos + platform.readyVideos,
      dailyUploadTarget: totals.dailyUploadTarget + platform.dailyUploadTarget
    }),
    { readyVideos: 0, dailyUploadTarget: 0 }
  )

type ProfileProps = {
  registerSearch: (bridge: SearchBridge | null) => void
}

const Profile: FC<ProfileProps> = ({ registerSearch }) => {
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(
    () => new Set(PROFILE_ACCOUNTS.map((account) => account.id))
  )
  const [collapsedUpcoming, setCollapsedUpcoming] = useState<Set<string>>(
    () => new Set(PROFILE_ACCOUNTS.map((account) => account.id))
  )
  const [activePlatforms, setActivePlatforms] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    PROFILE_ACCOUNTS.forEach((account) => {
      if (account.platforms[0]) {
        initial[account.id] = account.platforms[0].id
      }
    })
    return initial
  })

  useEffect(() => {
    registerSearch(null)
    return () => registerSearch(null)
  }, [registerSearch])

  const summary = useMemo(() => {
    let totalReady = 0
    let platformCount = 0
    let active = 0
    let attention = 0

    PROFILE_ACCOUNTS.forEach((account) => {
      account.platforms.forEach((platform) => {
        platformCount += 1
        totalReady += platform.readyVideos
        if (platform.status === 'active') {
          active += 1
        } else {
          attention += 1
        }
      })
    })

    return {
      totalReady,
      platformCount,
      accountCount: PROFILE_ACCOUNTS.length,
      active,
      attention
    }
  }, [])

  const toggleAccount = useCallback((accountId: string) => {
    let shouldCollapseUpcoming = false

    setCollapsedAccounts((current) => {
      const next = new Set(current)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
        shouldCollapseUpcoming = true
      }
      return next
    })

    if (shouldCollapseUpcoming) {
      setCollapsedUpcoming((current) => {
        if (current.has(accountId)) {
          return current
        }
        const next = new Set(current)
        next.add(accountId)
        return next
      })
    }
  }, [])

  const toggleUpcoming = useCallback((accountId: string) => {
    setCollapsedUpcoming((current) => {
      const next = new Set(current)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
      }
      return next
    })
  }, [])

  const selectPlatform = useCallback((accountId: string, platformId: string) => {
    setActivePlatforms((current) => {
      if (current[accountId] === platformId) {
        return current
      }
      return { ...current, [accountId]: platformId }
    })
  }, [])

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-[var(--fg)]">Profile</h1>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          Manage the accounts connected to Atropos and review your upcoming content pipeline. You
          currently have {summary.accountCount} account{summary.accountCount === 1 ? '' : 's'} with{' '}
          {summary.platformCount} platform connection{summary.platformCount === 1 ? '' : 's'} and{' '}
          {summary.totalReady.toLocaleString()} ready video{summary.totalReady === 1 ? '' : 's'}.
        </p>
        <p className="text-sm text-[var(--muted)]">
          {summary.platformCount > 0 ? (
            <>
              Active connections: {summary.active}/{summary.platformCount}.{' '}
              {summary.attention > 0
                ? `${summary.attention} connection${summary.attention === 1 ? ' needs' : 's need'} your attention.`
                : 'All connections are healthy.'}
            </>
          ) : (
            'No platform connections yet. Add a platform to start scheduling.'
          )}
        </p>
      </header>
      <div className="flex flex-col gap-6">
        {PROFILE_ACCOUNTS.map((account) => {
          const isCollapsed = collapsedAccounts.has(account.id)
          const totals = getAccountTotals(account.platforms)
          const coverage = computeCoverage(totals.readyVideos, totals.dailyUploadTarget, {
            scheduled: 'Combined coverage across all connected platforms.',
            none: 'Set a daily upload schedule across your platforms to estimate coverage.'
          })
          const aggregatedStatus = aggregateStatus(account.platforms)
          const statusStyles = STATUS_STYLES[aggregatedStatus]
          const selectedPlatformId = activePlatforms[account.id] ?? account.platforms[0]?.id
          const selectedPlatform =
            account.platforms.find((platform) => platform.id === selectedPlatformId) ??
            account.platforms[0] ??
            null
          const detailsId = `profile-${account.id}`
          const upcomingSectionId = `${detailsId}-upcoming`
          const isUpcomingCollapsed = collapsedUpcoming.has(account.id)
          const hasPlatforms = account.platforms.length > 0
          const accountUpcomingUploads = account.platforms
            .flatMap((platform) => platform.upcomingUploads)
            .sort(
              (a, b) =>
                new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
            )
          const summaryStats = [
            {
              id: 'readyVideos',
              value: totals.readyVideos.toLocaleString(),
              label: 'ready videos'
            },
            {
              id: 'dailyTarget',
              value: totals.dailyUploadTarget.toLocaleString(),
              label: 'daily target'
            },
            {
              id: 'coverage',
              value: coverage.daysLabel,
              label: 'coverage',
              title: coverage.description
            }
          ] as const

          return (
            <article
              key={account.id}
              data-testid={`account-panel-${account.id}`}
              className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_85%,transparent)] p-6 shadow-sm"
            >
              <div
                className={`flex flex-col gap-4 md:flex-row md:justify-between ${
                  isCollapsed ? 'md:items-center' : 'md:items-start'
                }`}
              >
                <div className={`flex flex-1 gap-4 ${isCollapsed ? 'items-center' : 'items-start'}`}>
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-full border-2 font-semibold ${statusStyles.avatar}`}
                    aria-hidden="true"
                  >
                    {account.initials}
                  </div>
                  <div
                    className={`flex flex-1 flex-col gap-3 ${
                      isCollapsed ? 'md:flex-row md:items-center md:justify-between md:gap-8' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-2">
                      <h2 className="text-lg font-semibold text-[var(--fg)]">{account.displayName}</h2>
                      {hasPlatforms ? (
                        <ul
                          className="flex flex-wrap items-center gap-2 pl-0"
                          data-testid={`account-platform-tags-${account.id}`}
                          aria-label={`${account.displayName} connected platforms`}
                        >
                          {account.platforms.map((platform) => {
                            const platformStyles = STATUS_STYLES[platform.status]
                            return (
                              <li
                                key={platform.id}
                                className="list-none"
                                title={`${platform.name}: ${platformStyles.label}`}
                              >
                                <span
                                  className={`flex items-center gap-2 rounded-full px-2 py-0.5 text-xs font-medium ${platformStyles.badge}`}
                                >
                                  <span
                                    className={`h-2 w-2 rounded-full ${platformStyles.dot}`}
                                    aria-hidden="true"
                                  />
                                  {platform.name}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="text-xs text-[var(--muted)]">No platforms connected yet.</p>
                      )}
                    </div>
                    {isCollapsed ? (
                      <div
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]"
                        data-testid={`account-summary-${account.id}`}
                      >
                        {summaryStats.map((item) => (
                          <span key={item.id} title={item.title}>
                            <span className="text-lg font-semibold text-[var(--fg)]">{item.value}</span>{' '}
                            {item.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAccount(account.id)}
                  className={`self-start rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                    isCollapsed ? 'md:self-center' : ''
                  }`}
                  aria-expanded={!isCollapsed}
                  aria-controls={detailsId}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${account.displayName} details`}
                >
                  {isCollapsed ? 'Expand' : 'Collapse'}
                </button>
              </div>

              {isCollapsed ? null : (
                <dl className="mt-6 grid gap-4 sm:grid-cols-3" data-testid={`account-summary-${account.id}`}>
                  <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Ready videos
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold text-[var(--fg)]">
                      {totals.readyVideos.toLocaleString()}
                    </dd>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Ready to publish across all connected platforms.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Daily target
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold text-[var(--fg)]">
                      {totals.dailyUploadTarget.toLocaleString()} per day
                    </dd>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Combined scheduled uploads for this account.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_90%,transparent)] p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Coverage
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold text-[var(--fg)]">{coverage.daysLabel}</dd>
                    <p className="mt-1 text-xs text-[var(--muted)]">{coverage.description}</p>
                  </div>
                </dl>
              )}

              <div
                id={detailsId}
                hidden={isCollapsed}
                className="mt-6 flex flex-col gap-6"
                aria-hidden={isCollapsed}
              >
                {isCollapsed
                  ? null
                  : hasPlatforms ? (
                      <>
                        <div className="flex flex-col gap-3">
                          <button
                            type="button"
                            onClick={() => toggleUpcoming(account.id)}
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm font-semibold text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                            aria-expanded={!isUpcomingCollapsed}
                            aria-controls={upcomingSectionId}
                          >
                            <span>Next uploads</span>
                            <svg
                              viewBox="0 0 20 20"
                              className={`h-4 w-4 text-[var(--muted)] transition-transform ${
                                isUpcomingCollapsed ? '-rotate-90' : 'rotate-0'
                              }`}
                              aria-hidden="true"
                            >
                              <path
                                fill="currentColor"
                                d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06"
                              />
                            </svg>
                          </button>
                          <div
                            id={upcomingSectionId}
                            hidden={isUpcomingCollapsed}
                            aria-hidden={isUpcomingCollapsed}
                            className="flex flex-col gap-3"
                          >
                            {isUpcomingCollapsed
                              ? null
                              : accountUpcomingUploads.length > 0 ? (
                                  <div
                                    className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                                    data-testid={`account-upcoming-${account.id}`}
                                  >
                                    {accountUpcomingUploads.map((upload) => (
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
                                          <p className="text-xs text-[var(--muted)]">
                                            Scheduled {formatScheduleTime(upload.scheduledFor)}
                                          </p>
                                          <p className="text-xs text-[var(--muted)]">
                                            Duration {formatDuration(upload.durationSec)}
                                          </p>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-[var(--muted)]">
                                    No upcoming uploads are scheduled for this account.
                                  </p>
                                )}
                          </div>
                        </div>
                        <div
                          role="tablist"
                          aria-label={`${account.displayName} platform connections`}
                          className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_92%,transparent)] p-1"
                        >
                          {account.platforms.map((platform) => {
                            const isActive = selectedPlatform?.id === platform.id
                            const platformStatus = STATUS_STYLES[platform.status]
                            return (
                              <button
                                key={platform.id}
                                type="button"
                                role="tab"
                                id={`profile-tab-${platform.id}`}
                                aria-selected={isActive}
                                aria-controls={`profile-platform-${platform.id}`}
                                onClick={() => selectPlatform(account.id, platform.id)}
                                className={`flex min-w-[10rem] flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                                  isActive
                                    ? 'bg-[color:color-mix(in_srgb,var(--card)_98%,white_8%)] text-[var(--fg)] shadow-sm'
                                    : 'text-[var(--muted)] hover:bg-white/5 hover:text-[var(--fg)]'
                                }`}
                              >
                                <span className="font-medium">{platform.name}</span>
                                <span
                                  className={`flex items-center justify-center rounded-full p-1 ${platformStatus.badge}`}
                                  title={`${platform.name}: ${platformStatus.label}`}
                                  aria-label={`${platform.name} status ${platformStatus.label}`}
                                >
                                  <span
                                    className={`h-2.5 w-2.5 rounded-full ${platformStatus.dot}`}
                                    aria-hidden="true"
                                  />
                                </span>
                              </button>
                            )
                          })}
                        </div>
                        {selectedPlatform ? (
                          <div
                            role="tabpanel"
                            id={`profile-platform-${selectedPlatform.id}`}
                            aria-labelledby={`profile-tab-${selectedPlatform.id}`}
                            className="flex flex-col gap-6"
                          >
                            <div className="flex flex-col gap-4">
                              <div className="flex flex-col gap-2">
                                {selectedPlatform.status === 'disconnected' ? (
                                  <button
                                    type="button"
                                    className="w-fit rounded-lg border border-white/10 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                                  >
                                    Reconnect {selectedPlatform.name}
                                  </button>
                                ) : selectedPlatform.statusMessage ? (
                                  <p className="text-sm text-[var(--muted)]">
                                    {selectedPlatform.statusMessage}
                                  </p>
                                ) : null}
                                <p className="text-xs text-[var(--muted)]">
                                  {STATUS_STYLES[selectedPlatform.status].helper}
                                </p>
                              </div>
                              <div className="flex flex-col gap-3">
                                <h3 className="text-sm font-semibold text-[var(--fg)]">
                                  Missed videos
                                </h3>
                                {selectedPlatform.missedUploads.length > 0 ? (
                                  <div
                                    className="grid gap-3 sm:grid-cols-2"
                                    data-testid={`missed-uploads-${selectedPlatform.id}`}
                                  >
                                    {selectedPlatform.missedUploads.map((missed) => (
                                      <article
                                        key={missed.id}
                                        className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_94%,transparent)] p-3"
                                      >
                                        <div className="flex flex-col gap-1">
                                          <h4 className="text-sm font-medium text-[var(--fg)]">
                                            {missed.title}
                                          </h4>
                                          <p className="text-xs text-[var(--muted)]">
                                            Scheduled {formatScheduleTime(missed.scheduledFor)}
                                          </p>
                                          <p className="text-xs text-[var(--muted)]">
                                            Duration {formatDuration(missed.durationSec)}
                                          </p>
                                          <p className="text-xs text-rose-200">
                                            {missed.failureReason}
                                          </p>
                                        </div>
                                        {missed.canRetry ? (
                                          <button
                                            type="button"
                                            className="w-fit rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                                          >
                                            Retry upload
                                          </button>
                                        ) : (
                                          <span className="text-xs text-[var(--muted)]">
                                            Retry unavailable for this video.
                                          </span>
                                        )}
                                      </article>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-[var(--muted)]">
                                    No missed videos for this platform.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-[var(--muted)]">
                            Select a platform to view its scheduling details.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        Connect a platform to manage scheduling for this account.
                      </p>
                    )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default Profile
