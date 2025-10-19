import type { LayoutCategory, LayoutDefinition } from '../../../types/layouts'
import type { LayoutCollection } from '../../../types/api'

const ensureApi = (): RendererApi => {
  if (typeof window === 'undefined' || !window.api) {
    throw new Error('Layout operations are unavailable outside the desktop environment.')
  }
  return window.api
}

type RendererApi = import('../../../types/api').RendererApi

export const fetchLayoutCollection = async (): Promise<LayoutCollection> => {
  const api = ensureApi()
  return api.listLayouts()
}

export const loadLayoutDefinition = async (
  id: string,
  category?: LayoutCategory | null
): Promise<LayoutDefinition> => {
  const api = ensureApi()
  return api.loadLayout({ id, category: category ?? null })
}

export const saveLayoutDefinition = async (options: {
  layout: LayoutDefinition
  originalId?: string | null
  originalCategory?: LayoutCategory | null
}): Promise<LayoutDefinition> => {
  const api = ensureApi()
  return api.saveLayout({
    layout: options.layout,
    originalId: options.originalId ?? null,
    originalCategory: options.originalCategory ?? null
  })
}

export const importLayoutDefinition = async (): Promise<LayoutDefinition | null> => {
  const api = ensureApi()
  return api.importLayout()
}

export const exportLayoutDefinition = async (
  id: string,
  category: LayoutCategory
): Promise<boolean> => {
  const api = ensureApi()
  return api.exportLayout({ id, category })
}
