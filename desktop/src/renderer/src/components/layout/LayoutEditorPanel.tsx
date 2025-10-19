import type {
  ChangeEvent,
  FC,
  FormEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutCollection } from '../../../../types/api'
import type {
  LayoutBackground,
  LayoutCategory,
  LayoutDefinition,
  LayoutFrame,
  LayoutItem,
  LayoutShapeItem,
  LayoutTextItem,
  LayoutVideoItem
} from '../../../../types/layouts'
import type { Clip } from '../../types'
import LayoutPreviewOverlay from './LayoutPreviewOverlay'

type LayoutReference = {
  id: string
  category: LayoutCategory | null
}

type LayoutEditorPanelProps = {
  clip: Clip | null
  layoutCollection: LayoutCollection | null
  isCollectionLoading: boolean
  selectedLayout: LayoutDefinition | null
  selectedLayoutReference: LayoutReference | null
  isLayoutLoading: boolean
  appliedLayoutId: string | null
  isSavingLayout: boolean
  isApplyingLayout: boolean
  statusMessage: string | null
  errorMessage: string | null
  onSelectLayout: (id: string, category: LayoutCategory) => void
  onCreateBlankLayout: () => void
  onLayoutChange: (layout: LayoutDefinition) => void
  onSaveLayout: (
    layout: LayoutDefinition,
    options?: { originalId?: string | null; originalCategory?: LayoutCategory | null }
  ) => Promise<LayoutDefinition>
  onImportLayout: () => Promise<void>
  onExportLayout: (id: string, category: LayoutCategory) => Promise<void>
  onApplyLayout: (layout: LayoutDefinition) => Promise<void>
}

type DragState = {
  itemId: string
  pointerId: number
  startX: number
  startY: number
  frame: LayoutFrame
  containerRect: DOMRect
}

type LayoutKind = LayoutItem['kind']

const clamp = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max)

const cloneLayout = (layout: LayoutDefinition): LayoutDefinition => ({
  ...layout,
  canvas: {
    ...layout.canvas,
    background: { ...layout.canvas.background }
  },
  captionArea: layout.captionArea ? { ...layout.captionArea } : null,
  items: layout.items.map((item) => {
    if (item.kind === 'video') {
      const video = item as LayoutVideoItem
      return {
        ...video,
        frame: { ...video.frame },
        crop: video.crop ? { ...video.crop } : null
      }
    }
    if (item.kind === 'text') {
      const text = item as LayoutTextItem
      return {
        ...text,
        frame: { ...text.frame }
      }
    }
    const shape = item as LayoutShapeItem
    return {
      ...shape,
      frame: { ...shape.frame }
    }
  })
})

const createDefaultLayout = (): LayoutDefinition => ({
  id: 'untitled-layout',
  name: 'Untitled layout',
  version: 1,
  description: null,
  author: null,
  tags: [],
  category: 'custom',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  canvas: {
    width: 1080,
    height: 1920,
    background: { kind: 'blur', radius: 45, opacity: 0.6, brightness: 0.55 }
  },
  captionArea: null,
  items: []
})

const getLayoutIcon = (category: LayoutCategory): string => (category === 'builtin' ? '🏛️' : '👤')

