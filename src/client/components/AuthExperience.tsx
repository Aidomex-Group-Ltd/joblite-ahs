import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { apiGet, apiPost, ApiError, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { JobliteBrand } from './JobliteBrand'
import { CURRENT_TERMS_VERSION } from '../../shared/legal-versions'

type Intent = 'publish-post' | 'apply-source' | 'save' | 'like' | 'comment' | 'notifications' | 'profile' | 'create-job' | 'apply'
type AuthRequest = { intent?: string; jobId?: string; nextPath?: string }
type AuthContextValue = { openAuth: (request?: AuthRequest) => void; closeAuth: () => void }
const AuthContext = createContext<AuthContextValue | null>(null)
const validIntents = new Set<Intent>(['publish-post','apply-source','save','like','comment','notifications','profile','create-job','apply'])
async function legalContext() {
  let region = localStorage.getItem('joblite:legal-region') || ''
  if (!region) {
    try { region = (await apiGet<{ region: string }>('/legal/region')).data.region } catch { region = 'unknown' }
  }
  return { region: region || 'unknown', language: navigator.language || 'en' }
}

export function safeInternalPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || /[\\\u0000-\u001f]/.test(value) || /%(?![\da-f]{2})/i.test(value)) return '/'
  try {
    const parsed = new URL(value, window.location.origin)
    const decodedPath = decodeURIComponent(parsed.pathname)
    if (parsed.origin !== window.location.origin || decodedPath.startsWith('//') || decodedPath.startsWith('/\\') || decodedPath.includes('\\')) return '/'
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch { return '/' }
}

export function useAuthExperience() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuthExperience must be used within AuthExperienceProvider')
  return value
}

export function AuthExperienceProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<AuthRequest | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const closeAuth = useCallback(() => setRequest(null), [])
  const openAuth = useCallback((next: AuthRequest = {}) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRequest(next)
  }, [])
  useEffect(() => {
    if (!request) { trigger.current?.focus({ preventScroll: true }); return }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAuth() }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', closeOnEscape) }
  }, [request, closeAuth])
  return <AuthContext.Provider value={{ openAuth, closeAuth }}>{children}{request && <AuthDialog request={request} onClose={closeAuth} />}</AuthContext.Provider>
}

