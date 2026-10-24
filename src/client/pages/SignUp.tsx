import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiGet, apiPost, ApiError, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { safeInternalPath } from '../components/AuthExperience'
import { CURRENT_TERMS_VERSION } from '../../shared/legal-versions'

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

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)

  const [stage, setStage] = useState<'form' | 'verify'>('form')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const codeInputRef = useRef<HTMLInputElement>(null)

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
      setError('You must agree to the Terms of Service to create an account.')
      return
    }
    if (!ageConfirmed) {
      setError('You must confirm that you are at least 18 years old.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    try {
      const legal = await legalContext()
      const res = await apiPost<{ challenge_id: string; resend_after: number }>('/auth/challenges', {
        email: trimmedEmail,
        ...legal,
      })
      setChallengeId(res.data.challenge_id)
      setResendIn(res.data.resend_after || 60)
      setStage('verify')
      setNotice(`We sent a 6-digit verification code to ${trimmedEmail}.`)
    } catch (caught) {
      if (caught instanceof ApiError && caught.retryAfter) {
        setResendIn(caught.retryAfter)
      }
      setError(errorMessage(caught))
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
        marketing_consent: marketingConsent,
        display_name: name.trim(),
      })

      await session.refresh()
      navigate(`/onboarding?next=${encodeURIComponent(nextTarget)}`, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
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
      const res = await apiPost<{ challenge_id: string; resend_after: number }>('/auth/challenges', {
        email: email.trim().toLowerCase(),
        ...legal,
      })
      setChallengeId(res.data.challenge_id)
      setResendIn(res.data.resend_after || 60)
      setCode('')
      setNotice('A fresh verification code was sent to your email.')
    } catch (caught) {
      if (caught instanceof ApiError && caught.retryAfter) {
        setResendIn(caught.retryAfter)
      }
      setError(errorMessage(caught))
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

              <div className="jl-signup-consent-group">
                <label className="jl-consent-item">
                  <input
                    type="checkbox"
                    required
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    I agree to the applicable{' '}
                    <Link to="/legal/terms" target="_blank" rel="noopener noreferrer">
                      Terms of Service
                    </Link>{' '}
                    (version {CURRENT_TERMS_VERSION}) and acknowledge the{' '}
                    <Link to="/legal/privacy" target="_blank" rel="noopener noreferrer">
                      Privacy Notice
                    </Link>
                    .
                  </span>
                </label>

                <label className="jl-consent-item">
                  <input
                    type="checkbox"
                    required
                    checked={ageConfirmed}
                    onChange={(e) => setAgeConfirmed(e.target.checked)}
                    disabled={busy}
                  />
                  <span>I confirm that I am at least 18 years old.</span>
                </label>

                <label className="jl-consent-item">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    onChange={(e) => setMarketingConsent(e.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    Email me optional Joblite job recommendations and product updates. (Optional, can be changed anytime in settings).
                  </span>
                </label>
              </div>

              <button
                type="submit"
                className="btn btn-primary jl-signup-submit-btn"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? 'Creating account…' : 'Create account'}
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
                  We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
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
                  disabled={busy || resendIn > 0}
                  onClick={() => void handleResend()}
                >
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
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
