import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import './Layout.css'

const navItems = [
  { path: '/', label: 'Home', icon: '🏠' },
  { path: '/jobs', label: 'Jobs', icon: '💼' },
  { path: '/applications', label: 'Applications', icon: '📋' },
  { path: '/saved', label: 'Saved', icon: '🔖' },
  { path: '/settings', label: 'Profile', icon: '👤' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  
  return (
    <div className="layout">
      <header className="header">
        <div className="container header-content">
          <Link to="/" className="logo">Joblite AHS</Link>
          <nav className="top-nav desktop-only">
            <Link to="/jobs">Jobs</Link>
            <Link to="/boards">Boards</Link>
            <Link to="/hiring">Hiring</Link>
          </nav>
          <div className="header-actions">
            <button className="icon-btn" aria-label="Notifications">🔔</button>
            <div className="avatar" aria-label="User avatar">U</div>
          </div>
        </div>
      </header>
      
      <div className="main-container container">
        <aside className="sidebar-left desktop-only">
          <nav className="side-nav">
            <Link to="/" className={`side-nav-item ${location.pathname === '/' ? 'active' : ''}`}>
              <span>🏠</span> Home
            </Link>
            <Link to="/jobs" className={`side-nav-item ${location.pathname.startsWith('/jobs') ? 'active' : ''}`}>
              <span>💼</span> Jobs
            </Link>
            <Link to="/boards" className={`side-nav-item ${location.pathname === '/boards' ? 'active' : ''}`}>
              <span>🌐</span> Boards
            </Link>
            <Link to="/applications" className={`side-nav-item ${location.pathname.startsWith('/applications') ? 'active' : ''}`}>
              <span>📋</span> My Applications
            </Link>
            <Link to="/saved" className={`side-nav-item ${location.pathname === '/saved' ? 'active' : ''}`}>
              <span>🔖</span> Saved
            </Link>
            <Link to="/hiring" className={`side-nav-item ${location.pathname.startsWith('/hiring') ? 'active' : ''}`}>
              <span>👥</span> Hiring
            </Link>
            <Link to="/notifications" className={`side-nav-item ${location.pathname === '/notifications' ? 'active' : ''}`}>
              <span>🔔</span> Notifications
            </Link>
            <Link to="/settings" className={`side-nav-item ${location.pathname === '/settings' ? 'active' : ''}`}>
              <span>⚙️</span> Settings
            </Link>
          </nav>
        </aside>
        
        <main className="main-content">
          {children}
        </main>
        
        <aside className="sidebar-right desktop-only">
          <div className="card">
            <h3 style={{fontSize: '18px', marginBottom: '8px'}}>Discover</h3>
            <p style={{color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '12px'}}>
              Search jobs by country, skills and more
            </p>
            <Link to="/jobs" className="btn" style={{display: 'inline-flex', textDecoration: 'none'}}>
              Find Jobs
            </Link>
          </div>
          <div className="card">
            <h4 style={{fontSize: '16px', marginBottom: '8px'}}>My Applications</h4>
            <p style={{color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px'}}>Track your applications</p>
            <Link to="/applications" style={{fontSize: '14px'}}>View tracker →</Link>
          </div>
        </aside>
      </div>
      
      <nav className="bottom-nav mobile-only">
        {navItems.map(item => (
          <Link key={item.path} to={item.path} className={`bottom-nav-item ${location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path)) ? 'active' : ''}`}>
            <span style={{fontSize: '22px'}}>{item.icon}</span>
            <span style={{fontSize: '11px'}}>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
