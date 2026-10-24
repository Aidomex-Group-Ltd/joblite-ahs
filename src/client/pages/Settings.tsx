import React, { useEffect, useState } from 'react'
import { apiGet, apiPatch, apiPut, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { useAuthExperience } from '../components/AuthExperience'
import { ErrorNotice, Loading, PageIntro } from '../components/Common'
import { Link } from 'react-router-dom'
import { useLegalRegion } from './Legal'

type Country = { code: string; name: string }

export default function Settings() {
  const session = useSession()
  const { openAuth } = useAuthExperience()
  const legalRegion = useLegalRegion()
  const [countries, setCountries] = useState<Country[]>([])
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [bio, setBio] = useState('')
  const [country, setCountry] = useState('')
  const [visibility, setVisibility] = useState('public')

  // Onboarding preferences state
  const [desiredRole, setDesiredRole] = useState('')
  const [workPreference, setWorkPreference] = useState('any')
  const [accountType, setAccountType] = useState('candidate')
  const [jobAlerts, setJobAlerts] = useState(false)
  const [alertFreq, setAlertFreq] = useState('daily')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [prefSaving, setPrefSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [prefNotice, setPrefNotice] = useState('')

  useEffect(() => {
    apiGet<Country[]>('/countries').then((r) => setCountries(r.data || [])).catch(() => setCountries([]))
  }, [])

  useEffect(() => {
    if (session.user) {
      setName(session.user.display_name || '')
      setHeadline(session.profile?.headline || '')
      setBio(session.profile?.bio || '')
      setCountry(session.profile?.country_code || '')
      setVisibility(session.profile?.visibility || 'public')

      if (session.onboarding) {
        setDesiredRole(session.onboarding.desired_role || session.profile?.headline || '')
        setWorkPreference(session.onboarding.work_preference || 'any')
        setAccountType(session.onboarding.account_type || 'candidate')
        setJobAlerts(Boolean(session.onboarding.job_alerts_enabled))
        setAlertFreq(session.onboarding.alert_frequency || 'daily')
      }
      setLoading(false)
    } else if (!session.loading) {
      setLoading(false)
    }
  }, [session.user, session.profile, session.onboarding, session.loading])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await apiPatch('/me/profile', { display_name: name, headline, bio, country_code: country || null, visibility })
      await session.refresh()
      setNotice('Your profile settings were saved.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault()
    setPrefSaving(true)
    setError('')
    setPrefNotice('')
    try {
      await apiPut('/me/onboarding', {
        step: 3,
        desired_role: desiredRole,
        work_preference: workPreference,
        account_type: accountType,
        country_code: country || null,
        job_alerts_enabled: jobAlerts,
        alert_frequency: alertFreq,
      })
      await session.refresh()
      setPrefNotice('Your job & alert preferences were updated.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPrefSaving(false)
    }
  }

  async function signOut() {
    try {
      await session.signOut()
      setNotice('You are signed out.')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <div className="page">
      <PageIntro title="Settings" subtitle="Manage your account, profile, and job preferences." />
      {!session.user && !session.loading ? (
        <section className="card state-card">
          <h2>Your account settings</h2>
          <p>Sign in to manage the profile information and job preferences attached to your Joblite account.</p>
          <button className="btn state-action" onClick={() => openAuth({ intent: 'profile' })}>
            Continue with email
          </button>
        </section>
      ) : loading ? (
        <Loading label="Loading your settings…" />
      ) : error && !session.user ? (
        <ErrorNotice message={error} />
      ) : (
        <>
          <form className="card form-grid" onSubmit={(event) => void save(event)}>
            <h2>Profile</h2>
            <p className="muted">Signed in as {session.user?.email}</p>
            <label>
              Display name
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
            </label>
            <label>
              Headline
              <input className="input" value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={120} />
            </label>
            <label>
              About
              <textarea className="input" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={2000} rows={4} />
            </label>
            <label>
              Country
              <select className="input" value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="">Select a country</option>
                {countries.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Profile visibility
              <select className="input" value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                <option value="public">Public</option>
                <option value="recruiter_only">Recruiters only</option>
                <option value="private">Private</option>
              </select>
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="form-notice" role="status">{notice}</p>}
            <div className="button-row">
              <button className="btn" disabled={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </form>

          <form className="card form-grid" onSubmit={(event) => void savePreferences(event)}>
            <h2>Job & Search Preferences</h2>
            <p className="muted">Preferences set during onboarding that personalize your job listings and alerts.</p>
            <label>
              Account goal
              <select className="input" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
                <option value="candidate">Looking for work</option>
                <option value="employer">Hiring talent</option>
                <option value="both">Both</option>
              </select>
            </label>
            <label>
              Desired role or title
              <input
                className="input"
                value={desiredRole}
                onChange={(e) => setDesiredRole(e.target.value)}
                maxLength={120}
                placeholder="e.g. Software Engineer"
              />
            </label>
            <label>
              Work arrangement preference
              <select className="input" value={workPreference} onChange={(e) => setWorkPreference(e.target.value)}>
                <option value="any">Any workplace</option>
                <option value="remote">Remote only</option>
                <option value="hybrid">Hybrid</option>
                <option value="on-site">On-site</option>
              </select>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={jobAlerts}
                  onChange={(e) => setJobAlerts(e.target.checked)}
                />
                <span>Email job alerts matching these preferences</span>
              </label>
              {jobAlerts && (
                <label>
                  Alert frequency
                  <select className="input" value={alertFreq} onChange={(e) => setAlertFreq(e.target.value)}>
                    <option value="daily">Daily digest</option>
                    <option value="weekly">Weekly digest</option>
                    <option value="instant">Instant notifications</option>
                  </select>
                </label>
              )}
            </div>
            {prefNotice && <p className="form-notice" role="status">{prefNotice}</p>}
            <div className="button-row">
              <button className="btn" disabled={prefSaving}>
                {prefSaving ? 'Saving preferences…' : 'Save preferences'}
              </button>
              <Link className="btn btn-secondary" to="/onboarding?edit=1">
                Open full onboarding wizard
              </Link>
            </div>
          </form>

          <section className="card form-grid jl-settings-privacy">
            <h2>Privacy controls</h2>
            <p>Optional analytics and advertising are not active. Essential session and security storage remains enabled.</p>
            <label htmlFor="settings-legal-region">
              Displayed legal region
              <select
                id="settings-legal-region"
                className="input"
                value={legalRegion.region}
                onChange={(event) => legalRegion.changeRegion(event.target.value)}
              >
                <option value="unknown">Unknown / protective baseline</option>
                <option value="UG">Uganda</option>
                <option value="EEA">European Economic Area</option>
                <option value="UK">United Kingdom</option>
                <option value="other">Other</option>
              </select>
            </label>
            <p className="muted">
              Approximate network region: {legalRegion.detected}. This is not proof of residence and is separate from your job-search country.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.dispatchEvent(new Event('joblite:open-privacy-choices'))}
              >
                Privacy choices
              </button>
              <a className="btn btn-secondary" href="/api/v1/me/export">
                Download my account data
              </a>
              <Link className="btn btn-secondary" to="/legal/privacy-rights">
                Submit or view privacy requests
              </Link>
              <Link to="/legal/privacy">Privacy Notice</Link>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

