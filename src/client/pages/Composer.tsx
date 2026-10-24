import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiDelete, apiPost, errorMessage, uploadMediaWithProgress } from '../lib/api'
import { signInPath, useSession } from '../lib/session'
import './Composer.css'

const DRAFT_KEY = 'joblite:pendingDraft'
const MAX_ATTACHMENTS = 4
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const VIDEO_TYPES = ['video/mp4', 'video/webm']

type AttachmentKind = 'image' | 'video'

type Attachment = {
  localId: string
  file: File
  kind: AttachmentKind
  status: 'uploading' | 'ready' | 'error'
  progress: number
  mediaId?: string
  serverUrl?: string
  previewUrl?: string
  error?: string
}

function attachmentLabel(kind: AttachmentKind): string {
  return kind === 'image' ? 'JPEG, PNG, WebP or GIF up to 8 MB' : 'MP4 or WebM up to 50 MB'
}

export default function Composer() {
  const navigate = useNavigate()
  const session = useSession()
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [closing, setClosing] = useState(false)
  const imageInput = useRef<HTMLInputElement | null>(null)
  const videoInput = useRef<HTMLInputElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const controllers = useRef<Map<string, AbortController>>(new Map())
  const publishLock = useRef(false)
  const attachmentsRef = useRef<Attachment[]>([])
  const draftRef = useRef('')
  const savedRef = useRef(false)

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(DRAFT_KEY)
      if (stored) setDraft(stored)
    } catch {
      // A blocked sessionStorage only means the draft stays in this view.
    }
    textRef.current?.focus()
  }, [])

  const revokePreview = useCallback((url?: string) => {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
  }, [])

  const cleanup = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    for (const attachment of attachmentsRef.current) revokePreview(attachment.previewUrl)
  }, [revokePreview])

  useEffect(() => {
    return () => {
      cleanup()
      if (!savedRef.current) {
        try {
          window.sessionStorage.setItem(DRAFT_KEY, draftRef.current)
        } catch {
          // ignore storage restrictions
        }
      }
    }
  }, [cleanup])

  const validateFile = useCallback((file: File, kind: AttachmentKind): string | null => {
    const allowed = kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES
    const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
    if (!allowed.includes(file.type)) {
      return `Unsupported type. Use ${kind === 'image' ? 'JPEG, PNG, WebP or GIF' : 'MP4 or WebM'}.`
    }
    if (file.size === 0) return 'This file is empty.'
    if (file.size > maxBytes) return `This file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`
    return null
  }, [])

  const uploadAttachment = useCallback(
    async (attachment: Attachment) => {
      const controller = new AbortController()
      controllers.current.set(attachment.localId, controller)
      setAttachments((current) =>
        current.map((item) =>
          item.localId === attachment.localId ? { ...item, status: 'uploading', progress: 0, error: undefined } : item
        )
      )
      try {
        const media = await uploadMediaWithProgress(
          attachment.file,
          attachment.kind === 'image' ? 'post_image' : 'post_video',
          (percent) => {
            setAttachments((current) =>
              current.map((item) => (item.localId === attachment.localId ? { ...item, progress: percent } : item))
            )
          },
          controller.signal
        )
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId
              ? { ...item, status: 'ready', progress: 100, mediaId: media.id, serverUrl: media.url, error: undefined }
              : item
          )
        )
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId
              ? { ...item, status: 'error', progress: 0, error: errorMessage(caught) }
              : item
          )
        )
      } finally {
        controllers.current.delete(attachment.localId)
      }
    },
    []
  )

  const addFiles = useCallback(
    (files: FileList | null, kind: AttachmentKind) => {
      if (!files || files.length === 0) return
      setNotice('')
      const room = MAX_ATTACHMENTS - attachmentsRef.current.length
      if (room <= 0) {
        setNotice(`You can attach up to ${MAX_ATTACHMENTS} files to one post.`)
        return
      }
      const selected = Array.from(files).slice(0, room)
      const next: Attachment[] = []
      for (const file of selected) {
        const validation = validateFile(file, kind)
        if (validation) {
          setNotice(validation)
          continue
        }
        next.push({
          localId: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          file,
          kind,
          status: 'uploading',
          progress: 0,
          previewUrl: URL.createObjectURL(file),
        })
      }
      if (next.length === 0) return
      setAttachments((current) => [...current, ...next])
      for (const attachment of next) void uploadAttachment(attachment)
    },
    [uploadAttachment, validateFile]
  )

  const removeAttachment = useCallback(
    (localId: string) => {
      const target = attachmentsRef.current.find((item) => item.localId === localId)
      if (!target) return
      controllers.current.get(localId)?.abort()
      controllers.current.delete(localId)
      revokePreview(target.previewUrl)
      if (target.mediaId) {
        void apiDelete(`/media/${encodeURIComponent(target.mediaId)}`).catch(() => {})
      }
      setAttachments((current) => current.filter((item) => item.localId !== localId))
    },
    [revokePreview]
  )

  const retryAttachment = useCallback(
    (localId: string) => {
      const target = attachmentsRef.current.find((item) => item.localId === localId)
      if (!target || target.status !== 'error') return
      void uploadAttachment(target)
    },
    [uploadAttachment]
  )

  const requestClose = useCallback(() => {
    if (closing) return
    const hasContent = draftRef.current.trim().length > 0 || attachmentsRef.current.length > 0
    if (hasContent && !window.confirm('Discard this draft? Your text and attachments will not be published.')) return
    savedRef.current = true
    setClosing(true)
    cleanup()
    if (window.history.length > 1) navigate(-1)
    else navigate('/', { replace: true })
  }, [cleanup, closing, navigate])

  const publish = useCallback(async () => {
    if (!session.user || publishLock.current) return
    const text = draft.trim()
    const uploading = attachments.some((item) => item.status === 'uploading')
    const failed = attachments.filter((item) => item.status === 'error')
    const ready = attachments.filter((item) => item.status === 'ready' && item.mediaId)
    if (uploading) {
      setNotice('Wait for the uploads to finish before publishing.')
      return
    }
    if (failed.length > 0) {
      setNotice('Remove or retry the failed attachment before publishing.')
      return
    }
    if (!text && ready.length === 0) {
      setNotice('Write something or attach an image/video first.')
      return
    }

    publishLock.current = true
    setSubmitting(true)
    setNotice('')
    try {
      await apiPost('/posts', { body: text, media_ids: ready.map((item) => item.mediaId) })
      savedRef.current = true
      try {
        window.sessionStorage.removeItem(DRAFT_KEY)
      } catch {
        // ignore storage restrictions
      }
      for (const attachment of attachments) revokePreview(attachment.previewUrl)
      setAttachments([])
      setDraft('')
      navigate('/', { replace: true })
    } catch (caught) {
      // Keep the text and attachments exactly as they are so the user can retry.
      setNotice(errorMessage(caught))
    } finally {
      publishLock.current = false
      setSubmitting(false)
    }
  }, [attachments, draft, navigate, revokePreview, session.user])

  useEffect(() => {
    if (!session.loading && !session.user) {
      // Guests keep a short-lived draft while they sign in.
      try {
        if (draft.trim()) window.sessionStorage.setItem(DRAFT_KEY, draft)
      } catch {
        // ignore storage restrictions
      }
    }
  }, [draft, session.loading, session.user])

  if (session.loading) {
    return (
      <div className="composer-page">
        <div className="composer-state" role="status">Checking your session…</div>
      </div>
    )
  }

  if (!session.user) {
    return (
      <div className="composer-page">
        <header className="composer-topbar">
          <button type="button" className="composer-text-button" onClick={() => navigate('/')} aria-label="Close composer">
            Cancel
          </button>
          <strong>New post</strong>
          <span aria-hidden="true" />
        </header>
        <main className="composer-gate">
          <div className="composer-gate-mark" aria-hidden="true">J</div>
          <h1>Sign in to share with Joblite</h1>
          <p>
            Publishing is tied to a real account so people can reply and you can manage your own posts. You can still
            browse jobs, view media and follow external applications without signing in.
          </p>
          <button
            type="button"
            className="composer-primary"
            onClick={() => navigate(signInPath('publish-post', '/compose'))}
          >
            Sign in and continue
          </button>
          <button type="button" className="composer-text-button" onClick={() => navigate('/')}>
            Browse without signing in
          </button>
        </main>
      </div>
    )
  }

  const uploading = attachments.some((item) => item.status === 'uploading')
  const hasFailed = attachments.some((item) => item.status === 'error')
  const ready = attachments.filter((item) => item.status === 'ready' && item.mediaId)
  const canPublish = !submitting && !uploading && !hasFailed && (draft.trim().length > 0 || ready.length > 0)
  const displayName = session.user.display_name || session.user.email.split('@')[0]

  return (
    <div className="composer-page">
      <header className="composer-topbar">
        <button type="button" className="composer-text-button" onClick={requestClose} aria-label="Close composer">
          Cancel
        </button>
        <strong>New post</strong>
        <button type="button" className="composer-primary composer-publish" disabled={!canPublish} onClick={() => void publish()}>
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </header>

      <main className="composer-card">
        <div className="composer-editor">
          <span className="composer-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
          <div className="composer-editor-main">
            <label className="sr-only" htmlFor="composer-text">Post text</label>
            <textarea
              id="composer-text"
              ref={textRef}
              value={draft}
              maxLength={5000}
              rows={5}
              placeholder="Share an opportunity, a hiring update or your work…"
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="composer-editor-meta">
              <span>Public post</span>
              <span className={draft.length > 4800 ? 'near-limit' : ''}>{draft.length} / 5000</span>
            </div>
          </div>
        </div>

        {attachments.length > 0 ? (
          <ul className="composer-attachments" aria-label="Selected attachments">
            {attachments.map((attachment) => (
              <li key={attachment.localId} className={`composer-attachment ${attachment.status}`}>
                <div className="composer-preview">
                  {attachment.kind === 'image' ? (
                    <img src={attachment.previewUrl} alt="Selected image preview" />
                  ) : (
                    <video src={attachment.previewUrl || attachment.serverUrl} controls playsInline preload="metadata" aria-label="Selected video preview" />
                  )}
                </div>
                <div className="composer-attachment-body">
                  <strong>{attachment.file.name}</strong>
                  <small>{attachmentLabel(attachment.kind)}</small>
                  {attachment.status === 'uploading' ? (
                    <div className="composer-progress">
                      <span style={{ width: `${attachment.progress}%` }} />
                      <small>{attachment.progress > 0 ? `${attachment.progress}% uploaded` : 'Preparing upload…'}</small>
                    </div>
                  ) : null}
                  {attachment.status === 'error' ? (
                    <small className="composer-error" role="alert">{attachment.error || 'Upload failed'}</small>
                  ) : null}
                  {attachment.status === 'ready' ? <small className="composer-ready">Uploaded and ready</small> : null}
                  <div className="composer-attachment-actions">
                    {attachment.status === 'error' ? (
                      <button type="button" onClick={() => retryAttachment(attachment.localId)}>
                        Retry upload
                      </button>
                    ) : null}
                    <button type="button" onClick={() => removeAttachment(attachment.localId)} aria-label={`Remove ${attachment.file.name}`}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="composer-toolbar">
          <div className="composer-tools">
            <input
              ref={imageInput}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                addFiles(event.target.files, 'image')
                event.target.value = ''
              }}
            />
            <input
              ref={videoInput}
              type="file"
              accept={VIDEO_TYPES.join(',')}
              multiple
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                addFiles(event.target.files, 'video')
                event.target.value = ''
              }}
            />
            <button
              type="button"
              className="composer-tool"
              onClick={() => imageInput.current?.click()}
              disabled={attachments.length >= MAX_ATTACHMENTS || submitting}
              aria-label="Add images"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v16H3ZM3 15l5-5 5 5 3-3 5 5M15 8h.01" /></svg>
              <span>Image</span>
            </button>
            <button
              type="button"
              className="composer-tool"
              onClick={() => videoInput.current?.click()}
              disabled={attachments.length >= MAX_ATTACHMENTS || submitting}
              aria-label="Add a video"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v12H3Zm12 4 6-4v12l-6-4Z" /></svg>
              <span>Video</span>
            </button>
          </div>
          <small className="composer-limit">
            {attachments.length}/{MAX_ATTACHMENTS} attachments
          </small>
        </div>

        {notice ? (
          <div className="composer-notice" role="alert">
            {notice}
          </div>
        ) : null}

        <p className="composer-hint">
          Uploads are validated on the server too. Media is stored in Joblite's R2 bucket and only attached after you
          publish. Videos play with the browser's native controls in the feed and the full-screen viewer.
        </p>
      </main>
    </div>
  )
}
