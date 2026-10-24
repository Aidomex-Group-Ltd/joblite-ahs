import { describe, expect, it } from 'vitest'
import {
  buildCountryIndex,
  canonicalUrlKey,
  matchCountryCodes,
  parseSalaryText,
  type CountryRow,
} from '../src/worker/lib/providers/common'
import { greenhouseAdapter } from '../src/worker/lib/providers/greenhouse'
import { leverAdapter } from '../src/worker/lib/providers/lever'
import { remoteOkAdapter } from '../src/worker/lib/providers/remoteok'
import { remotiveAdapter } from '../src/worker/lib/providers/remotive'
import { safeHttpUrl, sanitizeText } from '../src/worker/lib/validate'
import type { AdapterContext } from '../src/worker/lib/providers/types'

const countries: CountryRow[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
]
const countryIndex = buildCountryIndex(countries)

function context(config: Record<string, unknown> = {}): AdapterContext {
  return {
    source: { id: 'src_test', name: 'Test source', kind: 'api' },
    config,
    countryIndex,
  }
}

describe('provider normalization', () => {
  it('normalizes a Remotive record and preserves its stated eligibility', () => {
    const job = remotiveAdapter.normalize(
      {
        id: 123,
        url: 'https://remotive.com/remote-jobs/software-development/engineer-123?utm_source=test',
        title: 'Senior Engineer',
        company_name: 'Example Co',
        category: 'Software Development',
        job_type: 'full_time',
        publication_date: '2026-10-20T10:00:00',
        candidate_required_location: 'USA, Canada',
        salary: '$170k - $200k',
        tags: ['React', 'TypeScript'],
        description: '<p>Build useful tools with a global team.</p><script>alert(1)</script>',
      },
      context()
    )

    expect(job).not.toBeNull()
    expect(job?.title).toBe('Senior Engineer')
    expect(job?.company).toBe('Example Co')
    expect(job?.description).toBe('Build useful tools with a global team.')
    expect(job?.workplaceArrangement).toBe('remote')
    expect(job?.countryCodes).toEqual(['CA', 'US'])
    expect(job?.eligibilityMode).toBe('unknown')
    expect(job?.salary).toEqual({ minMinor: 17_000_000, maxMinor: 20_000_000, currency: 'USD', period: null })
    expect(job?.tags).toContain('React')
  })

  it('marks worldwide only when the source explicitly says so', () => {
    const worldwide = remotiveAdapter.normalize(
      {
        id: 'w1',
        url: 'https://remotive.com/jobs/w1',
        title: 'Support Specialist',
        description: 'Help customers.',
        candidate_required_location: 'Worldwide',
      },
      context()
    )
    expect(worldwide?.eligibilityMode).toBe('worldwide')
    expect(worldwide?.countryCodes).toEqual([])

    const region = remotiveAdapter.normalize(
      {
        id: 'r1',
        url: 'https://remotive.com/jobs/r1',
        title: 'Regional Lead',
        description: 'Lead the region.',
        candidate_required_location: 'Europe',
      },
      context()
    )
    expect(region?.eligibilityMode).toBe('unknown')
    expect(region?.countryCodes).toEqual([])
  })

  it('rejects malformed and unsafe provider records', () => {
    expect(remotiveAdapter.normalize({ id: 1, title: 'No body', url: 'https://example.com/job' }, context())).toBeNull()
    expect(
      remotiveAdapter.normalize(
        { id: 2, title: 'Bad URL', description: 'Text', url: 'javascript:alert(1)' },
        context()
      )
    ).toBeNull()
    expect(remoteOkAdapter.normalize({ legal: 'API terms only' }, context())).toBeNull()
    expect(
      remoteOkAdapter.normalize(
        { id: '3', position: 'No URL', description: 'Text', url: 'not-a-url' },
        context()
      )
    ).toBeNull()
  })

  it('sanitizes double-encoded Greenhouse HTML without changing meaning', () => {
    const job = greenhouseAdapter.normalize(
      {
        id: 44,
        title: 'Product Engineer',
        location: { name: 'Remote, Germany' },
        absolute_url: 'https://boards.greenhouse.io/example/jobs/44',
        updated_at: '2026-10-20T10:00:00Z',
        content: '&lt;div&gt;&lt;h2&gt;About us&lt;/h2&gt;&lt;p&gt;We build &amp;amp; ship.&lt;/p&gt;&lt;/div&gt;',
      },
      context({ company: 'Example', board_token: 'example' })
    )

    expect(job?.description).toBe('About us We build & ship.')
    expect(job?.description).not.toContain('<')
    expect(job?.workplaceArrangement).toBe('remote')
    expect(job?.publishedAt).toBeNull()
    expect(job?.providerUpdatedAt).toBe(1792490400)
    expect(job?.company).toBe('Example')
  })

  it('uses only explicitly supplied Lever salary ranges', () => {
    const job = leverAdapter.normalize(
      {
        id: 'lever-1',
        text: 'Staff Engineer',
        descriptionPlain: 'Design and build systems.',
        hostedUrl: 'https://jobs.lever.co/example/lever-1',
        applyUrl: 'https://jobs.lever.co/example/lever-1/apply',
        createdAt: 1792800000000,
        categories: { location: 'London, United Kingdom', commitment: 'Permanent' },
        salaryRange: { min: 100000, max: 150000, currency: 'GBP', interval: 'year' },
      },
      context({ company: 'Example', board_token: 'example' })
    )

    expect(job?.salary).toEqual({ minMinor: 10_000_000, maxMinor: 15_000_000, currency: 'GBP', period: 'year' })
    expect(job?.countryCodes).toEqual(['GB'])
    expect(job?.publishedAt).toBe(1792800000)
  })
})

describe('provider helpers', () => {
  it('parses explicit salaries and leaves ambiguous currency text alone', () => {
    expect(parseSalaryText('$170k - $200k').salary).toEqual({
      minMinor: 17_000_000,
      maxMinor: 20_000_000,
      currency: 'USD',
      period: null,
    })
    expect(parseSalaryText('€60,000 per year').salary).toEqual({
      minMinor: 6_000_000,
      maxMinor: null,
      currency: 'EUR',
      period: 'year',
    })
    const ambiguous = parseSalaryText('70K-80K')
    expect(ambiguous.salary).toBeNull()
    expect(ambiguous.salaryText).toBe('70K-80K')
  })

  it('matches only explicit countries, not remote or region words', () => {
    expect(matchCountryCodes('USA, Canada', countryIndex)).toEqual(['CA', 'US'])
    expect(matchCountryCodes('Remote · Europe', countryIndex)).toEqual([])
    expect(matchCountryCodes('Berlin, Germany', countryIndex)).toEqual(['DE'])
  })

  it('removes tracking parameters from canonical dedupe keys', () => {
    expect(canonicalUrlKey('https://www.example.com/jobs/1/?utm_source=x&b=2&a=1#frag')).toBe(
      'example.com/jobs/1?a=1&b=2'
    )
    expect(canonicalUrlKey('https://job-boards.greenhouse.io/example/jobs/1')).toBe(
      'boards.greenhouse.io/example/jobs/1'
    )
  })

  it('strips unsafe markup and rejects non-http destinations', () => {
    expect(sanitizeText('<script>alert(1)</script>Hello &amp; <b>world</b>')).toBe('Hello & world')
    expect(sanitizeText('&lt;div&gt;Visible&lt;/div&gt;')).toBe('Visible')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,hello')).toBeNull()
    expect(safeHttpUrl('https://user:pass@example.com/job')).toBeNull()
    expect(safeHttpUrl('https://example.com/job')).toBe('https://example.com/job')
  })
})
