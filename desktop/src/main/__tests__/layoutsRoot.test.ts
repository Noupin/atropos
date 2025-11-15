import { describe, expect, it } from 'vitest'
import { resolve } from 'path'

import { __testing } from '../layouts'

describe('resolveLayoutsSibling', () => {
  const { resolveLayoutsSibling } = __testing

  const existsFactory = (existing: Set<string>) => (candidate: string): boolean =>
    existing.has(resolve(candidate))

  it('prefers an existing layouts directory even if the pipeline output directory is missing', () => {
    const outRoot = '/tmp/project/out'
    const layoutDir = resolve('/tmp/project/layouts')
    const exists = existsFactory(new Set([layoutDir]))

    const result = resolveLayoutsSibling(outRoot, { pathExists: exists })

    expect(result).toBe(layoutDir)
  })

  it('falls back to the derived sibling when the output directory exists', () => {
    const outRoot = resolve('/tmp/project/out')
    const layoutDir = resolve('/tmp/project/layouts')
    const exists = existsFactory(new Set([outRoot]))

    const result = resolveLayoutsSibling(outRoot, { pathExists: exists })

    expect(result).toBe(layoutDir)
  })

  it('returns null when neither directory exists', () => {
    const outRoot = resolve('/tmp/project/out')
    const exists = existsFactory(new Set<string>())

    const result = resolveLayoutsSibling(outRoot, { pathExists: exists })

    expect(result).toBeNull()
  })
})
