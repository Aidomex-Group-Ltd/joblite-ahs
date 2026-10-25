import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, ApiError, isAbortError } from './api'

export type SessionUser = {
  id: string
  email: string
  display_name: string
}

export type SessionProfile = {
  id: string
  handle: string
  headline: string | null
  bio: string | null
  country_code: string | null
  visibility: 'public' | 'private' | 'recruiter_only'
  availability: string | null
}

export type Membership = {
  organization_id: string
  role: string
  org_name: string
  org_slug: string
  verification_state: string
}

export type SessionOnboarding = {
  status: 'in_progress' | 'completed' | 'skipped'
  current_step: number
  account_type: 'candidate' | 'employer' | 'both' | null
  country_code: string | null
  city: string | null
  desired_role: string | null
  skills: string[]
  work_preference: 'remote' | 'hybrid' | 'on-site' | 'any' | null
  employment_types: string[]
  experience_level: string | null
  organization_name: string | null
  organization_country: string | null
  organization_city: string | null
  organization_website: string | null
  expected_roles: string | null
  employer_title: string | null
  job_alerts_enabled: boolean
  notification_channels: string[]
  alert_frequency: string
  completed_at: number | null
}

type MeResponse = {
  user: SessionUser
  profile: SessionProfile | null
  memberships: Membership[]
  unread_notifications: number
  onboarding?: SessionOnboarding | null
}

type SessionState = {
  user: SessionUser | null
  profile: SessionProfile | null
  memberships: Membership[]
  onboarding: SessionOnboarding | null
  unreadNotifications: number
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setUnreadNotifications: (count: number) => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | undefined>(undefined)

export function isExpectedUnauthenticatedSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [profile, setProfile] = useState<SessionProfile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [onboarding, setOnboarding] = useState<SessionOnboarding | null>(null)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await apiGet<MeResponse>('/me')
      setUser(response.data.user)
      setProfile(response.data.profile)
      setMemberships(response.data.memberships || [])
      setOnboarding(response.data.onboarding || null)
      setUnreadNotifications(response.data.unread_notifications || 0)
      setError(null)
    } catch (caught) {
      if (isAbortError(caught)) return
      if (isExpectedUnauthenticatedSession(caught)) {
        setUser(null)
        setProfile(null)
        setMemberships([])
        setOnboarding(null)
        setUnreadNotifications(0)
        setError(null)
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not load your session')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    try {
      await apiPost('/auth/logout')
    } finally {
      setUser(null)
      setProfile(null)
      setMemberships([])
      setOnboarding(null)
      setUnreadNotifications(0)
    }
  }, [])

  const value = useMemo<SessionState>(
    () => ({
      user,
      profile,
      memberships,
      onboarding,
      unreadNotifications,
      loading,
      error,
      refresh,
      setUnreadNotifications,
      signOut,
    }),
    [user, profile, memberships, onboarding, unreadNotifications, loading, error, refresh, signOut]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}

/** Builds a sign-in link that carries only the intent label and a local path. */
export function signInPath(intent: string, nextPath = window.location.pathname + window.location.search): string {
  const params = new URLSearchParams({ intent, next: nextPath })
  return `/sign-in?${params.toString()}`
}
