import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

export default function Jobs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [countries, setCountries] = useState<any[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const q = searchParams.get('q') || ''
  const country = searchParams.get('country') || ''
  const arrangement = searchParams.get('arrangement') || ''

  useEffect(() => {
    fetch('/api/v1/countries').then(r => r.json() as Promise<any>).then((d: any) => setCountries(d.data || []))
    fetch('/api/v1/me/saved')
      .then(r => r.ok ? r.json() as Promise<any> : null)
      .then(data => {
        if (data?.data) setSavedIds(new Set(data.data.map((j: any) => j.id)))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (country) params.set('country', country)
    if (arrangement) params.set('arrangement', arrangement)
    fetch('/api/v1/jobs?' + params.toString())
      .then(r => r.json() as Promise<any>)
      .then((data: any) => {
        setJobs(data.data || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [q, country, arrangement])

  const toggleSave = async (jobId: string) => {
    const isSaved = savedIds.has(jobId)
    try {
      if (isSaved) {
        await fetch(`/api/v1/jobs/${jobId}/save`, { method: 'DELETE' })
        setSavedIds(prev => { const s = new Set(prev); s.delete(jobId); return s })
      } else {
        await fetch(`/api/v1/jobs/${jobId}/save`, { method: 'POST' })
        setSavedIds(prev => new Set(prev).add(jobId))
      }
    } catch {}
  }

  const share = async (job: any) => {
    const url = `${window.location.origin}/jobs/${job.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: job.title, url })
      } else {
        await navigator.clipboard.writeText(url)
        alert('Link copied')
      }
    } catch {}
  }

  return (
    <div>
      <div className="card">
        <h2 style={{marginBottom: '12px', fontSize: '22px'}}>Job Search</h2>
        <input 
          className="input" 
          placeholder="Search jobs by title, skill..." 
          defaultValue={q}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value
              setSearchParams(prev => {
                if (val) prev.set('q', val)
                else prev.delete('q')
                return prev
              })
            }
          }}
          aria-label="Search jobs"
        />
      </div>

      <div style={{display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0', marginBottom: '12px', WebkitOverflowScrolling: 'touch'}}>
        <select 
          className="filter-chip" 
          value={country}
          onChange={(e) => {
            setSearchParams(prev => {
              if (e.target.value) prev.set('country', e.target.value)
              else prev.delete('country')
              return prev
            })
          }}
          aria-label="Filter by country"
        >
          <option value="">All countries</option>
          {countries.map((c: any) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <select 
          className="filter-chip"
          value={arrangement}
          onChange={(e) => {
            setSearchParams(prev => {
              if (e.target.value) prev.set('arrangement', e.target.value)
              else prev.delete('arrangement')
              return prev
            })
          }}
          aria-label="Filter by remote/hybrid/onsite"
        >
          <option value="">Workplace</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
        </select>
        <button className="filter-chip">Eligibility</button>
        <button className="filter-chip">Skills</button>
      </div>

      {loading && <div className="card">Loading...</div>}
      {!loading && jobs.length === 0 && (
        <div className="card">
          <h3>No jobs found</h3>
          <p style={{color: 'var(--text-secondary)', marginTop: '8px'}}>Try adjusting filters. All countries are selectable - empty results are honest.</p>
        </div>
      )}
      {jobs.map((job: any) => (
        <div key={job.id} className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px'}}>
            <div style={{flex: 1, minWidth: 0}}>
              <Link to={`/jobs/${job.id}`} style={{textDecoration: 'none', color: 'inherit'}}>
                <h3 style={{marginBottom: '4px', fontSize: '18px', color: 'var(--navy)'}}>{job.title}</h3>
              </Link>
              <p style={{color: 'var(--text-secondary)', fontSize: '15px'}}>{job.org_name || 'Organization'}</p>
            </div>
            <span className={`badge ${job.origin === 'native' ? 'badge-native' : 'badge-imported'}`}>
              {job.origin === 'native' ? 'Native job' : 'Imported job'}
            </span>
          </div>
          <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px'}}>
            {job.workplace_arrangement && <span className="badge">{job.workplace_arrangement}</span>}
            {job.employment_type && <span className="badge">{job.employment_type}</span>}
            {job.eligibility_mode && <span className="badge">Eligibility: {job.eligibility_mode}</span>}
          </div>
          <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
            <Link to={`/jobs/${job.id}`} className="btn" style={{textDecoration: 'none'}}>
              {job.origin === 'native' && job.application_method === 'native' ? 'Apply' : 'View'}
            </Link>
            <button className="btn btn-secondary" onClick={() => toggleSave(job.id)}>
              {savedIds.has(job.id) ? 'Saved' : 'Save'}
            </button>
            <button className="btn btn-secondary" onClick={() => share(job)}>Share</button>
          </div>
        </div>
      ))}
    </div>
  )
}
