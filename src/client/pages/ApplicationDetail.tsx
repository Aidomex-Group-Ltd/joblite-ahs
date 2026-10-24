import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiGet, apiPost, errorMessage } from '../lib/api'
import { formatDateTime, stageLabel } from '../lib/format'
import { useSession } from '../lib/session'
import { ErrorNotice, Loading, PageIntro } from '../components/Common'

type Event = {
  id: string
  event_type: string
  old_stage: string | null
  new_stage: string | null
  created_at: number
  candidate_visible: number
}

type Offer = {
  id: string
  version: number
  terms_json: string | null
  status: string
  issued_at: number | null
  response: string | null
  responded_at: number | null
}

type Application = {
  id: string
  candidate_id: string
  job_id: string
  stage: string
  version: number
  submitted_at: number
  updated_at: number
  title: string
  org_name: string | null
  organization_id: string | null
  snapshot: { profile_json: string; job_json: string; cv_media_id: string | null; created_at: number } | null
  events: Event[]
  notes: Array<{ id: string; body: string; created_at: number }>
  offers: Offer[]
}

const EMPLOYER_TRANSITIONS = ['in_review', 'shortlisted', 'interview', 'rejected', 'closed']

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const [application, setApplication] = useState<Application | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const response = await apiGet<Application>(`/applications/${encodeURIComponent(id)}`)
      setApplication(response.data)
    } catch (caught) {
      setError(errorMessage(caught))
      setApplication(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function respondToOffer(offer: Offer, response: 'accepted' | 'declined') {
    setBusy(true)
    setNotice('')
    try {
      await apiPost(`/offers/${offer.id}/respond`, { response })
      setNotice(
        response === 'accepted'
          ? 'Offer accepted. Your acceptance is recorded; hiring still requires a separate human confirmation from the employer.'
          : 'Offer declined.'
      )
      await load()
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function transition(to: string) {
    if (!application) return
    if (to === 'rejected' && !window.confirm('Reject this application? The candidate will see the decision.')) return
    setBusy(true)
    setNotice('')
    try {
      await apiPost(`/applications/${application.id}/transitions`, {
        to,
        expected_version: application.version,
        confirmed: to === 'rejected',
      })
      setNotice(`Application moved to ${stageLabel(to)}.`)
      await load()
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading label="Loading application…" />
  if (error || !application) return <ErrorNotice message={error || 'Application not found.'} onRetry={() => void load()} />

  const isCandidate = session.user?.id === application.candidate_id
  const profile = parseJson(application.snapshot?.profile_json)
  const job = parseJson(application.snapshot?.job_json)

  return (
    <div className="page">
      <Link className="back-link" to={isCandidate ? '/applications' : '/hiring'}>
        ← Back
      </Link>
      <PageIntro
        title={application.title}
        subtitle={`${application.org_name || 'Organization'} · Application ${application.id}`}
        actions={<span className={`badge stage-${application.stage}`}>{stageLabel(application.stage)}</span>}
      />

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="detail-grid">
        <section className="card">
          <h2>Timeline</h2>
          {application.events.length === 0 ? <p className="muted">No visible events yet.</p> : null}
          <ol className="timeline">
            {application.events.map((event) => (
              <li key={event.id}>
                <strong>
                  {event.new_stage ? stageLabel(event.new_stage) : event.event_type.replace(/[._]/g, ' ')}
                </strong>
                <span>{formatDateTime(event.created_at)}</span>
                {event.old_stage && event.new_stage ? (
                  <small>
                    {stageLabel(event.old_stage)} → {stageLabel(event.new_stage)}
                  </small>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <h2>Submitted snapshot</h2>
          <p className="muted small">
            Captured {formatDateTime(application.snapshot?.created_at)}. Snapshots do not change when a profile or job is
            edited later.
          </p>
          <dl className="snapshot-list">
            <div>
              <dt>Candidate headline</dt>
              <dd>{profile.headline || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Candidate country</dt>
              <dd>{profile.country_code || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Job title at submission</dt>
              <dd>{job.title || application.title}</dd>
            </div>
            <div>
              <dt>CV attached</dt>
              <dd>{application.snapshot?.cv_media_id ? 'Yes' : 'No CV attached'}</dd>
            </div>
          </dl>
        </section>
      </div>

      {application.offers.length > 0 ? (
        <section className="card">
          <h2>Offers</h2>
          {application.offers.map((offer) => {
            const terms = parseJson(offer.terms_json)
            return (
              <div className="offer-row" key={offer.id}>
                <div>
                  <strong>Offer v{offer.version}</strong>
                  <p className="muted small">Issued {formatDateTime(offer.issued_at)} · Status: {offer.status.replace(/_/g, ' ')}</p>
                  {terms.summary ? <p>{String(terms.summary)}</p> : null}
                </div>
                {isCandidate && offer.status === 'issued' ? (
                  <div className="button-row">
                    <button type="button" className="btn" disabled={busy} onClick={() => void respondToOffer(offer, 'accepted')}>
                      Accept offer
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void respondToOffer(offer, 'declined')}>
                      Decline
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>
      ) : null}

      {!isCandidate ? (
        <>
          <section className="card">
            <h2>Move stage</h2>
            <p className="muted small">Every change is recorded. Rejection requires confirmation.</p>
            <div className="button-row">
              {EMPLOYER_TRANSITIONS.filter((stage) => stage !== application.stage).map((stage) => (
                <button
                  type="button"
                  key={stage}
                  className={`btn ${stage === 'rejected' ? 'btn-danger' : 'btn-secondary'}`}
                  disabled={busy}
                  onClick={() => void transition(stage)}
                >
                  {stageLabel(stage)}
                </button>
              ))}
            </div>
          </section>

          {application.notes.length > 0 ? (
            <section className="card">
              <h2>Private employer notes</h2>
              <ul className="note-list">
                {application.notes.map((note) => (
                  <li key={note.id}>
                    <p>{note.body}</p>
                    <small>{formatDateTime(note.created_at)}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <div className="button-row">
          <Link className="btn btn-secondary" to={`/jobs/${application.job_id}`}>
            View job
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/jobs')}>
            Find more jobs
          </button>
        </div>
      )}
    </div>
  )
}

function parseJson(value: string | null | undefined): Record<string, any> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
