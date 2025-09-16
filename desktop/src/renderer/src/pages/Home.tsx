import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import { CLIPS } from '../mock/clips'
import type { SearchBridge } from '../types'

const PAGE_SIZE = 12

type HomeProps = {
  registerSearch: (bridge: SearchBridge | null) => void
}

const Home: FC<HomeProps> = ({ registerSearch }) => {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value)
      setPage(0)
    },
    [setPage]
  )

  const bridge = useMemo<SearchBridge>(
    () => ({
      getQuery: () => query,
      onQueryChange: handleQueryChange,
      clear: () => handleQueryChange('')
    }),
    [handleQueryChange, query]
  )

  useEffect(() => {
    registerSearch(bridge)
    return () => registerSearch(null)
  }, [bridge, registerSearch])

  useEffect(() => {
    setLoading(true)
    const timer = window.setTimeout(() => setLoading(false), 300)
    return () => window.clearTimeout(timer)
  }, [query, page])

  const filteredClips = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return CLIPS
    }

    return CLIPS.filter(
      (clip) =>
        clip.title.toLowerCase().includes(normalized) ||
        clip.channel.toLowerCase().includes(normalized)
    )
  }, [query])

  const totalPages = filteredClips.length === 0 ? 0 : Math.ceil(filteredClips.length / PAGE_SIZE)

  useEffect(() => {
    if (totalPages === 0) {
      if (page !== 0) {
        setPage(0)
      }
      return
    }

    if (page > totalPages - 1) {
      setPage(totalPages - 1)
    }
  }, [page, totalPages])

  const visibleClips = filteredClips.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const skeletonCount = visibleClips.length > 0 ? visibleClips.length : Math.min(PAGE_SIZE, filteredClips.length || PAGE_SIZE)

  const handleSelect = useCallback(
    (id: string) => {
      navigate(`/clip/${id}`)
    },
    [navigate]
  )

  const hasResults = filteredClips.length > 0
  const hasPrev = page > 0
  const hasNext = totalPages > 0 && page < totalPages - 1

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--fg)]">Featured clips</h2>
          <p className="text-sm text-[var(--muted)]">
            {hasResults
              ? `${filteredClips.length.toLocaleString()} clip${filteredClips.length === 1 ? '' : 's'} found`
              : 'No clips match your search yet'}
          </p>
        </div>
        {totalPages > 1 && hasResults ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={!hasPrev}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-[var(--muted)]">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              disabled={!hasNext}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <div
              key={index}
              className="flex h-full flex-col overflow-hidden rounded-xl bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)]"
            >
              <div className="aspect-video w-full animate-pulse bg-white/10" />
              <div className="flex flex-1 flex-col gap-2 px-4 py-3">
                <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      ) : hasResults ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleClips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onClick={() => handleSelect(clip.id)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-10 text-center">
          <h3 className="text-lg font-semibold text-[var(--fg)]">No clips found</h3>
          <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
            Try a different keyword or explore trending creators to discover new highlights.
          </p>
        </div>
      )}
    </section>
  )
}

export default Home
