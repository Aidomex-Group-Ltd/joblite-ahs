import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, errorMessage, isAbortError } from '../lib/api'
import {
  formatLocation,
  formatRelativeTime,
  formatSalary,
  publicationLabel,
  publicJobUrl,
  safeExternalUrl,
  summarize,
} from '../lib/format'
import { signInPath, useSession } from '../lib/session'
import { EmptyState, ErrorNotice, Loading, PageIntro } from '../components/Common'

type Job = {
  id: string
  title: string
  body: string
  origin: 'native' | 'imported'
  application_method: string
  canonical_url: string | null
  application_url: string | null
  location_text: string | null
  salary_text: string | null
  source_name: string | null
  source_attribution: string | null
  published_at: number | null
  discovered_at: number | null
  created_at: number
  workplace_arrangement: string | null
  employment_type: string | null
  employment_type_label?: string
  org_name: string | null
  company_name: string | null
  eligibility_mode: string | null
  skills: string[]
  salary: { min_minor: number | null; max_minor: number | null; currency: string | null; period: string | null } | null
  locations: Array<{ city: string | null; country_code: string | null }>
  saved: boolean
}

type ListMeta = {
  total: number
  has_more: boolean
  next_offset: number
  catalog_total?: number
  last_updated_at?: number | null
  sync?: { stale: boolean; errors: Array<{ source_name: string; message: string }>; configured_sources: number } | null
  sources?: Array<{ id: string; name: string }>
}

