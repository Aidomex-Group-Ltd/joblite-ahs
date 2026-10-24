import React, { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import MediaViewer from '../components/MediaViewer'
import { signInPath, useSession } from '../lib/session'

export default function PostMedia() {
  const navigate = useNavigate()
  const session = useSession()
  const { postId, mediaIndex } = useParams<{ postId: string; mediaIndex: string }>()

  useEffect(() => {
    document.body.classList.add('jl-viewer-open')
    return () => document.body.classList.remove('jl-viewer-open')
  }, [])

  if (!postId) {
    return (
      <div className="composer-page">
        <div className="composer-state">Post not found.</div>
      </div>
    )
  }

  const index = Math.max(Number.parseInt(mediaIndex || '0', 10) || 0, 0)

  return (
    <MediaViewer
      postId={postId}
      initialIndex={index}
      signedIn={Boolean(session.user)}
      onClose={() => navigate('/', { replace: true })}
      onRequireAuth={(intent) =>
        navigate(signInPath(intent, `/posts/${encodeURIComponent(postId)}/media/${index}`))
      }
    />
  )
}
