import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiDelete, apiGet, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { useAuthExperience } from '../components/AuthExperience'
import { ErrorNotice, Loading, PageIntro } from '../components/Common'

type SavedJob = { id: string; title: string; org_name: string | null; company_name: string | null; origin: string; location_text: string | null; workplace_arrangement: string | null; source_name: string | null; saved_at: number }
export default function Saved() {
  const { user, loading: sessionLoading } = useSession()
  const { openAuth } = useAuthExperience()
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => { try { const response = await apiGet<SavedJob[]>('/me/saved'); setJobs(response.data || []); setError('') } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) } }, [])
  useEffect(() => { if (user) void load(); else if (!sessionLoading) setLoading(false) }, [user, sessionLoading, load])
  async function remove(id: string) { try { await apiDelete(`/jobs/${encodeURIComponent(id)}/save`); setJobs((current) => current.filter((job) => job.id !== id)) } catch (cause) { setError(errorMessage(cause)) } }
  return <div className="page"><PageIntro title="Saved" subtitle="Opportunities you’ve saved for later." />
    {!user && !sessionLoading ? <section className="card state-card"><h2>Your saved opportunities</h2><p>Sign in to save and revisit jobs across sessions.</p><button className="btn state-action" onClick={() => openAuth({ intent: 'save' })}>Continue with email</button></section> : loading ? <Loading label="Loading saved opportunities…" /> : error ? <ErrorNotice message={error} onRetry={() => { setLoading(true); void load() }} /> : jobs.length ? <div className="job-list">{jobs.map((job) => <article className="card job-row" key={job.id}><div><strong>{job.org_name || job.company_name || 'Employer'}</strong><h2><Link className="link-heading" to={`/jobs/${encodeURIComponent(job.id)}`}>{job.title}</Link></h2><p className="muted">{job.location_text || 'Location not specified'}{job.workplace_arrangement === 'remote' ? ' · Remote' : ''} · {job.origin === 'imported' ? `External · ${job.source_name || 'Source'}` : 'Joblite'}</p></div><div className="job-row-actions"><Link className="btn btn-secondary" to={`/jobs/${encodeURIComponent(job.id)}`}>View job</Link><button className="btn btn-secondary" onClick={() => void remove(job.id)}>Remove</button></div></article>)}</div> : <section className="card state-card"><h2>No saved jobs yet</h2><p>Save a job from the feed and it will appear here.</p><Link className="btn state-action" to="/jobs">Explore jobs</Link></section>}
  </div>
}
