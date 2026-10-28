import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiDelete, apiGet, apiPost, errorMessage, isAbortError } from '../lib/api'
import { formatRelativeTime, publicPostUrl } from '../lib/format'
import './MediaViewer.css'
import './MediaViewerMobile.css'

export type ViewerMedia = {
  id?: string
  kind: 'image' | 'video'
  url: string
  alt: string
  poster?: string
  captionsUrl?: string
}

export type ViewerPost = {
  id: string
  body: string
  created_at: number
  author_name: string
  author_handle?: string | null
  author_headline?: string | null
  media: ViewerMedia[]
  like_count: number
  comment_count: number
  liked: boolean
  is_own?: boolean
}

export type ViewerComment = {
  id: string
  body: string
  created_at: number
  author_name: string
  author_handle?: string | null
}

type Props = {
  postId: string
  initialIndex?: number
  initialPost?: ViewerPost | null
  signedIn: boolean
  onClose: () => void
  onRequireAuth: (intent: string) => void
  onPostChanged?: (postId: string, patch: Partial<ViewerPost>) => void
  onDeleted?: (postId: string) => void
}

type ApiPost = {
  id: string
  body: string
  created_at: number
  author_name: string
  author_handle: string | null
  author_headline: string | null
  media: ViewerMedia[]
  like_count: number
  comment_count: number
  liked: boolean
  is_own: boolean
}

