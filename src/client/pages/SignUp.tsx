import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiGet, apiPost, ApiError, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { safeInternalPath } from '../components/AuthExperience'
import { CURRENT_TERMS_VERSION } from '../../shared/legal-versions'

const SIGNUP_CHALLENGE_STORAGE_KEY = 'joblite:signup-challenge'
const SIGNUP_REQUEST_STORAGE_KEY = 'joblite:signup-request'

type StoredSignupChallenge = {
  email: string
  name: string
  challengeId: string
  expiresAt: number
  resendAfter: number
  idempotencyKey: string
}

type ChallengeResponse = {
  challenge_id: string
  expires_at: number
  resend_after: number
  delivery_status: 'accepted' | 'unknown'
  message: string
}

function isChallengeResponse(value: unknown): value is ChallengeResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Record<string, unknown>
  return typeof response.challenge_id === 'string'
    && typeof response.expires_at === 'number'
    && typeof response.resend_after === 'number'
    && (response.delivery_status === 'accepted' || response.delivery_status === 'unknown')
    && typeof response.message === 'string'
}

function readStoredSignupChallenge(): StoredSignupChallenge | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SIGNUP_CHALLENGE_STORAGE_KEY) || 'null')
    if (
      value && typeof value.email === 'string' && typeof value.name === 'string'
      && typeof value.challengeId === 'string' && typeof value.expiresAt === 'number'
      && typeof value.resendAfter === 'number' && typeof value.idempotencyKey === 'string'
    ) return value as StoredSignupChallenge
  } catch {
    return null
  }
  return null
}

function createIdempotencyKey(): string {
  return crypto.randomUUID()
}

function storeRequestKey(email: string, key: string): void {
  try {
    sessionStorage.setItem(SIGNUP_REQUEST_STORAGE_KEY, JSON.stringify({ email, key }))
  } catch {
    // In-memory state still protects retries until the page is closed.
  }
}

async function legalContext() {
  let region = localStorage.getItem('joblite:legal-region') || ''
  if (!region) {
    try {
      region = (await apiGet<{ region: string }>('/legal/region')).data.region
    } catch {
      region = 'unknown'
    }
  }
  return { region: region || 'unknown', language: navigator.language || 'en' }
}

