import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { resolvePlayableSourceUrl } from '../lib/media'

const originalWindow = globalThis.window

describe('resolvePlayableSourceUrl', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          hostname: 'localhost',
          origin: 'http://localhost:3000'
        }
      },
      configurable: true
    })
  })

  afterAll(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', { value: originalWindow })
    } else {
      // @ts-expect-error - clean up injected window for other tests
      delete globalThis.window
    }
  })

  it('returns empty for null or blank inputs', () => {
    expect(resolvePlayableSourceUrl(null)).toEqual({ status: 'empty', src: null })
    expect(resolvePlayableSourceUrl('   ')).toEqual({ status: 'empty', src: null })
  })

  it('accepts existing file and blob URLs', () => {
    expect(resolvePlayableSourceUrl('file:///Users/me/video.mp4')).toEqual({
      status: 'ok',
      src: 'file:///Users/me/video.mp4'
    })
    expect(resolvePlayableSourceUrl('blob:abcdef')).toEqual({ status: 'ok', src: 'blob:abcdef' })
  })

  it('normalises local absolute paths into file URLs', () => {
    expect(resolvePlayableSourceUrl('/Users/me/video clip.mp4')).toEqual({
      status: 'ok',
      src: 'file:///Users/me/video%20clip.mp4'
    })
    expect(resolvePlayableSourceUrl('C:/Videos/My Clip.mp4')).toEqual({
      status: 'ok',
      src: 'file:///C:/Videos/My%20Clip.mp4'
    })
    expect(resolvePlayableSourceUrl('\\\\server\\share\\clip.mp4')).toEqual({
      status: 'ok',
      src: 'file:////server/share/clip.mp4'
    })
  })

  it('accepts local HTTP URLs and blocks remote hosts', () => {
    expect(resolvePlayableSourceUrl('http://127.0.0.1:9000/source.mp4')).toEqual({
      status: 'ok',
      src: 'http://127.0.0.1:9000/source.mp4'
    })

    const remote = resolvePlayableSourceUrl('https://www.youtube.com/watch?v=123')
    expect(remote.status).toBe('remote-blocked')
    expect(remote.src).toBeNull()
    expect(remote).toHaveProperty('hostname', 'www.youtube.com')
  })

  it('returns invalid for unsupported inputs', () => {
    expect(resolvePlayableSourceUrl('relative/path.mp4')).toEqual({ status: 'invalid', src: null })
  })
})