export default function Jobs() {
  const navigate = useNavigate()
  const session = useSession()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') || ''
  const country = params.get('country') || ''
  const arrangement = params.get('arrangement') || ''
  const source = params.get('source') || ''
  const eligible = params.get('eligible') === 'me'

  const [search, setSearch] = useState(q)
  const [jobs, setJobs] = useState<Job[]>([])
  const [meta, setMeta] = useState<ListMeta>({ total: 0, has_more: false, next_offset: 0, catalog_total: 0 })
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [filterMessage, setFilterMessage] = useState('')
  const [notice, setNotice] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setSearch(q)
  }, [q])

  useEffect(() => {
    apiGet<{ code: string; name: string }[]>('/countries')
      .then((response) => setCountries(response.data || []))
      .catch(() => setCountries([]))
  }, [])

  const updateParam = useCallback(
    (key: string, value: string) => {
      setParams((current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      })
    },
    [setParams]
  )

  useEffect(() => {
    if (search === q) return
    const timer = window.setTimeout(() => updateParam('q', search.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [search, q, updateParam])

  const fetchJobs = useCallback(
    async (offset: number, mode: 'replace' | 'append') => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      if (mode === 'replace') setLoading(true)
      else setLoadingMore(true)
      setError('')

      const query = new URLSearchParams({ limit: '12', offset: String(offset) })
      if (q) query.set('q', q)
      if (country) query.set('country', country)
      if (arrangement) query.set('arrangement', arrangement)
      if (source) query.set('source', source)
      if (eligible) query.set('eligible', 'me')

      try {
        const response = await apiGet<Job[]>(`/jobs?${query.toString()}`, controller.signal)
        const list = response.data || []
        setJobs((current) => {
          if (mode === 'replace') return list
          const seen = new Set(current.map((job) => job.id))
          return [...current, ...list.filter((job) => !seen.has(job.id))]
        })
        const responseMeta = response.meta as unknown as ListMeta | undefined
        setMeta({
          total: responseMeta?.total ?? list.length,
          has_more: Boolean(responseMeta?.has_more),
          next_offset: responseMeta?.next_offset ?? offset + list.length,
          catalog_total: responseMeta?.catalog_total ?? 0,
          last_updated_at: responseMeta?.last_updated_at ?? null,
          sync: responseMeta?.sync ?? null,
          sources: responseMeta?.sources ?? [],
        })
        setFilterMessage('')
      } catch (caught) {
        if (isAbortError(caught)) return
        setError(errorMessage(caught))
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [arrangement, country, eligible, q, source]
  )

  useEffect(() => {
    void fetchJobs(0, 'replace')
  }, [fetchJobs])

  const toggleSave = async (job: Job) => {
    if (!session.user) {
      navigate(signInPath('save', `/jobs?${params.toString()}`))
      return
    }
    try {
      if (job.saved) await apiDelete(`/jobs/${encodeURIComponent(job.id)}/save`)
      else await apiPost(`/jobs/${encodeURIComponent(job.id)}/save`)
      setJobs((current) => current.map((item) => (item.id === job.id ? { ...item, saved: !item.saved } : item)))
    } catch (caught) {
      setNotice(errorMessage(caught))
    }
  }

  const apply = (job: Job) => {
    if (job.origin === 'native' && job.application_method === 'native') {
      if (!session.user) {
        navigate(signInPath('apply', `/jobs/${job.id}`))
        return
      }
      navigate(`/jobs/${job.id}`)
      return
    }
    const url = safeExternalUrl(job.application_url || job.canonical_url)
    if (!url) {
      navigate(`/jobs/${job.id}`)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const share = async (job: Job) => {
    const url = publicJobUrl(job.id)
    try {
      if (navigator.share) await navigator.share({ title: job.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setNotice('Link copied to clipboard.')
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setNotice('Could not share this job. Copy the address from your browser instead.')
    }
  }

  const toggleEligibility = () => {
    if (!session.user) {
      navigate(signInPath('personalised-eligibility', `/jobs?${params.toString()}`))
      return
    }
    if (!session.profile?.country_code) {
      setFilterMessage('Add your country in Settings before using eligibility filtering.')
      return
    }
    updateParam('eligible', eligible ? '' : 'me')
  }

  const clearFilters = () => setParams({})

  return (
    <div className="page">
      <PageIntro
        title="Find jobs"
        subtitle="Native and imported roles from every country. Imported jobs always link to their original source."
      />

      <div className="card filter-card">
        <label className="search-field">
          <span className="sr-only">Search jobs</span>
          <input
            className="input"
            placeholder="Search jobs, skills or companies"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
          />
        </label>
        <div className="chip-row">
          <select className="filter-chip" aria-label="Country" value={country} onChange={(event) => updateParam('country', event.target.value)}>
            <option value="">All countries</option>
            {countries.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
          <select className="filter-chip" aria-label="Workplace" value={arrangement} onChange={(event) => updateParam('arrangement', event.target.value)}>
            <option value="">Any workplace</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
          <select className="filter-chip" aria-label="Job source" value={source} onChange={(event) => updateParam('source', event.target.value)}>
            <option value="">All sources</option>
            {(meta.sources || []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <button type="button" className={`filter-chip ${eligible ? 'selected' : ''}`} aria-pressed={eligible} onClick={toggleEligibility}>
            Eligible for me
          </button>
          {q || country || arrangement || source || eligible ? (
            <button type="button" className="filter-chip" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
        {filterMessage ? (
          <p className="form-error" role="alert">
            {filterMessage}
          </p>
        ) : null}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        {meta.sync ? (
          <div className={`feed-freshness ${meta.sync.stale ? 'stale' : ''}`} role="status">
            <span>
              {meta.last_updated_at ? `Last updated ${formatRelativeTime(meta.last_updated_at)}` : 'Waiting for the first provider update'}
            </span>
            {meta.sync.stale ? <strong>Sync delayed — showing cached jobs</strong> : null}
            {meta.sync.errors.length > 0 ? (
              <small>{meta.sync.errors.length} source{meta.sync.errors.length === 1 ? '' : 's'} could not refresh; existing jobs are kept.</small>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? <Loading label="Loading jobs…" /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void fetchJobs(0, 'replace')} /> : null}
      {!loading && !error && jobs.length === 0 ? (
        <EmptyState
          title={q || country || arrangement || source || eligible ? 'No jobs match these filters' : 'No jobs have been ingested yet'}
          action={
            q || country || arrangement || source || eligible ? (
              <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                Clear filters
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => void fetchJobs(0, 'replace')}>
                Refresh jobs
              </button>
            )
          }
        >
          <p>
            {q || country || arrangement || source || eligible
              ? 'Job coverage differs by country and source. You can still explore external job-board directories for this search.'
              : 'Approved providers have not returned stored vacancies yet. If this is a new environment, run the initial ingestion sync; no mock jobs are inserted.'}
          </p>
        </EmptyState>
      ) : null}

      {!loading && !error && jobs.length > 0 ? (
        <>
          <p className="result-count" role="status">
            {meta.total} job{meta.total === 1 ? '' : 's'} found
          </p>
          <div className="job-list">
            {jobs.map((job) => {
              const salary = formatSalary(job.salary, job.salary_text)
              const native = job.origin === 'native' && job.application_method === 'native'
              return (
                <article className="card job-card" key={job.id}>
                  <div className="job-card-head">
                    <div className="company-mark" aria-hidden="true">
                      {(job.org_name || job.company_name || 'J').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="job-card-title">
                      <div className="job-meta-line">
                        <strong>{job.org_name || job.company_name || 'Organization'}</strong>
                        <span>{publicationLabel(job.published_at, job.discovered_at || job.created_at)}</span>
                        <span className={`badge ${native ? 'badge-native' : 'badge-imported'}`}>
                          {native ? 'Native job' : 'Imported job'}
                        </span>
                        {job.source_name ? <span className="source-label">via {job.source_name}</span> : null}
                      </div>
                      <button type="button" className="link-heading" onClick={() => navigate(`/jobs/${job.id}`)}>
                        {job.title}
                      </button>
                      <p className="job-location">{formatLocation(job.locations, job.workplace_arrangement, job.location_text)}</p>
                    </div>
                  </div>

                  {job.skills?.length ? (
                    <div className="tag-row">
                      {job.skills.slice(0, 7).map((skill) => (
                        <span className="tag" key={skill}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {salary ? <p className="job-salary">{salary}</p> : null}
                  <p className="job-summary">{summarize(job.body, 240)}</p>

                  <div className="button-row">
                    <button type="button" className="btn" onClick={() => apply(job)}>
                      {native ? 'Apply now' : 'Apply at source ↗'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void toggleSave(job)} aria-pressed={job.saved}>
                      {job.saved ? 'Saved' : 'Save'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void share(job)}>
                      Share
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => navigate(`/jobs/${job.id}`)}>
                      Details
                    </button>
                  </div>
                  {!native ? (
                    <p className="external-apply-note">
                      Opens {job.source_name || 'the original source'} in a new tab. Joblite does not record an application
                      until you choose to mark it yourself.
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
          {meta.has_more ? (
            <button type="button" className="btn btn-secondary load-more" disabled={loadingMore} onClick={() => void fetchJobs(meta.next_offset, 'append')}>
              {loadingMore ? 'Loading more…' : 'Load more jobs'}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
