import type { ChangeEvent, FC, FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LayoutCollection } from '../../../../types/api'
import type {
  LayoutBackground,
  LayoutCategory,
  LayoutDefinition,
  LayoutFrame,
  LayoutItem,
  LayoutTextItem,
  LayoutVideoItem
} from '../../../../types/layouts'
import type { Clip } from '../../types'
import VideoPreviewStage from '../VideoPreviewStage'
import LayoutCanvas from './LayoutCanvas'
import type { LayoutCanvasSelection } from './LayoutCanvas'

type LayoutReference = {
  id: string
  category: LayoutCategory | null
}

type LayoutEditorPanelProps = {
  tabNavigation: ReactNode
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

type UpdateOptions = {
  transient?: boolean
  emitChange?: boolean
  trackHistory?: boolean
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max)

const cloneLayout = (layout: LayoutDefinition): LayoutDefinition => ({
  ...layout,
  canvas: {
    ...layout.canvas,
    background: { ...layout.canvas.background }
  },
  captionArea: layout.captionArea ? { ...layout.captionArea } : null,
  items: layout.items.map((item) => ({
    ...item,
    frame: { ...item.frame }
  }))
})

const createItemId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 999)}`

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

const getBackgroundDefaults = (kind: LayoutBackground['kind']): LayoutBackground => {
  if (kind === 'color') {
    return { kind: 'color', color: '#000000', opacity: 1 }
  }
  if (kind === 'image') {
    return { kind: 'image', source: '', mode: 'cover', tint: null }
  }
  return { kind: 'blur', radius: 45, opacity: 0.6, brightness: 0.55 }
}

const isInputTarget = (element: EventTarget | null): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false
  }
  const tagName = element.tagName.toLowerCase()
  return ['input', 'textarea', 'select', 'button'].includes(tagName) || element.isContentEditable
}

const clampFrame = (frame: LayoutFrame): LayoutFrame => ({
  x: clamp(frame.x),
  y: clamp(frame.y),
  width: clamp(frame.width),
  height: clamp(frame.height)
})

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`

