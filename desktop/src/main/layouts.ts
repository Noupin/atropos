import { app, dialog } from 'electron'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import { basename, join, resolve } from 'path'
import type {
  LayoutCategory,
  LayoutDefinition,
  LayoutFrame,
  LayoutItem,
  LayoutSummary,
  LayoutBackground,
  LayoutCanvas,
  LayoutCaptionArea
} from '../types/layouts'

type LayoutCollection = Record<LayoutCategory, LayoutSummary[]>

type SaveLayoutOptions = {
  originalId?: string | null
  originalCategory?: LayoutCategory | null
}

type InternalLayoutDefinition = LayoutDefinition & {
  category: LayoutCategory
  filePath: string
}

let layoutsRoot: string | null = null

const BUILTIN_DIR = 'builtin'
const CUSTOM_DIR = 'custom'

const slugify = (value: string): string => {
  const normalised = value.trim().toLowerCase()
  const slug = normalised.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `layout-${Date.now().toString(36)}`
}

const parseString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

const parseNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

const parseFrame = (payload: unknown, fallback?: LayoutFrame): LayoutFrame => {
  if (!payload || typeof payload !== 'object') {
    return fallback ?? { x: 0, y: 0, width: 1, height: 1 }
  }
  const record = payload as Record<string, unknown>
  return {
    x: Math.max(0, Math.min(1, parseNumber(record.x, fallback?.x ?? 0))),
    y: Math.max(0, Math.min(1, parseNumber(record.y, fallback?.y ?? 0))),
    width: Math.max(0, Math.min(1, parseNumber(record.width, fallback?.width ?? 1))),
    height: Math.max(0, Math.min(1, parseNumber(record.height, fallback?.height ?? 1)))
  }
}

const parseBackground = (payload: unknown): LayoutBackground => {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'blur', radius: 45, opacity: 0.6, brightness: 0.55 }
  }
  const record = payload as Record<string, unknown>
  const kind = typeof record.kind === 'string' ? record.kind : 'blur'
  if (kind === 'color') {
    const color = parseString(record.color) ?? '#000000'
    const opacity = record.opacity != null ? parseNumber(record.opacity, 1) : undefined
    return { kind: 'color', color, opacity }
  }
  if (kind === 'image') {
    const source = parseString(record.source) ?? ''
    const mode = typeof record.mode === 'string' ? (record.mode === 'contain' ? 'contain' : 'cover') : undefined
    const tint = parseString(record.tint)
    return { kind: 'image', source, mode, tint }
  }
  return {
    kind: 'blur',
    radius: record.radius != null ? Math.max(0, Math.round(parseNumber(record.radius, 45))) : 45,
    opacity: record.opacity != null ? Math.max(0, Math.min(1, parseNumber(record.opacity, 0.6))) : 0.6,
    brightness: record.brightness != null ? Math.max(0, Math.min(1, parseNumber(record.brightness, 0.55))) : 0.55,
    saturation: record.saturation != null ? Math.max(0, parseNumber(record.saturation, 1)) : undefined
  }
}

const parseCanvas = (payload: unknown): LayoutCanvas => {
  if (!payload || typeof payload !== 'object') {
    return {
      width: 1080,
      height: 1920,
      background: { kind: 'blur', radius: 45, opacity: 0.6, brightness: 0.55 }
    }
  }
  const record = payload as Record<string, unknown>
  return {
    width: Math.max(1, Math.round(parseNumber(record.width, 1080))),
    height: Math.max(1, Math.round(parseNumber(record.height, 1920))),
    background: parseBackground(record.background)
  }
}

const parseCaptionArea = (payload: unknown): LayoutCaptionArea | null => {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as Record<string, unknown>
  const frame = parseFrame(record, { x: 0, y: 0.75, width: 1, height: 0.2 })
  const align =
    record.align === 'left' || record.align === 'right' || record.align === 'center'
      ? record.align
      : 'center'
  const maxLinesValue = record.maxLines ?? record.max_lines
  const wrapWidthValue = record.wrapWidth ?? record.wrap_width
  const maxLines =
    maxLinesValue != null && Number.isFinite(parseNumber(maxLinesValue))
      ? Math.max(1, Math.round(parseNumber(maxLinesValue)))
      : null
  const wrapWidth =
    wrapWidthValue != null && Number.isFinite(parseNumber(wrapWidthValue))
      ? Math.max(0, parseNumber(wrapWidthValue))
      : null
  return {
    ...frame,
    align,
    maxLines,
    wrapWidth
  }
}

const parseTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

