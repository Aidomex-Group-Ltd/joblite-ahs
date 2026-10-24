import React, { useEffect, useState } from 'react'

export default function Boards() {
  const [boards, setBoards] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/boards')
      .then(r => r.json() as Promise<any>)
      .then(data => {
        setBoards(data.data || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="card">
        <h2 style={{marginBottom: '8px', fontSize: '22px', fontWeight: 600, color: 'var(--navy)'}}>Job Boards Directory</h2>
        <p style={{color: 'var(--text-secondary)', marginBottom: '12px'}}>
          Verified external job boards and sources. Some boards may be imported via permitted feeds.
        </p>
        <div style={{padding: '12px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe'}}>
          <p style={{fontSize: '13px', color: '#1e40af'}}>
            ℹ️ Board directory is being populated with verified sources. Refresh every 30 minutes when configured.
          </p>
        </div>
      </div>

      {loading && <div className="card">Loading...</div>}
      {!loading && boards.length === 0 && (
        <div className="card">
          <h3 style={{marginBottom: '8px', color: 'var(--navy)'}}>No boards configured yet</h3>
          <p style={{color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.7'}}>
            The job board directory is managed through the source registry. Sources must be reviewed and configured
            with appropriate permissions before they appear here. Link-only boards will show directory entries
            without importing job listings.
          </p>
          <p style={{color: 'var(--text-secondary)', fontSize: '14px'}}>
            Check back for updates as verified sources are added.
          </p>
        </div>
      )}
      {boards.map((board: any) => (
        <article key={board.id} className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '10px'}}>
            <div>
              <h3 style={{fontSize: '18px', fontWeight: 600, color: 'var(--navy)', marginBottom: '4px'}}>{board.name}</h3>
              <p style={{color: 'var(--text-secondary)', fontSize: '14px'}}>{board.description || 'Job board'}</p>
            </div>
            <span className="badge">{board.permission_state || 'pending'}</span>
          </div>
          <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px'}}>
            {board.countries && <span className="badge">🌍 {board.countries}</span>}
            {board.categories && <span className="badge">📂 {board.categories}</span>}
          </div>
          {board.base_url && (
            <a href={board.base_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{textDecoration: 'none'}}>
              Visit Board ↗
            </a>
          )}
          {board.last_successful_refresh && (
            <p style={{color: 'var(--text-secondary)', fontSize: '13px', marginTop: '10px'}}>
              Last updated: {new Date(board.last_successful_refresh * 1000).toLocaleString()}
            </p>
          )}
        </article>
      ))}
    </div>
  )
}
