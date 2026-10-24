import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiGet, errorMessage } from '../lib/api'
import { formatDate, stageLabel } from '../lib/format'
import { signInPath, useSession } from '../lib/session'
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

const STAGES = ['submitted', 'in_review', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']

export default function Applications() {
  const navigate = useNavigate()
  const session = useSession()
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session.user) {
      setApplications([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await apiGet<Application[]>('/me/applications')
      setApplications(response.data || [])
    } catch (caught) {
      setError(errorMessage(caught))
      setApplications([])
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
            <button type="button" className="btn" onClick={() => navigate(signInPath('applications', '/applications'))}>
              Sign in
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
        subtitle="Each application stores an immutable snapshot of your profile at the time you applied."
        actions={
          <Link className="btn btn-secondary" to="/jobs">
            Find jobs
          </Link>
        }
      />

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
      {!loading && !error && applications.length === 0 ? (
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
      ) : null}
    </div>
  )
}