const parseLayoutItem = (payload: unknown, fallbackId: string): LayoutItem | null => {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as Record<string, unknown>
  const kind = typeof record.kind === 'string' ? record.kind : 'video'
  const id = parseString(record.id) ?? fallbackId
  const frame = parseFrame(record.frame)
  const zIndex = record.zIndex ?? record.z_index
  const parsedZIndex = Number.isFinite(parseNumber(zIndex)) ? Math.round(parseNumber(zIndex)) : 0

  if (kind === 'text') {
    const content = parseString(record.content) ?? 'Text'
    return {
      id,
      kind: 'text',
      content,
      frame,
      align:
        record.align === 'left' || record.align === 'right' || record.align === 'center'
          ? record.align
          : 'center',
      color: parseString(record.color),
      fontFamily: parseString(record.fontFamily ?? record.font_family),
      fontSize: record.fontSize ?? record.font_size ? parseNumber(record.fontSize ?? record.font_size) : null,
      fontWeight: record.fontWeight === 'bold' ? 'bold' : record.fontWeight === 'normal' ? 'normal' : null,
      letterSpacing:
        record.letterSpacing ?? record.letter_spacing ? parseNumber(record.letterSpacing ?? record.letter_spacing) : null,
      lineHeight: record.lineHeight ?? record.line_height ? parseNumber(record.lineHeight ?? record.line_height) : null,
      uppercase: Boolean(record.uppercase),
      opacity: record.opacity != null ? parseNumber(record.opacity) : null,
      zIndex: parsedZIndex
    }
  }

  if (kind === 'shape') {
    return {
      id,
      kind: 'shape',
      frame,
      color: parseString(record.color) ?? '#000000',
      borderRadius: record.borderRadius ?? record.border_radius ? parseNumber(record.borderRadius ?? record.border_radius) : 0,
      opacity: record.opacity != null ? parseNumber(record.opacity, 1) : 1,
      zIndex: parsedZIndex
    }
  }

  const crop = record.crop && typeof record.crop === 'object' ? record.crop : null
  return {
    id,
    kind: 'video',
    source: 'primary',
    name: parseString(record.name),
    frame,
    crop: crop
      ? {
          x: parseNumber((crop as Record<string, unknown>).x, 0),
          y: parseNumber((crop as Record<string, unknown>).y, 0),
          width: parseNumber((crop as Record<string, unknown>).width, 1),
          height: parseNumber((crop as Record<string, unknown>).height, 1),
          units:
            (crop as Record<string, unknown>).units === 'pixels'
              ? 'pixels'
              : 'fraction'
        }
      : null,
    scaleMode:
      record.scaleMode === 'contain' || record.scaleMode === 'fill'
        ? record.scaleMode
        : record.scale_mode === 'contain' || record.scale_mode === 'fill'
        ? (record.scale_mode as 'contain' | 'fill')
        : 'cover',
    rotation: record.rotation != null ? parseNumber(record.rotation) : null,
    opacity: record.opacity != null ? parseNumber(record.opacity) : null,
    mirror: Boolean(record.mirror),
    zIndex: parsedZIndex
  }
}

const parseIsoDate = (value: unknown): string | null => {
  const candidate = parseString(value)
  if (!candidate) {
    return null
  }
  const date = new Date(candidate)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString()
}

const parseLayoutDefinition = async (
  filePath: string,
  category: LayoutCategory
): Promise<InternalLayoutDefinition | null> => {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const payload = JSON.parse(raw) as Record<string, unknown>
    const id = parseString(payload.id) ?? basename(filePath, '.json')
    const name = parseString(payload.name) ?? id
    const version = Math.max(1, Math.round(parseNumber(payload.version, 1)))
    const canvas = parseCanvas(payload.canvas)
    const captionArea = parseCaptionArea(payload.captionArea ?? payload.caption_area)
    const rawItems = Array.isArray(payload.items) ? payload.items : []
    const items: LayoutItem[] = []
    rawItems.forEach((item, index) => {
      const parsed = parseLayoutItem(item, `${id}-item-${index + 1}`)
      if (parsed) {
        items.push(parsed)
      }
    })

    return {
      id,
      name,
      version,
      description: parseString(payload.description),
      author: parseString(payload.author),
      tags: parseTags(payload.tags),
      category,
      createdAt: parseIsoDate(payload.createdAt ?? payload.created_at),
      updatedAt: parseIsoDate(payload.updatedAt ?? payload.updated_at),
      canvas,
      captionArea,
      items,
      filePath
    }
  } catch (error) {
    console.error('[layouts] failed to parse layout', filePath, error)
    return null
  }
}

