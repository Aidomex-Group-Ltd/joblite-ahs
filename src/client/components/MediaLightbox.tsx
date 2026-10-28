import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './MediaLightbox.css'

export interface LightboxMedia {
  kind: 'image' | 'video'
  url: string
  alt?: string
  poster?: string
}

export interface MediaLightboxProps {
  media: LightboxMedia[]
  initialIndex: number
  /** Returns the on-page thumbnail for an attachment so the media can grow from and shrink back onto it. */
  getThumbnail: (index: number) => HTMLElement | null
  onCollapsed: () => void
  /** Opens the full post viewer with replies; omitted where that viewer is not available. */
  onOpenDetails?: (index: number) => void
}

type Phase = 'collapsed' | 'expanded' | 'collapsing'
type Box = { top: number; left: number; width: number; height: number; radius: number }

const TRANSITION_MS = 280

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function viewportBox(): Box {
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight, radius: 0 }
}

function thumbnailBox(element: HTMLElement | null): Box | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, radius: 8 }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`
}

export default function MediaLightbox({ media, initialIndex, getThumbnail, onCollapsed, onOpenDetails }: MediaLightboxProps): JSX.Element | null {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(media.length - 1, 0)))
  const animate = useRef(!prefersReducedMotion())
  const [phase, setPhase] = useState<Phase>(() => (animate.current && thumbnailBox(getThumbnail(initialIndex)) ? 'collapsed' : 'expanded'))
  const [origin, setOrigin] = useState<Box | null>(() => thumbnailBox(getThumbnail(initialIndex)))
  const [viewport, setViewport] = useState<Box>(() => viewportBox())
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [needsUnmute, setNeedsUnmute] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [videoError, setVideoError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const finished = useRef(false)
  const onCollapsedRef = useRef(onCollapsed)
  onCollapsedRef.current = onCollapsed

  const current = media[index] || null

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    onCollapsedRef.current()
  }, [])

  const collapse = useCallback(() => {
    if (phase === 'collapsing') return
    videoRef.current?.pause()
    const target = thumbnailBox(getThumbnail(index))
    if (!animate.current || !target) {
      finish()
      return
    }
    setOrigin(target)
    setPhase('collapsing')
    window.setTimeout(finish, TRANSITION_MS + 120)
  }, [finish, getThumbnail, index, phase])

  // Starting playback during the same commit as the tap keeps the user
  // activation, which iOS requires for unmuted playback.
  useLayoutEffect(() => {
    const video = videoRef.current
    if (!video || current?.kind !== 'video') return
    setVideoError(false)
    setNeedsUnmute(false)
    video.muted = false
    setMuted(false)
    video.play().catch((error: unknown) => {
      if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') return
      video.muted = true
      setMuted(true)
      setNeedsUnmute(true)
      void video.play().catch(() => setPlaying(false))
    })
  }, [current?.kind, current?.url])

  // Two frames: the first paints the media at the thumbnail, the second starts the transition.
  useEffect(() => {
    if (phase !== 'collapsed') return
    let inner = 0
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setPhase((value) => (value === 'collapsed' ? 'expanded' : value)))
    })
    return () => {
      window.cancelAnimationFrame(outer)
      window.cancelAnimationFrame(inner)
    }
  }, [phase])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus({ preventScroll: true })
    const onResize = () => setViewport(viewportBox())
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      previous?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        collapse()
      } else if (event.key === 'ArrowRight' && index < media.length - 1) {
        setIndex(index + 1)
      } else if (event.key === 'ArrowLeft' && index > 0) {
        setIndex(index - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapse, index, media.length])

  useEffect(() => {
    setCurrentTime(0)
    setDuration(0)
    setPlaying(false)
  }, [index])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setVideoError(true))
    else video.pause()
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
    setNeedsUnmute(false)
    if (!video.muted && video.paused) void video.play().catch(() => undefined)
  }, [])

  if (!current) return null

  const box = phase === 'expanded' || !origin ? viewport : origin
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <div
      className={`ml-backdrop ml-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label={current.kind === 'video' ? 'Expanded video' : 'Expanded image'}
      onClick={collapse}
    >
      <div
        className="ml-frame"
        style={{
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          borderRadius: box.radius,
          transitionDuration: animate.current ? `${TRANSITION_MS}ms` : '0ms',
        }}
        onTransitionEnd={(event) => {
          if (phase === 'collapsing' && event.target === event.currentTarget) finish()
        }}
      >
        {current.kind === 'image' ? (
          <img className="ml-media" src={current.url} alt={current.alt || 'Post image'} draggable={false} />
        ) : (
          <video
            key={current.url}
            ref={videoRef}
            className="ml-media"
            src={current.url}
            poster={current.poster}
            playsInline
            preload="auto"
            aria-label={current.alt || 'Post video'}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onPlaying={() => setVideoError(false)}
            onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onError={() => setVideoError(true)}
          />
        )}
      </div>

      <div className="ml-chrome ml-top" onClick={stop}>
        {media.length > 1 ? (
          <span className="ml-counter" aria-live="polite">
            {index + 1} / {media.length}
          </span>
        ) : <span />}
        <button ref={closeRef} type="button" className="ml-button" aria-label="Collapse to thumbnail" onClick={collapse}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      {media.length > 1 ? (
        <>
          <button
            type="button"
            className="ml-button ml-nav ml-prev"
            aria-label="Previous attachment"
            disabled={index === 0}
            onClick={(event) => {
              event.stopPropagation()
              setIndex(index - 1)
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
          <button
            type="button"
            className="ml-button ml-nav ml-next"
            aria-label="Next attachment"
            disabled={index === media.length - 1}
            onClick={(event) => {
              event.stopPropagation()
              setIndex(index + 1)
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        </>
      ) : null}

      {current.kind === 'video' && needsUnmute ? (
        <button type="button" className="ml-unmute" onClick={(event) => {
          event.stopPropagation()
          toggleMute()
        }}>
          Tap to unmute
        </button>
      ) : null}

      {current.kind === 'video' && videoError ? (
        <div className="ml-error" role="alert" onClick={stop}>
          This video could not be played on this device.{' '}
          <a href={current.url} target="_blank" rel="noopener noreferrer">Open video</a>
        </div>
      ) : null}

      <div className="ml-chrome ml-bottom" onClick={stop}>
        {current.kind === 'video' ? (
          <>
            <button type="button" className="ml-button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={togglePlay}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={playing ? 'M8 5v14M16 5v14' : 'm9 6 10 6-10 6Z'} />
              </svg>
            </button>
            <span className="ml-time">{formatTime(currentTime)}</span>
            <input
              className="ml-seek"
              type="range"
              min={0}
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              aria-label="Seek video"
              onChange={(event) => {
                const video = videoRef.current
                if (!video) return
                video.currentTime = Number(event.target.value)
                setCurrentTime(video.currentTime)
              }}
            />
            <span className="ml-time">{formatTime(duration)}</span>
            <button type="button" className="ml-button" aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={toggleMute}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={muted ? 'M4 9v6h4l5 4V5L8 9Zm12 0 5 6m0-6-5 6' : 'M4 9v6h4l5 4V5L8 9Zm12 0a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12'} />
              </svg>
            </button>
          </>
        ) : <span className="ml-hint">Tap the image to collapse</span>}
        {onOpenDetails ? (
          <button type="button" className="ml-details" onClick={() => onOpenDetails(index)}>
            Replies
          </button>
        ) : null}
      </div>
    </div>
  )
}