function toViewerPost(post: ApiPost): ViewerPost {
  return {
    id: post.id,
    body: post.body,
    created_at: post.created_at,
    author_name: post.author_name,
    author_handle: post.author_handle,
    author_headline: post.author_headline,
    media: Array.isArray(post.media) ? post.media : [],
    like_count: post.like_count || 0,
    comment_count: post.comment_count || 0,
    liked: Boolean(post.liked),
    is_own: Boolean(post.is_own),
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function Icon({ name }: { name: 'close' | 'more' | 'heart' | 'comment' | 'share' | 'play' | 'pause' | 'volume' | 'muted' | 'fullscreen' | 'left' | 'right' | 'plus' | 'minus' }) {
  const paths: Record<typeof name, string> = {
    close: 'M6 6l12 12M18 6 6 18',
    more: 'M12 4h.01M12 12h.01M12 20h.01',
    heart: 'M12 21 3 12C-3 4 8-1 12 6 16-1 27 4 21 12Z',
    comment: 'M21 11c0 8-9 10-14 7l-4 3 1-6C-1 4 20-4 21 11Z',
    share: 'M12 16V3m-4 4 4-4 4 4M5 12H3v9h18v-9h-2',
    play: 'm9 6 10 6-10 6Z',
    pause: 'M8 5v14M16 5v14',
    volume: 'M4 9v6h4l5 4V5L8 9Zm12 0a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12',
    muted: 'M4 9v6h4l5 4V5L8 9Zm12 0 5 6m0-6-5 6',
    fullscreen: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5',
    left: 'm15 5-7 7 7 7',
    right: 'm9 5 7 7-7 7',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
  }
  return (
    <svg
      className="mv-icon"
      viewBox="0 0 24 24"
      fill={name === 'heart' ? 'none' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}

export default function MediaViewer(props: Props) {
  const [post, setPost] = useState<ViewerPost | null>(props.initialPost || null)
  const [loading, setLoading] = useState(!props.initialPost)
  const [error, setError] = useState('')
  const [index, setIndex] = useState(() => {
    const max = Math.max((props.initialPost?.media.length || 1) - 1, 0)
    return Math.min(Math.max(props.initialIndex || 0, 0), max)
  })
  const [comments, setComments] = useState<ViewerComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentsError, setCommentsError] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const autoplayTried = useRef(false)

  const closeRef = useRef<HTMLButtonElement | null>(null)
  const replyRef = useRef<HTMLTextAreaElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const previousMediaCount = useRef(post?.media.length || 0)

  const media = post?.media || []
  const current = media[index] || null
  const maxIndex = Math.max(media.length - 1, 0)

  const loadPost = useCallback(async () => {
    try {
      const response = await apiGet<ApiPost>(`/posts/${encodeURIComponent(props.postId)}`)
      const next = toViewerPost(response.data)
      setPost(next)
      setError('')
      setIndex((value) => Math.min(value, Math.max(next.media.length - 1, 0)))
    } catch (caught) {
      if (!isAbortError(caught)) setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [props.postId])

  const loadComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const response = await apiGet<ViewerComment[]>(`/posts/${encodeURIComponent(props.postId)}/comments`)
      setComments(response.data || [])
      setCommentsError('')
    } catch (caught) {
      if (!isAbortError(caught)) setCommentsError(errorMessage(caught))
    } finally {
      setCommentsLoading(false)
    }
  }, [props.postId])

  useEffect(() => {
    void loadPost()
    void loadComments()
  }, [loadPost, loadComments])

  useEffect(() => {
    closeRef.current?.focus()
    setZoom(1)
  }, [])

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setVideoError('')
    setVideoLoading(false)
    setZoom(1)
    autoplayTried.current = false
    const video = videoRef.current
    if (video) {
      video.pause()
      video.load()
    }
  }, [index])

  useEffect(() => {
    return () => {
      const video = videoRef.current
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [])

  const closeMenuAnd = useCallback((action: () => void) => {
    setMenuOpen(false)
    action()
  }, [])

  const goTo = useCallback(
    (next: number) => {
      if (media.length === 0) return
      setIndex(Math.min(Math.max(next, 0), media.length - 1))
    },
    [media.length]
  )

  useEffect(() => {
    previousMediaCount.current = media.length
  }, [media.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (menuOpen) setMenuOpen(false)
        else props.onClose()
        return
      }
      if (event.key === 'ArrowRight' && maxIndex > 0) {
        event.preventDefault()
        goTo(index + 1)
      }
      if (event.key === 'ArrowLeft' && maxIndex > 0) {
        event.preventDefault()
        goTo(index - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goTo, index, maxIndex, menuOpen, props])

  const toggleLike = useCallback(async () => {
    if (!post) return
    if (!props.signedIn) {
      props.onRequireAuth('like')
      return
    }
    if (busy) return
    setBusy('like')
    setNotice('')
    try {
      const response = post.liked
        ? await apiDelete<{ liked: boolean; like_count: number }>(`/posts/${encodeURIComponent(post.id)}/like`)
        : await apiPost<{ liked: boolean; like_count: number }>(`/posts/${encodeURIComponent(post.id)}/like`)
      const patch = { liked: response.data.liked, like_count: response.data.like_count }
      setPost((currentPost) => (currentPost ? { ...currentPost, ...patch } : currentPost))
      props.onPostChanged?.(post.id, patch)
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }, [busy, post, props])

  const share = useCallback(async () => {
    const url = typeof window !== 'undefined' ? publicPostUrl(props.postId) : ''
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Joblite post', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setNotice('Link copied to clipboard.')
      window.setTimeout(() => setNotice(''), 3000)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setNotice('Could not share this post. Copy the address from your browser instead.')
    }
  }, [props.postId])

  const submitReply = useCallback(async () => {
    if (!post) return
    if (!props.signedIn) {
      props.onRequireAuth('comment')
      return
    }
    const body = reply.trim()
    if (!body || busy) return
    setBusy('reply')
    setNotice('')
    try {
      const response = await apiPost<ViewerComment>(`/posts/${encodeURIComponent(post.id)}/comments`, { body })
      setComments((currentComments) => [...currentComments, response.data])
      setReply('')
      const patch = { comment_count: (post.comment_count || 0) + 1 }
      setPost((currentPost) => (currentPost ? { ...currentPost, ...patch } : currentPost))
      props.onPostChanged?.(post.id, patch)
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }, [busy, post, props, reply])

  const deletePost = useCallback(async () => {
    if (!post || busy) return
    setBusy('delete')
    setNotice('')
    try {
      await apiDelete(`/posts/${encodeURIComponent(post.id)}`)
      props.onDeleted?.(post.id)
      props.onClose()
    } catch (caught) {
      setNotice(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }, [busy, post, props])

  const focusReply = useCallback(() => {
    if (!props.signedIn) {
      props.onRequireAuth('comment')
      return
    }
    setDetailsOpen(true)
    window.setTimeout(() => replyRef.current?.focus(), 0)
  }, [props])

  const togglePlay = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    try {
      if (video.paused) {
        await video.play()
        setPlaying(true)
      } else {
        video.pause()
        setPlaying(false)
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setVideoError('This video could not start. Press play again or open it in a new tab.')
    }
  }, [])

  // Browsers may refuse unmuted autoplay; the big play button stays as the fallback.
  const tryAutoplay = useCallback(() => {
    const video = videoRef.current
    if (!video || autoplayTried.current) return
    autoplayTried.current = true
    void video.play().catch(() => setPlaying(false))
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }, [])

  const seek = useCallback((value: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = value
    setCurrentTime(value)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const target = videoRef.current || stageRef.current
    if (!target) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (typeof target.requestFullscreen === 'function') await target.requestFullscreen()
      else {
        // iPhone Safari only supports native fullscreen on the video element itself.
        const iosVideo = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
        if (!iosVideo?.webkitEnterFullscreen) throw new Error('Fullscreen unavailable')
        iosVideo.webkitEnterFullscreen()
      }
    } catch {
      setNotice('Full screen is not available in this browser.')
    }
  }, [])

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0]
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }, [])

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchStart.current
      touchStart.current = null
      if (!start || zoom > 1) return
      const touch = event.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return
      goTo(index + (dx < 0 ? 1 : -1))
    },
    [goTo, index, zoom]
  )

  const authorInitial = (post?.author_name || 'J').trim().slice(0, 1).toUpperCase()
  const timestampLabel = post ? formatRelativeTime(post.created_at) : ''
  const isVideo = current?.kind === 'video'
  const zoomPercent = Math.round(zoom * 100)

  return (
    <div className="mv-backdrop" role="dialog" aria-modal="true" aria-label="Post media viewer">
      <header className="mv-topbar">
        <button ref={closeRef} type="button" className="mv-icon-button" aria-label="Close media viewer" onClick={props.onClose}>
          <Icon name="close" />
        </button>
        <div className="mv-brand" aria-label="Joblite AHIS">
          <img className="mv-brand-image" src="/joblite.png" alt="" />
          Joblite AHIS
        </div>
        <div className="mv-menu-wrap">
          <button
            type="button"
            className="mv-icon-button"
            aria-label="Post options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="more" />
          </button>
          {menuOpen ? (
            <div className="mv-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => closeMenuAnd(() => void share())}>
                Copy public link
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  closeMenuAnd(() => {
                    window.open(`/posts/${encodeURIComponent(props.postId)}`, '_blank', 'noopener,noreferrer')
                  })
                }
              >
                Open post page
              </button>
              {post?.is_own ? (
                <button type="button" role="menuitem" className="danger" disabled={busy !== null} onClick={() => closeMenuAnd(() => void deletePost())}>
                  Delete my post
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="mv-body">
        <div
          className="mv-stage"
          ref={stageRef}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onDoubleClick={() => setZoom((value) => (value > 1 ? 1 : 2))}
        >
          {loading && !post ? <p className="mv-state">Loading post…</p> : null}
          {error && !post ? (
            <div className="mv-state">
              <h2>This post could not be loaded</h2>
              <p>{error}</p>
              <button type="button" className="mv-primary" onClick={() => void loadPost()}>
                Retry
              </button>
            </div>
          ) : null}

          {post && current ? (
            isVideo ? (
              <div className="mv-video-wrap">
                <video
                  ref={videoRef}
                  className="mv-video"
                  src={current.url}
                  poster={current.poster}
                  playsInline
                  preload="auto"
                  onClick={() => void togglePlay()}
                  onLoadStart={() => setVideoLoading(true)}
                  onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onWaiting={() => setVideoLoading(true)}
                  onPlaying={() => {
                    setVideoLoading(false)
                    setVideoError('')
                  }}
                  onLoadedData={() => setVideoLoading(false)}
                  onCanPlay={() => {
                    setVideoLoading(false)
                    tryAutoplay()
                  }}
                  onError={() => {
                    setVideoLoading(false)
                    setVideoError('This video could not be played. The format may be unsupported or the file may be unavailable.')
                  }}
                  aria-label={current.alt || 'Post video'}
                >
                  {current.captionsUrl ? <track kind="captions" src={current.captionsUrl} srcLang="en" label="English" default /> : null}
                </video>

                {videoLoading ? <span className="mv-video-loading" role="status">Loading video…</span> : null}
                {videoError ? (
                  <div className="mv-video-error" role="alert">
                    <p>{videoError}</p>
                    <a href={current.url} target="_blank" rel="noopener noreferrer" className="mv-primary">
                      Open video
                    </a>
                  </div>
                ) : null}

                {!playing && !videoError ? (
                  <button type="button" className="mv-big-play" aria-label="Play video" onClick={() => void togglePlay()}>
                    <Icon name="play" />
                  </button>
                ) : null}

                <div className="mv-video-controls">
                  <button type="button" className="mv-control" aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => void togglePlay()}>
                    <Icon name={playing ? 'pause' : 'play'} />
                  </button>
                  <span className="mv-time">{formatTime(currentTime)}</span>
                  <input
                    className="mv-seek"
                    type="range"
                    min={0}
                    max={duration || 0}
                    step="0.1"
                    value={Math.min(currentTime, duration || 0)}
                    aria-label="Seek video"
                    onChange={(event) => seek(Number(event.target.value))}
                  />
                  <span className="mv-time">{formatTime(duration)}</span>
                  <button type="button" className="mv-control" aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={toggleMute}>
                    <Icon name={muted ? 'muted' : 'volume'} />
                  </button>
                  <button type="button" className="mv-control" aria-label="Full screen video" onClick={() => void toggleFullscreen()}>
                    <Icon name="fullscreen" />
                  </button>
                </div>
              </div>
            ) : (
              <div className={`mv-image-frame ${zoom > 1 ? 'zoomed' : ''}`}>
                <img
                  className="mv-image"
                  src={current.url}
                  alt={current.alt || 'Post image'}
                  style={{ transform: `scale(${zoom})` }}
                  draggable={false}
                />
              </div>
            )
          ) : null}

          {post && media.length === 0 ? (
            <div className="mv-state">
              <h2>No media on this post</h2>
              <p>{post.body}</p>
            </div>
          ) : null}

          {media.length > 1 ? (
            <>
              <button
                type="button"
                className="mv-nav previous"
                aria-label="Previous attachment"
                disabled={index === 0}
                onClick={() => goTo(index - 1)}
              >
                <Icon name="left" />
              </button>
              <button
                type="button"
                className="mv-nav next"
                aria-label="Next attachment"
                disabled={index === maxIndex}
                onClick={() => goTo(index + 1)}
              >
                <Icon name="right" />
              </button>
              <span className="mv-counter" aria-live="polite">
                {index + 1} / {media.length}
              </span>
            </>
          ) : null}

          {current?.kind === 'image' ? (
            <div className="mv-zoom-controls" role="group" aria-label="Image zoom">
              <button
                type="button"
                className="mv-control"
                aria-label="Zoom out"
                disabled={zoom <= 1}
                onClick={() => setZoom((value) => Math.max(1, Math.round((value - 0.5) * 10) / 10))}
              >
                <Icon name="minus" />
              </button>
              <span className="mv-zoom-value" aria-live="polite">{zoomPercent}%</span>
              <button
                type="button"
                className="mv-control"
                aria-label="Zoom in"
                disabled={zoom >= 3}
                onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.5) * 10) / 10))}
              >
                <Icon name="plus" />
              </button>
              {zoom > 1 ? (
                <button type="button" className="mv-reset" onClick={() => setZoom(1)}>
                  Reset
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className={`mv-panel ${detailsOpen ? 'expanded' : 'collapsed'}`}>
          <div className="mv-post">
            <div className="mv-author">
              <span className="mv-avatar" aria-hidden="true">{authorInitial}</span>
              <div>
                <strong>{post?.author_name || 'Joblite member'}</strong>
                <small>
                  {post?.author_handle ? `@${post.author_handle} · ` : ''}
                  {timestampLabel}
                </small>
                {post?.author_headline ? <small>{post.author_headline}</small> : null}
              </div>
            </div>
            {post?.body ? <p className="mv-caption">{post.body}</p> : null}
            {post ? (
              <dl className="mv-details">
                <div>
                  <dt>Likes</dt>
                  <dd>{post.like_count}</dd>
                </div>
                <div>
                  <dt>Replies</dt>
                  <dd>{post.comment_count}</dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="mv-actions" aria-label="Post actions">
            <button type="button" aria-label={`Like post, ${post?.like_count || 0} likes`} aria-pressed={Boolean(post?.liked)} className={post?.liked ? 'liked' : ''} disabled={busy !== null} onClick={() => void toggleLike()}>
              <Icon name="heart" />
              <span>{post?.like_count || 0}</span>
            </button>
            <button type="button" aria-label="Reply to post" onClick={focusReply}>
              <Icon name="comment" />
              <span>{post?.comment_count || 0}</span>
            </button>
            <button type="button" aria-label="Share post" onClick={() => void share()}>
              <Icon name="share" />
              <span>Share</span>
            </button>
          </div>

          <button
            type="button"
            className="mv-panel-toggle"
            aria-expanded={detailsOpen}
            aria-controls="mv-replies"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? 'Hide replies' : `Show replies (${post?.comment_count || 0})`}
          </button>

          <section id="mv-replies" className="mv-comments" aria-label="Replies">
            <h2>Replies</h2>
            {commentsLoading ? <p className="mv-muted" role="status">Loading replies…</p> : null}
            {commentsError ? (
              <div className="mv-inline-error" role="alert">
                <p>{commentsError}</p>
                <button type="button" onClick={() => void loadComments()}>Retry</button>
              </div>
            ) : null}
            {!commentsLoading && !commentsError && comments.length === 0 ? (
              <p className="mv-muted">No replies yet. Start the conversation.</p>
            ) : null}
            {comments.length > 0 ? (
              <ul className="mv-comment-list">
                {comments.map((comment) => (
                  <li key={comment.id}>
                    <strong>{comment.author_name}</strong>
                    <small>{comment.author_handle ? `@${comment.author_handle} · ` : ''}{formatRelativeTime(comment.created_at)}</small>
                    <p>{comment.body}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <form
            className="mv-reply"
            onSubmit={(event) => {
              event.preventDefault()
              void submitReply()
            }}
          >
            <label className="sr-only" htmlFor="mv-reply-input">Write a reply</label>
            <textarea
              id="mv-reply-input"
              ref={replyRef}
              value={reply}
              maxLength={2000}
              rows={2}
              placeholder={props.signedIn ? 'Post your reply' : 'Sign in to reply'}
              onChange={(event) => setReply(event.target.value)}
            />
            <button type="submit" className="mv-primary" disabled={busy !== null || !reply.trim()}>
              {busy === 'reply' ? 'Replying…' : 'Reply'}
            </button>
          </form>

          {notice ? <p className="mv-notice" role="status">{notice}</p> : null}
        </aside>
      </div>
    </div>
  )
}