const getLayoutsRoot = async (): Promise<string> => {
  if (layoutsRoot) {
    return layoutsRoot
  }
  await app.whenReady()
  const root = resolve(app.getPath('userData'), 'layouts')
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(join(root, BUILTIN_DIR), { recursive: true })
  await fs.mkdir(join(root, CUSTOM_DIR), { recursive: true })
  layoutsRoot = root
  process.env.ATROPOS_LAYOUTS_ROOT = root
  return root
}

const builtinCandidateDirs = (): string[] => {
  const candidates = new Set<string>()
  const appPath = app.getAppPath()
  const dirs = [
    join(__dirname, '../resources/layouts', BUILTIN_DIR),
    join(__dirname, '../../resources/layouts', BUILTIN_DIR),
    join(process.resourcesPath, 'layouts', BUILTIN_DIR),
    join(process.resourcesPath, 'app.asar.unpacked', 'layouts', BUILTIN_DIR),
    join(appPath, 'resources', 'layouts', BUILTIN_DIR),
    join(appPath, 'layouts', BUILTIN_DIR)
  ]
  dirs.forEach((candidate) => candidates.add(resolve(candidate)))
  return Array.from(candidates)
}

const resolveBuiltinSourceDir = (): string | null => {
  const candidates = builtinCandidateDirs()
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return candidate
      }
    } catch (error) {
      console.warn('[layouts] failed to inspect builtin candidate', candidate, error)
    }
  }
  return null
}

export const initialiseLayoutStorage = async (): Promise<void> => {
  const root = await getLayoutsRoot()
  const builtinSource = resolveBuiltinSourceDir()
  if (!builtinSource) {
    console.warn('[layouts] builtin layout source directory not found')
    return
  }
  const builtinTarget = join(root, BUILTIN_DIR)
  try {
    const entries = await fs.readdir(builtinSource)
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map(async (entry) => {
          const sourcePath = join(builtinSource, entry)
          const targetPath = join(builtinTarget, entry)
          try {
            const sourceContent = await fs.readFile(sourcePath)
            const shouldCopy = !existsSync(targetPath)
              ? true
              : (await fs.readFile(targetPath)).toString() !== sourceContent.toString()
            if (shouldCopy) {
              await fs.writeFile(targetPath, sourceContent)
            }
          } catch (error) {
            console.error('[layouts] failed to copy builtin layout', entry, error)
          }
        })
    )
  } catch (error) {
    console.error('[layouts] unable to synchronise builtin layouts', error)
  }
}

const layoutExists = async (id: string): Promise<boolean> => {
  const root = await getLayoutsRoot()
  const builtinPath = join(root, BUILTIN_DIR, `${id}.json`)
  const customPath = join(root, CUSTOM_DIR, `${id}.json`)
  return existsSync(builtinPath) || existsSync(customPath)
}

const ensureUniqueId = async (id: string): Promise<string> => {
  let candidate = slugify(id)
  let index = 1
  while (await layoutExists(candidate)) {
    candidate = `${slugify(id)}-${index}`
    index += 1
  }
  return candidate
}

const readLayoutsFromDir = async (
  dir: string,
  category: LayoutCategory
): Promise<InternalLayoutDefinition[]> => {
  try {
    const entries = await fs.readdir(dir)
    const layouts = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => parseLayoutDefinition(join(dir, entry), category))
    )
    return layouts.filter((layout): layout is InternalLayoutDefinition => Boolean(layout))
  } catch (error) {
    console.error('[layouts] failed to read directory', dir, error)
    return []
  }
}

const stripInternalFields = (layout: InternalLayoutDefinition): LayoutDefinition => {
  const { filePath: _filePath, ...rest } = layout
  return rest
}

export const listLayouts = async (): Promise<LayoutCollection> => {
  const root = await getLayoutsRoot()
  const [builtinLayouts, customLayouts] = await Promise.all([
    readLayoutsFromDir(join(root, BUILTIN_DIR), 'builtin'),
    readLayoutsFromDir(join(root, CUSTOM_DIR), 'custom')
  ])
  const toSummary = (layout: InternalLayoutDefinition): LayoutSummary => ({
    id: layout.id,
    name: layout.name,
    description: layout.description ?? null,
    author: layout.author ?? null,
    tags: layout.tags,
    category: layout.category,
    version: layout.version,
    createdAt: layout.createdAt ?? null,
    updatedAt: layout.updatedAt ?? null
  })
  return {
    builtin: builtinLayouts.map(toSummary),
    custom: customLayouts.map(toSummary)
  }
}

