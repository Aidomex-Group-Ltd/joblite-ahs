import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, errorMessage } from '../lib/api'
import { formatDate, stageLabel } from '../lib/format'
import { useSession } from '../lib/session'
import { useAuthExperience } from '../components/AuthExperience'
import { EmptyState, ErrorNotice, Loading, PageIntro } from '../components/Common'

type Application = {
  id: string
  stage: string
  version: number
  submitted_at: number
  updated_at: number
  job_id: string
  title: string
  origin: 'native' | 'imported'
  org_name: string | null
  org_slug: string | null
}

type ExternalRecord = {
  job_id: string
  status: string
  marked_at: number
  title: string
  org_name: string | null
  source_name: string | null
}

const STAGES = ['submitted', 'in_review', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']

export default function Applications() {
  const session = useSession()
  const { openAuth } = useAuthExperience()
  const [applications, setApplications] = useState<Application[]>([])
  const [external, setExternal] = useState<ExternalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session.user) {
      setApplications([])
      setExternal([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [response, externalResponse] = await Promise.all([
        apiGet<Application[]>('/me/applications'),
        apiGet<ExternalRecord[]>('/me/external-applications'),
      ])
      setApplications(response.data || [])
      setExternal(externalResponse.data || [])
    } catch (caught) {
      setError(errorMessage(caught))
      setApplications([])
      setExternal([])
    } finally {
      setLoading(false)
    }
  }, [session.user])

  useEffect(() => {
    void load()
  }, [load])

  const counts = applications.reduce<Record<string, number>>((acc, application) => {
    acc[application.stage] = (acc[application.stage] || 0) + 1
    return acc
  }, {})

  if (!session.loading && !session.user) {
    return (
      <div className="page">
        <PageIntro title="My applications" subtitle="Track every application you submit inside Joblite." />
        <EmptyState
          title="Sign in to track applications"
          action={
            <button type="button" className="btn" onClick={() => openAuth({ intent: 'apply', nextPath: '/applications' })}>
              Continue with email
            </button>
          }
        >
          <p>Applications, interview updates and offers are private to your account.</p>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="page">
      <PageIntro
        title="My applications"
        subtitle="Joblite submissions and any external applications you chose to report."
        actions={
          <Link className="btn btn-secondary" to="/jobs">
            Find jobs
          </Link>
        }
      />

      <p className="form-notice">Opening an external job link does not create an application record. External entries below are self-reported by you.</p>

      {applications.length > 0 ? (
        <div className="stage-summary" aria-label="Application stages">
          {STAGES.filter((stage) => counts[stage]).map((stage) => (
            <div key={stage} className="stage-pill">
              <strong>{counts[stage]}</strong>
              <span>{stageLabel(stage)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {loading ? <Loading label="Loading applications…" /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && applications.length === 0 && external.length === 0 ? (
        <EmptyState
          title="No applications yet"
          action={
            <Link className="btn" to="/jobs">
              Browse jobs
            </Link>
          }
        >
          <p>Apply to native jobs to track progress here. Imported jobs are applied for on the original site.</p>
        </EmptyState>
      ) : null}

      {!loading && !error && applications.length > 0 ? (
        <section aria-labelledby="jl-submitted-title">
          <h2 id="jl-submitted-title" className="jl-section-title">Submitted in Joblite</h2>
          <div className="job-list">
            {applications.map((application) => (
              <article className="card application-row" key={application.id}>
                <div>
                  <Link className="link-heading" to={`/applications/${application.id}`}>
                    {application.title}
                  </Link>
                  <p className="muted">{application.org_name || 'Organization'}</p>
                  <p className="muted small">
                    Submitted {formatDate(application.submitted_at)} · Updated {formatDate(application.updated_at)}
                  </p>
                </div>
                <div className="application-row-actions">
                  <span className={`badge stage-${application.stage}`}>{stageLabel(application.stage)}</span>
                  <Link className="btn btn-secondary" to={`/applications/${application.id}`}>
                    View timeline
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && !error && external.length > 0 ? <section className="jl-external-applications" aria-labelledby="jl-external-title">
        <h2 id="jl-external-title" className="jl-section-title">External applications you reported</h2>
        <div className="job-list">{external.map((record) => <article className="card application-row" key={record.job_id}>
          <div><Link className="link-heading" to={`/jobs/${encodeURIComponent(record.job_id)}`}>{record.title}</Link><p className="muted">{record.org_name || 'Employer'}{record.source_name ? ` · ${record.source_name}` : ''}</p><p className="muted small">Self-reported {record.status.replaceAll('_', ' ')} · Marked {formatDate(record.marked_at)}</p></div>
          <span className="badge">Self-reported</span>
        </article>)}</div>
      </section> : null}
    </div>
  )
}
