import React from 'react'
import { Routes, Route } from 'react-router-dom'
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

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/companies/:slug" element={<Companies />} />
        <Route path="/people/:handle" element={<People />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/saved" element={<Saved />} />
        <Route path="/hiring" element={<Hiring />} />
        <Route path="/hiring/jobs/new" element={<Hiring />} />
        <Route path="/hiring/jobs/:id/applicants" element={<Hiring />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/boards" element={<Boards />} />
      </Routes>
    </Layout>
  )
}
