import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiGet, apiPatch, apiPost, errorMessage } from '../lib/api'
import { formatDateTime, stageLabel } from '../lib/format'
import { useSession } from '../lib/session'
import { ErrorNotice, Loading, PageIntro } from '../components/Common'
import '../styles/ats.css'

type Event = {
  id: string
  event_type: string
  old_stage: string | null
  new_stage: string | null
  created_at: number
  candidate_visible: number
}

function parseAnswers(value: string | null | undefined): Array<{ question: string; answer: string }> {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is { question: string; answer: string } =>
      !!item && typeof item === 'object' && typeof item.question === 'string' && typeof item.answer === 'string'
    )
  } catch {
    return []
  }
}

type Offer = {
  id: string
  version: number
  terms_json: string | null
  status: string
  issued_at: number | null
  response: string | null
  responded_at: number | null
  expires_at: number | null
}

type Interview = {
  id: string
  scheduled_at: number
  timezone: string
  status: string
  details: string | null
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
  snapshot: { profile_json: string; job_json: string; answers_json: string; cv_media_id: string | null; created_at: number } | null
  events: Event[]
  notes: Array<{ id: string; body: string; created_at: number }>
  offers: Offer[]
  interviews: Interview[]
  reviewers: Array<{ id: string; membership_id: string; user_id: string; display_name: string; role: string }>
  scorecards: Array<{ id: string; membership_id: string; ratings_json: string; recommendation: string; summary: string | null; updated_at: number }>
}

