import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPatch, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { useAuthExperience } from '../components/AuthExperience'
import { ErrorNotice, Loading, PageIntro } from '../components/Common'

type Notice = { id: string; type: string; payload: Record<string, unknown>; read_at: number | null; created_at: number }
export default function Notifications() {
  const session = useSession(); const { openAuth } = useAuthExperience()
  const [items, setItems] = useState<Notice[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const load = useCallback(async () => { try { const response = await apiGet<Notice[]>('/me/notifications'); setItems(response.data || []); setError('') } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) } }, [])
  useEffect(() => { if (session.user) void load(); else if (!session.loading) setLoading(false) }, [session.user, session.loading, load])
  async function mark(id?: string) { try { await apiPatch(id ? `/me/notifications/${encodeURIComponent(id)}` : '/me/notifications', {}); const now = Math.floor(Date.now() / 1000); const next = items.map((item) => !id || item.id === id ? { ...item, read_at: item.read_at || now } : item); setItems(next); session.setUnreadNotifications(next.filter((item) => !item.read_at).length) } catch (cause) { setError(errorMessage(cause)) } }
  return <div className="page"><PageIntro title="Notifications" subtitle="Updates related to your Joblite account." actions={session.user && items.some((item) => !item.read_at) ? <button className="btn btn-secondary" onClick={() => void mark()}>Mark all read</button> : undefined} />
    {!session.user && !session.loading ? <section className="card state-card"><h2>Your notifications</h2><p>Sign in to see private updates for your account.</p><button className="btn state-action" onClick={() => openAuth({ intent: 'notifications' })}>Continue with email</button></section> : loading ? <Loading label="Loading notifications…" /> : error ? <ErrorNotice message={error} onRetry={() => { setLoading(true); void load() }} /> : items.length ? <div className="jl-notifications">{items.map((item) => <article className={`card jl-notification ${item.read_at ? '' : 'is-unread'}`} key={item.id}><span className="jl-notification-dot" aria-hidden="true"/><div><strong>{String(item.payload.title || item.type.replaceAll('_', ' '))}</strong><p>{String(item.payload.message || item.payload.body || 'You have a new Joblite update.')}</p>{typeof item.payload.href === 'string' && item.payload.href.startsWith('/') && <Link to={item.payload.href}>View details</Link>}</div>{!item.read_at && <button className="btn btn-secondary" onClick={() => void mark(item.id)}>Mark read</button>}</article>)}</div> : <section className="card state-card"><h2>You’re all caught up</h2><p>New account updates will appear here.</p></section>}
  </div>
}
