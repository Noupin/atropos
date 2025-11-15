import type {
  LayoutCategory,
  LayoutDefinition,
  LayoutSummary
} from './layouts'
import type {
  BuildTrimmedPreviewRequest,
  BuildTrimmedPreviewResponse,
  ResolveProjectSourceRequest,
  ResolveProjectSourceResponse
} from './preview'

type Clip = import('../renderer/src/types').Clip

export type LayoutCollection = Record<LayoutCategory, LayoutSummary[]>

export interface RendererApi {
  listAccountClips: (accountId: string | null) => Promise<Clip[]>
  openAccountClipsFolder: (accountId: string) => Promise<boolean>
  openVideoFile: () => Promise<string | null>
  resolveProjectSource: (request: ResolveProjectSourceRequest) => Promise<ResolveProjectSourceResponse>
  buildTrimmedPreview: (request: BuildTrimmedPreviewRequest) => Promise<BuildTrimmedPreviewResponse>
  releaseMediaToken: (token: string) => Promise<void>
  onNavigationCommand: (callback: (direction: 'back' | 'forward') => void) => () => void
  onDeepLink: (callback: (url: string) => void) => () => void
  updateNavigationState: (state: { canGoBack: boolean; canGoForward: boolean }) => void
  listLayouts: () => Promise<LayoutCollection>
  loadLayout: (request: { id: string; category?: LayoutCategory | null }) => Promise<LayoutDefinition>
  saveLayout: (request: {
    layout: LayoutDefinition
    originalId?: string | null
    originalCategory?: LayoutCategory | null
  }) => Promise<LayoutDefinition>
  importLayout: () => Promise<LayoutDefinition | null>
  exportLayout: (request: { id: string; category: LayoutCategory }) => Promise<boolean>
  deleteLayout: (request: { id: string; category: LayoutCategory }) => Promise<boolean>
}
