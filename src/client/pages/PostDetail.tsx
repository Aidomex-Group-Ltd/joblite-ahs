import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, errorMessage } from '../lib/api'
import { formatRelativeTime, publicPostUrl, videoThumbnailSrc } from '../lib/format'
import { signInPath, useSession } from '../lib/session'
import { EmptyState, Loading } from '../components/Common'
import MediaLightbox from '../components/MediaLightbox'
import { applyPageMetadata, DEFAULT_METADATA, SITE_ORIGIN } from '../../shared/page-metadata'

type Post = {
  id: string
  body: string
  created_at: number
  author_name: string
  author_handle: string | null
  author_headline: string | null
  comment_count: number
  like_count: number
  liked: boolean
  is_own: boolean
  media: Array<{ id: string; kind: 'image' | 'video'; url: string; alt: string }>
}

type Comment = {
  id: string
  body: string
  created_at: number
  author_name: string
  author_handle: string | null
}

export default function PostDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const session = useSession()
  const [post, setPost] = useState<Post | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<{ index: number; thumbnail: HTMLElement } | null>(null)

  useEffect(() => {
    if (!expanded) return
    document.body.classList.add('jl-viewer-open')
    return () => document.body.classList.remove('jl-viewer-open')
  }, [expanded])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [postResponse, commentsResponse] = await Promise.all([
        apiGet<Post>(`/posts/${encodeURIComponent(id)}`),
        apiGet<Comment[]>(`/posts/${encodeURIComponent(id)}/comments`),
      ])
      setPost(postResponse.data)
      setComments(commentsResponse.data || [])
      setError('')
    } catch (caught) {
      setError(errorMessage(caught))
      setPost(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const url = `${SITE_ORIGIN}/posts/${encodeURIComponent(id || '')}`
    if (!post) { applyPageMetadata({ ...DEFAULT_METADATA, title: 'Post unavailable | Joblite AHIS', url, noindex: true }); return }
    const excerpt = post.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260)
    const image = post.media.find((media) => media.kind === 'image')
    applyPageMetadata({ ...DEFAULT_METADATA, title: `${excerpt.slice(0, 90) || 'Public post'} | Joblite AHIS`, description: excerpt || 'A public post from the Joblite community.', url, type: 'article', image: image ? new URL(image.url, SITE_ORIGIN).href : DEFAULT_METADATA.image, imageWidth: image ? undefined : 1200, imageHeight: image ? undefined : 630, imageAlt: image ? `Image shared in a public Joblite post: ${excerpt.slice(0, 120)}` : DEFAULT_METADATA.imageAlt })
  }, [id, post])

  const requireSignIn = useCallback(
    (intent: string) => {
      navigate(signInPath(intent, `/posts/${encodeURIComponent(id || '')}`))
    },
    [id, navigate]
  )

  const toggleLike = useCallback(async () => {
    if (!post) return
    if (!session.user) return requireSignIn('like')
    if (busy) return
    setBusy('like')
    try {
      const response = post.liked
        ? await apiDelete<{ liked: boolean; like_count: number }>(`/posts/${encodeURIComponent(post.id)}/like`)
        : await apiPost<{ liked: boolean; like_count: number }>(`/posts/${encodeURIComponent(post.id)}/like`)
      setPost({ ...post, liked: response.data.liked, like_count: response.data.like_count })
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }, [busy, post, requireSignIn, session.user])

  const share = useCallback(async () => {
    if (!post) return
    try {
      const url = publicPostUrl(post.id)
      if (navigator.share) await navigator.share({ title: 'Joblite post', url })
      else {
        await navigator.clipboard.writeText(url)
        setNotice('Link copied to clipboard.')
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setNotice('Could not share this post.')
    }
  }, [post])

  const submitReply = useCallback(async () => {
    if (!post) return
    if (!session.user) return requireSignIn('comment')
    const body = reply.trim()
    if (!body || busy) return
    setBusy('reply')
    try {
      const response = await apiPost<Comment>(`/posts/${encodeURIComponent(post.id)}/comments`, { body })
      setComments((current) => [...current, response.data])
      setPost({ ...post, comment_count: post.comment_count + 1 })
      setReply('')
      setNotice('')
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }, [busy, post, reply, requireSignIn, session.user])

  const remove = useCallback(async () => {
    if (!post || busy) return
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    setBusy('delete')
    try {
      await apiDelete(`/posts/${encodeURIComponent(post.id)}`)
      navigate('/', { replace: true })
    } catch (caught) {
      setNotice(errorMessage(caught))
      setBusy(null)
    }
  }, [busy, navigate, post])

  if (loading) return <Loading label="Loading post…" />
  if (error || !post) {
    return (
      <div className="page">
        <EmptyState title="Post unavailable" action={<Link className="btn" to="/">Back to home</Link>}>
          <p>{error || 'This post could not be found.'}</p>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="page">
      <Link className="back-link" to="/">← Back to home</Link>
      <article className="card">
        <div className="job-meta-line">
          <strong>{post.author_name}</strong>
          {post.author_handle ? <span>@{post.author_handle}</span> : null}
          <span>{formatRelativeTime(post.created_at)}</span>
        </div>
        {post.author_headline ? <p className="muted">{post.author_headline}</p> : null}
        <p className="post-body">{post.body}</p>
        {post.media.length > 0 ? (
          <div className="post-media-list">
            {post.media.map((media, index) => (
              <button
                key={media.id}
                type="button"
                className="jl-media-button"
                aria-label={`Expand ${media.kind} ${index + 1} to full screen`}
                onClick={(event) => {
                  document.querySelectorAll('video').forEach((video) => video.pause())
                  setExpanded({ index, thumbnail: event.currentTarget })
                }}
              >
                {media.kind === 'image' ? (
                  <img className="jl-post-media" src={media.url} alt={media.alt || 'Post attachment'} />
                ) : (
                  <video className="jl-post-media" src={videoThumbnailSrc(media.url)} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
                )}
              </button>
            ))}
          </div>
        ) : null}
        {expanded ? (
          <MediaLightbox
            media={post.media.map((media) => ({ kind: media.kind, url: media.url, alt: media.alt }))}
            initialIndex={expanded.index}
            getThumbnail={(index) => {
              const sibling = expanded.thumbnail.parentElement?.children[index]
              return sibling instanceof HTMLElement ? sibling : expanded.thumbnail
            }}
            onCollapsed={() => setExpanded(null)}
          />
        ) : null}
        <div className="button-row" style={{ marginTop: 12 }}>
          <button type="button" className={`btn btn-secondary ${post.liked ? 'is-saved' : ''}`} aria-pressed={post.liked} disabled={busy !== null} onClick={() => void toggleLike()}>
            {post.liked ? 'Liked' : 'Like'} · {post.like_count}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void share()}>Share</button>
          {post.is_own ? (
            <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void remove()}>
              Delete
            </button>
          ) : null}
        </div>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </article>

      <section className="card" aria-label="Replies">
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Replies · {post.comment_count}</h2>
        {comments.length === 0 ? <p className="muted">No replies yet.</p> : null}
        {comments.length > 0 ? (
          <ul className="comment-list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <div className="job-meta-line">
                  <strong>{comment.author_name}</strong>
                  {comment.author_handle ? <span>@{comment.author_handle}</span> : null}
                  <span>{formatRelativeTime(comment.created_at)}</span>
                </div>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault()
            void submitReply()
          }}
        >
          <label>
            Reply
            <textarea
              className="input"
              rows={2}
              maxLength={2000}
              placeholder={session.user ? 'Post your reply' : 'Sign in to reply'}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={busy !== null || !reply.trim()}>
            {busy === 'reply' ? 'Replying…' : 'Reply'}
          </button>
        </form>
      </section>
    </div>
  )
}
