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
import Composer from './pages/Composer'
import PostMedia from './pages/PostMedia'
import PostDetail from './pages/PostDetail'
import SignIn from './pages/SignIn'
import ApplicationDetail from './pages/ApplicationDetail'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/compose" element={<Composer />} />
        <Route path="/posts/:postId/media/:mediaIndex" element={<PostMedia />} />
        <Route path="/posts/:id" element={<PostDetail />} />
        <Route path="/sign-in" element={<SignIn />} />
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
      </Routes>
    </Layout>
  )
}