export default function SignUp() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const session = useSession()
  const nextTarget = safeInternalPath(params.get('next'))

  const [initialChallenge] = useState(readStoredSignupChallenge)
  const [name, setName] = useState(initialChallenge?.name || '')
  const [email, setEmail] = useState(initialChallenge?.email || '')
  const [termsAccepted, setTermsAccepted] = useState(false)

  const [stage, setStage] = useState<'form' | 'verify'>(
    initialChallenge && initialChallenge.expiresAt > Math.floor(Date.now() / 1000) ? 'verify' : 'form'
  )
  const [challengeId, setChallengeId] = useState(initialChallenge?.challengeId || '')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(initialChallenge?.resendAfter || 0)
  const [cooldownEmail, setCooldownEmail] = useState(initialChallenge?.email || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const codeInputRef = useRef<HTMLInputElement>(null)
  const requestKeyRef = useRef<{ email: string; key: string } | null>(null)
  const activeResendIn = cooldownEmail === email.trim().toLowerCase() ? resendIn : 0

  function requestKeyFor(normalizedEmail: string, rotate = false): string {
    if (!rotate && requestKeyRef.current?.email === normalizedEmail) return requestKeyRef.current.key
    if (!rotate) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(SIGNUP_REQUEST_STORAGE_KEY) || 'null')
        if (stored?.email === normalizedEmail && typeof stored.key === 'string') {
          requestKeyRef.current = { email: normalizedEmail, key: stored.key }
          return stored.key
        }
      } catch {
        // Fall through to a new in-memory key.
      }
    }
    const key = createIdempotencyKey()
    requestKeyRef.current = { email: normalizedEmail, key }
    storeRequestKey(normalizedEmail, key)
    return key
  }

  function displayError(caught: unknown): string {
    const message = errorMessage(caught)
    return caught instanceof ApiError && caught.requestId
      ? `${message} (Reference: ${caught.requestId})`
      : message
  }

  useEffect(() => {
    if (session.user && !session.loading) {
      if (session.onboarding?.status === 'in_progress') {
        navigate(`/onboarding?next=${encodeURIComponent(nextTarget)}`, { replace: true })
      } else {
        navigate(nextTarget, { replace: true })
      }
    }
  }, [session.user, session.loading, session.onboarding?.status, navigate, nextTarget])

  useEffect(() => {
    if (!resendIn) return
    const timer = window.setTimeout(() => setResendIn((cur) => Math.max(0, cur - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  useEffect(() => {
    if (stage === 'verify') {
      codeInputRef.current?.focus()
    }
  }, [stage])

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()

    if (trimmedName.length < 2) {
      setError('Please enter your full name (at least 2 characters).')
      return
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!termsAccepted) {
      setError('Accept the Terms of Service and Privacy Policy to create an account.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    try {
      const legal = await legalContext()
      const idempotencyKey = requestKeyFor(trimmedEmail)
      const res = await apiPost<ChallengeResponse>('/auth/challenges', {
        email: trimmedEmail,
        idempotency_key: idempotencyKey,
        ...legal,
      })
      if (!isChallengeResponse(res.data)) {
        throw new ApiError(502, 'AUTH_RESPONSE_INVALID', 'We could not confirm the challenge response. Retry after the timer to safely check this request.')
      }
      setChallengeId(res.data.challenge_id)
      setResendIn(res.data.resend_after || 60)
      setCooldownEmail(trimmedEmail)
      setStage('verify')
      setNotice(res.data.delivery_status === 'accepted'
        ? `The email provider accepted the request for ${trimmedEmail}. Check your inbox; delivery is not confirmed.`
        : `${res.data.message} You can enter the code if it arrives; retrying will safely check this request without sending another email.`)
      try {
        sessionStorage.setItem(SIGNUP_CHALLENGE_STORAGE_KEY, JSON.stringify({
          email: trimmedEmail,
          name: trimmedName,
          challengeId: res.data.challenge_id,
          expiresAt: res.data.expires_at,
          resendAfter: res.data.resend_after || 60,
          idempotencyKey,
        } satisfies StoredSignupChallenge))
      } catch {
        // The active challenge remains available in memory.
      }
    } catch (caught) {
      const ambiguous = !(caught instanceof ApiError)
        || caught.status === 0 || (caught.status >= 500 && !caught.code.startsWith('EMAIL_'))
        || ['INTERNAL', 'AUTH_RESPONSE_INVALID'].includes(caught.code)
      if (ambiguous) {
        setResendIn(caught instanceof ApiError && caught.retryAfter ? caught.retryAfter : 60)
        setCooldownEmail(trimmedEmail)
        setError('We could not confirm whether your request completed. Check your inbox. After the timer, retrying with this browser session will safely check the same request without sending a duplicate email.')
      } else if (caught instanceof ApiError && caught.retryAfter) {
        setResendIn(caught.retryAfter)
        setCooldownEmail(trimmedEmail)
        setError(displayError(caught))
        if (caught.code.startsWith('EMAIL_')) {
          requestKeyRef.current = null
          try { sessionStorage.removeItem(SIGNUP_REQUEST_STORAGE_KEY) } catch { /* Optional browser storage. */ }
        }
      } else {
        setError(displayError(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const cleanCode = code.replace(/\s+/g, '')
    if (cleanCode.length !== 6) {
      setError('Please enter the 6-digit code sent to your email.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    try {
      await apiPost('/auth/verify', {
        challenge_id: challengeId,
        code: cleanCode,
        terms_accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed: true,
        marketing_consent: false,
        display_name: name.trim(),
      })

      await session.refresh()
      try {
        sessionStorage.removeItem(SIGNUP_CHALLENGE_STORAGE_KEY)
        sessionStorage.removeItem(SIGNUP_REQUEST_STORAGE_KEY)
      } catch {
        // Session creation does not depend on browser storage.
      }
      requestKeyRef.current = null
      navigate(`/onboarding?next=${encodeURIComponent(nextTarget)}`, { replace: true })
    } catch (caught) {
      setError(displayError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleResend() {
    if (busy || resendIn > 0) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const legal = await legalContext()
      const normalizedEmail = email.trim().toLowerCase()
      const idempotencyKey = requestKeyFor(normalizedEmail, true)
      const res = await apiPost<ChallengeResponse>('/auth/challenges', {
        email: normalizedEmail,
        idempotency_key: idempotencyKey,
        ...legal,
      })
      if (!isChallengeResponse(res.data)) {
        throw new ApiError(502, 'AUTH_RESPONSE_INVALID', 'We could not confirm the challenge response. Check your inbox and do not resend automatically.')
      }
      setChallengeId(res.data.challenge_id)
      setResendIn(res.data.resend_after || 60)
      setCooldownEmail(normalizedEmail)
      setCode('')
      setNotice(res.data.delivery_status === 'accepted'
        ? 'The email provider accepted the request. Check your inbox for the fresh verification code; delivery is not confirmed.'
        : `${res.data.message} You can enter the code if it arrives.`)
      try {
        sessionStorage.setItem(SIGNUP_CHALLENGE_STORAGE_KEY, JSON.stringify({
          email: normalizedEmail,
          name,
          challengeId: res.data.challenge_id,
          expiresAt: res.data.expires_at,
          resendAfter: res.data.resend_after || 60,
          idempotencyKey,
        } satisfies StoredSignupChallenge))
      } catch {
        // The active challenge remains available in memory.
      }
    } catch (caught) {
      const rateLimited = caught instanceof ApiError && ['RESEND_COOLDOWN', 'RATE_LIMITED'].includes(caught.code)
      if (caught instanceof ApiError && caught.retryAfter) {
        setResendIn(caught.retryAfter)
        setCooldownEmail(email.trim().toLowerCase())
      }
      const ambiguous = !(caught instanceof ApiError)
        || caught.status === 0 || caught.status >= 500
        || ['INTERNAL', 'AUTH_RESPONSE_INVALID'].includes(caught.code)
      if (ambiguous) {
        setError('We could not confirm whether this request completed. Check your inbox; do not resend automatically.')
      } else if (!rateLimited) {
        setChallengeId('')
        setCode('')
        setStage('form')
      }
      setError(displayError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page jl-signup-page">
      <div className="jl-signup-container">
        <header className="jl-signup-header">
          <Link to="/" className="jl-signup-logo-link" aria-label="Joblite home">
            <img
              src="/joblite.png"
              alt="Joblite worker hard-hat silhouette logo"
              className="jl-signup-brand-logo"
              width="56"
              height="56"
            />
          </Link>
          <h1 className="jl-signup-title">Find your next opportunity.</h1>
          <p className="jl-signup-subtitle">
            Access nearby jobs, worldwide opportunities, and remote roles tailored to your skills.
          </p>
        </header>

        <section className="card jl-signup-card" aria-labelledby="jl-signup-heading">
          <h2 id="jl-signup-heading" className="sr-only">
            {stage === 'form' ? 'Create your account' : 'Verify your email'}
          </h2>

          {error && (
            <div className="jl-auth-error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}

          {notice && !error && (
            <div className="jl-auth-notice-banner" role="status">
              <span>{notice}</span>
            </div>
          )}

          {stage === 'form' ? (
            <form className="jl-signup-form" onSubmit={handleCreateAccount} noValidate>
              <div className="jl-form-field">
                <label htmlFor="signup-name">Full name</label>
                <input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Taylor Morgan"
                  disabled={busy}
                />
              </div>

              <div className="jl-form-field">
                <label htmlFor="signup-email">Email address</label>
                <input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={busy}
                />
                <small className="muted">
                  Passwordless authentication: we will send a fast sign-in code to verify your email.
                </small>
              </div>

              <label className="jl-consent-item jl-signup-legal-notice">
                <input
                  type="checkbox"
                  required
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  disabled={busy}
                />
                <span>
                  By creating an account, you agree to Joblite’s{' '}
                  <Link to="/legal/terms" target="_blank" rel="noopener noreferrer">
                    Terms of Service
                  </Link>{' '}
                  and acknowledge its{' '}
                  <Link to="/legal/privacy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>

              <button
                type="submit"
                className="btn btn-primary jl-signup-submit-btn"
                disabled={busy || activeResendIn > 0}
                aria-busy={busy}
              >
                {busy ? 'Sending code…' : activeResendIn > 0 ? `Try again in ${activeResendIn}s` : 'Create account'}
              </button>

              <div className="jl-signup-footer-actions">
                <p className="jl-signup-switch">
                  Already have an account?{' '}
                  <Link to={`/sign-in?next=${encodeURIComponent(nextTarget)}`}>Sign in</Link>
                </p>
                <Link to={nextTarget || '/jobs'} className="jl-signup-browse-link">
                  Continue browsing jobs →
                </Link>
              </div>
            </form>
          ) : (
            <form className="jl-signup-form" onSubmit={handleVerify} noValidate>
              <div className="jl-verification-intro">
                <h3>Enter your verification code</h3>
                <p className="muted">
                  Check your inbox for a 6-digit code sent to <strong>{email}</strong>. It expires in 10 minutes.
                </p>
              </div>

              <div className="jl-form-field">
                <label htmlFor="signup-code">Verification code</label>
                <input
                  id="signup-code"
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,8}"
                  maxLength={8}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 8))}
                  placeholder="123456"
                  disabled={busy}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary jl-signup-submit-btn"
                disabled={busy || code.replace(/\s+/g, '').length !== 6}
                aria-busy={busy}
              >
                {busy ? 'Verifying…' : 'Verify and continue'}
              </button>

              <div className="jl-auth-links">
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setStage('form')
                    setError('')
                    setNotice('')
                  }}
                  disabled={busy}
                >
                  Edit details / change email
                </button>
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy || activeResendIn > 0}
                  onClick={() => void handleResend()}
                >
                  {activeResendIn > 0 ? `Resend code in ${activeResendIn}s` : 'Resend code'}
                </button>
              </div>

              <div className="jl-signup-footer-actions">
                <Link to={nextTarget || '/jobs'} className="jl-signup-browse-link">
                  Continue browsing jobs →
                </Link>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  )
}