const EMPLOYER_TRANSITIONS = ['in_review', 'shortlisted', 'interview', 'rejected', 'closed']
const ACTIVE_STAGES = ['submitted', 'in_review', 'shortlisted', 'interview', 'offer']

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const [application, setApplication] = useState<Application | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [interviewTime, setInterviewTime] = useState('')
  const [interviewDetails, setInterviewDetails] = useState('')
  const [offerSummary, setOfferSummary] = useState('')
  const [offerExpiry, setOfferExpiry] = useState('')
  const [draftOfferId, setDraftOfferId] = useState('')
  const [draftOfferSummary, setDraftOfferSummary] = useState('')
  const [members, setMembers] = useState<Array<{ user_id: string; display_name: string; role: string }>>([])
  const [reviewerUserId, setReviewerUserId] = useState('')
  const [scoreRecommendation, setScoreRecommendation] = useState('mixed')
  const [scoreSummary, setScoreSummary] = useState('')
  const [scoreRating, setScoreRating] = useState(3)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const response = await apiGet<Application>(`/applications/${encodeURIComponent(id)}`)
      setApplication(response.data)
      if (response.data.organization_id && response.data.candidate_id !== session.user?.id) {
        const memberResponse = await apiGet<typeof members>(`/organizations/${encodeURIComponent(response.data.organization_id)}/members`)
        setMembers(memberResponse.data || [])
      }
    } catch (caught) {
      setError(errorMessage(caught))
      setApplication(null)
    } finally {
      setLoading(false)
    }
  }, [id, session.user?.id])

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
    if (to === 'closed' && !window.confirm('Close this application without declaring a hiring outcome?')) return
    setBusy(true)
    setNotice('')
    try {
      await apiPost(`/applications/${application.id}/transitions`, {
        to,
        expected_version: application.version,
        confirmed: to === 'rejected' || to === 'closed',
        reason,
      })
      setNotice(`Application moved to ${stageLabel(to)}.`)
      await load()
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function respondToInterview(interviewId: string, response: 'accepted' | 'declined') {
    if (!application) return
    setBusy(true)
    setNotice('')
    try {
      await apiPost(`/applications/${application.id}/interviews/${interviewId}/respond`, { response })
      setNotice(response === 'accepted' ? 'Interview confirmed.' : 'Interview declined. The employer can see your response.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function withdraw() {
    if (!application || !window.confirm('Withdraw this application? This cannot be undone.')) return
    setBusy(true)
    try {
      await apiPost(`/applications/${application.id}/withdraw`, { expected_version: application.version, confirmed: true })
      setNotice('Application withdrawn.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault()
    if (!application) return
    setBusy(true)
    try {
      await apiPost(`/applications/${application.id}/notes`, { body: noteBody })
      setNoteBody('')
      setNotice('Private note saved for your organization.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function scheduleInterview(event: React.FormEvent) {
    event.preventDefault()
    if (!application || !interviewTime) return
    setBusy(true)
    try {
      await apiPost(`/applications/${application.id}/interviews`, {
        scheduled_at: Math.floor(new Date(interviewTime).getTime() / 1000),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        details: interviewDetails,
      })
      setInterviewTime('')
      setInterviewDetails('')
      setNotice('Interview scheduled. The candidate can see the time and calendar invite.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function createOffer(event: React.FormEvent) {
    event.preventDefault()
    if (!application) return
    setBusy(true)
    try {
      const draft = await apiPost<{ id: string }>(`/applications/${application.id}/offers`, {
        terms: { summary: offerSummary.trim() },
      })
      setDraftOfferId(draft.data.id)
      setDraftOfferSummary(offerSummary.trim())
      setOfferSummary('')
      setNotice('Offer draft saved. Review its terms, then issue it when ready.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function updateDraftOffer(event: React.FormEvent) {
    event.preventDefault()
    if (!draftOfferId) return
    setBusy(true)
    try {
      await apiPatch(`/applications/offers/${draftOfferId}`, { terms: { summary: draftOfferSummary.trim() } })
      setNotice('Offer draft updated.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function issueOffer(offerId: string) {
    if (!application) return
    setBusy(true)
    try {
      await apiPost(`/applications/offers/${offerId}/issue`, {
        expected_version: application.version,
        expires_at: offerExpiry ? Math.floor(new Date(offerExpiry).getTime() / 1000) : null,
      })
      setDraftOfferId('')
      setDraftOfferSummary('')
      setOfferExpiry('')
      setNotice('Offer issued. The candidate must respond; this does not hire them.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function assignReviewer(event: React.FormEvent) {
    event.preventDefault()
    if (!application || !reviewerUserId) return
    setBusy(true)
    try {
      await apiPost(`/applications/${application.id}/reviewers`, { user_id: reviewerUserId })
      setReviewerUserId('')
      setNotice('Reviewer assigned.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  async function hire() {
    if (!application || !window.confirm('Mark this candidate hired? An accepted offer is required.')) return
    setBusy(true)
    try {
      await apiPost(`/applications/${application.id}/hire`, { expected_version: application.version, confirmed: true })
      setNotice('Candidate marked hired.')
      await load()
    } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
  }

  if (loading) return <Loading label="Loading application…" />
  if (error || !application) return <ErrorNotice message={error || 'Application not found.'} onRetry={() => void load()} />

  const isCandidate = session.user?.id === application.candidate_id
  const canManage = session.memberships.some((membership) =>
    membership.organization_id === application.organization_id && ['owner', 'admin', 'recruiter'].includes(membership.role)
  )
  const profile = parseJson(application.snapshot?.profile_json)
  const job = parseJson(application.snapshot?.job_json)
  const answers = parseAnswers(application.snapshot?.answers_json)

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
              <dd>
                {application.snapshot?.cv_media_id
                  ? <a href={`/api/v1/media/${encodeURIComponent(application.snapshot.cv_media_id)}/content`} target="_blank" rel="noreferrer">
                      Download the submitted CV
                    </a>
                  : 'No CV attached'}
              </dd>
            </div>
          </dl>
          {answers.length > 0 && <section className="application-answers" aria-label="Submitted answers">
            <h3>Application answers</h3>
            <dl>{answers.map((item, index) => <div key={`${index}-${item.question}`}>
              <dt>{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>)}</dl>
          </section>}
        </section>
      </div>

      {isCandidate && ACTIVE_STAGES.includes(application.stage) ? (
        <section className="card">
          <h2>What happens next</h2>
          {application.stage === 'offer'
            ? <p>An offer needs your explicit response above. Accepting an offer still requires the employer to confirm the hire.</p>
            : application.interviews.some((interview) => interview.status === 'planned')
              ? <p>Respond to your interview invitation below so the employer knows whether you can attend.</p>
              : <p>Your application is with the employer. You can withdraw at any time while it stays active; every change appears in the timeline.</p>}
        </section>
      ) : null}

      {application.offers.length > 0 ? (
        <section className="card">
          <h2>Offers</h2>
          {application.offers.map((offer) => {
            const terms = parseJson(offer.terms_json)
            return (
              <div className="offer-row" key={offer.id}>
                <div>
                  <strong>Offer v{offer.version}</strong>
                  <p className="muted small">Issued {formatDateTime(offer.issued_at)} · Status: {offer.status.replace(/_/g, ' ')}{offer.expires_at ? ` · Expires ${formatDateTime(offer.expires_at)}` : ''}</p>
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
                {!isCandidate && canManage && offer.status === 'draft' ? (
                  <div className="form-grid">
                    {draftOfferId === offer.id ? (
                      <form onSubmit={(event) => void updateDraftOffer(event)}>
                        <label>Offer terms<textarea className="input" rows={2} value={draftOfferSummary} onChange={(event) => setDraftOfferSummary(event.target.value)} /></label>
                        <button className="btn btn-secondary" disabled={busy || !draftOfferSummary.trim()}>Save draft terms</button>
                      </form>
                    ) : (
                      <button type="button" className="btn btn-secondary" onClick={() => {
                        setDraftOfferId(offer.id)
                        setDraftOfferSummary(String(terms.summary || ''))
                      }}>Edit draft</button>
                    )}
                    <label>Response deadline (optional)<input className="input" type="datetime-local" value={offerExpiry} onChange={(event) => setOfferExpiry(event.target.value)} /></label>
                    <button type="button" className="btn" disabled={busy} onClick={() => void issueOffer(offer.id)}>Issue offer</button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>
      ) : null}

      {!isCandidate && canManage ? (
        <>
          <section className="card">
            <h2>Move stage</h2>
            <p className="muted small">Every change is recorded. Rejection requires confirmation.</p>
            <label>Reason for a decision or backward move<textarea className="input" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <div className="button-row">
              {EMPLOYER_TRANSITIONS.filter((stage) => {
                if (stage === application.stage) return false
                if (stage === 'rejected' || stage === 'closed') return ['submitted', 'in_review', 'shortlisted', 'interview', 'offer'].includes(application.stage)
                const transitions: Record<string, string[]> = {
                  submitted: ['in_review', 'shortlisted', 'interview'],
                  in_review: ['shortlisted', 'interview', 'submitted'],
                  shortlisted: ['in_review', 'interview', 'submitted'],
                  interview: ['in_review', 'shortlisted', 'submitted'],
                  offer: ['in_review', 'shortlisted', 'interview'],
                }
                return transitions[application.stage]?.includes(stage)
              }).map((stage) => (
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
              {application.offers.some((offer) => offer.status === 'accepted') && application.stage !== 'hired' && (
                <button type="button" className="btn" disabled={busy} onClick={() => void hire()}>Confirm hire</button>
              )}
            </div>
          </section>

          {ACTIVE_STAGES.includes(application.stage) && <>
            <form className="card form-grid" onSubmit={(event) => void addNote(event)}>
              <h2>Private employer notes</h2>
              <p className="muted small">Never shown to the candidate.</p>
              <label>Note<textarea className="input" rows={3} required maxLength={5000} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} /></label>
              <button className="btn btn-secondary" disabled={busy || !noteBody.trim()}>Save private note</button>
            </form>
            <form className="card form-grid" onSubmit={(event) => void scheduleInterview(event)}>
              <h2>Schedule interview</h2>
              <p className="muted small">Time is saved as an absolute instant with your browser’s IANA timezone.</p>
              <label>Local date and time<input className="input" type="datetime-local" required value={interviewTime} onChange={(event) => setInterviewTime(event.target.value)} /></label>
              <label>Candidate-visible details<textarea className="input" rows={2} value={interviewDetails} onChange={(event) => setInterviewDetails(event.target.value)} /></label>
              <button className="btn btn-secondary" disabled={busy}>Schedule interview</button>
            </form>
            <form className="card form-grid" onSubmit={(event) => void createOffer(event)}>
              <h2>Create offer draft</h2>
              <label>Terms summary<textarea className="input" rows={3} required value={offerSummary} onChange={(event) => setOfferSummary(event.target.value)} /></label>
              <button className="btn btn-secondary" disabled={busy || !offerSummary.trim()}>Save offer draft</button>
            </form>
            <div className="card">
              <h2>Reviewers and scorecards</h2>
              <form className="ats-filters" onSubmit={(event) => void assignReviewer(event)}>
                <label>Assign reviewer<select className="input" value={reviewerUserId} onChange={(event) => setReviewerUserId(event.target.value)}>
                  <option value="">Choose hiring member</option>{members.filter((member) => ['owner', 'admin', 'recruiter'].includes(member.role)).map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name} · {member.role}</option>)}
                </select></label>
                <button className="btn btn-secondary" disabled={busy || !reviewerUserId}>Assign</button>
              </form>
              <ul className="note-list">{application.reviewers.map((reviewer) => <li key={reviewer.id}>{reviewer.display_name} · {reviewer.role}</li>)}</ul>
              {application.reviewers.some((reviewer) => reviewer.user_id === session.user?.id) && <form className="form-grid" onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                try {
                  await apiPost(`/applications/${application.id}/scorecards`, {
                    ratings: { role_alignment: scoreRating },
                    recommendation: scoreRecommendation,
                    summary: scoreSummary,
                  })
                  setNotice('Scorecard saved. It is visible only to organization hiring members.')
                  await load()
                } catch (caught) { setNotice(errorMessage(caught)) } finally { setBusy(false) }
              }}>
                <label>Role alignment (1–5)<input className="input" type="number" min={1} max={5} value={scoreRating} onChange={(event) => setScoreRating(Number(event.target.value))} /></label>
                <label>Recommendation<select className="input" value={scoreRecommendation} onChange={(event) => setScoreRecommendation(event.target.value)}>
                  {['strong_yes', 'yes', 'mixed', 'no', 'strong_no'].map((recommendation) => <option key={recommendation} value={recommendation}>{recommendation.replace(/_/g, ' ')}</option>)}
                </select></label>
                <label>Evidence-based notes<textarea className="input" rows={3} maxLength={2000} value={scoreSummary} onChange={(event) => setScoreSummary(event.target.value)} /></label>
                <button className="btn btn-secondary" disabled={busy}>Save scorecard</button>
              </form>}
              {application.scorecards.length > 0 && <ul className="note-list">{application.scorecards.map((scorecard) => <li key={scorecard.id}><strong>{scorecard.recommendation.replace(/_/g, ' ')}</strong>{scorecard.summary ? <p>{scorecard.summary}</p> : null}</li>)}</ul>}
            </div>
          </>}

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
      ) : isCandidate ? (
        <div className="button-row">
          {ACTIVE_STAGES.includes(application.stage) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void withdraw()}>Withdraw application</button>}
          <Link className="btn btn-secondary" to={`/jobs/${application.job_id}`}>
            View job
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/jobs')}>
            Find more jobs
          </button>
        </div>
      ) : null}

      {application.interviews.length > 0 && <section className="card">
        <h2>Interviews</h2>
        <ul className="ats-interview-list">{application.interviews.map((interview) => (
          <li key={interview.id}>
            <strong>{new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: interview.timezone || 'UTC' }).format(new Date(interview.scheduled_at * 1000))}</strong>
            <span className="muted"> {interview.timezone} · {interview.status}</span>
            {interview.details && <p>{interview.details}</p>}
            {interview.status === 'planned' && <div className="button-row">
              <a className="btn btn-secondary" href={`/api/v1/applications/${encodeURIComponent(application.id)}/interviews/${encodeURIComponent(interview.id)}/calendar.ics`}>Add to calendar</a>
              {isCandidate ? <>
                <button type="button" className="btn" disabled={busy} onClick={() => void respondToInterview(interview.id, 'accepted')}>Confirm attendance</button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void respondToInterview(interview.id, 'declined')}>Decline</button>
              </> : null}
            </div>}
          </li>
        ))}</ul>
      </section>}
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
