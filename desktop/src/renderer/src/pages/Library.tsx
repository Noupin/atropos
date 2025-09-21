import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ChangeEvent, FC } from 'react'
import { Link } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import ClipDescription from '../components/ClipDescription'
import { listAccountClips } from '../services/clipLibrary'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
import type { AccountSummary, Clip, SearchBridge } from '../types'

const ALL_ACCOUNTS_VALUE = 'all'

const isAccountAvailable = (account: AccountSummary): boolean =>
  account.active && account.platforms.some((platform) => platform.active)

type LibraryProps = {
  registerSearch: (bridge: SearchBridge | null) => void
  accounts: AccountSummary[]
  selectedAccountId: string | null
  onSelectAccount: (accountId: string | null) => void
  isLoadingAccounts: boolean
}

const Library: FC<LibraryProps> = ({
  registerSearch,
  accounts,
  selectedAccountId,
  onSelectAccount,
  isLoadingAccounts
}) => {
  const [clips, setClips] = useState<Clip[]>([])
  const [isLoadingClips, setIsLoadingClips] = useState(false)
  const [clipsError, setClipsError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const queryRef = useRef('')
  const loadRequestRef = useRef(0)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)

  const availableAccounts = useMemo(
    () => accounts.filter((account) => isAccountAvailable(account)),
    [accounts]
  )
  const hasMultipleAccounts = availableAccounts.length > 1
  const hasAccounts = availableAccounts.length > 0

  useEffect(() => {
    if (!hasAccounts) {
      if (clips.length > 0) {
        setClips([])
      }
      return
    }

    if (selectedAccountId) {
      const exists = availableAccounts.some((account) => account.id === selectedAccountId)
      if (!exists) {
        onSelectAccount(hasMultipleAccounts ? null : availableAccounts[0].id)
      }
      return
    }

    if (!hasMultipleAccounts && availableAccounts[0]) {
      onSelectAccount(availableAccounts[0].id)
    }
  }, [
    availableAccounts,
    hasAccounts,
    hasMultipleAccounts,
    onSelectAccount,
    selectedAccountId,
    clips.length
  ])

  const handleQueryChange = useCallback((value: string) => {
    queryRef.current = value
    setQuery(value)
  }, [])

  const handleQueryClear = useCallback(() => {
    queryRef.current = ''
    setQuery('')
  }, [])

  useEffect(() => {
    const bridge: SearchBridge = {
      getQuery: () => queryRef.current,
      onQueryChange: handleQueryChange,
      clear: handleQueryClear
    }

    registerSearch(bridge)
    return () => registerSearch(null)
  }, [handleQueryChange, handleQueryClear, registerSearch])

  const targetAccountIds = useMemo(() => {
    if (!hasAccounts) {
      return []
    }

    if (selectedAccountId) {
      return [selectedAccountId]
    }

    if (hasMultipleAccounts) {
      return availableAccounts.map((account) => account.id)
    }

    return availableAccounts[0] ? [availableAccounts[0].id] : []
  }, [availableAccounts, hasAccounts, hasMultipleAccounts, selectedAccountId])

  const loadClipsForAccounts = useCallback(
    async (accountIds: string[]) => {
      if (accountIds.length === 0) {
        setClips([])
        setClipsError(null)
        setIsLoadingClips(false)
        return
      }

      const requestId = loadRequestRef.current + 1
      loadRequestRef.current = requestId

      setIsLoadingClips(true)
      setClipsError(null)

      try {
        const results = await Promise.all(
          accountIds.map(async (accountId) => {
            try {
              return await listAccountClips(accountId)
            } catch (error) {
              console.error('Failed to load clips for account', accountId, error)
              return [] as Clip[]
            }
          })
        )

        if (loadRequestRef.current !== requestId) {
          return
        }

        const merged = new Map<string, Clip>()
        for (const accountClips of results) {
          for (const clip of accountClips) {
            merged.set(clip.id, clip)
          }
        }

        const mergedClips = Array.from(merged.values())
        mergedClips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        setClips(mergedClips)
      } catch (error) {
        if (loadRequestRef.current !== requestId) {
          return
        }
        console.error('Failed to load clips for library view', error)
        setClips([])
        setClipsError('Unable to load clips. Please try again.')
      } finally {
        if (loadRequestRef.current === requestId) {
          setIsLoadingClips(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void loadClipsForAccounts(targetAccountIds)
  }, [loadClipsForAccounts, targetAccountIds])

  const filteredClips = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) {
      return clips
    }

    return clips.filter((clip) => {
      const haystack = [
        clip.title,
        clip.channel,
        clip.description,
        clip.quote ?? undefined,
        clip.reason ?? undefined
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase()

      return haystack.includes(trimmed)
    })
  }, [clips, query])

  const groupedClips = useMemo(() => {
    const groups = new Map<
      string,
      { title: string; clips: Clip[]; latestCreatedAt: string }
    >()

    for (const clip of filteredClips) {
      const key = clip.videoId ?? clip.id
      const title = clip.videoTitle || clip.sourceTitle || clip.title
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, { title, clips: [clip], latestCreatedAt: clip.createdAt })
      } else {
        existing.clips.push(clip)
        if (clip.createdAt > existing.latestCreatedAt) {
          existing.latestCreatedAt = clip.createdAt
        }
      }
    }

    return Array.from(groups.entries())
      .map(([id, value]) => ({
        id,
        title: value.title,
        clips: value.clips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        latestCreatedAt: value.latestCreatedAt
      }))
      .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1))
  }, [filteredClips])

  useEffect(() => {
    if (filteredClips.length === 0) {
      if (selectedClipId !== null) {
        setSelectedClipId(null)
      }
      return
    }

    if (!selectedClipId || !filteredClips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(filteredClips[0].id)
    }
  }, [filteredClips, selectedClipId])

  const selectedClip = useMemo(
    () => filteredClips.find((clip) => clip.id === selectedClipId) ?? null,
    [filteredClips, selectedClipId]
  )

  const selectedClipAccount = useMemo(
    () =>
      selectedClip && selectedClip.accountId
        ? accounts.find((account) => account.id === selectedClip.accountId) ?? null
        : null,
    [accounts, selectedClip]
  )

  const handleAccountChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const { value } = event.target
      if (value === ALL_ACCOUNTS_VALUE) {
        onSelectAccount(null)
      } else {
        onSelectAccount(value)
      }
    },
    [onSelectAccount]
  )

  const handleClipSelect = useCallback((clipId: string) => {
    setSelectedClipId(clipId)
  }, [])

  const dropdownValue = useMemo(() => {
    if (!hasAccounts) {
      return ''
    }
    if (selectedAccountId) {
      return selectedAccountId
    }
    return hasMultipleAccounts ? ALL_ACCOUNTS_VALUE : availableAccounts[0]?.id ?? ''
  }, [availableAccounts, hasAccounts, hasMultipleAccounts, selectedAccountId])

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[var(--fg)]">Clip library</h2>
                <p className="text-sm text-[var(--muted)]">
                  Browse generated clips by account or review everything at once.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:max-w-xs">
                <label htmlFor="library-account" className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                  Account
                </label>
                <select
                  id="library-account"
                  value={dropdownValue}
                  onChange={handleAccountChange}
                  disabled={!hasAccounts || isLoadingAccounts}
                  className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-4 py-2 text-sm text-[var(--fg)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {!hasAccounts ? (
                    <option value="">No available accounts</option>
                  ) : null}
                  {hasMultipleAccounts ? (
                    <option value={ALL_ACCOUNTS_VALUE}>All accounts</option>
                  ) : null}
                  {availableAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {clipsError ? (
              <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {clipsError}
              </div>
            ) : null}
            {!hasAccounts && !isLoadingAccounts ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-[var(--muted)]">
                Connect an account with an active platform from your profile to start collecting clips.
              </div>
            ) : null}
            {hasAccounts ? (
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>
                  Showing {filteredClips.length} {filteredClips.length === 1 ? 'clip' : 'clips'}
                  {selectedAccountId ? ' for the selected account.' : hasMultipleAccounts ? ' from all accounts.' : '.'}
                </span>
                {isLoadingClips ? <span className="text-[var(--fg)]">Loading clips…</span> : null}
              </div>
            ) : null}
          </div>

          {hasAccounts ? (
            filteredClips.length > 0 ? (
              <div className="flex flex-col gap-6">
                {groupedClips.map((group) => (
                  <div key={group.id} className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-lg font-semibold text-[var(--fg)]">{group.title}</h3>
                      <span className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                        {group.clips.length} {group.clips.length === 1 ? 'clip' : 'clips'}
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {group.clips.map((clip) => (
                        <ClipCard
                          key={clip.id}
                          clip={clip}
                          onClick={() => handleClipSelect(clip.id)}
                          isActive={clip.id === selectedClipId}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-10 text-center text-sm text-[var(--muted)]">
                {isLoadingClips
                  ? 'Loading your clips…'
                  : 'No clips match the current filters. Try selecting a different account or clearing your search.'}
              </div>
            )
          ) : null}
        </div>

        <aside className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-[var(--fg)]">Clip preview</h2>
              <p className="text-sm text-[var(--muted)]">
                {selectedClip
                  ? 'Inspect the selected highlight and copy its publishing metadata.'
                  : 'Choose a clip from the library to preview it here.'}
              </p>
            </div>
            {selectedClip ? (
              <div className="flex flex-col gap-4">
                <div className="flex w-full justify-center overflow-hidden rounded-xl bg-black/80 p-2">
                  <video
                    key={selectedClip.id}
                    src={selectedClip.playbackUrl}
                    poster={selectedClip.thumbnail ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full max-w-sm object-contain"
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
                <div className="space-y-5 text-sm text-[var(--muted)]">
                  <div className="space-y-3">
                    {selectedClip.quote ? (
                      <p className="text-lg font-semibold text-[var(--fg)] leading-tight">
                        “{selectedClip.quote}”
                      </p>
                    ) : selectedClip.title ? (
                      <p className="text-lg font-semibold text-[var(--fg)] leading-tight">
                        {selectedClip.title}
                      </p>
                    ) : null}
                    {selectedClip.reason ? (
                      <div className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                          Reason
                        </span>
                        <p className="rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-3 text-sm leading-relaxed text-[var(--fg)]/80">
                          {selectedClip.reason}
                        </p>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-semibold text-[var(--fg)] text-sm">{selectedClip.channel}</span>
                      {selectedClipAccount ? (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-[var(--muted)]">
                          {selectedClipAccount.displayName}
                        </span>
                      ) : null}
                      {selectedClip.views !== null ? <span>{formatViews(selectedClip.views)} views</span> : null}
                      <span>Duration {formatDuration(selectedClip.durationSec)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span>Generated {timeAgo(selectedClip.createdAt)}</span>
                      {selectedClip.sourcePublishedAt ? (
                        <span>Source uploaded {timeAgo(selectedClip.sourcePublishedAt)}</span>
                      ) : null}
                    </div>
                  </div>
                  <dl className="grid gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm text-[var(--muted)] sm:grid-cols-[auto_1fr]">
                    {selectedClip.rating !== null && selectedClip.rating !== undefined ? (
                      <>
                        <dt className="font-medium text-[var(--fg)]">Score</dt>
                        <dd className="text-[var(--fg)]">
                          {selectedClip.rating.toFixed(1).replace(/\.0$/, '')}
                        </dd>
                      </>
                    ) : null}
                    <dt className="font-medium text-[var(--fg)]">Clip created</dt>
                    <dd>{new Date(selectedClip.createdAt).toLocaleString()}</dd>
                    <dt className="font-medium text-[var(--fg)]">Source uploaded</dt>
                    <dd>{selectedClip.sourcePublishedAt ? new Date(selectedClip.sourcePublishedAt).toLocaleString() : 'Unknown'}</dd>
                    {selectedClipAccount ? (
                      <>
                        <dt className="font-medium text-[var(--fg)]">Account</dt>
                        <dd>{selectedClipAccount.displayName}</dd>
                      </>
                    ) : null}
                    {selectedClip.timestampSeconds !== null && selectedClip.timestampSeconds !== undefined ? (
                      <>
                        <dt className="font-medium text-[var(--fg)]">Starts at</dt>
                        <dd>{formatDuration(selectedClip.timestampSeconds)}</dd>
                      </>
                    ) : null}
                  </dl>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      to={`/clip/${selectedClip.id}`}
                      state={{ clip: selectedClip }}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white"
                    >
                      Open details
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M13.5 2h-5a.75.75 0 0 0 0 1.5H11l-6.72 6.72a.75.75 0 0 0 1.06 1.06L12 4.56v2.5a.75.75 0 0 0 1.5 0v-5A.75.75 0 0 0 13.5 2"
                        />
                      </svg>
                    </Link>
                    <a
                      href={selectedClip.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white"
                    >
                      View full video
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M13.5 2h-5a.75.75 0 0 0 0 1.5H11l-6.72 6.72a.75.75 0 0 0 1.06 1.06L12 4.56v2.5a.75.75 0 0 0 1.5 0v-5A.75.75 0 0 0 13.5 2"
                        />
                      </svg>
                    </a>
                    {selectedClip.timestampUrl ? (
                      <a
                        href={selectedClip.timestampUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white"
                      >
                        Jump to
                        <span className="font-semibold text-white">
                          {selectedClip.timestampSeconds !== null && selectedClip.timestampSeconds !== undefined
                            ? formatDuration(selectedClip.timestampSeconds)
                            : 'timestamp'}
                        </span>
                      </a>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-[var(--fg)]">Description</h4>
                    <ClipDescription
                      text={selectedClip.description}
                      className="text-sm leading-relaxed text-[var(--muted)]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-8 text-center text-sm text-[var(--muted)]">
                Select a clip from the library to see its preview and publishing metadata.
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

export default Library
