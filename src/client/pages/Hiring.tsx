import React, { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiDownload, apiGet, apiPatch, apiPost, errorMessage } from '../lib/api'
import { stageLabel } from '../lib/format'
import { useSession } from '../lib/session'
import { useAuthExperience } from '../components/AuthExperience'
import { EmptyState, ErrorNotice, Loading, PageIntro } from '../components/Common'
import '../styles/ats.css'

type Job = {
  id: string
  title: string
  body: string
  status: string
  version: number
  application_count: number
  employment_type: string | null
  workplace_arrangement: string | null
  application_questions_json: string
  archived_at: number | null
}
type Applicant = { id: string; stage: string; version: number; submitted_at: number; job_id: string; title: string; candidate_name: string }
type Overview = {
  jobs: { total: number; published: number; drafts: number; active: number }
  applications: { total: number; in_review: number }
  offers: { total: number; issued: number }
  stages: Array<{ stage: string; total: number }>
  upcoming_interviews: number
  recent_applications: Applicant[]
}
type Report = {
  window: { from: string; to: string; timezone: string }
  totals: { applications: number; active: number; hired: number; rejected: number; withdrawn: number; closed: number; without_history: number; missing_hire_timestamp: number; out_of_order_events: number }
  conversion: { applied_to_interview: number | null; applied_to_offer: number | null; applied_to_hired: number | null; offered_to_hired: number | null }
  time_to_hire_days: { average: number | null; median: number | null; samples: number }
  stages: Array<{ stage: string; current: number; reached: number; average_days: number | null; median_days: number | null; samples: number }>
  definitions: Record<string, string>
}
type BulkResult = { action: string; to: string; requested: number; succeeded_count: number; failed_count: number; failed: Array<{ id: string; code: string; message: string }> }

const BULK_CHOICES = [
  { value: 'in_review', label: 'Move to Screening' },
  { value: 'shortlisted', label: 'Move to Shortlisted' },
  { value: 'interview', label: 'Move to Interview' },
  { value: 'reject', label: 'Reject selected' },
  { value: 'close', label: 'Close selected' },
]

