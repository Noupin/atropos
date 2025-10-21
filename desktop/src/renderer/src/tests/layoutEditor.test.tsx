import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

type Selection = Parameters<typeof LayoutCanvas>[0]['selectedItemIds']

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

  it('selects and moves an item on the canvas', async () => {
    const onTransform = vi.fn()
    const onSelectionChange = vi.fn<(selection: Selection) => void>()
    render(
      <LayoutCanvas
        layout={baseLayout}
        selectedItemIds={[]}
        onSelectionChange={onSelectionChange}
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
    const item = screen.getByRole('group', { name: /primary/i })

    fireEvent.pointerDown(item, { clientX: 20, clientY: 20, pointerId: 1 })
    expect(onSelectionChange).toHaveBeenCalledWith(['video-1'])

    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 120, pointerId: 1 })
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

    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 120, pointerId: 1 })
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

  it('mirrors selection across both previews', async () => {
    const clip = {
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
    }

    render(
      <LayoutEditorPanel
        tabNavigation={<div />}
        clip={clip}
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
    const layoutCanvas = layoutCanvases[layoutCanvases.length - 1]
    if (!layoutCanvas) {
      throw new Error('Layout preview canvas not found')
    }
    const sourceItem = within(sourceCanvas).getByRole('group', { name: /Primary/i })
    fireEvent.pointerDown(sourceItem, { pointerId: 1, clientX: 20, clientY: 20 })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
    })

    const layoutItem = within(layoutCanvas).getByRole('group', { name: /Primary/i })
    const resizeHandle = within(layoutItem).getByLabelText('Resize south-east')
    fireEvent.pointerDown(resizeHandle, { pointerId: 2, clientX: 120, clientY: 220 })
    fireEvent.pointerMove(layoutCanvas, { pointerId: 2, clientX: 150, clientY: 250 })
    fireEvent.pointerUp(layoutCanvas, { pointerId: 2, clientX: 150, clientY: 250 })

    await waitFor(() => {
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
    })
  })

  it('clears the selection when clicking on the canvas background', async () => {
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

    const sourceCanvasElements = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = sourceCanvasElements[sourceCanvasElements.length - 1]
    const layoutCanvasElements = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = layoutCanvasElements[layoutCanvasElements.length - 1]
    const sourceItem = within(sourceCanvas).getByRole('group', { name: /Primary/i })

    fireEvent.pointerDown(sourceItem, { pointerId: 11, clientX: 32, clientY: 48 })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
    })

    fireEvent.pointerUp(sourceCanvas, { pointerId: 11, clientX: 32, clientY: 48 })

    fireEvent.pointerDown(sourceCanvas, { pointerId: 12, clientX: 4, clientY: 4 })
    fireEvent.pointerUp(sourceCanvas, { pointerId: 12, clientX: 4, clientY: 4 })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).not.toContain('ring-2')
      expect(within(layoutCanvas).getByRole('group', { name: /Primary/i }).className).not.toContain('ring-2')
    })
  })

  it('keeps both previews aligned with the canvas aspect ratio', async () => {
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
    const sourceCanvas = sourceCanvases[sourceCanvases.length - 1] as HTMLDivElement
    const layoutCanvases = await screen.findAllByLabelText('Layout preview canvas')
    const layoutCanvas = layoutCanvases[layoutCanvases.length - 1] as HTMLDivElement

    const readRatio = (element: HTMLDivElement): number => {
      const width = Number.parseFloat(element.style.width || '0')
      const height = Number.parseFloat(element.style.height || '0')
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
    expect(readRatio(sourceCanvas)).toBeCloseTo(initialRatio, 3)
    expect(readRatio(layoutCanvas)).toBeCloseTo(initialRatio, 3)

    const widthInput = screen.getByLabelText('Canvas width (px)') as HTMLInputElement
    const heightInput = screen.getByLabelText('Canvas height (px)') as HTMLInputElement

    await act(async () => {
      fireEvent.change(widthInput, { target: { value: '1920' } })
      fireEvent.change(heightInput, { target: { value: '1080' } })
    })

    await waitFor(() => {
      const updatedRatio = 1920 / 1080
      expect(readRatio(sourceCanvas)).toBeCloseTo(updatedRatio, 3)
      expect(readRatio(layoutCanvas)).toBeCloseTo(updatedRatio, 3)
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

    const sourceCanvases = await screen.findAllByLabelText('Source preview canvas')
    const sourceCanvas = sourceCanvases[sourceCanvases.length - 1]
    const sourceItemInitial = within(sourceCanvas).getByRole('group', { name: /Primary/i })
    fireEvent.pointerDown(sourceItemInitial, { pointerId: 7, clientX: 24, clientY: 32 })

    await waitFor(() => {
      expect(within(sourceCanvas).getByRole('group', { name: /Primary/i }).className).toContain('ring-2')
    })

    const sourceItem = within(sourceCanvas).getByRole('group', { name: /Primary/i })
    const handle = within(sourceItem).getByLabelText('Resize south-east')
    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 120, clientY: 260 })
    fireEvent.pointerMove(sourceCanvas, { pointerId: 8, clientX: 150, clientY: 300 })
    fireEvent.pointerUp(sourceCanvas, { pointerId: 8, clientX: 150, clientY: 300 })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
    })

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

  it('lets editors toggle the aspect ratio lock on video items', async () => {
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
    const layoutCanvas = layoutCanvases[layoutCanvases.length - 1]
    const videoItem = within(layoutCanvas).getByRole('group', { name: /primary/i })
    fireEvent.pointerDown(videoItem, { pointerId: 1, clientX: 10, clientY: 10 })

    const aspectToggles = await screen.findAllByLabelText('Lock video frame aspect ratio')
    const aspectToggle = aspectToggles[aspectToggles.length - 1]
    expect((aspectToggle as HTMLInputElement).checked).toBe(true)

    await act(async () => {
      fireEvent.click(aspectToggle)
    })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
      const updatedVideo = latestLayout?.items.find((item) => item.id === 'video-1') as LayoutVideoItem | undefined
      expect(updatedVideo?.lockAspectRatio).toBe(false)
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

    await act(async () => {
      layoutItem.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 20, clientY: 20, buttons: 1 })
      )
    })

    await act(async () => {
      layoutCanvas.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 70, clientY: 120, buttons: 1 })
      )
    })

    await act(async () => {
      layoutCanvas.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 70, clientY: 120 })
      )
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
})
