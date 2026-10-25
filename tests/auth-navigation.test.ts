import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/client/lib/api'
import { isExpectedUnauthenticatedSession } from '../src/client/lib/session'
import { safeInternalPath } from '../src/client/components/AuthExperience'

describe('session authentication response handling', () => {
  it('treats an unauthenticated session probe as signed out but preserves other failures', () => {
    expect(isExpectedUnauthenticatedSession(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'))).toBe(true)
    expect(isExpectedUnauthenticatedSession(new ApiError(403, 'FORBIDDEN', 'Forbidden'))).toBe(false)
    expect(isExpectedUnauthenticatedSession(new ApiError(500, 'INTERNAL', 'Unexpected failure'))).toBe(false)
    expect(isExpectedUnauthenticatedSession(new Error('Network failure'))).toBe(false)
  })
})

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
