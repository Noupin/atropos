import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, beforeAll, vi, it, expect } from 'vitest'
import type { LayoutDefinition } from '../../../types/layouts'
import LayoutCanvas from '../components/layout/LayoutCanvas'
import LayoutEditorPanel from '../components/layout/LayoutEditorPanel'

type Selection = Parameters<typeof LayoutCanvas>[0]['selectedItemIds']

describe('Layout editor interactions', () => {
  beforeAll(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
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
        { commit: false }
      )
    })

    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 120, pointerId: 1 })
    await waitFor(() => {
      expect(onTransform).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ itemId: 'video-1' })
        ]),
        { commit: true }
      )
    })
  })

  it('updates canvas properties via the inspector', async () => {
    const onLayoutChange = vi.fn()
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
      />
    )

    const widthInputs = await screen.findAllByLabelText(/Canvas width/i)
    const widthInput = widthInputs[0]
    fireEvent.change(widthInput, { target: { value: '720' } })

    await waitFor(() => {
      expect(onLayoutChange).toHaveBeenCalled()
    })
    const lastCall = onLayoutChange.mock.calls.at(-1)
    expect(lastCall?.[0].canvas.width).toBe(720)
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
          sourceUrl: '',
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
