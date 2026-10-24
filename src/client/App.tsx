import React, { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Jobs from './pages/Jobs'
import JobDetail from './pages/JobDetail'
import Companies from './pages/Companies'
import People from './pages/People'
import Applications from './pages/Applications'
import Saved from './pages/Saved'
import Hiring from './pages/Hiring'
import Notifications from './pages/Notifications'
import Settings from './pages/Settings'
import Boards from './pages/Boards'
import Composer from './pages/Composer'
import PostMedia from './pages/PostMedia'
import PostDetail from './pages/PostDetail'
import ApplicationDetail from './pages/ApplicationDetail'
import SignUp from './pages/SignUp'
import Onboarding from './pages/Onboarding'
import { AuthExperienceProvider, SignInPage } from './components/AuthExperience'
import { LegalPage, PrivacyChoicesButton, SiteFooter } from './pages/Legal'
import { applyPageMetadata, DEFAULT_METADATA, SITE_ORIGIN } from '../shared/page-metadata'

function RouteMetadata() {
  const location = useLocation()
  useEffect(() => {
    const path = location.pathname
    if (/^\/jobs\/[A-Za-z0-9_-]+$/.test(path) || /^\/posts\/[A-Za-z0-9_-]+$/.test(path)) return
    const isLegal = path === '/legal' || path.startsWith('/legal/')
    const title = isLegal ? `${path === '/legal' ? 'Legal Center' : path.split('/').pop()?.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())} | Joblite AHIS` : DEFAULT_METADATA.title
    applyPageMetadata({ ...DEFAULT_METADATA, title, url: `${SITE_ORIGIN}${path}`, noindex: !isLegal && !['/','/jobs','/boards'].includes(path) })
  }, [location.pathname])
  return null
}

function GlobalPageTools() {
  const location = useLocation()
  if (/^\/posts\/[^/]+\/media\/\d+$/.test(location.pathname)) return null
  return <><SiteFooter /><PrivacyChoicesButton /></>
}

export default function App() {
  return (
    <AuthExperienceProvider>
      <RouteMetadata />
      <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/compose" element={<Composer />} />
        <Route path="/posts/:postId/media/:mediaIndex" element={<PostMedia />} />
        <Route path="/posts/:id" element={<PostDetail />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/companies/:slug" element={<Companies />} />
        <Route path="/people/:handle" element={<People />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />
        <Route path="/saved" element={<Saved />} />
        <Route path="/hiring" element={<Hiring />} />
        <Route path="/hiring/jobs/new" element={<Hiring />} />
        <Route path="/hiring/jobs/:id/applicants" element={<Hiring />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Settings />} />
        <Route path="/boards" element={<Boards />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/legal/terms" element={<LegalPage />} />
        <Route path="/legal/privacy" element={<LegalPage />} />
        <Route path="/legal/cookies" element={<LegalPage />} />
        <Route path="/legal/acceptable-use" element={<LegalPage />} />
        <Route path="/legal/community-guidelines" element={<LegalPage />} />
        <Route path="/legal/job-disclaimer" element={<LegalPage />} />
        <Route path="/legal/privacy-rights" element={<LegalPage />} />
        <Route path="/legal/employer-terms" element={<LegalPage />} />
      </Routes>
      </Layout>
      <GlobalPageTools />
    </AuthExperienceProvider>
  )
}
