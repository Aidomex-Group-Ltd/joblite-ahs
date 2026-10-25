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
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://joblite.online'
    const parsed = new URL(value, origin)
    const decodedPath = decodeURIComponent(parsed.pathname)
    if (parsed.origin !== origin || decodedPath.startsWith('//') || decodedPath.startsWith('/\\') || decodedPath.includes('\\')) return '/'
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
  const [countries, setCountries] = useState<Array<{ code: string; name: string }>>([])
  const [accountType, setAccountType] = useState<'candidate' | 'employer' | 'both' | ''>('')
  const [displayName, setDisplayName] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [desiredRole, setDesiredRole] = useState('')
  const [experienceLevel, setExperienceLevel] = useState('')
  const [availability, setAvailability] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [employerTitle, setEmployerTitle] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const intent = (validIntents.has(request.intent as Intent) ? request.intent : undefined) as Intent | undefined
  const copy = intent === 'apply-source' ? 'Sign in to continue to the original job posting.' : intent === 'publish-post' ? 'Sign in to publish your post. Your draft stays on this device.' : intent === 'save' ? 'Sign in to save this opportunity to your account.' : 'Continue with email to access your Joblite account.'

  useEffect(() => { dialog.current?.querySelector<HTMLElement>('input,button,a')?.focus() }, [])
  useEffect(() => {
    if (!termsRequired || countries.length) return
    apiGet<Array<{ code: string; name: string }>>('/countries').then(({ data }) => setCountries(data || [])).catch(() => setCountries([]))
  }, [termsRequired, countries.length])
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
    } catch (cause) {
      if (cause instanceof ApiError && cause.retryAfter) setResendIn(cause.retryAfter)
      setError(cause instanceof ApiError && cause.requestId ? `${errorMessage(cause)} (Reference: ${cause.requestId})` : errorMessage(cause))
    } finally { setBusy(false) }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      await apiPost('/auth/verify', {
        challenge_id: challenge,
        code,
        terms_accepted: termsAccepted,
        age_confirmed: ageConfirmed,
        terms_version: CURRENT_TERMS_VERSION,
        marketing_consent: marketingConsent,
        onboarding: {
          account_type: accountType,
          display_name: displayName,
          country_code: countryCode,
          desired_role: desiredRole,
          experience_level: experienceLevel,
          availability,
          organization_name: organizationName,
          employer_title: employerTitle,
        },
      })
      await session.refresh()
      if (intent === 'apply-source') { setStage('continue'); return }
      const defaultTarget = intent === 'publish-post' ? '/compose' : location.pathname === '/sign-in' ? '/' : location.pathname + location.search
      const target = safeInternalPath(request.nextPath || defaultTarget)
      onClose(); if (target !== location.pathname + location.search) navigate(target)
    } catch (cause) { if (cause instanceof ApiError && cause.status === 428) setTermsRequired(true); setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  async function resend() {
    if (busy) return
    setBusy(true); setError('')
    try { const response = await apiPost<{ challenge_id: string; resend_after: number }>('/auth/challenges', { email, ...await legalContext() }); setChallenge(response.data.challenge_id); setResendIn(response.data.resend_after || 60); setCode('') }
    catch (cause) {
      if (cause instanceof ApiError && cause.retryAfter) setResendIn(cause.retryAfter)
      if (!(cause instanceof ApiError && ['RESEND_COOLDOWN', 'RATE_LIMITED'].includes(cause.code))) {
        setChallenge('')
        setCode('')
        setStage('email')
      }
      setError(cause instanceof ApiError && cause.requestId ? `${errorMessage(cause)} (Reference: ${cause.requestId})` : errorMessage(cause))
    } finally { setBusy(false) }
  }
  const isCandidate = accountType === 'candidate' || accountType === 'both'
  const isEmployer = accountType === 'employer' || accountType === 'both'
  const onboardingReady = displayName.trim().length >= 2 && Boolean(countryCode) && Boolean(accountType)
    && (!isCandidate || desiredRole.trim().length >= 2)
    && (!isEmployer || (organizationName.trim().length >= 2 && employerTitle.trim().length >= 2))
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
        <h1 id="jl-auth-title">{termsRequired ? 'Set up your Joblite account' : stage === 'code' ? 'Check your email' : 'Welcome to Joblite'}</h1>
        <p>{termsRequired ? 'Your email code is confirmed. Tell us whether you are looking for work, hiring, or both.' : stage === 'code' ? `Enter the six-digit code sent to ${email}.` : copy}</p>
        {stage === 'email' ? <form className="jl-auth-form" onSubmit={send}><label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button className="btn jl-auth-submit" disabled={busy || resendIn > 0}>{busy ? 'Sending code…' : resendIn > 0 ? `Try again in ${resendIn}s` : 'Continue with email'}</button></form> : <form className="jl-auth-form" onSubmit={verify}>
          <label>Verification code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9 ]/g, '').slice(0, 8))} placeholder="123456" /></label>
          {termsRequired ? <div className="jl-onboarding-step">
            <p className="jl-onboarding-kicker">ACCOUNT SETUP · 1 MIN</p>
            <label>Your name<input autoComplete="name" required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we address you?" /></label>
            <label>Where are you based?<select autoComplete="country" required value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="">Choose your country</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select><small>Used to show relevant opportunities. You can change it later.</small></label>
            <fieldset className="jl-account-type"><legend>What brings you to Joblite?</legend>
              <label className={accountType === 'candidate' ? 'is-selected' : ''}><input type="radio" name="account_type" value="candidate" checked={accountType === 'candidate'} onChange={() => setAccountType('candidate')} /><span><strong>I’m looking for work</strong><small>Discover roles and build a candidate profile</small></span></label>
              <label className={accountType === 'employer' ? 'is-selected' : ''}><input type="radio" name="account_type" value="employer" checked={accountType === 'employer'} onChange={() => setAccountType('employer')} /><span><strong>I’m hiring</strong><small>Set up an employer workspace and post jobs</small></span></label>
              <label className={accountType === 'both' ? 'is-selected' : ''}><input type="radio" name="account_type" value="both" checked={accountType === 'both'} onChange={() => setAccountType('both')} /><span><strong>Both</strong><small>Look for work and hire for my organization</small></span></label>
            </fieldset>
            {isCandidate && <div className="jl-onboarding-fields"><label>Role or kind of work you’re looking for<input autoComplete="organization-title" required maxLength={120} value={desiredRole} onChange={(event) => setDesiredRole(event.target.value)} placeholder="e.g. Product designer" /></label><label>Experience level <span className="jl-onboarding-optional">Optional</span><select value={experienceLevel} onChange={(event) => setExperienceLevel(event.target.value)}><option value="">Choose if you’d like</option><option value="student">Student or recent graduate</option><option value="entry">Early career</option><option value="mid">Experienced</option><option value="senior">Senior or lead</option><option value="executive">Executive</option><option value="career_change">Changing careers</option><option value="not_sure">Not sure yet</option></select></label></div>}
            {isEmployer && <div className="jl-onboarding-fields"><label>Company or organization name<input autoComplete="organization" required maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Organization name" /></label><label>Your role there<input autoComplete="organization-title" required maxLength={100} value={employerTitle} onChange={(event) => setEmployerTitle(event.target.value)} placeholder="e.g. Recruiter or Founder" /></label><small className="jl-onboarding-note">The workspace will be marked unverified until your organization is reviewed.</small></div>}
            <div className="jl-auth-legal-checks"><label><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /> By creating an account, you agree to Joblite’s <Link to="/legal/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link> and acknowledge its <Link to="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.</label><label><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /> I confirm that I am at least 18. Joblite does not currently offer a parent or guardian consent process.</label><label><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /> Email me optional Joblite product updates. This is optional and can be withdrawn later.</label></div>
          </div> : null}
          <button className="btn jl-auth-submit" disabled={busy || code.replace(/\s/g,'').length !== 6 || (termsRequired && (!termsAccepted || !ageConfirmed || !onboardingReady))}>{busy ? termsRequired ? 'Creating account…' : 'Verifying…' : termsRequired ? 'Create my account' : 'Verify and continue'}</button>
          <div className="jl-auth-links"><button type="button" onClick={() => { setStage('email'); setError('') }}>Change email</button><button type="button" disabled={busy || resendIn > 0} onClick={() => void resend()}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}</button></div>
        </form>}
        {error && <p className="jl-auth-error" role="alert">{error}</p>}<p className="jl-auth-footnote">No password needed. If this email already has an account, its existing account will be signed in.</p>
        {!termsRequired && stage === 'email' && <p style={{ marginTop: '10px', fontSize: '14px' }}>Don’t have an account? <Link to={`/signup?next=${encodeURIComponent(safeInternalPath(request.nextPath))}`} onClick={onClose} style={{ color: 'var(--jl-blue)', fontWeight: 600 }}>Create account</Link></p>}
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
  return (
    <main className="page">
      <div className="card state-card">
        <JobliteBrand />
        <h1>Sign in to Joblite</h1>
        <p>Continue with email to save opportunities, publish posts, and manage your account.</p>
        <div className="button-row" style={{ marginTop: '14px', marginBottom: '14px' }}>
          <button className="btn btn-primary" onClick={() => openAuth({ intent, jobId, nextPath })}>
            Sign in with email
          </button>
          <Link className="btn btn-secondary" to={`/signup?next=${encodeURIComponent(nextPath)}`}>
            Create an account
          </Link>
        </div>
        <Link className="muted" to={location.state?.from || '/jobs'}>
          Continue browsing jobs
        </Link>
      </div>
    </main>
  )
}
