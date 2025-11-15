import { describe, expect, it } from 'vitest'
import type { Display, Rectangle } from 'electron'

import { __testing } from '../windowState'

const createDisplay = (area: Rectangle): Display =>
  ({
    workArea: area,
    bounds: area
  } as unknown as Display)

describe('sanitizeBounds', () => {
  const { sanitizeBounds } = __testing

  it('returns sanitized bounds when the rectangle intersects a display', () => {
    const displays = [createDisplay({ x: 0, y: 0, width: 1920, height: 1080 })]

    const result = sanitizeBounds(
      { x: 10.4, y: 20.6, width: 800.2, height: 600.8 },
      displays
    )

    expect(result).toEqual({ x: 10, y: 21, width: 800, height: 601 })
  })

  it('returns null when the bounds do not intersect any display', () => {
    const displays = [createDisplay({ x: 0, y: 0, width: 1280, height: 720 })]

    const result = sanitizeBounds({ x: 5000, y: 5000, width: 800, height: 600 }, displays)

    expect(result).toBeNull()
  })

  it('returns null when dimensions are invalid', () => {
    const displays = [createDisplay({ x: 0, y: 0, width: 800, height: 600 })]

    const result = sanitizeBounds({ x: 10, y: 10, width: 0, height: 0 }, displays)

    expect(result).toBeNull()
  })
})
