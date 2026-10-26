import React, { useEffect, useRef, useState } from 'react'
import { apiPost, errorMessage } from '../lib/api'
import './SupportChat.css'

type Message = { role: 'user' | 'assistant'; content: string }

const MAX_INPUT_LENGTH = 800

export default function SupportChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  function close() {
    setOpen(false)
  }

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    const next = [...messages, { role: 'user' as const, content: text }]
    setBusy(true)
    setError('')
    setMessages(next)
    setDraft('')
    try {
      const response = await apiPost<{ answer: string }>('/support/chat', { messages: next.slice(-8) })
      setMessages([...next, { role: 'assistant', content: response.data.answer }])
    } catch (cause) {
      setMessages(messages)
      setDraft(text)
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="jl-support-launcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
        <span>Support</span>
      </button>
      <dialog
        ref={dialogRef}
        className="jl-support-dialog"
        aria-labelledby="jl-support-title"
        aria-describedby="jl-support-disclaimer"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) close()
        }}
      >
        <header className="jl-support-header">
          <div>
            <h2 id="jl-support-title">Joblite support</h2>
            <p>AI answers about using Joblite</p>
          </div>
          <button type="button" className="jl-support-close" aria-label="Close support chat" onClick={close}>×</button>
        </header>
        <p id="jl-support-disclaimer" className="jl-support-disclaimer">
          Don’t share verification codes, passwords, CVs, or private application details. This chat isn’t saved and can’t access your account.
        </p>
        <div className="jl-support-messages" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0
            ? <p className="jl-support-welcome">Hi! Ask me how to use Joblite. For account-specific changes, use Settings, My Applications, or Hiring.</p>
            : messages.map((message, index) => (
              <p className={`jl-support-message is-${message.role}`} key={`${index}-${message.role}`}>
                <strong>{message.role === 'user' ? 'You' : 'Joblite support'}</strong>
                <span>{message.content}</span>
              </p>
            ))}
          {busy && <p className="jl-support-status" role="status">Getting an answer…</p>}
        </div>
        {error && <p className="jl-support-error" role="alert">{error}</p>}
        <form
          className="jl-support-form"
          onSubmit={(event) => {
            event.preventDefault()
            void ask(draft)
          }}
        >
          <label htmlFor="jl-support-question">Your question</label>
          <textarea
            id="jl-support-question"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_INPUT_LENGTH}
            rows={3}
            placeholder="How do I track a Joblite application?"
            disabled={busy}
          />
          <div className="jl-support-form-footer">
            <small>{draft.length}/{MAX_INPUT_LENGTH}</small>
            <button className="btn" type="submit" disabled={busy || !draft.trim()}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