function AuthDialog({ request, onClose }: { request: AuthRequest; onClose: () => void }) {
  const session = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState('')
  const [stage, setStage] = useState<'email'|'code'|'continue'>('email')
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [error, setError] = useState('')
  const [destination, setDestination] = useState<{ url: string; source: string } | null>(null)
  const [termsRequired, setTermsRequired] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const intent = (validIntents.has(request.intent as Intent) ? request.intent : undefined) as Intent | undefined
  const copy = intent === 'apply-source' ? 'Sign in to continue to the original job posting.' : intent === 'publish-post' ? 'Sign in to publish your post. Your draft stays on this device.' : intent === 'save' ? 'Sign in to save this opportunity to your account.' : 'Continue with email to access your Joblite account.'

  useEffect(() => { dialog.current?.querySelector<HTMLElement>('input,button,a')?.focus() }, [])
  useEffect(() => {
    if (!resendIn) return
    const timer = window.setTimeout(() => setResendIn((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])
  useEffect(() => {
    if (session.user && intent === 'apply-source' && request.jobId) {
      apiGet<any>(`/jobs/${encodeURIComponent(request.jobId)}`).then(({ data }) => {
        const raw = data?.application_url || data?.canonical_url
        if (!raw) { setError('This job does not have a verified application link.'); return }
        try {
          const url = new URL(raw)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
          setDestination({ url: url.href, source: data.source_name || 'original source' }); setStage('continue')
        } catch { setError('This job does not have a safe application link.') }
      }).catch((cause) => setError(errorMessage(cause)))
    }
  }, [session.user, intent, request.jobId])

  async function send(event: React.FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      const response = await apiPost<{ challenge_id: string; resend_after: number }>('/auth/challenges', { email, ...await legalContext() })
      setChallenge(response.data.challenge_id); setResendIn(response.data.resend_after || 60); setStage('code')
    } catch (cause) { if (cause instanceof ApiError && cause.retryAfter) setResendIn(cause.retryAfter); setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      await apiPost('/auth/verify', { challenge_id: challenge, code, terms_accepted: termsAccepted, age_confirmed: ageConfirmed, terms_version: CURRENT_TERMS_VERSION, marketing_consent: marketingConsent })
      await session.refresh()
      if (intent === 'apply-source') { setStage('continue'); return }
      const target = safeInternalPath(request.nextPath || (intent === 'publish-post' ? '/compose' : location.pathname + location.search))
      onClose(); if (target !== location.pathname + location.search) navigate(target)
    } catch (cause) { if (cause instanceof ApiError && cause.status === 428) setTermsRequired(true); setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  async function resend() {
    if (busy) return
    setBusy(true); setError('')
    try { const response = await apiPost<{ challenge_id: string; resend_after: number }>('/auth/challenges', { email, ...await legalContext() }); setChallenge(response.data.challenge_id); setResendIn(response.data.resend_after || 60); setCode('') }
    catch (cause) { if (cause instanceof ApiError && cause.retryAfter) setResendIn(cause.retryAfter); setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  const isSheet = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  return <div className="jl-auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className={`jl-auth-dialog ${isSheet ? 'is-sheet' : ''}`} role="dialog" aria-modal="true" aria-labelledby="jl-auth-title" onKeyDown={(event) => {
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)'))
      if (!focusable.length) return
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
      <header><JobliteBrand /><button className="jl-auth-close" type="button" onClick={onClose} aria-label="Close sign in">×</button></header>
      {session.user && intent === 'apply-source' ? <div className="jl-auth-body"><h1 id="jl-auth-title">Continue to the job</h1><p>{error || (destination ? `You’re signed in. Continue to ${destination.source}; this opens an external website.` : 'Checking the original job link…')}</p>{destination && <a className="btn jl-auth-submit" href={destination.url} target="_blank" rel="noopener noreferrer" onClick={onClose}>Continue to {destination.source} ↗</a>}</div> : <div className="jl-auth-body">
        <h1 id="jl-auth-title">{stage === 'code' ? 'Check your email' : 'Welcome to Joblite'}</h1><p>{stage === 'code' ? `Enter the six-digit code sent to ${email}.` : copy}</p>
        {stage === 'email' ? <form className="jl-auth-form" onSubmit={send}><label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button className="btn jl-auth-submit" disabled={busy || resendIn > 0}>{busy ? 'Sending code…' : resendIn > 0 ? `Try again in ${resendIn}s` : 'Continue with email'}</button></form> : <form className="jl-auth-form" onSubmit={verify}><label>Verification code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9 ]/g, '').slice(0, 8))} placeholder="123456" /></label>{termsRequired ? <div className="jl-auth-legal-checks"><label><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /> I agree to the current <Link to="/legal/terms" target="_blank">Terms of Service</Link> (version {CURRENT_TERMS_VERSION}).</label><label><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /> I confirm that I am at least 18. Joblite does not currently offer a parent or guardian consent process.</label><label><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /> Email me optional Joblite product updates. This is optional and can be withdrawn later.</label><p><Link to="/legal/privacy" target="_blank">Privacy Notice</Link> explains processing. Marketing consent is not required to create an account.</p></div> : null}<button className="btn jl-auth-submit" disabled={busy || code.replace(/\s/g,'').length !== 6 || (termsRequired && (!termsAccepted || !ageConfirmed))}>{busy ? 'Verifying…' : 'Verify and continue'}</button><div className="jl-auth-links"><button type="button" onClick={() => { setStage('email'); setError('') }}>Change email</button><button type="button" disabled={busy || resendIn > 0} onClick={() => void resend()}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}</button></div></form>}
        {error && <p className="jl-auth-error" role="alert">{error}</p>}<p className="jl-auth-footnote">No password needed. If you already have an account, this signs you in.</p>
        {!request.intent && <Link className="jl-auth-secondary" to="/" onClick={onClose}>Back to Joblite</Link>}
      </div>}
    </section>
  </div>
}

export function SignInPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { openAuth } = useAuthExperience()
  const session = useSession()
  const intent = params.get('intent') || undefined
  const jobId = params.get('jobId') || undefined
  const nextPath = safeInternalPath(params.get('next'))
  useEffect(() => { if (!session.user) openAuth({ intent, jobId, nextPath }); else navigate(nextPath, { replace: true }) }, [])
  return <main className="page"><div className="card state-card"><JobliteBrand /><h1>Sign in to Joblite</h1><p>Continue with email to save opportunities, publish posts, and manage your account.</p><Link className="btn btn-secondary" to={location.state?.from || '/'}>Back</Link></div></main>
}
