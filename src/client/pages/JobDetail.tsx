import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from '../lib/api'
import {
  formatDate,
  formatLocation,
  formatRelativeTime,
  formatSalary,
  publicationLabel,
  publicJobUrl,
  safeExternalUrl,
} from '../lib/format'
import { useSession } from '../lib/session'
import { ErrorNotice, Loading } from '../components/Common'
import { useAuthExperience } from '../components/AuthExperience'

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
  last_seen_at: number | null
  last_fetched_at: number | null
  provenance: Array<{ source_id: string; source_name: string; canonical_url: string | null; first_seen_at: number }>
  company_name: string | null
  org_name: string | null
  org_slug: string | null
  source_id: string | null
  published_at: number | null
  discovered_at: number | null
  created_at: number
  expires_at: number | null
  deadline: string | null
  workplace_arrangement: string | null
  employment_type: string | null
  eligibility_mode: string | null
  eligibility_evidence: string | null
  skills: string[]
  salary: { min_minor: number | null; max_minor: number | null; currency: string | null; period: string | null } | null
  locations: Array<{ city: string | null; country_code: string | null }>
  eligible_countries: Array<{ country_code: string }>
  saved: boolean
  status: string
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const { openAuth } = useAuthExperience()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [externalMarked, setExternalMarked] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const response = await apiGet<Job>(`/jobs/${encodeURIComponent(id)}`)
      setJob(response.data)
    } catch (caught) {
      setError(errorMessage(caught))
      setJob(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const native = job ? job.origin === 'native' && job.application_method === 'native' : false

  async function toggleSave() {
    if (!job) return
    if (!session.user) {
      openAuth({ intent: 'save', nextPath: `/jobs/${job.id}` })
      return
    }
    try {
      if (job.saved) await apiDelete(`/jobs/${job.id}/save`)
      else await apiPost(`/jobs/${job.id}/save`)
      setJob({ ...job, saved: !job.saved })
    } catch (caught) {
      setNotice(errorMessage(caught))
    }
  }

  async function share() {
    if (!job) return
    const url = publicJobUrl(job.id)
    try {
      if (navigator.share) await navigator.share({ title: job.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setNotice('Link copied to clipboard.')
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setNotice('Could not share this job.')
    }
  }

  function startApply() {
    if (!job) return
    if (!native) {
      const url = safeExternalUrl(job.application_url || job.canonical_url)
      if (!url) {
        setNotice('This imported job does not have a verified application destination yet.')
        return
      }
      if (!session.user) {
        openAuth({ intent: 'apply-source', jobId: job.id, nextPath: `/jobs/${encodeURIComponent(job.id)}` })
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
      setNotice(`Opened ${job.source_name || 'the original source'}. Joblite does not record this as an application.`)
      return
    }
    if (!session.user) {
      openAuth({ intent: 'apply', nextPath: `/jobs/${job.id}` })
      return
    }
    setConfirming(true)
  }

  async function submitApplication() {
    if (!job) return
    setApplying(true)
    setNotice('')
    try {
      await apiPost('/applications', { job_id: job.id })
      setApplied(true)
      setConfirming(false)
      setNotice('Your application was submitted with an immutable snapshot of your profile.')
      await load()
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setApplying(false)
    }
  }

  async function markExternalApplied() {
    if (!job) return
    if (!session.user) {
      openAuth({ intent: 'apply', nextPath: `/jobs/${job.id}` })
      return
    }
    try {
      await apiPut(`/me/external-applications/${encodeURIComponent(job.id)}`, { status: 'applied' })
      setExternalMarked(true)
      setNotice('Marked as self-reported applied. This job’s application stays with the original source.')
    } catch (caught) {
      setNotice(errorMessage(caught))
    }
  }

  if (loading) return <Loading label="Loading job details…" />
  if (error || !job) {
    return (
      <div className="page">
        <ErrorNotice message={error || 'This job could not be found.'} onRetry={() => void load()} />
        <Link className="btn btn-secondary" to="/jobs">
          Back to jobs
        </Link>
      </div>
    )
  }

  const salary = formatSalary(job.salary, job.salary_text)
  const companyName = job.org_name || job.company_name || 'Organization'
  const externalUrl = safeExternalUrl(job.application_url || job.canonical_url)

  return (
    <div className="page">
      <Link className="back-link" to="/jobs">
        ← Back to jobs
      </Link>

      <article className="card job-detail">
        <div className="job-card-head">
          <div className="company-mark large" aria-hidden="true">
            {companyName.slice(0, 1).toUpperCase()}
          </div>
          <div className="job-card-title">
            <div className="job-meta-line">
              {job.org_slug ? <Link to={`/companies/${job.org_slug}`}>{companyName}</Link> : <strong>{companyName}</strong>}
              <span>{publicationLabel(job.published_at, job.discovered_at || job.created_at)}</span>
              <span className={`badge ${native ? 'badge-native' : 'badge-imported'}`}>{native ? 'Native job' : 'Imported job'}</span>
              {job.source_name ? <span className="badge badge-source">via {job.source_name}</span> : null}
              {job.status !== 'published' ? <span className="badge">{job.status}</span> : null}
            </div>
            <h1>{job.title}</h1>
            <p className="job-location">{formatLocation(job.locations, job.workplace_arrangement, job.location_text)}</p>
          </div>
        </div>

        <dl className="detail-facts">
          <div>
            <dt>Workplace</dt>
            <dd>{job.workplace_arrangement || 'Not specified'}</dd>
          </div>
          <div>
            <dt>Employment</dt>
            <dd>{job.employment_type || 'Not specified'}</dd>
          </div>
          <div>
            <dt>Eligibility</dt>
            <dd>{job.eligibility_mode ? job.eligibility_mode.replace(/_/g, ' ') : 'Unknown — check the source'}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>{job.published_at ? formatDate(job.published_at) : 'Not supplied by source'}</dd>
          </div>
          {job.last_seen_at ? (
            <div>
              <dt>Last seen at source</dt>
              <dd>{formatRelativeTime(job.last_seen_at)}</dd>
            </div>
          ) : null}
          {job.expires_at ? (
            <div>
              <dt>Expires</dt>
              <dd>{formatDate(job.expires_at)}</dd>
            </div>
          ) : null}
          {salary ? (
            <div>
              <dt>Salary</dt>
              <dd>{salary}</dd>
            </div>
          ) : (
            <div>
              <dt>Salary</dt>
              <dd>Not stated</dd>
            </div>
          )}
        </dl>

        {job.skills?.length ? (
          <div className="tag-row">
            {job.skills.map((skill) => (
              <span className="tag" key={skill}>
                {skill}
              </span>
            ))}
          </div>
        ) : null}

        {job.eligible_countries?.length ? (
          <p className="detail-note">
            Eligible countries: {job.eligible_countries.map((country) => country.country_code).join(', ')}
          </p>
        ) : null}
        {job.eligibility_evidence ? <p className="detail-note">{job.eligibility_evidence}</p> : null}

        <section className="job-description">
          <h2>Job description</h2>
          <p>{job.body}</p>
        </section>

        <div className="provenance">
          <strong>Source</strong>
          <p>
            {native
              ? 'Posted directly on Joblite AHS.'
              : `Imported from ${job.source_name || 'an approved external source'}. Applications are completed on the original site.`}
          </p>
          {!native && job.source_attribution ? <p>{job.source_attribution}</p> : null}
          {job.provenance && job.provenance.length > 1 ? (
            <p>Also listed by {job.provenance.filter((entry) => entry.source_name !== job.source_name).map((entry) => entry.source_name).join(', ')}.</p>
          ) : null}
          {externalUrl ? (
            <a href={externalUrl} target="_blank" rel="noopener noreferrer">
              View original posting ↗
            </a>
          ) : null}
        </div>

        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}

        {confirming ? (
          <div className="confirm-panel" role="group" aria-label="Confirm application">
            <h2>Submit this application?</h2>
            <p>
              Joblite stores an immutable snapshot of your profile and this job as it appears now. You can update your
              profile later without changing this application. Your application enters review; no decision is made
              automatically.
            </p>
            <div className="button-row">
              <button type="button" className="btn" onClick={() => void submitApplication()} disabled={applying}>
                {applying ? 'Submitting…' : 'Confirm application'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={applying}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="button-row sticky-actions">
          {native ? (
            <button type="button" className="btn" onClick={startApply} disabled={applying || applied}>
              {applied ? 'Applied' : applying ? 'Applying…' : 'Apply inside Joblite'}
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={startApply} disabled={!externalUrl}>
                Apply at source ↗
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void markExternalApplied()} disabled={externalMarked}>
                {externalMarked ? 'Marked applied' : 'Mark as applied'}
              </button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => void toggleSave()} aria-pressed={job.saved}>
            {job.saved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void share()}>
            Share
          </button>
        </div>
        {!native ? (
          <p className="external-apply-note">
            Apply at source opens {job.source_name || 'the original listing'} in a new tab. You leave Joblite, and this
            button does not record an application. Use “Mark as applied” only if you applied yourself.
          </p>
        ) : null}
      </article>
    </div>
  )
}
