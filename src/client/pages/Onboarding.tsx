import React, { useEffect, useState, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiGet, apiPut, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import { safeInternalPath } from '../components/AuthExperience'

type AccountType = 'candidate' | 'employer' | 'both'
type WorkPreference = 'remote' | 'hybrid' | 'on-site' | 'any'
type Country = { code: string; name: string }

const ALL_EMPLOYMENT_TYPES = [
  { id: 'full-time', label: 'Full-time' },
  { id: 'part-time', label: 'Part-time' },
  { id: 'contract', label: 'Contract' },
  { id: 'internship', label: 'Internship' },
  { id: 'temporary', label: 'Temporary' },
]

const EXPERIENCE_LEVELS = [
  { id: 'student', label: 'Student or recent graduate' },
  { id: 'entry', label: 'Early career (0-2 years)' },
  { id: 'mid', label: 'Experienced / Mid-level (3-5 years)' },
  { id: 'senior', label: 'Senior or Lead (6+ years)' },
  { id: 'executive', label: 'Executive / Director' },
  { id: 'career_change', label: 'Changing careers' },
  { id: 'not_sure', label: 'Not sure yet' },
]

export default function Onboarding() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const session = useSession()
  const nextTarget = safeInternalPath(params.get('next'))

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [countries, setCountries] = useState<Country[]>([])

  // Step 1: Goal
  const [accountType, setAccountType] = useState<AccountType | ''>('')

  // Step 2: Job Seeker Preferences
  const [countryCode, setCountryCode] = useState('')
  const [city, setCity] = useState('')
  const [desiredRole, setDesiredRole] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')
  const [skillSuggestions, setSkillSuggestions] = useState<string[]>([])
  const [workPreference, setWorkPreference] = useState<WorkPreference>('any')
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(['full-time'])
  const [experienceLevel, setExperienceLevel] = useState('')

  // Step 2: Hiring Preferences
  const [orgName, setOrgName] = useState('')
  const [orgCountry, setOrgCountry] = useState('')
  const [orgCity, setOrgCity] = useState('')
  const [orgWebsite, setOrgWebsite] = useState('')
  const [expectedRoles, setExpectedRoles] = useState('')
  const [employerTitle, setEmployerTitle] = useState('')

  // Step 3: Alerts
  const [jobAlertsEnabled, setJobAlertsEnabled] = useState(false)
  const [alertFrequency, setAlertFrequency] = useState<'daily' | 'weekly' | 'instant'>('daily')
  const [notificationChannel] = useState<'email'>('email')

  const skillDebounceRef = useRef<number | null>(null)

  // Redirect unauthenticated guests to signup
  useEffect(() => {
    if (!session.loading && !session.user) {
      navigate(`/signup?next=${encodeURIComponent('/onboarding')}`, { replace: true })
    }
  }, [session.loading, session.user, navigate])

  // Load countries & detected location
  useEffect(() => {
    apiGet<Country[]>('/countries')
      .then((res) => setCountries(res.data || []))
      .catch(() => setCountries([]))

    apiGet<{ detected_country: string | null }>('/legal/region')
      .then((res) => {
        if (res.data.detected_country && !countryCode) {
          setCountryCode(res.data.detected_country)
        }
      })
      .catch(() => undefined)
  }, [])

  // Load existing onboarding state
  useEffect(() => {
    if (!session.user) return
    apiGet<any>('/me/onboarding')
      .then(({ data }) => {
        if (data) {
          if (data.status === 'completed' && !params.get('edit')) {
            navigate(nextTarget, { replace: true })
            return
          }
          if (data.account_type) setAccountType(data.account_type)
          if (data.country_code) setCountryCode(data.country_code)
          if (data.city) setCity(data.city)
          if (data.desired_role) setDesiredRole(data.desired_role)
          if (Array.isArray(data.skills)) setSkills(data.skills)
          if (data.work_preference) setWorkPreference(data.work_preference)
          if (Array.isArray(data.employment_types) && data.employment_types.length) {
            setEmploymentTypes(data.employment_types)
          }
          if (data.experience_level) setExperienceLevel(data.experience_level)
          if (data.organization_name) setOrgName(data.organization_name)
          if (data.organization_country) setOrgCountry(data.organization_country)
          if (data.organization_city) setOrgCity(data.organization_city)
          if (data.organization_website) setOrgWebsite(data.organization_website)
          if (data.expected_roles) setExpectedRoles(data.expected_roles)
          if (data.employer_title) setEmployerTitle(data.employer_title)
          if (typeof data.job_alerts_enabled === 'boolean') setJobAlertsEnabled(data.job_alerts_enabled)
          if (data.alert_frequency) setAlertFrequency(data.alert_frequency)

          const resumeStep = Math.min(3, Math.max(1, data.current_step || 1)) as 1 | 2 | 3
          setStep(resumeStep)
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [session.user, navigate, nextTarget, params])

  // Search skills as user types
  useEffect(() => {
    if (skillDebounceRef.current) window.clearTimeout(skillDebounceRef.current)
    const trimmed = skillInput.trim()
    if (trimmed.length < 2) {
      setSkillSuggestions([])
      return
    }
    skillDebounceRef.current = window.setTimeout(async () => {
      try {
        const res = await apiGet<string[]>(`/skills?q=${encodeURIComponent(trimmed)}&limit=6`)
        setSkillSuggestions(res.data || [])
      } catch {
        setSkillSuggestions([])
      }
    }, 200)
    return () => {
      if (skillDebounceRef.current) window.clearTimeout(skillDebounceRef.current)
    }
  }, [skillInput])

  function addSkill(val: string) {
    const clean = val.trim().toLowerCase()
    if (!clean || skills.includes(clean)) return
    if (skills.length >= 20) return
    setSkills([...skills, clean])
    setSkillInput('')
    setSkillSuggestions([])
  }

  function removeSkill(val: string) {
    setSkills(skills.filter((s) => s !== val))
  }

  function toggleEmploymentType(id: string) {
    if (employmentTypes.includes(id)) {
      if (employmentTypes.length > 1) {
        setEmploymentTypes(employmentTypes.filter((t) => t !== id))
      }
    } else {
      setEmploymentTypes([...employmentTypes, id])
    }
  }

  function handleUseLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.')
      return
    }
    setError('')
    navigator.geolocation.getCurrentPosition(
      () => {
        // Location permission granted; country suggestion remains respectful manual choice
      },
      (err) => {
        setError(`Location access declined: ${err.message}. You can choose your country manually below.`)
      },
      { timeout: 8000 }
    )
  }

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault()
    if (!accountType) {
      setError('Please choose how you would like to use Joblite.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiPut('/me/onboarding', {
        step: 1,
        account_type: accountType,
      })
      setStep(2)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault()
    const isCandidate = accountType === 'candidate' || accountType === 'both'
    const isEmployer = accountType === 'employer' || accountType === 'both'

    if (isCandidate && !countryCode) {
      setError('Please select your country.')
      return
    }
    if (isCandidate && desiredRole.trim().length < 2) {
      setError('Please enter your desired role or kind of work.')
      return
    }
    if (isEmployer && accountType === 'employer' && orgName.trim().length < 2) {
      setError('Please enter your organization name.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await apiPut('/me/onboarding', {
        step: 2,
        account_type: accountType,
        country_code: countryCode || null,
        city: city.trim() || null,
        desired_role: desiredRole.trim() || null,
        skills,
        work_preference: workPreference,
        employment_types: employmentTypes,
        experience_level: experienceLevel || null,
        organization_name: orgName.trim() || null,
        organization_country: orgCountry || countryCode || null,
        organization_city: orgCity.trim() || null,
        organization_website: orgWebsite.trim() || null,
        expected_roles: expectedRoles.trim() || null,
        employer_title: employerTitle.trim() || null,
      })
      setStep(3)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  async function handleStep3(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiPut('/me/onboarding', {
        step: 3,
        action: 'complete',
        job_alerts_enabled: jobAlertsEnabled,
        alert_frequency: alertFrequency,
        notification_channels: [notificationChannel],
      })
      await session.refresh()
      const destination = nextTarget !== '/' ? nextTarget : accountType === 'employer' ? '/hiring' : '/jobs'
      navigate(destination, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  async function handleSkip() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await apiPut('/me/onboarding', { action: 'skip' })
      await session.refresh()
      const destination = nextTarget !== '/' ? nextTarget : '/jobs'
      navigate(destination, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page jl-onboarding-page">
        <div className="card state-card">
          <p className="muted">Loading your preferences…</p>
        </div>
      </div>
    )
  }

  const isCandidate = accountType === 'candidate' || accountType === 'both'
  const isEmployer = accountType === 'employer' || accountType === 'both'

  return (
    <div className="page jl-onboarding-page">
      <div className="jl-onboarding-container">
        {/* Progress Bar */}
        <header className="jl-onboarding-header">
          <div className="jl-onboarding-progress-track" aria-label="Onboarding progress">
            <div className={`jl-progress-step ${step >= 1 ? 'is-active' : ''}`}>
              <span className="jl-step-number">1</span>
              <span className="jl-step-label">Your goal</span>
            </div>
            <div className="jl-progress-line" />
            <div className={`jl-progress-step ${step >= 2 ? 'is-active' : ''}`}>
              <span className="jl-step-number">2</span>
              <span className="jl-step-label">Preferences</span>
            </div>
            <div className="jl-progress-line" />
            <div className={`jl-progress-step ${step >= 3 ? 'is-active' : ''}`}>
              <span className="jl-step-number">3</span>
              <span className="jl-step-label">Review & alerts</span>
            </div>
          </div>
        </header>

        {error && (
          <div className="jl-auth-error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: YOUR GOAL */}
        {step === 1 && (
          <section className="card jl-onboarding-card">
            <h1 className="jl-onboarding-title">How would you like to use Joblite?</h1>
            <p className="jl-onboarding-description">
              We personalize your search, recommendations, and feed based on your intent.
            </p>

            <form onSubmit={handleStep1}>
              <fieldset className="jl-goal-selector" aria-labelledby="goal-legend">
                <legend id="goal-legend" className="sr-only">
                  Account goal options
                </legend>

                <label className={`jl-goal-card ${accountType === 'candidate' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="account_type"
                    value="candidate"
                    checked={accountType === 'candidate'}
                    onChange={() => setAccountType('candidate')}
                  />
                  <div className="jl-goal-card-content">
                    <span className="jl-goal-card-title">Find a job</span>
                    <span className="jl-goal-card-desc">
                      Discover nearby and worldwide opportunities, save jobs, and track your applications.
                    </span>
                  </div>
                </label>

                <label className={`jl-goal-card ${accountType === 'employer' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="account_type"
                    value="employer"
                    checked={accountType === 'employer'}
                    onChange={() => setAccountType('employer')}
                  />
                  <div className="jl-goal-card-content">
                    <span className="jl-goal-card-title">Hire talent</span>
                    <span className="jl-goal-card-desc">
                      Plan hiring for your organization and explore candidate profiles.
                    </span>
                    <small className="muted jl-goal-disclaimer">
                      Note: Selecting this does not grant organization membership or verified employer status.
                    </small>
                  </div>
                </label>

                <label className={`jl-goal-card ${accountType === 'both' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="account_type"
                    value="both"
                    checked={accountType === 'both'}
                    onChange={() => setAccountType('both')}
                  />
                  <div className="jl-goal-card-content">
                    <span className="jl-goal-card-title">Both</span>
                    <span className="jl-goal-card-desc">
                      Look for opportunities and recruit talent for your team.
                    </span>
                  </div>
                </label>
              </fieldset>

              <div className="jl-onboarding-button-row">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!accountType || saving}
                >
                  {saving ? 'Saving…' : 'Continue'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleSkip()}
                  disabled={saving}
                >
                  Skip for now
                </button>
              </div>
            </form>
          </section>
        )}

        {/* STEP 2: PREFERENCES */}
        {step === 2 && (
          <section className="card jl-onboarding-card">
            <h1 className="jl-onboarding-title">
              {accountType === 'employer' ? 'Tell us about your organization' : 'Set your job preferences'}
            </h1>
            <p className="jl-onboarding-description">
              We never require a CV, phone number, date of birth, or payment details to complete onboarding.
            </p>

            <form onSubmit={handleStep2} className="jl-preferences-form">
              {isCandidate && (
                <>
                  <div className="jl-form-field">
                    <label htmlFor="pref-country">Where are you based?</label>
                    <div className="jl-country-picker-row">
                      <select
                        id="pref-country"
                        required
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                      >
                        <option value="">Select your country</option>
                        {countries.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name} ({c.code})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary jl-btn-location"
                        onClick={handleUseLocation}
                        title="Detect approximate location"
                      >
                        📍 Use my location
                      </button>
                    </div>
                    <small className="muted">
                      Used to prioritize relevant local jobs and eligible remote roles. Residence is kept separate from search filters.
                    </small>
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="pref-city">
                      City or region <span className="muted">(Optional)</span>
                    </label>
                    <input
                      id="pref-city"
                      type="text"
                      maxLength={80}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Kampala or London"
                    />
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="pref-role">Desired job titles or categories</label>
                    <input
                      id="pref-role"
                      type="text"
                      required
                      maxLength={120}
                      value={desiredRole}
                      onChange={(e) => setDesiredRole(e.target.value)}
                      placeholder="e.g. Full-Stack Developer, Product Designer"
                    />
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="pref-skills">
                      Skills <span className="muted">(Search or add custom)</span>
                    </label>
                    <div className="jl-skill-input-container">
                      <input
                        id="pref-skills"
                        type="text"
                        value={skillInput}
                        onChange={(e) => setSkillInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addSkill(skillInput)
                          }
                        }}
                        placeholder="Type a skill and press Enter"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary jl-add-skill-btn"
                        onClick={() => addSkill(skillInput)}
                        disabled={!skillInput.trim()}
                      >
                        Add
                      </button>
                    </div>

                    {skillSuggestions.length > 0 && (
                      <div className="jl-skill-suggestions" role="listbox">
                        {skillSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            className="jl-suggestion-chip"
                            onClick={() => addSkill(suggestion)}
                          >
                            + {suggestion}
                          </button>
                        ))}
                      </div>
                    )}

                    {skills.length > 0 && (
                      <div className="jl-skill-chips-row" aria-label="Selected skills">
                        {skills.map((skill) => (
                          <span key={skill} className="jl-skill-chip">
                            {skill}
                            <button
                              type="button"
                              onClick={() => removeSkill(skill)}
                              aria-label={`Remove skill ${skill}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="jl-form-field">
                    <label>Work preference</label>
                    <div className="jl-radio-chips-group">
                      {(['any', 'remote', 'hybrid', 'on-site'] as WorkPreference[]).map((pref) => (
                        <label
                          key={pref}
                          className={`jl-chip-choice ${workPreference === pref ? 'is-selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="work_preference"
                            value={pref}
                            checked={workPreference === pref}
                            onChange={() => setWorkPreference(pref)}
                          />
                          <span>{pref === 'any' ? 'Any workplace' : pref === 'on-site' ? 'On-site' : pref.charAt(0).toUpperCase() + pref.slice(1)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="jl-form-field">
                    <label>Employment types</label>
                    <div className="jl-checkbox-grid">
                      {ALL_EMPLOYMENT_TYPES.map((type) => (
                        <label key={type.id} className="jl-checkbox-item">
                          <input
                            type="checkbox"
                            checked={employmentTypes.includes(type.id)}
                            onChange={() => toggleEmploymentType(type.id)}
                          />
                          <span>{type.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="pref-experience">
                      Experience level <span className="muted">(Optional)</span>
                    </label>
                    <select
                      id="pref-experience"
                      value={experienceLevel}
                      onChange={(e) => setExperienceLevel(e.target.value)}
                    >
                      <option value="">Select your experience level</option>
                      {EXPERIENCE_LEVELS.map((lvl) => (
                        <option key={lvl.id} value={lvl.id}>
                          {lvl.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {isEmployer && (
                <div className="jl-employer-section">
                  {accountType === 'both' && (
                    <h3 className="jl-section-subheading">Organization details (Optional)</h3>
                  )}
                  <div className="jl-form-field">
                    <label htmlFor="employer-org-name">Organization name</label>
                    <input
                      id="employer-org-name"
                      type="text"
                      maxLength={120}
                      required={accountType === 'employer'}
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Acme Studios"
                    />
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="employer-country">Organization country</label>
                    <select
                      id="employer-country"
                      value={orgCountry || countryCode}
                      onChange={(e) => setOrgCountry(e.target.value)}
                    >
                      <option value="">Select country</option>
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="employer-website">
                      Website <span className="muted">(Optional)</span>
                    </label>
                    <input
                      id="employer-website"
                      type="url"
                      maxLength={200}
                      value={orgWebsite}
                      onChange={(e) => setOrgWebsite(e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="employer-roles">
                      Types of roles you expect to hire <span className="muted">(Optional)</span>
                    </label>
                    <input
                      id="employer-roles"
                      type="text"
                      maxLength={200}
                      value={expectedRoles}
                      onChange={(e) => setExpectedRoles(e.target.value)}
                      placeholder="e.g. Frontend Engineers, UX Designers"
                    />
                  </div>

                  <div className="jl-form-field">
                    <label htmlFor="employer-title">
                      Your role there <span className="muted">(Optional)</span>
                    </label>
                    <input
                      id="employer-title"
                      type="text"
                      maxLength={100}
                      value={employerTitle}
                      onChange={(e) => setEmployerTitle(e.target.value)}
                      placeholder="e.g. Founder, Head of People"
                    />
                  </div>
                </div>
              )}

              <div className="jl-onboarding-button-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setStep(1)}
                  disabled={saving}
                >
                  ← Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Continue'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleSkip()}
                  disabled={saving}
                >
                  Skip for now
                </button>
              </div>
            </form>
          </section>
        )}

        {/* STEP 3: ALERTS AND REVIEW */}
        {step === 3 && (
          <section className="card jl-onboarding-card">
            <h1 className="jl-onboarding-title">Review & notifications</h1>
            <p className="jl-onboarding-description">
              Verify your choices below. You can update any preference later in Account Settings.
            </p>

            <form onSubmit={handleStep3} className="jl-review-form">
              {/* Summary card */}
              <div className="jl-summary-box">
                <div className="jl-summary-item">
                  <div>
                    <strong>Goal:</strong>{' '}
                    <span>
                      {accountType === 'candidate'
                        ? 'Looking for work'
                        : accountType === 'employer'
                        ? 'Hiring talent'
                        : 'Both'}
                    </span>
                  </div>
                  <button type="button" className="btn-text" onClick={() => setStep(1)}>
                    Edit
                  </button>
                </div>

                {isCandidate && (
                  <>
                    <div className="jl-summary-item">
                      <div>
                        <strong>Location:</strong>{' '}
                        <span>
                          {countries.find((c) => c.code === countryCode)?.name || countryCode || 'Worldwide'}
                          {city ? ` (${city})` : ''}
                        </span>
                      </div>
                      <button type="button" className="btn-text" onClick={() => setStep(2)}>
                        Edit
                      </button>
                    </div>

                    <div className="jl-summary-item">
                      <div>
                        <strong>Desired role:</strong> <span>{desiredRole || 'Any role'}</span>
                      </div>
                      <button type="button" className="btn-text" onClick={() => setStep(2)}>
                        Edit
                      </button>
                    </div>

                    {skills.length > 0 && (
                      <div className="jl-summary-item">
                        <div>
                          <strong>Skills:</strong> <span>{skills.join(', ')}</span>
                        </div>
                        <button type="button" className="btn-text" onClick={() => setStep(2)}>
                          Edit
                        </button>
                      </div>
                    )}

                    <div className="jl-summary-item">
                      <div>
                        <strong>Arrangement:</strong>{' '}
                        <span className="capitalize">{workPreference}</span>
                        {' · '}
                        <span>{employmentTypes.join(', ')}</span>
                      </div>
                      <button type="button" className="btn-text" onClick={() => setStep(2)}>
                        Edit
                      </button>
                    </div>
                  </>
                )}

                {isEmployer && orgName && (
                  <div className="jl-summary-item">
                    <div>
                      <strong>Organization:</strong>{' '}
                      <span>
                        {orgName} ({orgCountry || countryCode})
                      </span>
                    </div>
                    <button type="button" className="btn-text" onClick={() => setStep(2)}>
                      Edit
                    </button>
                  </div>
                )}
              </div>

              {/* Job Alerts Opt-In */}
              <div className="jl-alerts-optin-box">
                <label className="jl-alerts-checkbox-label">
                  <input
                    type="checkbox"
                    checked={jobAlertsEnabled}
                    onChange={(e) => setJobAlertsEnabled(e.target.checked)}
                  />
                  <span>
                    <strong>Email me job alerts matching these preferences</strong>
                    <br />
                    <small className="muted">
                      Explicit, optional opt-in. You can finish without subscribing.
                    </small>
                  </span>
                </label>

                {jobAlertsEnabled && (
                  <div className="jl-alert-options-subgrid">
                    <div className="jl-form-field">
                      <label htmlFor="alert-frequency">Frequency</label>
                      <select
                        id="alert-frequency"
                        value={alertFrequency}
                        onChange={(e) =>
                          setAlertFrequency(e.target.value as 'daily' | 'weekly' | 'instant')
                        }
                      >
                        <option value="daily">Daily digest</option>
                        <option value="weekly">Weekly digest</option>
                        <option value="instant">Instant notifications</option>
                      </select>
                    </div>

                    <div className="jl-form-field">
                      <label>Notification channel</label>
                      <div className="jl-channel-indicator">
                        <span className="jl-channel-badge">✓ Email ({session.user?.email})</span>
                        <small className="muted">
                          (Only verified email delivery is supported at this time)
                        </small>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="jl-onboarding-button-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setStep(2)}
                  disabled={saving}
                >
                  ← Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving
                    ? 'Finishing setup…'
                    : accountType === 'employer'
                    ? 'Continue to hiring'
                    : 'Start exploring jobs'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleSkip()}
                  disabled={saving}
                >
                  Skip for now
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  )
}