const PAGE_SIZE = 20
const ROLES = ['owner', 'admin', 'recruiter']
const JOB_STATUSES = ['draft', 'published', 'paused', 'closed']
const STAGES = ['submitted', 'in_review', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn', 'closed']

export default function Hiring() {
  const session = useSession()
  const { openAuth } = useAuthExperience()
  const { id: routeJobId } = useParams()
  const [searchParams] = useSearchParams()
  const [orgName, setOrgName] = useState('')
  const [selected, setSelected] = useState(searchParams.get('organization') || session.memberships[0]?.organization_id || '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [workplaceArrangement, setWorkplaceArrangement] = useState('')
  const [applicationQuestionText, setApplicationQuestionText] = useState('')
  const [editingJobId, setEditingJobId] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [stage, setStage] = useState('')
  const [applicantQuery, setApplicantQuery] = useState('')
  const [jobFilter, setJobFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [applicantTotal, setApplicantTotal] = useState(0)
  const [applicantView, setApplicantView] = useState<'list' | 'board'>('list')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkChoice, setBulkChoice] = useState('in_review')
  const [bulkReason, setBulkReason] = useState('')
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const canHire = session.memberships.some(
    (membership) => membership.organization_id === selected && ROLES.includes(membership.role)
  )

  useEffect(() => {
    if (!selected && session.memberships.length) setSelected(session.memberships[0].organization_id)
  }, [selected, session.memberships])
  useEffect(() => {
    if (routeJobId) {
      setJobFilter(routeJobId)
      setOffset(0)
    }
  }, [routeJobId])

  const load = useCallback(async () => {
    if (!selected) {
      setJobs([])
      setApplicants([])
      setOverview(null)
      setReport(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (stage) params.set('stage', stage)
      if (jobFilter) params.set('job_id', jobFilter)
      if (applicantQuery.trim()) params.set('q', applicantQuery.trim())
      const reportParams = new URLSearchParams()
      if (reportFrom) reportParams.set('from', reportFrom)
      if (reportTo) reportParams.set('to', reportTo)
      const [overviewResponse, jobsResponse, applicationsResponse, reportResponse] = await Promise.all([
        apiGet<Overview>(`/organizations/${encodeURIComponent(selected)}/overview`),
        apiGet<Job[]>(`/organizations/${encodeURIComponent(selected)}/jobs?limit=100`),
        apiGet<Applicant[]>(`/organizations/${encodeURIComponent(selected)}/applications?${params.toString()}`),
        canHire
          ? apiGet<Report>(`/organizations/${encodeURIComponent(selected)}/reports?${reportParams.toString()}`)
          : Promise.resolve({ data: null }),
      ])
      setOverview(overviewResponse.data)
      setJobs(jobsResponse.data || [])
      setApplicants(applicationsResponse.data || [])
      setApplicantTotal(Number(applicationsResponse.meta?.total || 0))
      setReport(reportResponse.data)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [selected, offset, stage, jobFilter, applicantQuery, reportFrom, reportTo, canHire])

  useEffect(() => { void load() }, [load])

  function toggleApplicant(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function runBulk() {
    if (!selected || selectedIds.length === 0) return
    const choice = BULK_CHOICES.find((item) => item.value === bulkChoice)
    if (!choice) return
    const terminal = choice.value === 'reject' || choice.value === 'close'
    if (terminal && !bulkReason.trim()) { setNotice('Add a reason before rejecting or closing applications.'); return }
    const question = `Apply “${choice.label}” to ${selectedIds.length} application${selectedIds.length === 1 ? '' : 's'}?`
    if (!window.confirm(question)) return
    setBusy(true)
    setNotice('')
    setBulkResult(null)
    try {
      const items = selectedIds.map((id) => ({
        id,
        expected_version: applicants.find((applicant) => applicant.id === id)?.version ?? -1,
      }))
      const response = await apiPost<BulkResult>('/applications/bulk', {
        organization_id: selected,
        action: terminal ? choice.value : 'stage',
        ...(terminal ? {} : { to: choice.value }),
        reason: bulkReason.trim(),
        confirmed: terminal,
        items,
      })
      setBulkResult(response.data)
      setNotice(`${response.data.succeeded_count} updated, ${response.data.failed_count} not changed.`)
      setSelectedIds(response.data.failed.map((item) => item.id))
      setBulkReason('')
      await load()
    } catch (cause) {
      setNotice(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    if (!selected) return
    const params = new URLSearchParams()
    if (stage) params.set('stage', stage)
    if (jobFilter) params.set('job_id', jobFilter)
    try {
      await apiDownload(`/organizations/${encodeURIComponent(selected)}/applications/export.csv?${params.toString()}`, 'joblite-applications.csv')
      setNotice('Export downloaded. Internal notes and scorecards are never included.')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await apiPost<{ id: string; name: string }>('/organizations', { name: orgName })
      await session.refresh()
      setSelected(result.data.id)
      setNotice(`${result.data.name} is ready for hiring.`)
      setOrgName('')
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  async function createJob(event: React.FormEvent) {
    event.preventDefault()
    const applicationQuestions = applicationQuestionText.split('\n').map((question) => question.trim()).filter(Boolean)
    if (applicationQuestions.length > 5 || applicationQuestions.some((question) => question.length > 240)) {
      setError('Add no more than five application questions, with each question 240 characters or fewer.')
      return
    }
    setBusy(true); setError('')
    try {
      if (editingJobId) {
        const job = jobs.find((item) => item.id === editingJobId)
        if (!job) throw new Error('This job is no longer available. Refresh and try again.')
        await apiPatch(`/jobs/${encodeURIComponent(editingJobId)}`, {
          expected_version: job.version,
          title,
          body: description,
          employment_type: employmentType,
          workplace_arrangement: workplaceArrangement,
          application_questions: applicationQuestions,
        })
        setNotice('Job changes saved.')
      } else {
        await apiPost<{ id: string }>('/jobs', {
          organization_id: selected,
          title,
          body: description,
          employment_type: employmentType,
          workplace_arrangement: workplaceArrangement,
          application_questions: applicationQuestions,
        })
        setNotice('Draft job created.')
      }
      setTitle(''); setDescription(''); setEmploymentType(''); setWorkplaceArrangement('')
      setApplicationQuestionText(''); setEditingJobId('')
      await load()
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  function editJob(job: Job) {
    setEditingJobId(job.id)
    setTitle(job.title)
    setDescription(job.body)
    setEmploymentType(job.employment_type || '')
    setWorkplaceArrangement(job.workplace_arrangement || '')
    try {
      const questions: unknown = JSON.parse(job.application_questions_json || '[]')
      setApplicationQuestionText(Array.isArray(questions) ? questions.filter((item): item is string => typeof item === 'string').join('\n') : '')
    } catch {
      setApplicationQuestionText('')
    }
    document.getElementById('ats-job-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function archiveJob(job: Job) {
    if (!window.confirm(`Archive “${job.title}”? Archived jobs cannot be reopened.`)) return
    const reason = window.prompt('Why are you archiving this closed vacancy?')
    if (!reason?.trim()) return
    setBusy(true)
    setNotice('')
    try {
      await apiPost(`/jobs/${encodeURIComponent(job.id)}/archive`, {
        expected_version: job.version,
        reason: reason.trim(),
      })
      setNotice('Job archived.')
      await load()
    } catch (cause) { setNotice(errorMessage(cause)) } finally { setBusy(false) }
  }

  function cancelEdit() {
    setEditingJobId('')
    setTitle('')
    setDescription('')
    setEmploymentType('')
    setWorkplaceArrangement('')
    setApplicationQuestionText('')
  }

  async function setJobStatus(job: Job, status: string) {
    if (status === 'closed' && !window.confirm('Close this vacancy? Resolve every active application first.')) return
    if (job.status === 'closed' && status !== 'closed' && !window.confirm('Reopen this vacancy?')) return
    setBusy(true); setNotice('')
    try {
      await apiPatch(`/jobs/${encodeURIComponent(job.id)}/status`, {
        status,
        expected_version: job.version,
        ...(job.status === 'closed' ? { reopen_confirmed: true, reason: 'Reopened by organization member' } : {}),
      })
      setNotice(`Job status changed to ${status}.`)
      await load()
    } catch (cause) { setNotice(errorMessage(cause)) } finally { setBusy(false) }
  }

  if (!session.user && !session.loading) {
    return <div className="page">
      <PageIntro title="Hiring on Joblite" subtitle="Manage jobs and applicants with an auditable, human-controlled workflow." />
      <section className="card state-card"><h2>Manage your hiring pipeline</h2><p>Sign in to create an employer organization, publish roles, and manage applicants.</p><button className="btn state-action" onClick={() => openAuth({ intent: 'create-job' })}>Continue with email</button></section>
    </div>
  }

  return <div className="page">
    <PageIntro title="Hiring workspace" subtitle="Track vacancies, review applicant pipelines, and take explicit human decisions." />
    {session.memberships.length > 0 && <section className="card ats-toolbar">
      <label>Organization<select className="input" value={selected} onChange={(event) => { setSelected(event.target.value); setOffset(0) }}>
        {session.memberships.map((org) => <option key={org.organization_id} value={org.organization_id}>{org.org_name} · {org.role}</option>)}
      </select></label>
      {canHire && <Link className="btn btn-secondary" to={`/hiring/jobs/new?organization=${encodeURIComponent(selected)}`}>Create job</Link>}
      {canHire && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void exportCsv()}>Export CSV</button>}
    </section>}
    {error && <ErrorNotice message={error} onRetry={() => void load()} />}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {loading && selected && <Loading label="Loading hiring workspace…" />}
    {!session.loading && session.memberships.length === 0 && <div className="jl-hiring-columns">
      <form className="card form-grid" onSubmit={(event) => void createOrganization(event)}>
        <h2>Create an employer organization</h2><p className="muted">Organization access is private to its members.</p>
        <label>Organization name<input className="input" required minLength={2} value={orgName} onChange={(event) => setOrgName(event.target.value)} /></label>
        <button className="btn" disabled={busy || !orgName.trim()}>{busy ? 'Working…' : 'Create organization'}</button>
      </form>
    </div>}
    {!session.loading && selected && !loading && overview && <>
      <section className="ats-metrics" aria-label="Hiring overview">
        <div className="card"><strong>{overview.jobs.active}</strong><span>Active jobs</span></div>
        <div className="card"><strong>{overview.applications.total}</strong><span>Applications</span></div>
        <div className="card"><strong>{overview.applications.in_review}</strong><span>In Screening</span></div>
        <div className="card"><strong>{overview.upcoming_interviews}</strong><span>Upcoming interviews</span></div>
        <div className="card"><strong>{overview.offers.total}</strong><span>Offers issued</span></div>
        <div className="card"><strong>{overview.offers.issued}</strong><span>Awaiting response</span></div>
        <div className="card"><strong>{overview.jobs.published}</strong><span>Published (including expired)</span></div>
        <div className="card"><strong>{overview.jobs.drafts}</strong><span>Drafts</span></div>
      </section>
      <section className="card" aria-label="Applications by stage">
        <h2>Pipeline by stage</h2>
        <div className="stage-summary">
          {overview.stages.map((item) => <div className="stage-pill" key={item.stage}><strong>{item.total}</strong><span>{stageLabel(item.stage)}</span></div>)}
          {overview.stages.length === 0 && <p className="muted">No applicants yet.</p>}
        </div>
      </section>
      {canHire && report ? <section className="card" aria-label="Hiring reports">
        <h2>Hiring outcomes</h2>
        <div className="ats-filters">
          <label>From<input className="input" type="date" value={reportFrom || report.window.from} onChange={(event) => setReportFrom(event.target.value)} /></label>
          <label>To<input className="input" type="date" value={reportTo || report.window.to} onChange={(event) => setReportTo(event.target.value)} /></label>
        </div>
        {report.totals.applications === 0 ? <p className="muted">No applications were submitted in this date range, so there is nothing to report yet.</p> : <>
          <div className="ats-metrics">
            <div className="card"><strong>{report.totals.applications}</strong><span>Applications</span></div>
            <div className="card"><strong>{report.totals.hired}</strong><span>Hired</span></div>
            <div className="card"><strong>{report.time_to_hire_days.median === null ? '—' : `${report.time_to_hire_days.median.toFixed(1)}d`}</strong><span>Median time to hire ({report.time_to_hire_days.samples} hires)</span></div>
            <div className="card"><strong>{report.conversion.applied_to_hired === null ? '—' : `${Math.round(report.conversion.applied_to_hired * 100)}%`}</strong><span>Applied → hired</span></div>
          </div>
          <div className="ats-table-wrap">
            <table className="ats-table">
              <caption className="muted small">Stage volume and recorded duration for {report.window.from} to {report.window.to} (UTC).</caption>
              <thead><tr><th scope="col">Stage</th><th scope="col">Now</th><th scope="col">Reached</th><th scope="col">Median days</th></tr></thead>
              <tbody>{report.stages.map((row) => <tr key={row.stage}>
                <th scope="row">{stageLabel(row.stage)}</th>
                <td>{row.current}</td>
                <td>{row.reached}</td>
                <td>{row.median_days === null ? 'No data' : row.median_days.toFixed(1)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="muted small">
            Withdrawn {report.totals.withdrawn} · Rejected {report.totals.rejected} · Closed {report.totals.closed} · Active {report.totals.active}.
            {report.totals.without_history > 0 ? ` ${report.totals.without_history} application(s) have no recorded events and are excluded from duration averages.` : ''}
            {report.totals.missing_hire_timestamp > 0 ? ` ${report.totals.missing_hire_timestamp} hire(s) lack a hire timestamp and are excluded from time to hire.` : ''}
          </p>
        </>}
        <details><summary>How these numbers are defined</summary>
          <ul className="ats-definitions">{Object.entries(report.definitions).map(([key, value]) => <li key={key}><strong>{key.replace(/_/g, ' ')}</strong>: {value}</li>)}</ul>
        </details>
      </section> : null}
      <section className="card">
        <h2>Applicant pipeline</h2>
        <div className="ats-filters">
          <label>Stage<select className="input" value={stage} onChange={(event) => { setStage(event.target.value); setOffset(0) }}>
            <option value="">All stages</option>{STAGES.map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}
          </select></label>
          <label>Job<select className="input" value={jobFilter} onChange={(event) => { setJobFilter(event.target.value); setOffset(0) }}>
            <option value="">All jobs</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select></label>
          <label>Candidate or job<input className="input" value={applicantQuery} onChange={(event) => { setApplicantQuery(event.target.value); setOffset(0) }} placeholder="Search applicant or job" /></label>
        </div>
        {canHire && applicants.length > 0 ? <div className="ats-bulk">
          <label className="ats-select-all">
            <input
              type="checkbox"
              checked={applicants.every((candidate) => selectedIds.includes(candidate.id))}
              onChange={(event) => setSelectedIds(event.target.checked ? applicants.map((candidate) => candidate.id) : [])}
            />
            Select this page
          </label>
          <label>Bulk action<select className="input" value={bulkChoice} onChange={(event) => setBulkChoice(event.target.value)}>
            {BULK_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select></label>
          <label>Reason<input className="input" value={bulkReason} maxLength={1000} onChange={(event) => setBulkReason(event.target.value)} placeholder="Required to reject or close" /></label>
          <button type="button" className="btn btn-secondary" disabled={busy || selectedIds.length === 0} onClick={() => void runBulk()}>
            Apply to {selectedIds.length} selected
          </button>
        </div> : null}
        {bulkResult && bulkResult.failed_count > 0 ? <div className="ats-bulk-errors" role="alert">
          <p>{bulkResult.failed_count} of {bulkResult.requested} applications were not changed:</p>
          <ul>{bulkResult.failed.map((item) => <li key={`${item.id}-${item.code}`}><code>{item.id}</code> · {item.message}</li>)}</ul>
        </div> : null}
        <div className="ats-view-toggle" aria-label="Applicant view">
          <button type="button" className="btn btn-secondary" aria-pressed={applicantView === 'list'} onClick={() => setApplicantView('list')}>List</button>
          <button type="button" className="btn btn-secondary" aria-pressed={applicantView === 'board'} onClick={() => setApplicantView('board')}>Pipeline board</button>
        </div>
        {applicants.length === 0 ? <p className="muted">No applications match these filters.</p> : applicantView === 'board'
          ? <div className="ats-board" aria-label="Applicants grouped by stage">
            {STAGES.map((item) => {
              const stageApplicants = applicants.filter((candidate) => candidate.stage === item)
              return <section className="ats-board-column" key={item} aria-label={`${stageLabel(item)} stage`}>
                <h3>{stageLabel(item)} <span>{stageApplicants.length}</span></h3>
                {stageApplicants.length === 0 ? <p className="muted">No applicants on this page.</p> : <ul>
                  {stageApplicants.map((candidate) => <li key={candidate.id}>
                    {canHire && <input
                      type="checkbox"
                      aria-label={`Select ${candidate.candidate_name}`}
                      checked={selectedIds.includes(candidate.id)}
                      onChange={() => toggleApplicant(candidate.id)}
                    />}
                    <Link to={`/applications/${encodeURIComponent(candidate.id)}`} aria-label={`Review ${candidate.candidate_name}, ${stageLabel(item)}`}>
                      <strong>{candidate.candidate_name}</strong><span>{candidate.title}</span>
                    </Link>
                  </li>)}
                </ul>}
              </section>
            })}
            <p className="muted small">Board cards reflect the current filters and page. Use Review to open an application and make an authorized stage change.</p>
          </div>
          : <ul className="ats-applicant-list">
            {applicants.map((candidate) => <li key={candidate.id} className="ats-applicant-row">
              {canHire ? <input
                type="checkbox"
                aria-label={`Select ${candidate.candidate_name}`}
                checked={selectedIds.includes(candidate.id)}
                onChange={() => toggleApplicant(candidate.id)}
              /> : null}
              <div><Link className="link-heading" to={`/applications/${candidate.id}`}>{candidate.candidate_name}</Link><p className="muted">{candidate.title}</p></div>
              <span className={`badge stage-${candidate.stage}`}>{stageLabel(candidate.stage)}</span>
              <Link className="btn btn-secondary" to={`/applications/${candidate.id}`}>Review</Link>
            </li>)}
          </ul>}
        <div className="ats-pagination"><span>{applicantTotal ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, applicantTotal)} of ${applicantTotal}` : '0 applications'}</span>
          <button className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
          <button className="btn btn-secondary" disabled={offset + PAGE_SIZE >= applicantTotal} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
        </div>
      </section>
      <section className="card"><h2>Jobs</h2>
        {jobs.length === 0 ? <EmptyState title="No jobs yet"><p>Create a draft to start managing a vacancy.</p></EmptyState> : <ul className="ats-job-list">
          {jobs.map((job) => <li key={job.id} className="ats-job-row">
            <div><strong>{job.title}</strong><p className="muted">{job.application_count} applicant{job.application_count === 1 ? '' : 's'}</p></div>
            <span className={`badge job-status-${job.status}`}>{job.archived_at ? 'archived' : job.status}</span>
            {canHire && !job.archived_at && <select aria-label={`Set ${job.title} status`} className="input ats-status-select" value={job.status} disabled={busy} onChange={(event) => void setJobStatus(job, event.target.value)}>
              {JOB_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>}
            {canHire && !job.archived_at && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => editJob(job)}>Edit</button>}
            {canHire && !job.archived_at && job.status === 'closed' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void archiveJob(job)}>Archive</button>}
            <Link to={`/hiring/jobs/${encodeURIComponent(job.id)}/applicants`}>Applicants</Link>
          </li>)}
        </ul>}
      </section>
      <form className="card form-grid" onSubmit={(event) => void createOrganization(event)}>
        <h2>Create another employer organization</h2>
        <label>Organization name<input className="input" required minLength={2} value={orgName} onChange={(event) => setOrgName(event.target.value)} /></label>
        <button className="btn btn-secondary" disabled={busy || !orgName.trim()}>{busy ? 'Working…' : 'Create organization'}</button>
      </form>
      {canHire && <form id="ats-job-form" className="card form-grid" onSubmit={(event) => void createJob(event)}>
        <h2>{editingJobId ? 'Edit job' : 'Draft a job'}</h2>
        <label>Job title<input className="input" required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Description<textarea className="input" required minLength={20} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label>Employment type<input className="input" maxLength={100} value={employmentType} onChange={(event) => setEmploymentType(event.target.value)} /></label>
        <label>Workplace arrangement<select className="input" value={workplaceArrangement} onChange={(event) => setWorkplaceArrangement(event.target.value)}>
          <option value="">Not specified</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option>
        </select></label>
        <label>Application questions (one per line, optional)<textarea className="input" rows={3} maxLength={1204} value={applicationQuestionText} onChange={(event) => setApplicationQuestionText(event.target.value)} placeholder="What interests you about this role?" /></label>
        <div className="button-row">
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : editingJobId ? 'Save job changes' : 'Create job draft'}</button>
          {editingJobId && <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancelEdit}>Cancel edit</button>}
        </div>
      </form>}
    </>}
  </div>
}
