import { describe, expect, it } from 'vitest'
import { buildFfmpegArgs, sanitizeTrimWindow } from '../trimmedPreview'

describe('trimmedPreview helpers', () => {
  it('sanitises trim window ensuring a minimum duration', () => {
    const result = sanitizeTrimWindow(300, 299.2)
    expect(result.start).toBeCloseTo(300)
    expect(result.end).toBeGreaterThan(result.start)
    expect(result.duration).toBeGreaterThan(0)
  })

  it('builds ffmpeg arguments with faststart and reset timestamps', () => {
    const args = buildFfmpegArgs('input.mp4', 'out.mp4', 12.3456, 14.2)
    expect(args).toContain('-movflags')
    expect(args).toContain('+faststart')
    expect(args).toContain('-reset_timestamps')
    expect(args).toContain('1')
    expect(args[args.length - 1]).toBe('out.mp4')
  })

  describe('windows and macOS path handling', () => {
    it.each([
      ['darwin', '/Users/test/clip.mp4'],
      ['win32', 'C:/Projects/clip.mp4']
    ])('includes the input path for %s builds', (_platform, inputPath) => {
      const args = buildFfmpegArgs(inputPath, '/tmp/out.mp4', 0, 10)
      expect(args).toContain(inputPath)
    })
  })
})
