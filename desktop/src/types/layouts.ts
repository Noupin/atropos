export type LayoutCategory = 'builtin' | 'custom'

export type LayoutFrame = {
  x: number
  y: number
  width: number
  height: number
}

export type LayoutCrop = {
  x: number
  y: number
  width: number
  height: number
  units?: 'fraction' | 'pixels'
}

export type LayoutBackground =
  | ({ kind: 'blur' } & {
      radius?: number
      opacity?: number
      brightness?: number
      saturation?: number
    })
  | ({ kind: 'color' } & {
      color: string
      opacity?: number
    })
  | ({ kind: 'image' } & {
      source: string
      mode?: 'cover' | 'contain'
      tint?: string | null
    })

export type LayoutCaptionArea = {
  x: number
  y: number
  width: number
  height: number
  align?: 'left' | 'center' | 'right'
  maxLines?: number | null
  wrapWidth?: number | null
}

export type LayoutCanvas = {
  width: number
  height: number
  background: LayoutBackground
}

export type LayoutVideoItem = {
  id: string
  kind: 'video'
  source?: 'primary'
  name?: string | null
  frame: LayoutFrame
  crop?: LayoutCrop | null
  sourceCrop?: LayoutCrop | null
  scaleMode?: 'cover' | 'contain' | 'fill'
  rotation?: number | null
  opacity?: number | null
  mirror?: boolean
  lockAspectRatio?: boolean | null
  lockCropAspectRatio?: boolean | null
  frameAspectRatio?: number | null
  cropAspectRatio?: number | null
  zIndex?: number
}

export type LayoutTextItem = {
  id: string
  kind: 'text'
  content: string
  frame: LayoutFrame
  align?: 'left' | 'center' | 'right'
  color?: string | null
  fontFamily?: string | null
  fontSize?: number | null
  fontWeight?: 'normal' | 'bold' | null
  letterSpacing?: number | null
  lineHeight?: number | null
  uppercase?: boolean
  opacity?: number | null
  zIndex?: number
}

export type LayoutShapeItem = {
  id: string
  kind: 'shape'
  frame: LayoutFrame
  color?: string
  borderRadius?: number
  opacity?: number
  zIndex?: number
}

export type LayoutItem = LayoutVideoItem | LayoutTextItem | LayoutShapeItem

export type LayoutSummary = {
  id: string
  name: string
  description?: string | null
  author?: string | null
  tags?: string[]
  category: LayoutCategory
  version: number
  createdAt?: string | null
  updatedAt?: string | null
}

export type LayoutDefinition = LayoutSummary & {
  canvas: LayoutCanvas
  captionArea?: LayoutCaptionArea | null
  items: LayoutItem[]
}
