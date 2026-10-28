import React, { useEffect, useRef } from 'react'
import { formatMegabytes, VIDEO_HARD_MAX_BYTES, VIDEO_RECOMMENDED_MAX_BYTES } from '../../shared/media-limits'
import './LargeVideoDialog.css'

export interface LargeVideoDialogProps {
  files: Array<{ name: string; size: number }>
  onConfirm: () => void
  onCancel: () => void
}

export default function LargeVideoDialog({ files, onConfirm, onCancel }: LargeVideoDialogProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  const single = files.length === 1
  return (
    <div className="large-video-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="large-video-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="large-video-title"
        aria-describedby="large-video-description"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="large-video-icon" aria-hidden="true">!</span>
        <h2 id="large-video-title">{single ? 'This video is very large' : 'These videos are very large'}</h2>
        <p id="large-video-description">
          The recommended maximum is {formatMegabytes(VIDEO_RECOMMENDED_MAX_BYTES)}. Larger videos take longer to upload, use
          more mobile data and can load slowly for people watching your post. You can still upload{' '}
          {single ? 'it' : 'them'} (up to {formatMegabytes(VIDEO_HARD_MAX_BYTES)}).
        </p>
        <ul className="large-video-files">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              <span>{file.name}</span>
              <strong>{formatMegabytes(file.size)}</strong>
            </li>
          ))}
        </ul>
        <div className="large-video-actions">
          <button ref={cancelRef} type="button" className="large-video-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="large-video-confirm" onClick={onConfirm}>
            Upload anyway
          </button>
        </div>
      </div>
    </div>
  )
}
