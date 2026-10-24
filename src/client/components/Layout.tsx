import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { JobliteBrand } from './JobliteBrand'
import { useSession } from '../lib/session'
import { apiGet } from '../lib/api'

const links = [
  ['/', 'Home', '⌂'], ['/jobs', 'Jobs', '⌕'], ['/saved', 'Saved', '♡'],
  ['/applications', 'Applications', '▤'], ['/hiring', 'Hiring', '＋'],
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { user, loading, unreadNotifications } = useSession()
  const [hasApplications, setHasApplications] = useState(false)
  useEffect(() => {
    let active = true
    if (!user) { setHasApplications(false); return () => { active = false } }
    apiGet<{ applications: { total: number }; external_tracked: number }>('/me/summary').then(({ data }) => { if (active) setHasApplications(data.applications.total > 0 || data.external_tracked > 0) }).catch(() => { if (active) setHasApplications(false) })
    return () => { active = false }
  }, [user])
  const bare = location.pathname === '/' || location.pathname === '/compose' || /^\/posts\/[^/]+\/media\/\d+$/.test(location.pathname)
  if (bare) return <>{children}</>
  return <div className="jl-site-layout">
    <header className="jl-site-header">
      <JobliteBrand />
      <nav className="jl-top-links" aria-label="Account navigation">
        <Link to="/notifications" aria-label="Notifications">Notifications{unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}</Link>
        <Link to={user ? '/settings' : '/sign-in'}>{user ? 'Account' : 'Sign in'}</Link>
      </nav>
    </header>
    <div className="jl-site-content">
      <nav className="jl-site-sidebar" aria-label="Main navigation">
        {links.filter(([path]) => path !== '/applications' || (user && !loading && hasApplications)).map(([path, title, icon]) => <Link key={path} to={path} aria-current={location.pathname === path ? 'page' : undefined}><span aria-hidden="true">{icon}</span>{title}</Link>)}
      </nav>
      <main className="jl-site-main">{children}</main>
      <aside className="jl-site-aside"><div className="card"><strong>Joblite AHS</strong><p className="muted">Discover opportunities and share what you’re building.</p><Link to="/jobs" className="btn btn-secondary">Explore jobs</Link></div></aside>
    </div>
    <nav className="jl-mobile-nav" aria-label="Main navigation">
      {links.filter(([path]) => path !== '/applications' || (user && !loading && hasApplications)).map(([path, title, icon]) => <Link key={path} to={path} aria-current={location.pathname === path ? 'page' : undefined}><span aria-hidden="true">{icon}</span><small>{title}</small></Link>)}
      <Link to="/notifications" aria-current={location.pathname === '/notifications' ? 'page' : undefined}><span aria-hidden="true">♧</span><small>Alerts</small></Link>
    </nav>
  </div>
}
