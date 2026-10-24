import React, { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiPost, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { PageIntro } from '../components/Common'

const INTENT_COPY: Record<string, string> = {
  'publish-post': 'Sign in to publish your post. Your draft stays on this device until you choose to publish it.',
  notifications: 'Sign in to open your private notifications.',
  profile: 'Sign in to view and edit your profile.',
  following: 'Sign in to see updates from people you follow.',
  'personalised-eligibility': 'Sign in and add your country to filter jobs you are eligible for.',
  'create-job': 'Sign in to create a structured job posting.',
  save: 'Sign in to save jobs.',
  apply: 'Sign in to apply to native jobs.',
  like: 'Sign in to like this post. You will return to the same media.',
  comment: 'Sign in to reply. Your reply will be added to the real conversation.',
  'attach-image': 'Sign in to attach an image to your post.',
  'attach-video': 'Sign in to attach a video to your post.',
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export default function SignIn() {
  const navigate = useNavigate()
  const session = useSession()
  const [params] = useSearchParams()
  const intent = params.get('intent') || ''
  const next = safeNext(params.get('next'))
  const copy = useMemo(() => INTENT_COPY[intent] || 'Sign in to continue.', [intent])

  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [stage, setStage] = useState<'email' | 'verify'>('email')
  const [devToken, setDevToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function requestLink(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await apiPost<{ message: string; token?: string }>('/auth/challenges', { email })
      setMessage(response.data.message)
      if (response.data.token) {
        setDevToken(response.data.token)
        setToken(response.data.token)
      }
      setStage('verify')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiPost('/auth/verify', { token: token.trim() })
      await session.refresh()
      navigate(next, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (session.user) {
    return (
      <div className="page">
        <PageIntro title="You’re signed in" subtitle={`Signed in as ${session.user.email}`} />
        <div className="card">
          <p>Your session is active. Continue where you left off.</p>
          <div className="button-row">
            <Link className="btn" to={next}>
              Continue
            </Link>
            <Link className="btn btn-secondary" to="/">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <PageIntro title="Sign in to Joblite" subtitle={copy} />
      <div className="card auth-card">
        {stage === 'email' ? (
          <form onSubmit={requestLink} className="form-grid">
            <label>
              Email address
              <input
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Requesting…' : 'Continue with email'}
            </button>
            <p className="form-hint">
              Joblite uses passwordless email sign-in. We never post, apply or publish anything on your behalf.
            </p>
          </form>
        ) : (
          <form onSubmit={verify} className="form-grid">
            {message ? <p className="form-notice">{message}</p> : null}
            {devToken ? (
              <p className="form-notice">
                Development build: the sign-in token is prefilled below. In production this would arrive by email.
              </p>
            ) : null}
            <label>
              Sign-in token
              <input
                className="input"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="one-time-code"
                required
                placeholder="Paste your sign-in token"
              />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn" disabled={busy || !token.trim()}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setStage('email')} disabled={busy}>
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
