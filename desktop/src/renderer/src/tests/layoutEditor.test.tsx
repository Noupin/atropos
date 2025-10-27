import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, beforeAll, afterEach, vi, it, expect } from 'vitest'
import type { LayoutDefinition, LayoutVideoItem } from '../../../types/layouts'
import LayoutCanvas from '../components/layout/LayoutCanvas'
import LayoutEditorPanel from '../components/layout/LayoutEditorPanel'
import { resetLayoutSelection } from '../components/layout/layoutSelectionStore'

vi.mock('../services/preview/adjustedPreview', () => ({
  resolveOriginalSource: vi.fn(async () => ({
    kind: 'ready' as const,
    fileUrl: 'source.mp4',
    mediaUrl: 'source.mp4',
    filePath: '/tmp/source.mp4',
    origin: 'canonical' as const,
    projectDir: null
  }))
}))

describe('Layout editor interactions', () => {
  beforeAll(() => {
    if (typeof window.PointerEvent === 'undefined') {
      class PointerEventPolyfill extends MouseEvent {
        pointerId: number
        pointerType: string
        isPrimary: boolean
        constructor(type: string, props?: PointerEventInit) {
          super(type, props)
          this.pointerId = props?.pointerId ?? 1
          this.pointerType = props?.pointerType ?? 'mouse'
          this.isPrimary = props?.isPrimary ?? true
        }
      }
      // @ts-expect-error jsdom polyfill for PointerEvent
      window.PointerEvent = PointerEventPolyfill
      // @ts-expect-error jsdom polyfill for PointerEvent
      global.PointerEvent = PointerEventPolyfill
    }
    if (typeof window.ResizeObserver === 'undefined') {
      class ResizeObserverPolyfill {
        private readonly callback: ResizeObserverCallback

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback
        }

        observe(target: Element) {
          this.callback(
            [
              {
                target,
                contentRect: target.getBoundingClientRect()
              } as ResizeObserverEntry
            ],
            this as unknown as ResizeObserver
          )
        }

        unobserve() {}

        disconnect() {}
      }
      // @ts-expect-error jsdom polyfill for ResizeObserver
      window.ResizeObserver = ResizeObserverPolyfill
      // @ts-expect-error jsdom polyfill for ResizeObserver
      global.ResizeObserver = ResizeObserverPolyfill
    }
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) =>
      window.setTimeout(() => {
        callback(performance.now())
      }, 0)
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle: number) => {
      window.clearTimeout(handle)
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true
    })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 0,
        width: 200,
        height: 400,
        top: 0,
        left: 0,
        right: 200,
        bottom: 400,
        toJSON: () => ({})
      })
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn(),
      configurable: true
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: vi.fn(),
      configurable: true
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      value: 0,
      writable: true,
      configurable: true
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      value: 0,
      writable: true,
      configurable: true
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: vi.fn(() => ({
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        drawImage: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        font: '',
        textAlign: 'center',
        textBaseline: 'top',
        measureText: vi.fn(() => ({ width: 100 } as TextMetrics)),
        fillText: vi.fn(),
        filter: '',
        globalAlpha: 1
      })),
      configurable: true
    })
  })

  afterEach(() => {
    cleanup()
    resetLayoutSelection()
  })

  const baseLayout: LayoutDefinition = {
    id: 'layout-1',
    name: 'Test layout',
    description: null,
    author: null,
    tags: [],
    category: 'custom',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canvas: {
      width: 1080,
      height: 1920,
      background: { kind: 'blur', radius: 45, opacity: 0.6 }
    },
    captionArea: null,
    items: [
      {
        id: 'video-1',
        kind: 'video',
        frame: { x: 0.1, y: 0.1, width: 0.4, height: 0.3 },
        name: 'Primary',
        source: 'primary',
        scaleMode: 'cover',
        rotation: null,
        opacity: 1,
        mirror: false,
        zIndex: 0
      }
    ]
  }

  const pipelineSteps = [
    { id: 'cut', label: 'Cut clip', description: 'Trim the footage', status: 'pending' as const },
    {
      id: 'subtitles',
      label: 'Regenerate subtitles',
      description: 'Update transcript timing',
      status: 'pending' as const
    },
    {
      id: 'render',
      label: 'Render vertical clip',
      description: 'Produce the final output',
      status: 'pending' as const
    }
  ]

  const sampleClip = {
    id: 'clip-1',
    title: 'Demo clip',
    channel: 'Channel',
    views: null,
    createdAt: new Date().toISOString(),
    durationSec: 120,
    sourceDurationSeconds: 180,
    thumbnail: null,
    playbackUrl: 'playback.mp4',
    previewUrl: 'preview.mp4',
    description: '',
    sourceUrl: 'source.mp4',
    sourceTitle: '',
    sourcePublishedAt: null,
    videoId: 'video-1',
    videoTitle: 'Video',
    rating: null,
    quote: null,
    reason: null,
    timestampUrl: null,
    timestampSeconds: null,
    accountId: null,
    startSeconds: 0,
    endSeconds: 60,
    originalStartSeconds: 0,
    originalEndSeconds: 60,
    hasAdjustments: false,
    layoutId: null
  } as const

  const pointerDown = (element: Element, init: Partial<PointerEventInit> = {}) =>
    fireEvent.pointerDown(element, {
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      pointerType: init.pointerType ?? 'mouse',
      ...init
    })

  const pointerMove = (element: Element, init: Partial<PointerEventInit> = {}) =>
    fireEvent.pointerMove(element, {
      pointerId: init.pointerId ?? 1,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      pointerType: init.pointerType ?? 'mouse',
      ...init
    })

  const pointerUp = (element: Element, init: Partial<PointerEventInit> = {}) =>
    fireEvent.pointerUp(element, {
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      pointerType: init.pointerType ?? 'mouse',
      ...init
    })

  type SelectOptions = Partial<PointerEventInit> & { release?: boolean }

  const selectItemByName = async (
    canvas: HTMLElement,
    name: string | RegExp,
    init: SelectOptions = {}
  ): Promise<HTMLElement> => {
    const target = within(canvas).getByRole('group', { name })
    const style = target.getAttribute('style') ?? ''
    const extractPercent = (property: string): number => {
      const match = new RegExp(`${property}:\\s*([0-9.]+)%`).exec(style)
      return match ? parseFloat(match[1]) / 100 : 0
    }
    const left = extractPercent('left')
    const top = extractPercent('top')
    const width = extractPercent('width')
    const height = extractPercent('height')
    const rect = canvas.getBoundingClientRect()
    const clientX = (init.clientX ?? rect.width * (left + width / 2)) + rect.left
    const clientY = (init.clientY ?? rect.height * (top + height / 2)) + rect.top
    await act(async () => {
      pointerDown(canvas, {
        pointerId: init.pointerId,
        clientX,
        clientY,
        pointerType: init.pointerType
      })
    })
    if (init.release !== false) {
      await act(async () => {
        pointerUp(canvas, {
          pointerId: init.pointerId,
          clientX,
          clientY,
          pointerType: init.pointerType
        })
      })
    }
    await waitFor(() => {
      const selected = within(canvas).getByRole('group', { name })
      expect(selected.className).toMatch(/ring-(?!0)/)
    })
    return within(canvas).getByRole('group', { name })
  }

  const findInteractiveCanvas = (canvases: HTMLElement[]): HTMLElement => {
    const reversed = [...canvases].reverse()
    const withVideo = reversed.find((element) =>
      within(element).queryByLabelText('Source video preview')
    )
    if (withVideo) {
      return withVideo
    }
    const withItem = reversed.find((element) =>
      within(element).queryByRole('group', { name: /primary/i })
    )
    return withItem ?? canvases[canvases.length - 1]
  }

  it('selects and moves an item on the canvas', async () => {
    const onTransform = vi.fn()
    render(
      <LayoutCanvas
        layout={baseLayout}
        onTransform={onTransform}
        onRequestBringForward={vi.fn()}
        onRequestSendBackward={vi.fn()}
        onRequestDuplicate={vi.fn()}
        onRequestDelete={vi.fn()}
        showGrid
        showSafeMargins={false}
        previewContent={<div>preview</div>}
        transformTarget="frame"
      />
    )

    const canvas = screen.getByRole('presentation')

    await act(async () => {
      pointerDown(canvas, { clientX: 60, clientY: 80, pointerId: 1 })
    })

    await act(async () => {
      pointerMove(canvas, { clientX: 90, clientY: 140, pointerId: 1 })
    })
    await waitFor(() => {
      expect(onTransform).toHaveBeenCalledWith(
        [
          {
            itemId: 'video-1',
            frame: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
          }
        ],
        { commit: false },
        'frame'
      )
    })

    await act(async () => {
      pointerUp(canvas, { clientX: 90, clientY: 140, pointerId: 1 })
    })
    await waitFor(() => {
      expect(onTransform).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ itemId: 'video-1' })
        ]),
        { commit: true },
        'frame'
      )
    })
  })

  it('keeps the selection active after releasing and dragging until the background is clicked', async () => {
    render(
      <LayoutCanvas
        layout={baseLayout}
        onTransform={vi.fn()}
        onRequestBringForward={vi.fn()}
        onRequestSendBackward={vi.fn()}
        onRequestDuplicate={vi.fn()}
        onRequestDelete={vi.fn()}
        showGrid
        showSafeMargins={false}
        previewContent={<div>preview</div>}
        transformTarget="frame"
      />
    )

    const canvas = screen.getByRole('presentation')

    await act(async () => {
      pointerDown(canvas, { clientX: 60, clientY: 100, pointerId: 11 })
      pointerUp(canvas, { clientX: 60, clientY: 100, pointerId: 11 })
    })

    await waitFor(() => {
      expect(within(canvas).getByRole('group', { name: /primary/i }).className).toContain('ring-2')
      const outline = within(canvas).getByTestId('selection-outline')
      expect(outline).toBeTruthy()
    })

    await act(async () => {
      pointerDown(canvas, { clientX: 60, clientY: 100, pointerId: 12 })
      pointerMove(canvas, { clientX: 90, clientY: 140, pointerId: 12 })
      pointerUp(canvas, { clientX: 90, clientY: 140, pointerId: 12 })
    })

    await waitFor(() => {
      expect(within(canvas).getByRole('group', { name: /primary/i }).className).toContain('ring-2')
      const outline = within(canvas).getByTestId('selection-outline')
      expect(outline).toBeTruthy()
    })

    await act(async () => {
      pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 13 })
      pointerUp(canvas, { clientX: 10, clientY: 10, pointerId: 13 })
    })

    await waitFor(() => {
      expect(within(canvas).getByRole('group', { name: /primary/i }).className).not.toContain('ring-2')
      expect(within(canvas).queryByTestId('selection-outline')).toBeNull()
    })
  })

  it('keeps the frame selected after resizing from a handle', async () => {
    render(
      <LayoutCanvas
        layout={baseLayout}
        onTransform={vi.fn()}
        onRequestBringForward={vi.fn()}
        onRequestSendBackward={vi.fn()}
        onRequestDuplicate={vi.fn()}
        onRequestDelete={vi.fn()}
        showGrid
        showSafeMargins={false}
        previewContent={<div>preview</div>}
        transformTarget="frame"
      />
    )

    const canvas = screen.getByRole('presentation')
    await selectItemByName(canvas, /Primary/i, { pointerId: 30 })

    const item = within(canvas).getByRole('group', { name: /Primary/i })
    const handle = within(item).getByLabelText('Resize south-east')

    await act(async () => {
      pointerDown(handle, { pointerId: 31, clientX: 160, clientY: 320 })
      pointerMove(canvas, { pointerId: 31, clientX: 190, clientY: 360 })
    })

    await act(async () => {
      pointerUp(canvas, { pointerId: 31, clientX: 190, clientY: 360 })
    })

    await waitFor(() => {
      const updated = within(canvas).getByRole('group', { name: /Primary/i })
      expect(updated.className).toContain('ring-2')
      const outline = within(canvas).getByTestId('selection-outline')
      expect(outline.className).toContain('border-[4px]')
      expect(outline.className).toContain('rounded-none')
      const handles = within(updated).getAllByRole('button', { name: /Resize/i })
      handles.forEach((button) => {
        expect(button.className).toContain('opacity-100')
        expect(button.className).toContain('rounded-none')
      })
    })
  })

  it('renders the previews with square edges and a handle gutter', () => {
    render(
      <LayoutCanvas
        layout={baseLayout}
        onTransform={vi.fn()}
        onRequestBringForward={vi.fn()}
        onRequestSendBackward={vi.fn()}
        onRequestDuplicate={vi.fn()}
        onRequestDelete={vi.fn()}
        showGrid={false}
        showSafeMargins={false}
        previewContent={<div>preview</div>}
        transformTarget="frame"
      />
    )

    const canvas = screen.getByRole('presentation')
    const wrapper = canvas.parentElement as HTMLElement | null
    expect(wrapper).not.toBeNull()
    if (!wrapper) {
      throw new Error('Canvas wrapper missing')
    }
    expect(wrapper.className).toContain('rounded-none')
    expect(wrapper.className).toContain('p-3')
    expect(wrapper.className).toContain('overflow-visible')
    expect(wrapper.className).not.toContain('rounded-2xl')
  })

  it('cycles through overlapping frames when clicking the same location repeatedly', async () => {
    const overlappingLayout: LayoutDefinition = {
      ...baseLayout,
      items: [
        {
          ...(baseLayout.items[0] as LayoutVideoItem),
          id: 'bottom-frame',
          name: 'Bottom frame',
          frame: { x: 0.25, y: 0.2, width: 0.5, height: 0.5 },
          zIndex: 1
        },
        {
          ...(baseLayout.items[0] as LayoutVideoItem),
          id: 'top-frame',
          name: 'Top frame',
          frame: { x: 0.3, y: 0.25, width: 0.5, height: 0.5 },
          zIndex: 5
        }
      ]
    }

    render(
      <LayoutCanvas
        layout={overlappingLayout}
        onTransform={vi.fn()}
        onRequestBringForward={vi.fn()}
        onRequestSendBackward={vi.fn()}
        onRequestDuplicate={vi.fn()}
        onRequestDelete={vi.fn()}
        showGrid={false}
        showSafeMargins={false}
        previewContent={<div>preview</div>}
        transformTarget="frame"
      />
    )

    const canvas = screen.getByRole('presentation')

    await act(async () => {
      pointerDown(canvas, { clientX: 120, clientY: 160, pointerId: 21 })
      pointerUp(canvas, { clientX: 120, clientY: 160, pointerId: 21 })
    })

    await waitFor(() => {
      expect(within(canvas).getByRole('group', { name: /Top frame/i }).className).toContain('ring-2')
      expect(within(canvas).getByRole('group', { name: /Top frame/i }).className).toContain('rounded-none')
      expect(within(canvas).getByTestId('selection-outline').className).toContain('border-[4px]')
      const topHandles = within(
        within(canvas).getByRole('group', { name: /Top frame/i })
      ).getAllByRole('button', { name: /Resize/i })
      topHandles.forEach((handle) => {
        expect(handle.className).toContain('rounded-none')
        expect(handle.className).toContain('h-4')
        expect(handle.className).toContain('w-4')
        expect(handle.className).toContain('opacity-100')
      })
    })

    await act(async () => {
      pointerDown(canvas, { clientX: 120, clientY: 160, pointerId: 22 })
      pointerUp(canvas, { clientX: 120, clientY: 160, pointerId: 22 })
    })

    await waitFor(() => {
      expect(within(canvas).getByRole('group', { name: /Bottom frame/i }).className).toContain('ring-2')
      expect(within(canvas).getByTestId('selection-outline').className).toContain('border-[4px]')
      const bottomHandles = within(
        within(canvas).getByRole('group', { name: /Bottom frame/i })
      ).getAllByRole('button', { name: /Resize/i })
      bottomHandles.forEach((handle) => {
        expect(handle.className).toContain('rounded-none')
        expect(handle.className).toContain('h-4')
        expect(handle.className).toContain('w-4')
        expect(handle.className).toContain('opacity-100')
      })
    })

    await act(async () => {
      pointerDown(canvas, { clientX: 120, clientY: 160, pointerId: 23 })
      pointerUp(canvas, { clientX: 120, clientY: 160, pointerId: 23 })
    })

    await waitFor(() => {
      expect(within(canvas).getByRole('group', { name: /Top frame/i }).className).toContain('ring-2')
      expect(within(canvas).getByTestId('selection-outline').className).toContain('border-[4px]')
      const topHandles = within(
        within(canvas).getByRole('group', { name: /Top frame/i })
      ).getAllByRole('button', { name: /Resize/i })
      topHandles.forEach((handle) => {
        expect(handle.className).toContain('rounded-none')
        expect(handle.className).toContain('h-4')
        expect(handle.className).toContain('w-4')
        expect(handle.className).toContain('opacity-100')
      })
    })
  })

  it('mirrors selection across both previews', async () => {
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={{ ...sampleClip, id: 'clip-mirror' }}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const sourceCanvas = await screen.findByLabelText('Source preview canvas')
    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    if (!layoutCanvas) {
      throw new Error('Layout preview canvas not found')
    }
    await within(sourceCanvas).findByLabelText('Source video preview')
    await selectItemByName(sourceCanvas, /Primary/i, { pointerId: 1 })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      const sourceOutline = within(sourceCanvas).getByTestId('selection-outline')
      const layoutOutline = within(layoutCanvas).getByTestId('selection-outline')
      expect(sourceOutline).toBeTruthy()
      expect(layoutOutline).toBeTruthy()
    })

    const layoutItem = within(layoutCanvas).getByRole('group', { name: /Primary/i })
    const resizeHandle = within(layoutItem).getByLabelText('Resize south-east')
    await act(async () => {
      pointerDown(resizeHandle, { pointerId: 2, clientX: 120, clientY: 220 })
      pointerMove(layoutCanvas, { pointerId: 2, clientX: 150, clientY: 250 })
    })
    await act(async () => {
      pointerUp(layoutCanvas, { pointerId: 2, clientX: 150, clientY: 250 })
    })

    await waitFor(() => {
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      const layoutOutline = within(layoutCanvas).getByTestId('selection-outline')
      const sourceOutline = within(sourceCanvas).getByTestId('selection-outline')
      expect(layoutOutline).toBeTruthy()
      expect(sourceOutline).toBeTruthy()
    })
  })

  it('clears the selection when clicking on the canvas background', async () => {
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={sampleClip}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const sourceCanvasElements = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = findInteractiveCanvas(sourceCanvasElements)
    const layoutCanvasElements = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvasElements)
    await selectItemByName(sourceCanvas, /Primary/i, { pointerId: 11 })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
    })

    await act(async () => {
      pointerDown(sourceCanvas, { pointerId: 12, clientX: 4, clientY: 4 })
    })
    await act(async () => {
      pointerUp(sourceCanvas, { pointerId: 12, clientX: 4, clientY: 4 })
    })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).not.toContain('ring-2')
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).not.toContain('ring-2')
    })
  })

  it('keeps both previews aligned with the canvas aspect ratio', async () => {
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={sampleClip}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const sourceCanvases = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = sourceCanvases[sourceCanvases.length - 1] as HTMLDivElement
    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = layoutCanvases[layoutCanvases.length - 1] as HTMLDivElement

    const readStyleValue = (element: HTMLDivElement | null | undefined, key: 'width' | 'height'): string => {
      if (!element) {
        return ''
      }
      const value = element.style[key as keyof CSSStyleDeclaration]
      if (value && value !== '0') {
        return value
      }
      if (element.parentElement) {
        return readStyleValue(element.parentElement as HTMLDivElement, key)
      }
      return ''
    }

    const readRatio = (element: HTMLDivElement): number => {
      const width = Number.parseFloat(readStyleValue(element, 'width') || '0')
      const height = Number.parseFloat(readStyleValue(element, 'height') || '0')
      if (width <= 0 || height <= 0) {
        return 0
      }
      return width / height
    }

    await waitFor(() => {
      expect(readRatio(sourceCanvas)).toBeGreaterThan(0)
      expect(readRatio(layoutCanvas)).toBeGreaterThan(0)
    })

    const initialRatio = baseLayout.canvas.width / baseLayout.canvas.height
    const fallbackSourceRatio = 16 / 9
    expect(readRatio(sourceCanvas)).toBeCloseTo(fallbackSourceRatio, 3)
    expect(readRatio(layoutCanvas)).toBeCloseTo(initialRatio, 3)

    const widthInput = screen.getByLabelText('Canvas width (px)') as HTMLInputElement
    const heightInput = screen.getByLabelText('Canvas height (px)') as HTMLInputElement

    await act(async () => {
      fireEvent.change(widthInput, { target: { value: '1920' } })
      fireEvent.change(heightInput, { target: { value: '1080' } })
    })

    await waitFor(() => {
      const updatedRatio = 1920 / 1080
      expect(readRatio(layoutCanvas)).toBeCloseTo(updatedRatio, 3)
      expect(readRatio(sourceCanvas)).toBeCloseTo(fallbackSourceRatio, 3)
    })
  })

  it('aligns the source crop with the frame aspect ratio when locked', async () => {
    let latestLayout: LayoutDefinition | null = null
    const onLayoutChange = vi.fn((layout: LayoutDefinition) => {
      latestLayout = layout
    })

    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={sampleClip}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const sourceCanvases = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = sourceCanvases[sourceCanvases.length - 1]
    const sourceItemInitial = within(sourceCanvas).getByRole('group', { name: /Primary/i })
    await selectItemByName(sourceCanvas, /Primary/i, { pointerId: 7 })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
    })

    const sourceItem = within(sourceCanvas).getByRole('group', { name: /Primary/i })
    const handle = within(sourceItem).getByLabelText('Resize south-east')
    await act(async () => {
      pointerDown(handle, { pointerId: 8, clientX: 120, clientY: 260 })
      pointerMove(sourceCanvas, { pointerId: 8, clientX: 150, clientY: 300 })
    })
    await act(async () => {
      pointerUp(sourceCanvas, { pointerId: 8, clientX: 150, clientY: 300 })
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
    })

    const changeCountBeforeSnap = onLayoutChange.mock.calls.length

    const capturedLayout = latestLayout ?? (onLayoutChange.mock.calls.at(-1)?.[0] as LayoutDefinition | undefined)
    expect(capturedLayout).toBeTruthy()
    const updatedVideo = capturedLayout?.items.find((item) => item.id === 'video-1') as LayoutVideoItem | undefined
    expect(updatedVideo).toBeTruthy()
    const crop = updatedVideo?.crop
    expect(crop).toBeTruthy()
    const cropRatio = crop && crop.height ? crop.width / crop.height : null
    const frameRatio = updatedVideo ? updatedVideo.frame.width / updatedVideo.frame.height : null
    expect(cropRatio).not.toBeNull()
    expect(frameRatio).not.toBeNull()
    if (cropRatio != null && frameRatio != null) {
      expect(cropRatio).toBeCloseTo(frameRatio, 3)
    }
  })

  it('does not render frame aspect lock controls on the layout canvas', async () => {
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    await selectItemByName(layoutCanvas, /primary/i, { pointerId: 1 })

    expect(
      within(layoutCanvas).queryByRole('button', {
        name: 'Unlock frame aspect (freeform)'
      })
    ).toBeNull()
    expect(
      within(layoutCanvas).queryByRole('button', {
        name: 'Lock frame aspect (preserve ratio)'
      })
    ).toBeNull()
  })

  it('does not render crop aspect lock controls on the source canvas', async () => {
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const sourceCanvases = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = findInteractiveCanvas(sourceCanvases)
    if (!sourceCanvas) {
      throw new Error('Source preview canvas not found')
    }
    await selectItemByName(sourceCanvas, /primary/i, { pointerId: 4 })

    expect(
      within(sourceCanvas).queryByRole('button', {
        name: 'Unlock crop aspect (freeform)'
      })
    ).toBeNull()
    expect(
      within(sourceCanvas).queryByRole('button', {
        name: 'Lock crop aspect (preserve ratio)'
      })
    ).toBeNull()
  })

  it('snaps frame bounds to the source aspect ratio on demand', async () => {
    let latestLayout: LayoutDefinition | null = null
    const onLayoutChange = vi.fn((next: LayoutDefinition) => {
      latestLayout = next
    })

    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    const videoItem = await selectItemByName(layoutCanvas, /primary/i, {
      pointerId: 22,
      clientX: 60,
      clientY: 80
    })

    const frameLockedButtons = await within(layoutCanvas).findAllByRole('button', {
      name: 'Unlock frame aspect (freeform)'
    })
    const frameLockedButton = frameLockedButtons[frameLockedButtons.length - 1]

    await act(async () => {
      fireEvent.click(frameLockedButton)
    })

    await waitFor(() => {
      const updatedVideo = latestLayout?.items.find((item) => item.id === 'video-1') as LayoutVideoItem | undefined
      expect(updatedVideo?.lockAspectRatio).toBe(false)
    })

    const eastHandle = within(videoItem).getByLabelText('Resize east')
    await act(async () => {
      pointerDown(eastHandle, { pointerId: 23, clientX: 220, clientY: 140 })
      pointerMove(layoutCanvas, { pointerId: 23, clientX: 160, clientY: 140 })
    })
    await act(async () => {
      pointerUp(layoutCanvas, { pointerId: 23, clientX: 160, clientY: 140 })
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
    })

    const changeCountBeforeSnap = onLayoutChange.mock.calls.length

    const distortedVideo = latestLayout?.items.find((item) => item.id === 'video-1') as LayoutVideoItem | undefined
    expect(distortedVideo).toBeTruthy()
    const distortedRatio = distortedVideo
      ? distortedVideo.frame.width / Math.max(distortedVideo.frame.height, 0.0001)
      : null
    expect(distortedRatio).not.toBeNull()
    if (distortedRatio != null) {
      expect(distortedRatio).toBeLessThan(16 / 9)
    }

    const distortedWidth = distortedVideo?.frame.width ?? 0

    const resetButtons = await within(layoutCanvas).findAllByRole('button', {
      name: 'Match source frame aspect'
    })
    const resetButton = resetButtons[resetButtons.length - 1]

    await act(async () => {
      fireEvent.click(resetButton)
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalledTimes(changeCountBeforeSnap + 1)
    })

    const snappedVideo = latestLayout?.items.find((item) => item.id === 'video-1') as LayoutVideoItem | undefined
    expect(snappedVideo).toBeTruthy()
    if (snappedVideo) {
      expect(snappedVideo.frame.width).toBeCloseTo(distortedWidth, 3)
      const snappedRatio = snappedVideo.frame.width / Math.max(snappedVideo.frame.height, 0.0001)
      expect(snappedRatio).not.toBeCloseTo(distortedRatio ?? snappedRatio, 3)
      const crop = snappedVideo.crop
      expect(crop).toBeTruthy()
      if (crop) {
        expect(crop).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
        const cropRatio = crop.width / Math.max(crop.height, 0.0001)
        const expectedFrameRatio = (16 / 9) * cropRatio
        expect(snappedRatio).toBeCloseTo(expectedFrameRatio, 3)
        if (snappedVideo.cropAspectRatio != null) {
          expect(snappedVideo.cropAspectRatio).toBeCloseTo(cropRatio, 3)
        }
      }
    }
  })

  it('resets the source preview to the native aspect and full-frame crop', async () => {
    let latestLayout: LayoutDefinition | null = null
    const onLayoutChange = vi.fn((next: LayoutDefinition) => {
      latestLayout = next
    })

    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    const layoutItem = await selectItemByName(layoutCanvas, /primary/i, {
      pointerId: 40,
      clientX: 60,
      clientY: 80
    })

    const unlockButtons = await within(layoutCanvas).findAllByRole('button', {
      name: 'Unlock frame aspect (freeform)'
    })
    await act(async () => {
      fireEvent.click(unlockButtons[unlockButtons.length - 1])
    })

    const eastHandle = within(layoutItem).getByLabelText('Resize east')
    await act(async () => {
      pointerDown(eastHandle, { pointerId: 41, clientX: 220, clientY: 140 })
      pointerMove(layoutCanvas, { pointerId: 41, clientX: 160, clientY: 140 })
    })
    await act(async () => {
      pointerUp(layoutCanvas, { pointerId: 41, clientX: 160, clientY: 140 })
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
    })

    const sourceCanvases = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = sourceCanvases[sourceCanvases.length - 1]
    const initialChangeCount = onLayoutChange.mock.calls.length
    await selectItemByName(sourceCanvas, /primary/i, { pointerId: 42 })
    expect(onLayoutChange).toHaveBeenCalledTimes(initialChangeCount)

    const sourceGroup = within(sourceCanvas).getByRole('group', { name: /primary/i })
    const cropHandle = within(sourceGroup).getByLabelText('Resize east')
    await act(async () => {
      pointerDown(cropHandle, { pointerId: 43, clientX: 200, clientY: 180 })
      pointerMove(sourceCanvas, { pointerId: 43, clientX: 150, clientY: 200 })
    })
    await act(async () => {
      pointerUp(sourceCanvas, { pointerId: 43, clientX: 150, clientY: 200 })
    })

    await waitFor(() => {
      expect(onLayoutChange.mock.calls.length).toBeGreaterThan(initialChangeCount)
    })

    const changeCountBeforeReset = onLayoutChange.mock.calls.length
    const distortedVideo = latestLayout?.items.find((item) => item.id === 'video-1') as
      | LayoutVideoItem
      | undefined
    expect(distortedVideo).toBeTruthy()
    if (distortedVideo) {
      expect(distortedVideo.sourceCrop).toBeTruthy()
      const cropWidth = distortedVideo.sourceCrop?.width ?? 0
      expect(cropWidth).toBeLessThan(1)
    }

    const distortedWidth = distortedVideo?.frame.width ?? 0

    const resetButtons = await within(sourceCanvas).findAllByRole('button', {
      name: 'Reset to video aspect'
    })
    await act(async () => {
      fireEvent.click(resetButtons[resetButtons.length - 1])
    })

    await waitFor(() => {
      expect(onLayoutChange.mock.calls.length).toBeGreaterThan(changeCountBeforeReset)
    })

    const resetVideo = latestLayout?.items.find((item) => item.id === 'video-1') as
      | LayoutVideoItem
      | undefined
    expect(resetVideo).toBeTruthy()
    if (resetVideo) {
      expect(resetVideo.frame.width).toBeCloseTo(distortedWidth, 3)
      const frameRatio = resetVideo.frame.width / Math.max(resetVideo.frame.height, 0.0001)
      expect(frameRatio).toBeCloseTo(16 / 9, 3)
      const expectedCrop = { x: 0, y: 0, width: 1, height: 1 }
      expect(resetVideo.sourceCrop ?? expectedCrop).toMatchObject(expectedCrop)
      expect(resetVideo.crop).toMatchObject(expectedCrop)
      if (resetVideo.cropAspectRatio != null) {
        expect(resetVideo.cropAspectRatio).toBeCloseTo(1, 3)
      }
    }

    const interactionsBeforeFollowUp = onLayoutChange.mock.calls.length
    const resetSourceGroup = within(sourceCanvas).getByRole('group', { name: /primary/i })
    const resetHandle = within(resetSourceGroup).getByLabelText('Resize east')
    await act(async () => {
      pointerDown(resetHandle, { pointerId: 44, clientX: 200, clientY: 200 })
      pointerMove(sourceCanvas, { pointerId: 44, clientX: 150, clientY: 200 })
    })
    await act(async () => {
      pointerUp(sourceCanvas, { pointerId: 44, clientX: 150, clientY: 200 })
    })

    await waitFor(() => {
      expect(onLayoutChange.mock.calls.length).toBeGreaterThan(interactionsBeforeFollowUp)
    })

    const afterFollowUp = latestLayout?.items.find((item) => item.id === 'video-1') as
      | LayoutVideoItem
      | undefined
    expect(afterFollowUp).toBeTruthy()
    if (afterFollowUp) {
      const sourceCrop = afterFollowUp.sourceCrop ?? { x: 0, y: 0, width: 1, height: 1 }
      const cropRatio = sourceCrop.width / Math.max(sourceCrop.height, 0.0001)
      expect(cropRatio).toBeCloseTo(1, 3)
      const frameRatio = afterFollowUp.frame.width / Math.max(afterFollowUp.frame.height, 0.0001)
      expect(frameRatio).toBeCloseTo(16 / 9, 3)
    }
  })

  it('switches the layout canvas between frame and crop editing modes', async () => {
    let latestLayout: LayoutDefinition | null = baseLayout
    const onLayoutChange = vi.fn((next: LayoutDefinition) => {
      latestLayout = next
    })

    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={sampleClip}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    const videoItem = await selectItemByName(layoutCanvas, /primary/i, {
      pointerId: 31,
      clientX: 60,
      clientY: 80
    })

    const cropButton = await within(layoutCanvas).findByRole('button', {
      name: 'Crop video'
    })

    await act(async () => {
      fireEvent.click(cropButton)
    })

    await waitFor(() => {
      expect(
        within(layoutCanvas).getByRole('button', {
          name: 'Finish crop'
        })
      ).toBeInTheDocument()
    })

    expect(within(videoItem).getByText('Crop')).toBeInTheDocument()

    const cropHandle = within(videoItem).getByLabelText('Resize east')
    expect(cropHandle.className).toContain('rotate-45')

    const callsBeforeDrag = onLayoutChange.mock.calls.length
    const initialVideo = (latestLayout?.items.find((item) => item.id === 'video-1') ?? null) as
      | LayoutVideoItem
      | null
    const initialCrop = initialVideo?.crop ?? { x: 0, y: 0, width: 1, height: 1 }

    await act(async () => {
      pointerDown(cropHandle, { pointerId: 201, clientX: 160, clientY: 160 })
      pointerMove(layoutCanvas, { pointerId: 201, clientX: 120, clientY: 160 })
    })
    await act(async () => {
      pointerUp(layoutCanvas, { pointerId: 201, clientX: 120, clientY: 160 })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(onLayoutChange).toHaveBeenCalledTimes(callsBeforeDrag)
    const pendingVideo = (latestLayout?.items.find((item) => item.id === 'video-1') ?? null) as
      | LayoutVideoItem
      | null
    expect(pendingVideo?.crop).toMatchObject(initialCrop)

    const finishCropButton = await within(layoutCanvas).findByRole('button', {
      name: 'Finish crop'
    })

    await act(async () => {
      fireEvent.click(finishCropButton)
    })

    await waitFor(() => {
      expect(
        within(layoutCanvas).getByRole('button', { name: 'Crop video' })
      ).toBeInTheDocument()
    })

    expect(within(videoItem).queryByText('Crop')).toBeNull()

    const frameHandle = within(videoItem).getByLabelText('Resize north')
    expect(frameHandle.className).not.toContain('rotate-45')

    const committedVideo = (latestLayout?.items.find((item) => item.id === 'video-1') ?? null) as
      | LayoutVideoItem
      | null
    expect(committedVideo?.crop?.width).not.toBeCloseTo(initialCrop.width)
  })

  it('keeps the selection active while interacting with toolbar actions', async () => {
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    const videoItem = within(layoutCanvas).getByRole('group', { name: /primary/i })

    await selectItemByName(layoutCanvas, /primary/i, { pointerId: 51 })

    await waitFor(() => {
      expect(within(layoutCanvas).getByRole('group', { name: /primary/i }).className).toContain('ring-2')
    })

    const toggleButtons = within(layoutCanvas).getAllByRole('button', { name: /frame aspect/i })
    const toggleButton = toggleButtons[toggleButtons.length - 1]

    await act(async () => {
      fireEvent.click(toggleButton)
    })

    await waitFor(() => {
      expect(within(layoutCanvas).getByRole('group', { name: /primary/i }).className).toContain('ring-2')
    })

    const bringForwardButton = within(layoutCanvas).getByRole('button', { name: 'Bring forward' })
    await act(async () => {
      fireEvent.click(bringForwardButton)
    })

    await waitFor(() => {
      expect(within(layoutCanvas).getByRole('group', { name: /primary/i }).className).toContain('ring-2')
    })
  })

  it('mirrors the selection toolbar across canvases', async () => {
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const sourceCanvases = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = sourceCanvases[sourceCanvases.length - 1]
    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)

    const sourceVideo = within(sourceCanvas).getByRole('group', { name: /primary/i })
    await selectItemByName(sourceCanvas, /primary/i, { pointerId: 61 })

    await waitFor(() => {
      const layoutVideo = within(layoutCanvas).getByRole('group', { name: /primary/i })
      expect(layoutVideo.className).toContain('ring-2')
      expect(within(layoutCanvas).getByRole('button', { name: 'Bring forward' })).toBeTruthy()
    })

    const eastHandle = within(layoutCanvas).getByLabelText('Resize east')
    await act(async () => {
      pointerDown(eastHandle, { pointerId: 62, clientX: 196, clientY: 112 })
    })
    await act(async () => {
      pointerUp(layoutCanvas, { pointerId: 62, clientX: 196, clientY: 112 })
    })

    await waitFor(() => {
      const layoutVideo = within(layoutCanvas).getByRole('group', { name: /primary/i })
      expect(layoutVideo.className).toContain('ring-2')
    })
  })

  it('keeps the selection when the parent syncs the layout state', async () => {
    const LayoutHarness = () => {
      const [layout, setLayout] = useState<LayoutDefinition>(baseLayout)

      return (
        <LayoutEditorPanel
          tabNavigation={<div />}
          clip={null}
          layoutCollection={null}
          isCollectionLoading={false}
          selectedLayout={layout}
          selectedLayoutReference={{ id: layout.id, category: 'custom' }}
          isLayoutLoading={false}
          appliedLayoutId={null}
          isSavingLayout={false}
          isApplyingLayout={false}
          statusMessage={null}
          errorMessage={null}
          onSelectLayout={vi.fn()}
          onCreateBlankLayout={vi.fn()}
          onLayoutChange={setLayout}
          onSaveLayout={vi.fn(async () => layout)}
          onImportLayout={vi.fn(async () => undefined)}
          onExportLayout={vi.fn(async () => undefined)}
          onApplyLayout={vi.fn(async () => undefined)}
          onRenderLayout={vi.fn(async () => undefined)}
          renderSteps={pipelineSteps}
          isRenderingLayout={false}
          renderStatusMessage={null}
          renderErrorMessage={null}
        />
      )
    }

    render(<LayoutHarness />)

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    const videoItem = within(layoutCanvas).getByRole('group', { name: /primary/i })

    await selectItemByName(layoutCanvas, /primary/i, {
      pointerId: 101,
      release: false
    })
    await act(async () => {
      pointerMove(layoutCanvas, { pointerId: 101, clientX: 84, clientY: 136 })
    })
    await act(async () => {
      pointerUp(layoutCanvas, { pointerId: 101, clientX: 84, clientY: 136 })
    })

    await waitFor(() => {
      const layoutVideo = within(layoutCanvas).getByRole('group', { name: /primary/i })
      expect(layoutVideo.className).toContain('ring-2')
      const toolbarButton = within(layoutCanvas).getByRole('button', { name: 'Bring forward' })
      expect(toolbarButton).toBeInstanceOf(HTMLButtonElement)
    })
  })

  it('updates canvas properties via the inspector', async () => {
    let capturedLayout: LayoutDefinition | null = null
    const onLayoutChange = vi.fn((layout: LayoutDefinition) => {
      capturedLayout = layout
    })
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const widthInputs = await screen.findAllByLabelText(/Canvas width/i)
    const widthInput = widthInputs[widthInputs.length - 1]
    await act(async () => {
      fireEvent.change(widthInput, { target: { value: '720' } })
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
      const latest = onLayoutChange.mock.calls.at(-1)?.[0] as LayoutDefinition | undefined
      expect(latest?.canvas.width).toBe(720)
    })
  })

  it('keeps the source and layout previews in sync while playing', async () => {
    const onLayoutChange = vi.fn()
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={{
          id: 'clip-sync',
          title: 'Sync clip',
          channel: 'Channel',
          views: null,
          createdAt: new Date().toISOString(),
          durationSec: 90,
          sourceDurationSeconds: 120,
          thumbnail: null,
          playbackUrl: 'playback.mp4',
          previewUrl: 'preview.mp4',
          description: '',
          sourceUrl: 'source.mp4',
          sourceTitle: '',
          sourcePublishedAt: null,
          videoId: 'video-sync',
          videoTitle: 'Video',
          rating: null,
          quote: null,
          reason: null,
          timestampUrl: null,
          timestampSeconds: null,
          accountId: null,
          startSeconds: 0,
          endSeconds: 45,
          originalStartSeconds: 0,
          originalEndSeconds: 45,
          hasAdjustments: false,
          layoutId: null
        }}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const [sourceVideo] = (await screen.findAllByLabelText('Source video preview')) as HTMLVideoElement[]
    const [layoutVideo] = (await screen.findAllByLabelText('Layout preview video')) as HTMLVideoElement[]

    Object.defineProperty(sourceVideo, 'duration', { value: 120, configurable: true })
    const layoutPlay = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(layoutVideo, 'play', {
      value: layoutPlay,
      configurable: true
    })
    Object.defineProperty(sourceVideo, 'currentTime', { value: 5, writable: true, configurable: true })
    Object.defineProperty(layoutVideo, 'currentTime', { value: 0, writable: true, configurable: true })

    fireEvent.loadedMetadata(sourceVideo)
    fireEvent.loadedMetadata(layoutVideo)
    fireEvent.play(sourceVideo)

    await waitFor(() => {
      expect(layoutPlay).toHaveBeenCalled()
    })
    expect(layoutVideo.currentTime).toBe(5)
  })

  it('collapses layout sections inside the horizontal picker', async () => {
    const onSelectLayout = vi.fn()
    const layoutCollection = {
      builtin: [
        {
          id: 'builtin-1',
          name: 'Built-in layout',
          description: 'Default view',
          author: null,
          tags: [],
          category: 'builtin' as const,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      custom: [
        {
          id: 'custom-1',
          name: 'My layout',
          description: null,
          author: null,
          tags: [],
          category: 'custom' as const,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }

    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={layoutCollection}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={onSelectLayout}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={vi.fn()}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const builtInToggle = (await screen.findAllByRole('button', { name: /Built-in/i })).find(
      (button) => button.getAttribute('aria-controls') === 'layout-section-builtin'
    )
    if (!builtInToggle) {
      throw new Error('Built-in toggle not found')
    }
    expect(builtInToggle.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('Built-in layout')).not.toBeNull()

    fireEvent.click(builtInToggle)
    await screen.findByText(/layouts hidden/i)
    expect(builtInToggle.getAttribute('aria-expanded')).toBe('false')

    const customToggle = (await screen.findAllByRole('button', { name: /Custom/i })).find(
      (button) => button.getAttribute('aria-controls') === 'layout-section-custom'
    )
    if (!customToggle) {
      throw new Error('Custom toggle not found')
    }
    fireEvent.click(customToggle)
    await screen.findAllByText(/layouts hidden/i)
  })

  it('applies transforms when dragging items on the layout preview', async () => {
    let capturedLayout: LayoutDefinition | null = null
    const onLayoutChange = vi.fn((layout: LayoutDefinition) => {
      capturedLayout = layout
    })
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={{
          id: 'clip-drag',
          title: 'Drag clip',
          channel: 'Channel',
          views: null,
          createdAt: new Date().toISOString(),
          durationSec: 120,
          sourceDurationSeconds: 180,
          thumbnail: null,
          playbackUrl: 'playback.mp4',
          previewUrl: 'preview.mp4',
          description: '',
          sourceUrl: 'source.mp4',
          sourceTitle: '',
          sourcePublishedAt: null,
          videoId: 'video-drag',
          videoTitle: 'Video',
          rating: null,
          quote: null,
          reason: null,
          timestampUrl: null,
          timestampSeconds: null,
          accountId: null,
          startSeconds: 0,
          endSeconds: 60,
          originalStartSeconds: 0,
          originalEndSeconds: 60,
          hasAdjustments: false,
          layoutId: null
        }}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = layoutCanvases[layoutCanvases.length - 1]
    if (!layoutCanvas) {
      throw new Error('Layout preview canvas not found')
    }

    const sourceCanvases = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = sourceCanvases[sourceCanvases.length - 1]
    if (!sourceCanvas) {
      throw new Error('Source preview canvas not found')
    }

    const layoutItem = within(layoutCanvas).getByRole('group', { name: /Primary/i })
    const sourceItem = within(sourceCanvas).getByRole('group', { name: /Primary/i })
    const originalLayoutStyle = layoutItem.getAttribute('style') ?? ''
    const originalSourceStyle = sourceItem.getAttribute('style') ?? ''

    const selectedItem = await selectItemByName(layoutCanvas, /primary/i, {
      pointerId: 1,
      release: false
    })

    await act(async () => {
      pointerMove(layoutCanvas, { pointerId: 1, clientX: 70, clientY: 120 })
    })

    await act(async () => {
      pointerUp(layoutCanvas, { pointerId: 1, clientX: 70, clientY: 120 })
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
      expect(capturedLayout).not.toBeNull()
    })

    if (!capturedLayout) {
      throw new Error('Layout did not update')
    }
    const updatedFrame = capturedLayout.items[0].frame
    if (!Number.isFinite(updatedFrame.x) || !Number.isFinite(updatedFrame.y)) {
      throw new Error(`Updated frame invalid: ${JSON.stringify(updatedFrame)}`)
    }
    expect(updatedFrame.x).toBeGreaterThan(baseLayout.items[0].frame.x)

    await waitFor(() => {
      const updatedLayoutItem = within(layoutCanvas).getByRole('group', { name: /Primary/i })
      expect(updatedLayoutItem.getAttribute('style')).not.toEqual(originalLayoutStyle)
    })
  })

  it('saves and applies the layout from the toolbar', async () => {
    const onSaveLayout = vi.fn(async () => baseLayout)
    const onApplyLayout = vi.fn(async () => undefined)
    const onLayoutChange = vi.fn()
    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={{
          id: 'clip-1',
          title: 'Test clip',
          channel: 'Channel',
          views: null,
          createdAt: new Date().toISOString(),
          durationSec: 120,
          sourceDurationSeconds: 120,
          thumbnail: null,
          playbackUrl: 'video.mp4',
          previewUrl: 'video.mp4',
          description: '',
          sourceUrl: 'source.mp4',
          sourceTitle: '',
          sourcePublishedAt: null,
          videoId: 'video',
          videoTitle: 'Video',
          rating: null,
          quote: null,
          reason: null,
          timestampUrl: null,
          timestampSeconds: null,
          accountId: null,
          startSeconds: 0,
          endSeconds: 60,
          originalStartSeconds: 0,
          originalEndSeconds: 60,
          hasAdjustments: false,
          layoutId: null
        }}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={onSaveLayout}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={onApplyLayout}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    await screen.findAllByDisplayValue(/Test layout/i)
    const widthInput = (await screen.findAllByLabelText(/Canvas width/i))[0]
    fireEvent.change(widthInput, { target: { value: '720' } })
    await screen.findAllByDisplayValue('720')
    const saveButtons = await screen.findAllByRole('button', { name: /Save layout/i })
    const primarySaveButton = saveButtons[saveButtons.length - 1]
    await act(async () => {
      fireEvent.click(primarySaveButton)
    })
    await waitFor(() => expect(onSaveLayout).toHaveBeenCalledTimes(1))

    const applyButtons = await screen.findAllByRole('button', { name: /Apply to clip/i })
    const primaryApplyButton = applyButtons[applyButtons.length - 1]
    await act(async () => {
      fireEvent.click(primaryApplyButton)
    })
    await waitFor(() => expect(onApplyLayout).toHaveBeenCalledTimes(1))
  })

  it('toggles between auto crop and stretch using the layout context menu', async () => {
    let latestLayout: LayoutDefinition | null = null
    const onLayoutChange = vi.fn((next: LayoutDefinition) => {
      latestLayout = next
    })

    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={null}
        layoutCollection={null}
        isCollectionLoading={false}
        selectedLayout={baseLayout}
        selectedLayoutReference={{ id: 'layout-1', category: 'custom' }}
        isLayoutLoading={false}
        appliedLayoutId={null}
        isSavingLayout={false}
        isApplyingLayout={false}
        statusMessage={null}
        errorMessage={null}
        onSelectLayout={vi.fn()}
        onCreateBlankLayout={vi.fn()}
        onLayoutChange={onLayoutChange}
        onSaveLayout={vi.fn(async () => baseLayout)}
        onImportLayout={vi.fn(async () => undefined)}
        onExportLayout={vi.fn(async () => undefined)}
        onApplyLayout={vi.fn(async () => undefined)}
        onRenderLayout={vi.fn(async () => undefined)}
        renderSteps={pipelineSteps}
        isRenderingLayout={false}
        renderStatusMessage={null}
        renderErrorMessage={null}
      />
    )

    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = findInteractiveCanvas(layoutCanvases)
    const videoItem = await selectItemByName(layoutCanvas, /primary/i, {
      pointerId: 71,
      clientX: 80,
      clientY: 100
    })

    await act(async () => {
      fireEvent.contextMenu(videoItem)
    })

    const stretchOption = await screen.findByRole('button', { name: /stretch to frame/i })

    await act(async () => {
      fireEvent.click(stretchOption)
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
      const updatedVideo = latestLayout?.items.find((item) => item.id === 'video-1') as LayoutVideoItem | undefined
      expect(updatedVideo?.scaleMode).toBe('fill')
      expect(updatedVideo?.crop).toMatchObject({ width: 1, height: 1 })
    })

    const refreshedItem = await selectItemByName(layoutCanvas, /primary/i, {
      pointerId: 72,
      clientX: 90,
      clientY: 120
    })

    await act(async () => {
      fireEvent.contextMenu(refreshedItem)
    })

    const autoOption = await screen.findByRole('button', { name: /auto crop to fill/i })

    await act(async () => {
      fireEvent.click(autoOption)
    })

    await waitFor(() => {
      const updatedVideo = latestLayout?.items.find((item) => item.id === 'video-1') as LayoutVideoItem | undefined
      expect(updatedVideo?.scaleMode).toBe('cover')
      expect(updatedVideo?.crop?.width ?? 1).toBeLessThan(0.9)
      expect(updatedVideo?.crop?.height ?? 0).toBeGreaterThan(0.9)
    })
  })
})