const LayoutEditorPanel: FC<LayoutEditorPanelProps> = ({
  tabNavigation,
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
  const [selectedItemIds, setSelectedItemIds] = useState<LayoutCanvasSelection>([])
  const [history, setHistory] = useState<LayoutDefinition[]>([])
  const [future, setFuture] = useState<LayoutDefinition[]>([])
  const [clipboard, setClipboard] = useState<LayoutItem[] | null>(null)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showSafeMargins, setShowSafeMargins] = useState(false)

  useEffect(() => {
    if (!selectedLayout) {
      setDraftLayout(null)
      setSelectedItemIds([])
      setHistory([])
      setFuture([])
      return
    }
    setDraftLayout(cloneLayout(selectedLayout))
    setSelectedItemIds([])
    setHistory([])
    setFuture([])
  }, [selectedLayout])

  const updateLayout = useCallback(
    (updater: (layout: LayoutDefinition) => LayoutDefinition, options?: UpdateOptions) => {
      setDraftLayout((previous) => {
        if (!previous) {
          return previous
        }
        const transient = options?.transient ?? false
        const emitChange = options?.emitChange ?? !transient
        const trackHistory = options?.trackHistory ?? !transient
        const snapshot = cloneLayout(previous)
        const next = updater(snapshot)
        if (trackHistory) {
          setHistory((current) => [...current.slice(-19), cloneLayout(previous)])
          setFuture([])
        }
        if (emitChange) {
          onLayoutChange(next)
        }
        return next
      })
    },
    [onLayoutChange]
  )

  const handleTransform = useCallback(
    (transforms: { itemId: string; frame: LayoutFrame }[], options: { commit: boolean }) => {
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            const match = transforms.find((transform) => transform.itemId === item.id)
            if (!match) {
              return item
            }
            return {
              ...item,
              frame: clampFrame(match.frame)
            }
          })
        }),
        { transient: !options.commit, trackHistory: options.commit }
      )
    },
    [updateLayout]
  )

  const handleAddItem = useCallback(
    (kind: LayoutItem['kind']) => {
      if (!draftLayout) {
        return
      }
      let newItem: LayoutItem
      if (kind === 'video') {
        newItem = {
          id: createItemId('video'),
          kind: 'video',
          source: 'primary',
          name: 'Primary video',
          frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.6 },
          scaleMode: 'cover',
          rotation: null,
          opacity: 1,
          mirror: false,
          zIndex: draftLayout.items.length
        }
      } else if (kind === 'text') {
        newItem = {
          id: createItemId('text'),
          kind: 'text',
          content: 'Add your headline',
          frame: { x: 0.12, y: 0.72, width: 0.76, height: 0.2 },
          align: 'center',
          color: '#ffffff',
          fontFamily: null,
          fontSize: 48,
          fontWeight: 'bold',
          letterSpacing: null,
          lineHeight: 1.2,
          uppercase: false,
          opacity: 1,
          zIndex: draftLayout.items.length
        }
      } else {
        newItem = {
          id: createItemId('shape'),
          kind: 'shape',
          frame: { x: 0, y: 0, width: 1, height: 1 },
          color: '#000000',
          opacity: 0.4,
          borderRadius: 32,
          zIndex: 0
        }
      }
      updateLayout(
        (layout) => ({
          ...layout,
          items: [...layout.items, newItem]
        }),
        { trackHistory: true }
      )
      setSelectedItemIds([newItem.id])
      setIsAddMenuOpen(false)
    },
    [draftLayout, updateLayout]
  )

  const handleRemoveSelected = useCallback(() => {
    if (!draftLayout || selectedItemIds.length === 0) {
      return
    }
    updateLayout(
      (layout) => ({
        ...layout,
        items: layout.items.filter((item) => !selectedItemIds.includes(item.id))
      }),
      { trackHistory: true }
    )
    setSelectedItemIds([])
  }, [draftLayout, selectedItemIds, updateLayout])

  const handleChangeItemFrameValue = useCallback(
    (itemId: string, field: keyof LayoutFrame, value: number) => {
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  frame: {
                    ...item.frame,
                    [field]: clamp(value)
                  }
                }
              : item
          )
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleChangeVideoField = useCallback(
    (itemId: string, field: keyof LayoutVideoItem, value: LayoutVideoItem[keyof LayoutVideoItem]) => {
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            if (item.id !== itemId || item.kind !== 'video') {
              return item
            }
            return {
              ...item,
              [field]: value
            }
          })
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleChangeTextField = useCallback(
    (
      itemId: string,
      field: keyof LayoutTextItem,
      value: LayoutTextItem[keyof LayoutTextItem]
    ) => {
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            if (item.id !== itemId || item.kind !== 'text') {
              return item
            }
            return {
              ...item,
              [field]: value
            }
          })
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleCanvasDimensionChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { name, value } = event.target
      const numeric = Number.parseInt(value, 10)
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return
      }
      updateLayout(
        (layout) => ({
          ...layout,
          canvas: {
            ...layout.canvas,
            [name]: numeric
          }
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleBackgroundKindChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const kind = event.target.value as LayoutBackground['kind']
      updateLayout(
        (layout) => ({
          ...layout,
          canvas: {
            ...layout.canvas,
            background: getBackgroundDefaults(kind)
          }
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleBackgroundFieldChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = event.target
      updateLayout(
        (layout) => ({
          ...layout,
          canvas: {
            ...layout.canvas,
            background: {
              ...layout.canvas.background,
              [name]: name === 'radius' || name === 'opacity' || name === 'brightness'
                ? Number.parseFloat(value)
                : value
            }
          }
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const bringSelectionForward = useCallback(() => {
    if (!draftLayout || selectedItemIds.length === 0) {
      return
    }
    updateLayout(
      (layout) => {
        const updatedItems = layout.items.map((item) => {
          if (!selectedItemIds.includes(item.id)) {
            return item
          }
          const z = 'zIndex' in item && typeof item.zIndex === 'number' ? item.zIndex : 0
          return { ...item, zIndex: z + 1 }
        })
        return {
          ...layout,
          items: updatedItems
        }
      },
      { trackHistory: true }
    )
  }, [draftLayout, selectedItemIds, updateLayout])

  const sendSelectionBackward = useCallback(() => {
    if (!draftLayout || selectedItemIds.length === 0) {
      return
    }
    updateLayout(
      (layout) => {
        const updatedItems = layout.items.map((item) => {
          if (!selectedItemIds.includes(item.id)) {
            return item
          }
          const z = 'zIndex' in item && typeof item.zIndex === 'number' ? item.zIndex : 0
          return { ...item, zIndex: Math.max(0, z - 1) }
        })
        return {
          ...layout,
          items: updatedItems
        }
      },
      { trackHistory: true }
    )
  }, [draftLayout, selectedItemIds, updateLayout])

  const duplicateSelection = useCallback(() => {
    if (!draftLayout || selectedItemIds.length === 0) {
      return
    }
    const duplicates: LayoutItem[] = draftLayout.items
      .filter((item) => selectedItemIds.includes(item.id))
      .map((item) => ({
        ...item,
        id: createItemId(item.kind),
        frame: clampFrame({
          x: clamp(item.frame.x + 0.03),
          y: clamp(item.frame.y + 0.03),
          width: item.frame.width,
          height: item.frame.height
        }),
        zIndex: draftLayout.items.length + 1
      }))
    updateLayout(
      (layout) => ({
        ...layout,
        items: [...layout.items, ...duplicates]
      }),
      { trackHistory: true }
    )
    setSelectedItemIds(duplicates.map((item) => item.id))
  }, [draftLayout, selectedItemIds, updateLayout])

  const handleCopySelection = useCallback(() => {
    if (!draftLayout || selectedItemIds.length === 0) {
      return
    }
    const items = draftLayout.items.filter((item) => selectedItemIds.includes(item.id)).map((item) => ({
      ...item,
      frame: { ...item.frame }
    }))
    setClipboard(items)
  }, [draftLayout, selectedItemIds])

  const handlePaste = useCallback(() => {
    if (!clipboard || !draftLayout) {
      return
    }
    const clones = clipboard.map((item) => ({
      ...item,
      id: createItemId(item.kind),
      frame: clampFrame({
        x: clamp(item.frame.x + 0.05),
        y: clamp(item.frame.y + 0.05),
        width: item.frame.width,
        height: item.frame.height
      }),
      zIndex: draftLayout.items.length + 1
    }))
    updateLayout(
      (layout) => ({
        ...layout,
        items: [...layout.items, ...clones]
      }),
      { trackHistory: true }
    )
    setSelectedItemIds(clones.map((item) => item.id))
  }, [clipboard, draftLayout, updateLayout])

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.length === 0 || !draftLayout) {
        return current
      }
      const previous = current[current.length - 1]
      setDraftLayout(cloneLayout(previous))
      setFuture((futureStack) => [cloneLayout(draftLayout), ...futureStack])
      onLayoutChange(previous)
      return current.slice(0, -1)
    })
  }, [draftLayout, onLayoutChange])

  const redo = useCallback(() => {
    setFuture((current) => {
      if (current.length === 0 || !draftLayout) {
        return current
      }
      const next = current[0]
      setDraftLayout(cloneLayout(next))
      setHistory((historyStack) => [...historyStack, cloneLayout(draftLayout)])
      onLayoutChange(next)
      return current.slice(1)
    })
  }, [draftLayout, onLayoutChange])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!draftLayout || isInputTarget(event.target)) {
        return
      }
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const primaryMod = isMac ? event.metaKey : event.ctrlKey
      if (event.key === 'Escape') {
        setSelectedItemIds([])
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        handleCopySelection()
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        handlePaste()
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelection()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        handleRemoveSelected()
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        const delta = event.shiftKey ? 0.02 : 0.005
        const dx = event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0
        const dy = event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0
        if (dx === 0 && dy === 0) {
          return
        }
        updateLayout(
          (layout) => ({
            ...layout,
            items: layout.items.map((item) =>
              selectedItemIds.includes(item.id)
                ? {
                    ...item,
                    frame: clampFrame({
                      x: item.frame.x + dx,
                      y: item.frame.y + dy,
                      width: item.frame.width,
                      height: item.frame.height
                    })
                  }
                : item
            )
          }),
          { trackHistory: true }
        )
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [draftLayout, duplicateSelection, handleCopySelection, handlePaste, handleRemoveSelected, redo, selectedItemIds, undo, updateLayout])

  const handleSave = useCallback(
    async (event?: FormEvent) => {
      if (event) {
        event.preventDefault()
      }
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

  const handleApply = useCallback(async () => {
    if (!draftLayout) {
      return
    }
    await onApplyLayout(draftLayout)
  }, [draftLayout, onApplyLayout])

  const handleExport = useCallback(async () => {
    if (!selectedLayoutReference) {
      return
    }
    const category = selectedLayoutReference.category ?? 'custom'
    await onExportLayout(selectedLayoutReference.id, category)
  }, [onExportLayout, selectedLayoutReference])

  const handleImport = useCallback(async () => {
    await onImportLayout()
  }, [onImportLayout])

  const bringSelectionIntoView = useCallback(() => {
    if (!draftLayout || selectedItemIds.length === 0) {
      return
    }
    updateLayout(
      (layout) => ({
        ...layout,
        items: layout.items.map((item) => {
          if (!selectedItemIds.includes(item.id)) {
            return item
          }
          return {
            ...item,
            frame: clampFrame(item.frame)
          }
        })
      }),
      { trackHistory: true }
    )
  }, [draftLayout, selectedItemIds, updateLayout])

  const selectedItems = useMemo(
    () => draftLayout?.items.filter((item) => selectedItemIds.includes(item.id)) ?? [],
    [draftLayout, selectedItemIds]
  )

  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : null

  const selectionOffCanvas = useMemo(() => {
    if (selectedItems.length === 0) {
      return false
    }
    return selectedItems.some((item) => {
      const frame = item.frame
      return frame.x < 0 || frame.y < 0 || frame.x + frame.width > 1 || frame.y + frame.height > 1
    })
  }, [selectedItems])

  const selectionLabel = useMemo(() => {
    if (selectedItems.length === 0) {
      return 'Canvas settings'
    }
    if (selectedItems.length === 1) {
      return selectedItem?.kind === 'video'
        ? 'Video window'
        : selectedItem?.kind === 'text'
        ? 'Text overlay'
        : 'Background layer'
    }
    return `${selectedItems.length} items selected`
  }, [selectedItems, selectedItem])

  const availableLayouts = useMemo(() => {
    if (!layoutCollection) {
      return []
    }
    const rows: Array<{ title: string; category: LayoutCategory; items: LayoutCollection['builtin'] }> = []
    if (layoutCollection.builtin.length > 0) {
      rows.push({ title: 'Built-in layouts', category: 'builtin', items: layoutCollection.builtin })
    }
    if (layoutCollection.custom.length > 0) {
      rows.push({ title: 'Custom layouts', category: 'custom', items: layoutCollection.custom })
    }
    return rows
  }, [layoutCollection])

  const previewVideoSource = clip?.previewUrl ?? clip?.playbackUrl ?? null
  const clipDuration = clip?.durationSec ?? 0
  const transportRangeLabel =
    clip && clipDuration > 0
      ? `${formatPercent(clip.startSeconds / clipDuration)} – ${formatPercent(clip.endSeconds / clipDuration)}`
      : clip
      ? `${clip.startSeconds.toFixed(1)}s – ${clip.endSeconds.toFixed(1)}s`
      : 'No clip loaded'

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      updateLayout(
        (layout) => ({
          ...layout,
          name: value
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      updateLayout(
        (layout) => ({
          ...layout,
          description: value.length > 0 ? value : null
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  return (
    <section className="flex w-full flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {tabNavigation}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={() => {
              const fresh = createDefaultLayout()
              setDraftLayout(fresh)
              setSelectedItemIds([])
              onCreateBlankLayout()
              onLayoutChange(fresh)
            }}
          >
            New layout
          </button>
          <div className="relative">
            <button
              type="button"
              className="marble-button marble-button--ghost px-3 py-2 text-sm"
              onClick={() => setIsAddMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={isAddMenuOpen}
            >
              Add item ▾
            </button>
            {isAddMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_75%,transparent)] shadow-[0_16px_32px_rgba(0,0,0,0.35)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleAddItem('video')}
                  className="block w-full px-4 py-2 text-left text-sm text-[var(--fg)] hover:bg-white/10"
                >
                  Video window
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleAddItem('text')}
                  className="block w-full px-4 py-2 text-left text-sm text-[var(--fg)] hover:bg-white/10"
                >
                  Text overlay
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleAddItem('shape')}
                  className="block w-full px-4 py-2 text-left text-sm text-[var(--fg)] hover:bg-white/10"
                >
                  Background layer
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={handleRemoveSelected}
            disabled={selectedItemIds.length === 0}
          >
            Remove selected
          </button>
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={handleImport}
          >
            Import JSON
          </button>
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={handleExport}
            disabled={!selectedLayoutReference}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="marble-button marble-button--solid px-3 py-2 text-sm"
            onClick={handleSave}
            disabled={!draftLayout || isSavingLayout}
          >
            {isSavingLayout ? 'Saving…' : 'Save layout'}
          </button>
          <button
            type="button"
            className="marble-button marble-button--outline px-3 py-2 text-sm"
            onClick={handleApply}
            disabled={!draftLayout || isApplyingLayout}
          >
            {isApplyingLayout ? 'Applying…' : clip ? 'Apply to clip' : 'Set as default'}
          </button>
        </div>
      </div>
      {availableLayouts.length > 0 ? (
        <div className="space-y-4">
          {availableLayouts.map((row) => (
            <div key={row.category} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_65%,transparent)]">
                  {row.title}
                </h3>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {row.items.map((layout) => {
                  const isActive = selectedLayoutReference?.id === layout.id
                  return (
                    <button
                      key={layout.id}
                      type="button"
                      onClick={() => onSelectLayout(layout.id, row.category)}
                      className={`flex w-56 flex-shrink-0 flex-col gap-2 rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                        isActive
                          ? 'border-[var(--ring)] bg-[color:color-mix(in_srgb,var(--ring)_20%,var(--card))] text-[var(--fg)]'
                          : 'border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] text-[var(--muted)] hover:border-[var(--ring)]'
                      }`}
                    >
                      <span className="text-sm font-semibold text-[var(--fg)]">{layout.name}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {layout.description ? layout.description : 'No description'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : isCollectionLoading ? (
        <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-3 text-sm text-[var(--muted)]">
          Loading layouts…
        </div>
      ) : null}
      {statusMessage ? (
        <div
          role="status"
          className="rounded-xl border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-3 text-sm text-[var(--fg)]"
        >
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div
          role="alert"
          className="rounded-xl border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:color-mix(in_srgb,var(--error-soft)_80%,transparent)] px-4 py-3 text-sm text-[color:var(--error-contrast)]"
        >
          {errorMessage}
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-[var(--fg)]">Source preview</h3>
          <VideoPreviewStage height="clamp(240px, 50vh, 520px)">
            {previewVideoSource ? (
              <video
                src={previewVideoSource}
                className="h-full w-full object-contain"
                controls
                aria-label="Source video preview"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-white/60">
                Load a clip to preview the source video.
              </div>
            )}
          </VideoPreviewStage>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-3 py-2 text-xs text-[var(--muted)]">
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white">
                ▶︎
              </button>
              <span>Transport controls mirrored from the trimming view.</span>
            </div>
            <span>{transportRangeLabel}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-[var(--fg)]">Layout preview</h3>
          <LayoutCanvas
            layout={draftLayout}
            selectedItemIds={selectedItemIds}
            onSelectionChange={setSelectedItemIds}
            onTransform={handleTransform}
            onRequestBringForward={bringSelectionForward}
            onRequestSendBackward={sendSelectionBackward}
            onRequestDuplicate={duplicateSelection}
            onRequestDelete={handleRemoveSelected}
            showGrid={showGrid}
            showSafeMargins={showSafeMargins}
            previewContent={
              previewVideoSource ? (
                <video
                  src={previewVideoSource}
                  className="h-full w-full object-cover"
                  muted
                  loop
                  autoPlay
                  playsInline
                  aria-label="Layout preview video"
                />
              ) : (
                <span>No preview source available.</span>
              )
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(event) => setShowGrid(event.target.checked)}
              />
              Show grid
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showSafeMargins}
                onChange={(event) => setShowSafeMargins(event.target.checked)}
              />
              Safe margins
            </label>
            {appliedLayoutId ? (
              <span className="ml-auto text-xs text-[var(--muted)]">Applied layout: {appliedLayoutId}</span>
            ) : null}
          </div>
        </div>
      </div>
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--fg)]">{selectionLabel}</h3>
          {selectionOffCanvas ? (
            <div className="flex items-center gap-3 rounded-full border border-[color:color-mix(in_srgb,var(--warning-strong)_60%,var(--edge))] bg-[color:var(--warning-soft)] px-3 py-1 text-xs text-[color:var(--warning-contrast)]">
              <span>Part of this selection sits outside the canvas.</span>
              <button
                type="button"
                className="rounded-full bg-[color:color-mix(in_srgb,var(--warning-contrast)_15%,transparent)] px-2 py-1 text-xs font-semibold"
                onClick={bringSelectionIntoView}
              >
                Bring into view
              </button>
            </div>
          ) : null}
        </div>
        {selectedItem ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Position & size
              </legend>
              <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                {(Object.keys(selectedItem.frame) as Array<keyof LayoutFrame>).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    {key.toUpperCase()}
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={selectedItem.frame[key].toFixed(2)}
                      onChange={(event) => handleChangeItemFrameValue(selectedItem.id, key, Number.parseFloat(event.target.value))}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            {selectedItem.kind === 'video' ? (
              <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Video settings
                </legend>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Name
                  <input
                    type="text"
                    value={(selectedItem as LayoutVideoItem).name ?? ''}
                    onChange={(event) => handleChangeVideoField(selectedItem.id, 'name', event.target.value)}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Scale mode
                  <select
                    value={(selectedItem as LayoutVideoItem).scaleMode ?? 'cover'}
                    onChange={(event) => handleChangeVideoField(selectedItem.id, 'scaleMode', event.target.value as LayoutVideoItem['scaleMode'])}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                    <option value="fill">Fill</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Rotation (°)
                    <input
                      type="number"
                      value={(selectedItem as LayoutVideoItem).rotation ?? 0}
                      onChange={(event) => handleChangeVideoField(selectedItem.id, 'rotation', Number.parseFloat(event.target.value))}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(selectedItem as LayoutVideoItem).mirror ?? false}
                      onChange={(event) => handleChangeVideoField(selectedItem.id, 'mirror', event.target.checked)}
                    />
                    Mirror horizontally
                  </label>
                </div>
              </fieldset>
            ) : null}
            {selectedItem.kind === 'text' ? (
              <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Text settings
                </legend>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Content
                  <textarea
                    value={(selectedItem as LayoutTextItem).content}
                    onChange={(event) => handleChangeTextField(selectedItem.id, 'content', event.target.value)}
                    rows={3}
                    className="resize-none rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Colour
                  <input
                    type="text"
                    value={(selectedItem as LayoutTextItem).color ?? '#ffffff'}
                    onChange={(event) => handleChangeTextField(selectedItem.id, 'color', event.target.value)}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <div className="grid grid-cols-3 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Size
                    <input
                      type="number"
                      value={(selectedItem as LayoutTextItem).fontSize ?? 48}
                      onChange={(event) => handleChangeTextField(selectedItem.id, 'fontSize', Number.parseFloat(event.target.value))}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Weight
                    <select
                      value={(selectedItem as LayoutTextItem).fontWeight ?? 'bold'}
                      onChange={(event) => handleChangeTextField(selectedItem.id, 'fontWeight', event.target.value as LayoutTextItem['fontWeight'])}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    Align
                    <select
                      value={(selectedItem as LayoutTextItem).align ?? 'center'}
                      onChange={(event) => handleChangeTextField(selectedItem.id, 'align', event.target.value as LayoutTextItem['align'])}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                </div>
              </fieldset>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Layout details
              </legend>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                Name
                <input
                  type="text"
                  value={draftLayout?.name ?? ''}
                  onChange={handleNameChange}
                  placeholder="Layout name"
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                Description
                <textarea
                  value={draftLayout?.description ?? ''}
                  onChange={handleDescriptionChange}
                  rows={3}
                  placeholder="Describe how this layout should be used"
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
                    onChange={handleCanvasDimensionChange}
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
                    onChange={handleCanvasDimensionChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Background
              </legend>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
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
                <div className="grid grid-cols-3 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Radius
                    <input
                      type="number"
                      name="radius"
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
                      min={0}
                      max={1}
                      step={0.05}
                      value={draftLayout.canvas.background.opacity ?? 0.6}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Brightness
                    <input
                      type="number"
                      name="brightness"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draftLayout.canvas.background.brightness ?? 0.55}
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
                      min={0}
                      max={1}
                      step={0.05}
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
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Fit mode
                    <select
                      name="mode"
                      value={draftLayout.canvas.background.mode ?? 'cover'}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </fieldset>
          </div>
        )}
      </form>
    </section>
  )
}

export default LayoutEditorPanel
