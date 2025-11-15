import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutCollection } from '../../../types/api'
import type { LayoutDefinition } from '../../../types/layouts'
import {
  deleteLayoutDefinition,
  exportLayoutDefinition,
  fetchLayoutCollection,
  importLayoutDefinition,
  loadLayoutDefinition,
  saveLayoutDefinition
} from '../services/layouts'

declare global {
  interface Window {
    api?: import('../../../types/api').RendererApi
    electron?: { ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }
  }
}

const createLayout = (overrides: Partial<LayoutDefinition> = {}): LayoutDefinition => ({
  id: 'test-layout',
  name: 'Test layout',
  description: null,
  author: 'tester',
  category: 'custom',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: [],
  canvas: {
    width: 1080,
    height: 1920,
    background: { kind: 'blur', radius: 45, opacity: 0.6, brightness: 0.55 }
  },
  captionArea: null,
  items: [],
  ...overrides
})

describe('layout services', () => {
  const apiMock = {
    listLayouts: vi.fn<[], Promise<LayoutCollection>>(),
    loadLayout: vi.fn<[{ id: string; category: 'builtin' | 'custom' | null }], Promise<LayoutDefinition>>(),
    saveLayout: vi.fn<[{
      layout: LayoutDefinition
      originalId: string | null
      originalCategory: 'builtin' | 'custom' | null
    }], Promise<LayoutDefinition>>(),
    importLayout: vi.fn<[], Promise<LayoutDefinition | null>>(),
    exportLayout: vi.fn<[{ id: string; category: 'builtin' | 'custom' }], Promise<boolean>>(),
    deleteLayout: vi.fn<[{ id: string; category: 'builtin' | 'custom' }], Promise<boolean>>()
  }

  beforeEach(() => {
    window.api = apiMock as unknown as typeof window.api
    apiMock.listLayouts.mockReset()
    apiMock.loadLayout.mockReset()
    apiMock.saveLayout.mockReset()
    apiMock.importLayout.mockReset()
    apiMock.exportLayout.mockReset()
    apiMock.deleteLayout.mockReset()
  })

  afterEach(() => {
    delete window.api
    delete window.electron
  })

  it('fetches the layout collection through the bridge', async () => {
    const collection: LayoutCollection = {
      builtin: [
        {
          id: 'centered',
          name: 'Centered',
          description: null,
          author: 'Atropos',
          category: 'builtin',
          version: 1,
          tags: []
        }
      ],
      custom: []
    }
    apiMock.listLayouts.mockResolvedValueOnce(collection)

    const result = await fetchLayoutCollection()
    expect(apiMock.listLayouts).toHaveBeenCalledTimes(1)
    expect(result).toEqual(collection)
  })

  it('loads a layout definition by identifier', async () => {
    const layout = createLayout({ id: 'centered', category: 'builtin' })
    apiMock.loadLayout.mockResolvedValueOnce(layout)

    const result = await loadLayoutDefinition('centered', 'builtin')
    expect(apiMock.loadLayout).toHaveBeenCalledWith({ id: 'centered', category: 'builtin' })
    expect(result).toEqual(layout)
  })

  it('saves a layout and forwards original identifiers', async () => {
    const layout = createLayout()
    apiMock.saveLayout.mockResolvedValueOnce(layout)

    const result = await saveLayoutDefinition({
      layout,
      originalId: 'previous-layout',
      originalCategory: 'custom'
    })

    expect(apiMock.saveLayout).toHaveBeenCalledWith({
      layout,
      originalId: 'previous-layout',
      originalCategory: 'custom'
    })
    expect(result).toEqual(layout)
  })

  it('imports a layout through the bridge', async () => {
    const layout = createLayout({ id: 'imported' })
    apiMock.importLayout.mockResolvedValueOnce(layout)

    const result = await importLayoutDefinition()
    expect(apiMock.importLayout).toHaveBeenCalledTimes(1)
    expect(result).toEqual(layout)
  })

  it('exports a layout definition by id and category', async () => {
    apiMock.exportLayout.mockResolvedValueOnce(true)

    const result = await exportLayoutDefinition('custom-layout', 'custom')
    expect(apiMock.exportLayout).toHaveBeenCalledWith({ id: 'custom-layout', category: 'custom' })
    expect(result).toBe(true)
  })

  it('deletes a layout definition by id and category', async () => {
    apiMock.deleteLayout.mockResolvedValueOnce(true)

    const result = await deleteLayoutDefinition('custom-layout', 'custom')
    expect(apiMock.deleteLayout).toHaveBeenCalledWith({ id: 'custom-layout', category: 'custom' })
    expect(result).toBe(true)
  })

  it('falls back to invoking the delete channel directly if the bridge helper is missing', async () => {
    const invoke = vi.fn().mockResolvedValue(true)
    window.electron = {
      ipcRenderer: { invoke }
    } as unknown as typeof window.electron

    const originalDelete = apiMock.deleteLayout
    ;(apiMock as unknown as { deleteLayout?: undefined }).deleteLayout = undefined

    const result = await deleteLayoutDefinition('custom-layout', 'custom')

    expect(invoke).toHaveBeenCalledWith('layouts:delete', { id: 'custom-layout', category: 'custom' })
    expect(result).toBe(true)

    apiMock.deleteLayout = originalDelete
  })
})
