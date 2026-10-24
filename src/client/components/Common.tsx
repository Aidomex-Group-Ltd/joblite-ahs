import React from 'react'
import { initials } from '../lib/format'

export function PageIntro({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-intro">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-intro-actions">{actions}</div> : null}
    </header>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="card state-card" role="status">
      {label}
    </div>
  )
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card state-card error" role="alert">
      <h2>Something went wrong</h2>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card state-card">
      <h2>{title}</h2>
      {children ? <div className="state-body">{children}</div> : null}
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  )
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className="avatar-initials" style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size / 2.6)) }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
