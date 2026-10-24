import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiPost, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { useAuthExperience } from '../components/AuthExperience'
import { PageIntro } from '../components/Common'

export default function Hiring() {
  const session = useSession(); const navigate = useNavigate(); const { openAuth } = useAuthExperience()
  const [orgName, setOrgName] = useState(''); const [selected, setSelected] = useState(session.memberships[0]?.organization_id || ''); const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  async function createOrganization(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { const result = await apiPost<{ id: string; name: string }>('/organizations', { name: orgName }); await session.refresh(); setSelected(result.data.id); setNotice(`${result.data.name} is ready for hiring.`); setOrgName('') } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) } }
  async function createJob(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { const result = await apiPost<{ id: string }>('/jobs', { organization_id: selected, title, body: description }); navigate(`/jobs/${encodeURIComponent(result.data.id)}`) } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) } }
  return <div className="page"><PageIntro title="Hiring on Joblite" subtitle="Create a structured job listing and manage applicants from your employer account." />
    {!session.user && !session.loading ? <section className="card state-card"><h2>Reach people ready for their next opportunity</h2><p>Sign in to create an employer organization, publish roles, and manage applicants.</p><button className="btn state-action" onClick={() => openAuth({ intent: 'create-job' })}>Continue with email</button></section> : <>
      {session.memberships.length > 0 && <section className="card"><h2>Your organizations</h2><ul className="jl-org-list">{session.memberships.map((org) => <li key={org.organization_id}><strong>{org.org_name}</strong><span className="badge">{org.role}</span><span className="muted">{org.verification_state}</span><Link to={`/hiring/jobs/new?organization=${encodeURIComponent(org.organization_id)}`}>Create a job</Link></li>)}</ul></section>}
      <div className="jl-hiring-columns"><form className="card form-grid" onSubmit={(event) => void createOrganization(event)}><h2>Create an employer organization</h2><p className="muted">Organization access is private to its members.</p><label>Organization name<input className="input" required minLength={2} value={orgName} onChange={(event) => setOrgName(event.target.value)} /></label><button className="btn" disabled={busy || !orgName.trim()}>{busy ? 'Working…' : 'Create organization'}</button></form>
      {session.memberships.length > 0 && <form className="card form-grid" onSubmit={(event) => void createJob(event)}><h2>Draft a job</h2><label>Organization<select className="input" required value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose organization</option>{session.memberships.filter((org) => ['owner','admin','recruiter'].includes(org.role)).map((org) => <option key={org.organization_id} value={org.organization_id}>{org.org_name}</option>)}</select></label><label>Job title<input className="input" required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Description<textarea className="input" required minLength={20} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="btn" disabled={busy || !selected}>{busy ? 'Submitting…' : 'Create job draft'}</button></form>}</div>
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
      {session.memberships.length === 0 && <div className="card"><p className="muted">Your employer organizations will appear here after you create one.</p></div>}
    </>}
  </div>
}
