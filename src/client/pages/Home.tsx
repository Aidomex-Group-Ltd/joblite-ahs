import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export default function Home() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'discover' | 'following'>('discover')
  const [composerMode, setComposerMode] = useState<'post' | 'job'>('post')
  const [user, setUser] = useState<any>(null)
  const [appCount, setAppCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/v1/posts')
      .then(r => r.json() as Promise<any>)
      .then(data => {
        setPosts(data.data || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
    
    fetch('/api/v1/me')
      .then(r => r.ok ? r.json() as Promise<any> : null)
      .then(data => {
        if (data?.data?.user) setUser(data.data.user)
        if (data?.data?.applications) setAppCount(data.data.applications.length)
      })
      .catch(() => {})
  }, [])

  return (
    <div style={{width: '100%'}}>
      <div className="card" style={{borderRadius: '0', borderLeft: 'none', borderRight: 'none', marginBottom: '0'}}>
        <div style={{display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px'}}>
          <div className="avatar" style={{width: '40px', height: '40px', flexShrink: 0}}>U</div>
          <div style={{flex: 1}}>
            <div style={{display: 'flex', gap: '8px', marginBottom: '12px'}}>
              <button className={`tab-btn ${composerMode === 'post' ? 'active' : ''}`} style={{padding: '8px 16px'}} onClick={() => setComposerMode('post')}>Post</button>
              <button className={`tab-btn ${composerMode === 'job' ? 'active' : ''}`} style={{padding: '8px 16px'}} onClick={() => setComposerMode('job')}>Job</button>
            </div>
            {composerMode === 'post' ? (
              <textarea className="input" placeholder="What's happening?" rows={3} style={{resize: 'vertical', border: 'none', padding: '8px 0'}} aria-label="Post content" />
            ) : (
              <Link to="/hiring/jobs/new" style={{display: 'block', padding: '12px 0', color: 'var(--text-secondary)'}}>Create a structured job post →</Link>
            )}
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '8px'}}>
              <div style={{display: 'flex', gap: '8px'}}>
                <button className="filter-chip" aria-label="Add image">🖼️</button>
                <button className="filter-chip" aria-label="Add video">🎬</button>
              </div>
              <button className="btn" disabled={!user} aria-label={composerMode === 'post' ? 'Post' : 'Create job'} style={{minWidth: '80px'}}>
                {composerMode === 'post' ? 'Post' : 'Job'}
              </button>
            </div>
          </div>
        </div>
        {!user && <p style={{color: 'var(--text-secondary)', fontSize: '13px'}}>Sign in to post</p>}
      </div>

      <div style={{display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-primary)'}}>
        <button className={`tab-btn ${activeTab === 'discover' ? 'active' : ''}`} style={{flex: 1}} onClick={() => setActiveTab('discover')}>Discover</button>
        <button className={`tab-btn ${activeTab === 'following' ? 'active' : ''}`} style={{flex: 1}} onClick={() => setActiveTab('following')}>Following</button>
      </div>

      <div style={{padding: '12px 16px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)'}}>
        <Link to="/applications" style={{fontSize: '14px', color: 'var(--accent)'}}>My Applications {appCount !== null ? `(${appCount})` : ''} →</Link>
      </div>

      {loading && <div className="card" style={{borderRadius: '0', borderLeft: 'none', borderRight: 'none'}}>Loading...</div>}
      {!loading && posts.length === 0 && (
        <div className="card" style={{borderRadius: '0', borderLeft: 'none', borderRight: 'none'}}>
          <p style={{color: 'var(--text-secondary)'}}>No posts yet</p>
        </div>
      )}
      {posts.map((post: any) => (
        <article key={post.id} className="card" style={{borderRadius: '0', borderLeft: 'none', borderRight: 'none', marginBottom: '0', borderTop: 'none'}}>
          <div style={{display: 'flex', gap: '12px'}}>
            <div className="avatar" style={{width: '40px', height: '40px', flexShrink: 0}}></div>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap'}}>
                <strong style={{color: 'var(--navy)', fontSize: '15px'}}>@{post.author_handle || 'user'}</strong>
                <span style={{color: 'var(--text-secondary)', fontSize: '14px'}}>· {new Date(post.created_at * 1000).toLocaleDateString()}</span>
              </div>
              <p style={{marginTop: '4px', whiteSpace: 'pre-wrap', color: 'var(--navy)', fontSize: '15px'}}>{post.body}</p>
              <div style={{display: 'flex', gap: '40px', marginTop: '12px', color: 'var(--text-secondary)'}}>
                <button style={{background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '14px'}}>💬</button>
                <button style={{background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '14px'}}>🔁</button>
                <button style={{background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '14px'}}>❤️</button>
                <button style={{background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '14px'}}>🔗</button>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
