import { describe, expect, it } from 'vitest'
import { parseClipTimestamp } from '../lib/clipMetadata'

describe('parseClipTimestamp', () => {
  it('extracts timestamp url and seconds from a description', () => {
    const description = `Full video: https://www.youtube.com/watch?v=abc123&t=125s\nCredit: Creator\n`
    const result = parseClipTimestamp(description)
    expect(result.timestampUrl).toBe('https://www.youtube.com/watch?v=abc123&t=125s')
    expect(result.timestampSeconds).toBe(125)
  })

  it('supports minute and second notation', () => {
    const description = 'Full video: https://youtu.be/example?t=1m30s\nMade by Atropos'
    const result = parseClipTimestamp(description)
    expect(result.timestampUrl).toBe('https://youtu.be/example?t=1m30s')
    expect(result.timestampSeconds).toBe(90)
  })

  it('returns null metadata when no timestamp link is present', () => {
    const description = 'Watch the full video on our channel!'
    const result = parseClipTimestamp(description)
    expect(result.timestampUrl).toBeNull()
    expect(result.timestampSeconds).toBeNull()
  })
})
