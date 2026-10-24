import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export default function Applications() {
  const [apps, setApps] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/me/applications')
      .then(r => r.ok ? r.json() as Promise<any> : null)
      .then(data => {
        setApps(data?.data || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="card">
        <h2 style={{marginBottom: '8px'}}>My Applications</h2>
        <p style={{color: 'var(--text-secondary)'}}>Track your application progress</p>
      </div>
      {loading && <div className="card">Loading...</div>}
      {!loading && apps.length === 0 && (
        <div className="card">
          <h3>No applications yet</h3>
          <p style={{color: 'var(--text-secondary)', marginTop: '8px'}}>Apply to native jobs to track them here.</p>
          <Link to="/jobs" className="btn" style={{display: 'inline-flex', marginTop: '12px', textDecoration: 'none'}}>Browse jobs</Link>
        </div>
      )}
      {apps.map((app: any) => (
        <div key={app.id} className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start'}}>
            <div>
              <h3 style={{marginBottom: '4px'}}>{app.title}</h3>
              <p style={{color: 'var(--text-secondary)'}}>{app.org_name || 'Organization'}</p>
            </div>
            <span className="badge">{app.stage}</span>
          </div>
          <p style={{color: 'var(--text-secondary)', fontSize: '14px', marginTop: '8px'}}>
            Submitted {app.submitted_at ? new Date(app.submitted_at * 1000).toLocaleDateString() : ''}
          </p>
        </div>
      ))}
    </div>
  )
}
