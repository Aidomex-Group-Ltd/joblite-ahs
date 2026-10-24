import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeInternalPath } from '../src/client/components/AuthExperience'

describe('safe internal authentication destinations', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves valid local paths with query and fragment', () => {
    vi.stubGlobal('window', { location: { origin: 'https://joblite.test' } })
    expect(safeInternalPath('/jobs?q=engineer#results')).toBe('/jobs?q=engineer#results')
  })

  it.each([
    '//outside.test/path',
    'https://outside.test/path',
    '/\\outside.test/path',
    '/%2F%2Foutside.test/path',
    '/%5c%5coutside.test/path',
    '/bad%escape',
  ])('rejects unsafe or malformed return destination %s', (destination) => {
    vi.stubGlobal('window', { location: { origin: 'https://joblite.test' } })
    expect(safeInternalPath(destination)).toBe('/')
  })
})
