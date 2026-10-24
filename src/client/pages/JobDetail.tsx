import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

export default function JobDetail() {
  const { id } = useParams()
  const [job, setJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/jobs/' + id)
      .then(r => r.json() as Promise<any>)
      .then(data => {
        setJob(data.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return <div className="card">Loading...</div>
  if (!job) return <div className="card"><h3>Job not found</h3><Link to="/jobs">← Back to jobs</Link></div>

  const isNativeApply = job.origin === 'native' && job.application_method === 'native'

  return (
    <div>
      <Link to="/jobs" style={{marginBottom: '16px', display: 'inline-block', color: 'var(--navy)'}}>← Back to jobs</Link>
      <div className="card">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px', gap: '12px'}}>
          <div style={{flex: 1, minWidth: 0}}>
            <h1 style={{fontSize: '24px', marginBottom: '6px', color: 'var(--navy)'}}>{job.title}</h1>
            <p style={{color: 'var(--text-secondary)', fontSize: '17px'}}>{job.org_name || 'Organization'}</p>
          </div>
          <span className={`badge ${job.origin === 'native' ? 'badge-native' : 'badge-imported'}`}>
            {job.origin === 'native' ? 'Native job' : 'Imported job'}
          </span>
        </div>
        
        <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px'}}>
          {job.workplace_arrangement && <span className="badge">Location: {job.workplace_arrangement}</span>}
          {job.employment_type && <span className="badge">{job.employment_type}</span>}
          {job.eligibility_mode && <span className="badge">Eligibility: {job.eligibility_mode}</span>}
        </div>
        
        <div style={{marginBottom: '20px'}}>
          <h3 style={{marginBottom: '10px', color: 'var(--navy)'}}>Description</h3>
          <p style={{whiteSpace: 'pre-wrap', lineHeight: '1.7', color: 'var(--navy)'}}>{job.body}</p>
        </div>
        
        {isNativeApply ? (
          <button className="btn" style={{width: '100%'}} aria-label="Apply inside Joblite">Apply inside Joblite</button>
        ) : (
          <div>
            <p style={{color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '14px'}}>
              This is an imported job. Apply at the source.
            </p>
            <a href={job.canonical_url || '#'} target="_blank" rel="noopener noreferrer" className="btn" style={{display: 'inline-flex', textDecoration: 'none'}} aria-label="Apply at source">
              Apply at source ↗
            </a>
            <p style={{color: 'var(--text-secondary)', marginTop: '8px', fontSize: '13px'}}>
              You can manually mark this job as applied in your tracker.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