const findLayoutFile = async (
  id: string,
  preferredCategory?: LayoutCategory | null
): Promise<InternalLayoutDefinition | null> => {
  const root = await getLayoutsRoot()
  const candidates: Array<{ path: string; category: LayoutCategory }> = []
  if (preferredCategory) {
    candidates.push({ path: join(root, preferredCategory, `${id}.json`), category: preferredCategory })
  }
  if (!preferredCategory || preferredCategory === 'custom') {
    candidates.push({ path: join(root, CUSTOM_DIR, `${id}.json`), category: 'custom' })
  }
  if (!preferredCategory || preferredCategory === 'builtin') {
    candidates.push({ path: join(root, BUILTIN_DIR, `${id}.json`), category: 'builtin' })
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      continue
    }
    const parsed = await parseLayoutDefinition(candidate.path, candidate.category)
    if (parsed) {
      return parsed
    }
  }
  return null
}

export const loadLayoutDefinition = async (
  id: string,
  category?: LayoutCategory | null
): Promise<LayoutDefinition> => {
  const layout = await findLayoutFile(id, category)
  if (!layout) {
    throw new Error(`Layout '${id}' was not found.`)
  }
  return stripInternalFields(layout)
}

const serializeLayout = (layout: InternalLayoutDefinition): Record<string, unknown> => {
  const { category: _category, filePath: _filePath, ...rest } = layout
  const base: Record<string, unknown> = {
    id: rest.id,
    name: rest.name,
    version: rest.version,
    canvas: rest.canvas,
    items: rest.items
  }
  if (rest.description) {
    base.description = rest.description
  }
  if (rest.author) {
    base.author = rest.author
  }
  if (rest.tags && rest.tags.length > 0) {
    base.tags = rest.tags
  }
  if (rest.captionArea) {
    base.captionArea = rest.captionArea
  }
  if (rest.createdAt) {
    base.createdAt = rest.createdAt
  }
  if (rest.updatedAt) {
    base.updatedAt = rest.updatedAt
  }
  return base
}

export const saveCustomLayout = async (
  layout: LayoutDefinition,
  options?: SaveLayoutOptions
): Promise<LayoutDefinition> => {
  const root = await getLayoutsRoot()
  const customDir = join(root, CUSTOM_DIR)
  await fs.mkdir(customDir, { recursive: true })

  const requestedId = slugify(layout.id || layout.name)
  const originalId = options?.originalId ? slugify(options.originalId) : null
  const originalCategory = options?.originalCategory ?? null
  const editingExisting = originalId && originalCategory === 'custom' && originalId === requestedId
  const finalId = editingExisting ? requestedId : await ensureUniqueId(requestedId)
  const targetPath = join(customDir, `${finalId}.json`)

  let createdAt = layout.createdAt ?? null
  if (!createdAt && existsSync(targetPath)) {
    const existing = await parseLayoutDefinition(targetPath, 'custom')
    if (existing?.createdAt) {
      createdAt = existing.createdAt
    }
  }

  const isoNow = new Date().toISOString()
  const internal: InternalLayoutDefinition = {
    id: finalId,
    name: layout.name,
    version: Math.max(1, Math.round(layout.version ?? 1)),
    description: layout.description ?? null,
    author: layout.author ?? null,
    tags: Array.isArray(layout.tags) ? layout.tags : [],
    category: 'custom',
    createdAt: createdAt ?? isoNow,
    updatedAt: isoNow,
    canvas: layout.canvas,
    captionArea: layout.captionArea ?? null,
    items: layout.items,
    filePath: targetPath
  }

  await fs.writeFile(targetPath, JSON.stringify(serializeLayout(internal), null, 2), 'utf-8')
  return stripInternalFields(internal)
}

export const importLayoutFromDialog = async (): Promise<LayoutDefinition | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Layout JSON', extensions: ['json'] }]
  })
  if (canceled || filePaths.length === 0) {
    return null
  }
  const filePath = filePaths[0]
  const parsed = await parseLayoutDefinition(filePath, 'custom')
  if (!parsed) {
    throw new Error('The selected file is not a valid layout definition.')
  }
  return saveCustomLayout(stripInternalFields(parsed))
}

export const exportLayoutToDialog = async (
  id: string,
  category: LayoutCategory
): Promise<boolean> => {
  const layout = await findLayoutFile(id, category)
  if (!layout) {
    throw new Error(`Layout '${id}' was not found.`)
  }
  const { filePath } = layout
  const defaultPath = `${layout.name || layout.id}.json`
  const { canceled, filePath: destination } = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: 'Layout JSON', extensions: ['json'] }]
  })
  if (canceled || !destination) {
    return false
  }
  await fs.copyFile(filePath, destination)
  return true
}