const createItemId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 999)}`

const LayoutEditorPanel: FC<LayoutEditorPanelProps> = ({
  clip,
  layoutCollection,
  isCollectionLoading,
  selectedLayout,
  selectedLayoutReference,
  isLayoutLoading,
  appliedLayoutId,
  isSavingLayout,
  isApplyingLayout,
  statusMessage,
  errorMessage,
  onSelectLayout,
  onCreateBlankLayout,
  onLayoutChange,
  onSaveLayout,
  onImportLayout,
  onExportLayout,
  onApplyLayout
}) => {
  const [draftLayout, setDraftLayout] = useState<LayoutDefinition | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)

  useEffect(() => {
    if (!selectedLayout) {
      setDraftLayout(null)
      setSelectedItemId(null)
      return
    }
    setDraftLayout(cloneLayout(selectedLayout))
    setSelectedItemId(null)
  }, [selectedLayout])

  const handleUpdateLayout = useCallback(
    (updater: (layout: LayoutDefinition) => LayoutDefinition, emitChange = true) => {
      setDraftLayout((previous) => {
        if (!previous) {
          return previous
        }
        const next = updater(previous)
        if (emitChange) {
          onLayoutChange(next)
        }
        return next
      })
    },
    [onLayoutChange]
  )

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      handleUpdateLayout((layout) => ({ ...layout, name: value }))
    },
    [handleUpdateLayout]
  )

  const handleDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      handleUpdateLayout((layout) => ({ ...layout, description: value.length > 0 ? value : null }))
    },
    [handleUpdateLayout]
  )

  const handleCanvasChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { name, value } = event.target
      const numericValue = Number.parseInt(value, 10)
      if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return
      }
      handleUpdateLayout((layout) => ({
        ...layout,
        canvas: {
          ...layout.canvas,
          [name]: numericValue
        }
      }))
    },
    [handleUpdateLayout]
  )

  const handleBackgroundKindChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const kind = event.target.value as LayoutBackground['kind']
      handleUpdateLayout((layout) => ({
        ...layout,
        canvas: {
          ...layout.canvas,
          background: {
            kind,
            ...(kind === 'blur'
              ? { radius: 45, opacity: 0.6, brightness: 0.55 }
              : kind === 'color'
              ? { color: '#000000', opacity: 1 }
              : { source: '', mode: 'cover' })
          }
        }
      }))
    },
    [handleUpdateLayout]
  )

  const handleBackgroundFieldChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = event.target
      handleUpdateLayout((layout) => ({
        ...layout,
        canvas: {
          ...layout.canvas,
          background: {
            ...layout.canvas.background,
            [name]: name === 'radius' ? Number.parseInt(value, 10) || 0 : value
          }
        }
      }))
    },
    [handleUpdateLayout]
  )

  const addItem = useCallback(
    (kind: LayoutKind) => {
      if (!draftLayout) {
        return
      }
      const newLayout = cloneLayout(draftLayout)
      const baseFrame: LayoutFrame = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      let item: LayoutItem
      if (kind === 'video') {
        item = {
          id: createItemId('video'),
          kind: 'video',
          source: 'primary',
          frame: baseFrame,
          name: 'Primary video',
          crop: null,
          scaleMode: 'cover',
          rotation: null,
          opacity: 1,
          mirror: false,
          zIndex: newLayout.items.length
        }
      } else if (kind === 'text') {
        item = {
          id: createItemId('text'),
          kind: 'text',
          content: 'Add your title',
          frame: { x: 0.1, y: 0.75, width: 0.8, height: 0.2 },
          align: 'center',
          color: '#ffffff',
          fontFamily: null,
          fontSize: 48,
          fontWeight: 'bold',
          letterSpacing: null,
          lineHeight: 1.2,
          uppercase: false,
          opacity: 1,
          zIndex: newLayout.items.length
        }
      } else {
        item = {
          id: createItemId('shape'),
          kind: 'shape',
          frame: { x: 0, y: 0, width: 1, height: 1 },
          color: '#000000',
          borderRadius: 32,
          opacity: 0.4,
          zIndex: 0
        }
      }
      newLayout.items = [...newLayout.items, item]
      setDraftLayout(newLayout)
      onLayoutChange(newLayout)
      setSelectedItemId(item.id)
      setIsAddMenuOpen(false)
    },
    [draftLayout, onLayoutChange]
  )

  const removeSelectedItem = useCallback(() => {
    if (!draftLayout || !selectedItemId) {
      return
    }
    const newLayout = cloneLayout(draftLayout)
    newLayout.items = newLayout.items.filter((item) => item.id !== selectedItemId)
    setDraftLayout(newLayout)
    onLayoutChange(newLayout)
    setSelectedItemId(null)
  }, [draftLayout, onLayoutChange, selectedItemId])

  const handleItemPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, item: LayoutItem) => {
      if (!editorRef.current) {
        return
      }
      const rect = editorRef.current.getBoundingClientRect()
      dragStateRef.current = {
        itemId: item.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        frame: { ...item.frame },
        containerRect: rect
      }
      setSelectedItemId(item.id)
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    []
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state || !draftLayout) {
        return
      }
      if (state.pointerId !== event.pointerId) {
        return
      }
      const { containerRect, frame } = state
      const deltaX = (event.clientX - state.startX) / containerRect.width
      const deltaY = (event.clientY - state.startY) / containerRect.height
      const newX = clamp(frame.x + deltaX, 0, 1 - frame.width)
      const newY = clamp(frame.y + deltaY, 0, 1 - frame.height)
      const newLayout = cloneLayout(draftLayout)
      newLayout.items = newLayout.items.map((item) =>
        item.id === state.itemId
          ? {
              ...item,
              frame: {
                ...item.frame,
                x: Number.isFinite(newX) ? clamp(newX) : item.frame.x,
                y: Number.isFinite(newY) ? clamp(newY) : item.frame.y
              }
            }
          : item
      )
      setDraftLayout(newLayout)
      onLayoutChange(newLayout)
    },
    [draftLayout, onLayoutChange]
  )

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state) {
      return
    }
    if (state.pointerId === event.pointerId) {
      dragStateRef.current = null
      ;(event.target as HTMLElement).releasePointerCapture(event.pointerId)
    }
  }, [])

  const handleItemFieldChange = useCallback(
    (
      itemId: string,
      field: keyof LayoutFrame | keyof LayoutVideoItem | keyof LayoutTextItem | keyof LayoutShapeItem,
      rawValue: string | number
    ) => {
      if (!draftLayout) {
        return
      }
      const newLayout = cloneLayout(draftLayout)
      newLayout.items = newLayout.items.map((item) => {
        if (item.id !== itemId) {
          return item
        }
        if (field in item.frame) {
          const numericValue = typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue)
          if (Number.isFinite(numericValue)) {
            const clamped = clamp(numericValue)
            return {
              ...item,
              frame: {
                ...item.frame,
                [field]: clamped
              }
            }
          }
          return item
        }
        if (item.kind === 'video') {
          const video = item as LayoutVideoItem
          if (field === 'scaleMode') {
            return { ...video, scaleMode: (rawValue as LayoutVideoItem['scaleMode']) ?? 'cover' }
          }
          if (field === 'rotation') {
            const numericValue = typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue)
            return { ...video, rotation: Number.isFinite(numericValue) ? numericValue : null }
          }
          if (field === 'mirror') {
            return { ...video, mirror: rawValue === 'true' || rawValue === true }
          }
          if (field === 'opacity') {
            const numericValue = typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue)
            return { ...video, opacity: Number.isFinite(numericValue) ? clamp(numericValue) : video.opacity }
          }
        }
        if (item.kind === 'text') {
          const text = item as LayoutTextItem
          if (field === 'content') {
            return { ...text, content: String(rawValue) }
          }
          if (field === 'align') {
            return { ...text, align: rawValue as LayoutTextItem['align'] }
          }
          if (field === 'color') {
            return { ...text, color: String(rawValue) }
          }
          if (field === 'fontSize') {
            const numericValue = typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue)
            return { ...text, fontSize: Number.isFinite(numericValue) ? numericValue : text.fontSize }
          }
        }
        if (item.kind === 'shape') {
          const shape = item as LayoutShapeItem
          if (field === 'color') {
            return { ...shape, color: String(rawValue) }
          }
          if (field === 'opacity') {
            const numericValue = typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue)
            return { ...shape, opacity: Number.isFinite(numericValue) ? clamp(numericValue) : shape.opacity }
          }
        }
        return item
      })
      setDraftLayout(newLayout)
      onLayoutChange(newLayout)
    },
    [draftLayout, onLayoutChange]
  )

  const handleSave = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!draftLayout) {
        return
      }
      await onSaveLayout(draftLayout, {
        originalId: selectedLayoutReference?.id ?? null,
        originalCategory: selectedLayoutReference?.category ?? null
      })
    },
    [draftLayout, onSaveLayout, selectedLayoutReference]
  )

  const handleExport = useCallback(async () => {
    if (!selectedLayoutReference) {
      return
    }
    if (!selectedLayoutReference.category) {
      // Try both categories, default to builtin
      await onExportLayout(selectedLayoutReference.id, 'custom').catch(async () => {
        await onExportLayout(selectedLayoutReference.id, 'builtin')
      })
      return
    }
    await onExportLayout(selectedLayoutReference.id, selectedLayoutReference.category)
  }, [onExportLayout, selectedLayoutReference])

  const handleImport = useCallback(async () => {
    await onImportLayout()
  }, [onImportLayout])

  const handleApply = useCallback(async () => {
    if (!draftLayout) {
      return
    }
    await onApplyLayout(draftLayout)
  }, [draftLayout, onApplyLayout])

  const availableLayouts = useMemo(() => {
    if (!layoutCollection) {
      return null
    }
    return [
      { title: 'Built-in', category: 'builtin' as LayoutCategory, items: layoutCollection.builtin },
      { title: 'Custom', category: 'custom' as LayoutCategory, items: layoutCollection.custom }
    ]
  }, [layoutCollection])

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--fg)]">Layout editor</h2>
          <p className="text-xs text-[var(--muted)]">
            Arrange video windows, text overlays, and shapes. Drag items on the canvas to reposition them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const fresh = createDefaultLayout()
              setDraftLayout(fresh)
              onCreateBlankLayout()
              onLayoutChange(fresh)
              setSelectedItemId(null)
            }}
            className="marble-button marble-button--ghost px-3 py-1 text-xs font-semibold"
          >
            New layout
          </button>
          <button
            type="button"
            onClick={() => setIsAddMenuOpen((prev) => !prev)}
            className="marble-button marble-button--outline px-3 py-1 text-xs font-semibold"
          >
            Add item
          </button>
          <button
            type="button"
            onClick={removeSelectedItem}
            className="marble-button marble-button--ghost px-3 py-1 text-xs font-semibold disabled:opacity-60"
            disabled={!selectedItemId}
          >
            Remove selected
          </button>
          <button
            type="button"
            onClick={handleImport}
            className="marble-button marble-button--ghost px-3 py-1 text-xs font-semibold"
            disabled={isSavingLayout}
          >
            Import layout JSON
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="marble-button marble-button--ghost px-3 py-1 text-xs font-semibold"
            disabled={!selectedLayoutReference}
          >
            Export layout JSON
          </button>
        </div>
      </header>
      {isAddMenuOpen ? (
        <div className="flex flex-wrap gap-2 rounded-lg border border-white/10 bg-black/40 p-3 text-xs">
          <button
            type="button"
            className="marble-button marble-button--solid px-3 py-1"
            onClick={() => addItem('video')}
          >
            Video window
          </button>
          <button
            type="button"
            className="marble-button marble-button--solid px-3 py-1"
            onClick={() => addItem('text')}
          >
            Text overlay
          </button>
          <button
            type="button"
            className="marble-button marble-button--solid px-3 py-1"
            onClick={() => addItem('shape')}
          >
            Background block
          </button>
        </div>
      ) : null}
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-[var(--fg)]">Layouts</h3>
        <div className="flex flex-col gap-3">
          {isCollectionLoading ? (
            <p className="text-xs text-[var(--muted)]">Loading layouts…</p>
          ) : availableLayouts ? (
            availableLayouts.map((group) => (
              <Fragment key={group.category}>
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                    {group.title}
                  </h4>
                  <span className="text-[10px] text-[var(--muted)]">{group.items.length} layouts</span>
                </div>
                {group.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-white/10 bg-black/40 p-3 text-xs text-[var(--muted)]">
                    No layouts in this group.
                  </p>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {group.items.map((summary) => {
                      const isActive = selectedLayoutReference?.id === summary.id
                      return (
                        <button
                          key={`${group.category}-${summary.id}`}
                          type="button"
                          onClick={() => onSelectLayout(summary.id, group.category)}
                          className={`min-w-[200px] max-w-[200px] rounded-xl border p-3 text-left transition ${
                            isActive
                              ? 'border-[var(--ring)] bg-[color:color-mix(in_srgb,var(--ring)_15%,var(--card))]'
                              : 'border-white/10 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] hover:border-[var(--ring)]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xl" aria-hidden>
                              {getLayoutIcon(group.category)}
                            </span>
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold text-[var(--fg)]">{summary.name}</span>
                              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                                {group.category === 'builtin' ? 'Built-in' : 'Custom'}
                              </span>
                            </div>
                          </div>
                          {summary.description ? (
                            <p className="mt-2 line-clamp-3 text-xs text-[var(--muted)]">{summary.description}</p>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </Fragment>
            ))
          ) : (
            <p className="text-xs text-[var(--muted)]">No layouts available.</p>
          )}
        </div>
      </section>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-white/10 bg-black" ref={editorRef}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-none text-xs text-[var(--muted)]">
              {isLayoutLoading
                ? 'Loading layout…'
                : draftLayout
                ? 'Drag items to reposition them.'
                : 'Select a layout to begin editing.'}
            </div>
          </div>
          {draftLayout && !isLayoutLoading ? (
            <div
              className="absolute inset-0"
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => {
                dragStateRef.current = null
              }}
            >
              <LayoutPreviewOverlay
                layout={draftLayout}
                selectedItemId={selectedItemId}
                interactive
                onItemPointerDown={handleItemPointerDown}
                highlightCaptionArea
              />
            </div>
          ) : null}
        </div>
        <form onSubmit={handleSave} className="flex max-h-[620px] flex-col gap-4 overflow-y-auto pr-1">
          <fieldset className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Layout details</legend>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
              Name
              <input
                type="text"
                value={draftLayout?.name ?? ''}
                onChange={handleNameChange}
                placeholder="Layout name"
                className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
              Description
              <textarea
                value={draftLayout?.description ?? ''}
                onChange={handleDescriptionChange}
                placeholder="Describe this layout"
                rows={3}
                className="resize-none rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
              <label className="flex flex-col gap-1">
                Canvas width (px)
                <input
                  type="number"
                  min={100}
                  name="width"
                  value={draftLayout?.canvas.width ?? 1080}
                  onChange={handleCanvasChange}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                Canvas height (px)
                <input
                  type="number"
                  min={100}
                  name="height"
                  value={draftLayout?.canvas.height ?? 1920}
                  onChange={handleCanvasChange}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted)]">
              Background type
              <select
                value={draftLayout?.canvas.background.kind ?? 'blur'}
                onChange={handleBackgroundKindChange}
                className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="blur">Blurred video</option>
                <option value="color">Solid colour</option>
                <option value="image">Image</option>
              </select>
            </label>
            {draftLayout?.canvas.background.kind === 'blur' ? (
              <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                <label className="flex flex-col gap-1">
                  Radius
                  <input
                    type="number"
                    name="radius"
                    min={0}
                    value={draftLayout.canvas.background.radius ?? 45}
                    onChange={handleBackgroundFieldChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Opacity
                  <input
                    type="number"
                    name="opacity"
                    step="0.05"
                    min={0}
                    max={1}
                    value={draftLayout.canvas.background.opacity ?? 0.6}
                    onChange={handleBackgroundFieldChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
              </div>
            ) : null}
            {draftLayout?.canvas.background.kind === 'color' ? (
              <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                <label className="flex flex-col gap-1">
                  Colour
                  <input
                    type="text"
                    name="color"
                    value={draftLayout.canvas.background.color ?? '#000000'}
                    onChange={handleBackgroundFieldChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Opacity
                  <input
                    type="number"
                    name="opacity"
                    step="0.05"
                    min={0}
                    max={1}
                    value={draftLayout.canvas.background.opacity ?? 1}
                    onChange={handleBackgroundFieldChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
              </div>
            ) : null}
            {draftLayout?.canvas.background.kind === 'image' ? (
              <div className="grid grid-cols-1 gap-3 text-xs text-[var(--muted)]">
                <label className="flex flex-col gap-1">
                  Image path
                  <input
                    type="text"
                    name="source"
                    value={draftLayout.canvas.background.source ?? ''}
                    onChange={handleBackgroundFieldChange}
                    placeholder="Relative or absolute image path"
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Fit mode
                  <select
                    name="mode"
                    value={draftLayout.canvas.background.mode ?? 'cover'}
                    onChange={handleBackgroundFieldChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                  </select>
                </label>
              </div>
            ) : null}
          </fieldset>
          <fieldset className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Items</legend>
            {draftLayout?.items.length ? (
              <ul className="flex flex-col gap-2">
                {draftLayout.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedItemId(item.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                        selectedItemId === item.id
                          ? 'border-[var(--ring)] bg-[color:color-mix(in_srgb,var(--ring)_18%,var(--card))] text-[var(--fg)]'
                          : 'border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] text-[var(--muted)] hover:border-[var(--ring)]'
                      }`}
                    >
                      <span className="font-semibold capitalize text-[var(--fg)]">{item.kind}</span>
                      <span className="ml-2 text-xs text-[var(--muted)]">{item.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--muted)]">No items yet. Use “Add item” to insert video windows or overlays.</p>
            )}
          </fieldset>
          {selectedItemId ? (
            <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/40 p-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Item properties</legend>
              {draftLayout?.items
                .filter((item) => item.id === selectedItemId)
                .map((item) => (
                  <Fragment key={item.id}>
                    <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                      {(['x', 'y', 'width', 'height'] as Array<keyof LayoutFrame>).map((key) => (
                        <label key={key} className="flex flex-col gap-1">
                          {key.charAt(0).toUpperCase() + key.slice(1)}
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            max={1}
                            value={Number(item.frame[key]).toFixed(2)}
                            onChange={(event) => handleItemFieldChange(item.id, key, Number.parseFloat(event.target.value))}
                            className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          />
                        </label>
                      ))}
                    </div>
                    {item.kind === 'video' ? (
                      <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                        <label className="flex flex-col gap-1">
                          Scale mode
                          <select
                            value={(item as LayoutVideoItem).scaleMode ?? 'cover'}
                            onChange={(event) => handleItemFieldChange(item.id, 'scaleMode', event.target.value)}
                            className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          >
                            <option value="cover">Cover</option>
                            <option value="contain">Contain</option>
                            <option value="fill">Fill</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          Rotation
                          <input
                            type="number"
                            step="1"
                            value={(item as LayoutVideoItem).rotation ?? 0}
                            onChange={(event) => handleItemFieldChange(item.id, 'rotation', Number.parseFloat(event.target.value))}
                            className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          />
                        </label>
                      </div>
                    ) : null}
                    {item.kind === 'text' ? (
                      <div className="flex flex-col gap-3 text-xs text-[var(--muted)]">
                        <label className="flex flex-col gap-1">
                          Text content
                          <textarea
                            value={(item as LayoutTextItem).content}
                            onChange={(event) => handleItemFieldChange(item.id, 'content', event.target.value)}
                            rows={3}
                            className="resize-none rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          Colour
                          <input
                            type="text"
                            value={(item as LayoutTextItem).color ?? '#ffffff'}
                            onChange={(event) => handleItemFieldChange(item.id, 'color', event.target.value)}
                            className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          />
                        </label>
                      </div>
                    ) : null}
                    {item.kind === 'shape' ? (
                      <div className="flex flex-col gap-3 text-xs text-[var(--muted)]">
                        <label className="flex flex-col gap-1">
                          Colour
                          <input
                            type="text"
                            value={(item as LayoutShapeItem).color ?? '#000000'}
                            onChange={(event) => handleItemFieldChange(item.id, 'color', event.target.value)}
                            className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          Opacity
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step="0.05"
                            value={(item as LayoutShapeItem).opacity ?? 1}
                            onChange={(event) => handleItemFieldChange(item.id, 'opacity', Number.parseFloat(event.target.value))}
                            className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          />
                        </label>
                      </div>
                    ) : null}
                  </Fragment>
                ))}
            </fieldset>
          ) : null}
          <div className="flex flex-col gap-3">
            {statusMessage ? (
              <p className="text-xs font-semibold text-[color:var(--success-strong)]">{statusMessage}</p>
            ) : null}
            {errorMessage ? (
              <p className="text-xs font-semibold text-[color:var(--error-strong)]">{errorMessage}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="marble-button marble-button--solid px-4 py-2 text-sm font-semibold"
                disabled={!draftLayout || isSavingLayout}
              >
                {isSavingLayout ? 'Saving…' : 'Save layout'}
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="marble-button marble-button--outline px-4 py-2 text-sm font-semibold disabled:opacity-60"
                disabled={!draftLayout || isApplyingLayout || (!clip && !appliedLayoutId)}
              >
                {isApplyingLayout ? 'Applying…' : clip ? 'Apply to clip' : 'Set as default'}
              </button>
              {appliedLayoutId ? (
                <span className="text-xs text-[var(--muted)]">
                  Active layout: <strong>{appliedLayoutId}</strong>
                </span>
              ) : null}
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}

export default LayoutEditorPanel
