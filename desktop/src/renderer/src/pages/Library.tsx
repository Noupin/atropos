import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ChangeEvent, FC } from 'react'
import { useNavigate } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import { listAccountClips } from '../services/clipLibrary'
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
  const navigate = useNavigate()

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

  const handleClipOpen = useCallback(
    (clip: Clip) => {
      navigate(`/clip/${clip.id}`, { state: { clip } })
    },
    [navigate]
  )

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
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
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
                    <ClipCard key={clip.id} clip={clip} onClick={() => handleClipOpen(clip)} />
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
    </section>
  )
}

export default Library
