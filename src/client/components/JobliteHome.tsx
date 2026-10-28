import React, { useEffect, useState } from 'react'
import { videoThumbnailSrc } from '../lib/format'
import './JobliteHome.css'
import './FeedReadability.css'

export type IconName =
  | 'home'
  | 'jobs'
  | 'applications'
  | 'saved'
  | 'profile'
  | 'search'
  | 'globe'
  | 'remote'
  | 'spark'
  | 'image'
  | 'video'
  | 'bell'
  | 'share'
  | 'comment'
  | 'heart'
  | 'pin'
  | 'money'
  | 'arrow'
  | 'more'
  | 'plus'
  | 'play'
  | 'close'

const ICON_PATHS: Record<IconName, string> = {
  home: 'M3 10 12 3l9 7v10h-6v-6H9v6H3Z',
  jobs: 'M8 6V3h8v3M3 7h18v14H3ZM3 12c6 3 12 3 18 0M10 13h4',
  applications: 'M8 5H5v16h14V5h-3M9 3h6v4H9ZM8 12h8M8 16h6',
  saved: 'M6 3h12v18l-6-4-6 4Z',
  profile: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2c0-6 16-6 16 0v2Z',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 4 6 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
  remote: 'M3 8c5-5 13-5 18 0M6 12c3-3 9-3 12 0M9 16c2-2 4-2 6 0M12 20h.01',
  spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
  image: 'M3 4h18v16H3ZM3 15l5-5 5 5 3-3 5 5M15 8h.01',
  video: 'M3 6h12v12H3Zm12 4 6-4v12l-6-4Z',
  bell: 'M6 9a6 6 0 0 1 12 0v5l3 3H3l3-3ZM10 21h4',
  share: 'M12 16V3m-4 4 4-4 4 4M5 12H3v9h18v-9h-2',
  comment: 'M21 11c0 8-9 10-14 7l-4 3 1-6C-1 4 20-4 21 11Z',
  heart: 'M12 21 3 12C-3 4 8-1 12 6 16-1 27 4 21 12Z',
  pin: 'M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  money: 'M2 5h20v14H2Zm13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 9h.01M19 15h.01',
  arrow: 'm9 5 7 7-7 7',
  more: 'M12 4h.01M12 12h.01M12 20h.01',
  plus: 'M12 5v14M5 12h14',
  play: 'm9 6 10 6-10 6Z',
  close: 'M6 6l12 12M18 6 6 18',
}

function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg
      className="jl-icon"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

export interface User {
  name: string
  avatarUrl?: string
}

interface Identity {
  name: string
  imageUrl?: string
}

export interface JobItem {
  kind: 'job'
  id: string
  company: Identity
  title: string
  /** Truthful provider publication label; never a first-seen time presented as publication. */
  publishedLabel: string
  location: string
  origin: 'native' | 'imported'
  skills: string[]
  salaryLabel?: string
  summary: string
  saved: boolean
  sourceName?: string
  sourceAttribution?: string
  /** Canonical external application destination for imported jobs. */
  applyUrl?: string
  /** Server timestamp used only for ordering the mixed feed. */
  timestamp?: number
}

export interface PostMedia {
  id?: string
  kind: 'image' | 'video'
  url: string
  alt: string
  poster?: string
  captionsUrl?: string
}

export interface PostItem {
  kind: 'post'
  id: string
  author: Identity
  authorHandle?: string
  subtitle?: string
  publishedLabel: string
  body: string
  media?: PostMedia[]
  commentCount: number
  likeCount: number
  liked: boolean
  isOwn?: boolean
  timestamp?: number
}

export type FeedItem = JobItem | PostItem

export interface Board {
  id: string
  name: string
  url: string
  coverage: string
  lastSuccessfulRefreshLabel?: string
  feedStatus?: string
}

export interface Attachment {
  id: string
  name: string
  kind: 'image' | 'video'
  status: 'uploading' | 'ready' | 'error'
  error?: string
  progress?: number
  /** Local object URL used only for the in-progress preview; never persisted. */
  previewUrl?: string
}

export interface JobliteHomeProps {
  user: User | null
  items: FeedItem[]
  countries: { code: string; name: string }[]
  boards: Board[]
  loading: boolean
  error?: string
  applications?: { total: number; inReview: number; interviews: number }
  filters: { query: string; country: string; remote: boolean; source: string }
  onFiltersChange: (filters: JobliteHomeProps['filters']) => void
  sources?: { id: string; name: string }[]
  catalogTotal?: number
  sync?: { lastUpdatedLabel?: string; stale?: boolean; errorCount?: number; note?: string }
  tab: 'discover' | 'following'
  onTabChange: (tab: 'discover' | 'following') => void
  onSignIn: (intent: string) => void
  onNavigate: (path: string) => void
  onCompose: () => void
  onOpenMedia: (post: PostItem, index: number) => void
  onClearFilters: () => void
  onRetry: () => void
  onPublish: (body: string, mediaIds: string[]) => Promise<void>
  onAddMedia: (kind: 'image' | 'video') => void
  onApply: (job: JobItem) => void
  onToggleSave: (job: JobItem) => Promise<void>
  onPostAction: (post: PostItem, action: 'like' | 'comment') => Promise<void>
  onShare: (item: FeedItem) => Promise<void>
  onItemMenu: (item: FeedItem) => void
  onEligibility: () => void
  onNotifications: () => void
  attachments?: Attachment[]
  onRemoveAttachment?: (id: string) => void
  uploading?: boolean
  uploadProgress?: number
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  filterError?: string
  unreadNotifications?: number
  eligibilityActive?: boolean
  initialDraft?: string
  onDraftChange?: (draft: string) => void
}

function Avatar({ identity, square = false }: { identity: Identity; square?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`jl-avatar ${square ? 'jl-avatar-square' : ''}`}>
      {identity.imageUrl && !failed ? <img src={identity.imageUrl} alt="" onError={() => setFailed(true)} /> : null}
      <span aria-hidden="true">{(identity.name || 'J').trim().slice(0, 1).toUpperCase() || 'J'}</span>
    </span>
  )
}

const NAV: { label: string; icon: IconName; path: string; private?: boolean }[] = [
  { label: 'Home', icon: 'home', path: '/' },
  { label: 'Jobs', icon: 'jobs', path: '/jobs' },
  { label: 'Applications', icon: 'applications', path: '/applications', private: true },
  { label: 'Saved', icon: 'saved', path: '/saved', private: true },
  { label: 'Profile', icon: 'profile', path: '/settings', private: true },
]

export default function JobliteHome(props: JobliteHomeProps) {
  const [draft, setDraft] = useState(props.initialDraft || '')
  const [mode, setMode] = useState<'post' | 'job'>('post')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (props.initialDraft) setDraft((current) => (current ? current : props.initialDraft || ''))
  }, [props.initialDraft])

  function updateDraft(value: string) {
    setDraft(value)
    props.onDraftChange?.(value)
  }

  const protect = (intent: string, action: () => void) => (props.user ? action() : props.onSignIn(intent))

  async function perform(key: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    setNotice('')
    try {
      await action()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That action could not be completed. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    if (mode === 'job') {
      if (!props.user) return props.onSignIn('create-job')
      return props.onNavigate('/hiring/jobs/new')
    }
    if (!props.user) return props.onSignIn('publish-post')
    if (!draft.trim() || props.uploading) return

    const mediaIds = (props.attachments || [])
      .filter((attachment) => attachment.status === 'ready')
      .map((attachment) => attachment.id)

    await perform('publish', async () => {
      await props.onPublish(draft.trim(), mediaIds)
      setDraft('')
      props.onDraftChange?.('')
      setNotice('Your post was published.')
    })
  }

  const readyMedia = props.attachments || []
  const canPublish = Boolean(props.user) && mode === 'post' && (draft.trim().length > 0 || readyMedia.some((a) => a.status === 'ready'))
  const publishDisabled = busy !== null || props.uploading || (Boolean(props.user) && mode === 'post' && !canPublish)

  return (
    <div className="jl-app">
      <div className="jl-shell">
        <header className="jl-header">
          <button type="button" className="jl-brand" aria-label="Joblite AHIS home" onClick={() => props.onNavigate('/')}>
            <img className="jl-brand-logo" src="/joblite.png" alt="" />
            Joblite AHIS
          </button>
          <div className="jl-header-actions">
            <button
              type="button"
              className="jl-fab"
              aria-label="Create a post or job"
              onClick={props.onCompose}
            >
              <Icon name="plus" />
            </button>
            <button
              type="button"
              className="jl-icon-button jl-bell"
              aria-label={
                props.unreadNotifications ? `Notifications, ${props.unreadNotifications} unread` : 'Notifications'
              }
              onClick={() => protect('notifications', props.onNotifications)}
            >
              <Icon name="bell" />
              {props.unreadNotifications ? (
                <span className="jl-bell-count">{props.unreadNotifications > 9 ? '9+' : props.unreadNotifications}</span>
              ) : null}
            </button>
            <button
              type="button"
              className="jl-profile-button"
              aria-label={props.user ? 'Open profile' : 'Sign in'}
              onClick={() => protect('profile', () => props.onNavigate('/profile'))}
            >
              <Avatar identity={props.user || { name: 'Guest' }} />
            </button>
          </div>
        </header>

        <nav className="jl-tabs" aria-label="Feed">
          <button
            type="button"
            aria-current={props.tab === 'discover' ? 'page' : undefined}
            className={props.tab === 'discover' ? 'active' : ''}
            onClick={() => props.onTabChange('discover')}
          >
            Discover
          </button>
          <button
            type="button"
            aria-current={props.tab === 'following' ? 'page' : undefined}
            className={props.tab === 'following' ? 'active' : ''}
            onClick={() => protect('following', () => props.onTabChange('following'))}
          >
            Following
          </button>
        </nav>

        <div className="jl-layout">
          <aside className="jl-desktop-nav" aria-label="Primary navigation">
            {NAV.map((item) => (
              <button
                type="button"
                key={item.path}
                onClick={() => (item.private ? protect(item.label.toLowerCase(), () => props.onNavigate(item.path)) : props.onNavigate(item.path))}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.label === 'Applications' && props.user && props.applications && props.applications.total > 0 ? (
                  <span className="jl-inline-count">{props.applications.total}</span>
                ) : null}
              </button>
            ))}
          </aside>

          <main className="jl-main">
            <section className="jl-composer" aria-label="Share an opportunity">
              <div className="jl-composer-top">
                <Avatar identity={props.user || { name: 'Guest' }} />
                <textarea
                  aria-label="Opportunity text"
                  placeholder={mode === 'post' ? 'Share an opportunity…' : 'Describe your hiring need…'}
                  value={draft}
                  onChange={(event) => updateDraft(event.target.value)}
                  maxLength={5000}
                  rows={1}
                />
              </div>

              {readyMedia.length > 0 ? (
                <ul className="jl-attachments" aria-label="Attachments">
                  {readyMedia.map((attachment) => (
                    <li key={attachment.id} className={`jl-attachment ${attachment.status}`}>
                      {attachment.previewUrl && attachment.kind === 'image' ? (
                        <img src={attachment.previewUrl} alt="" />
                      ) : (
                        <span className="jl-attachment-kind">
                          <Icon name={attachment.kind === 'video' ? 'video' : 'image'} />
                        </span>
                      )}
                      <span className="jl-attachment-name">{attachment.name}</span>
                      <small>
                        {attachment.status === 'uploading'
                          ? attachment.progress && attachment.progress > 0
                            ? `Uploading… ${attachment.progress}%`
                            : 'Uploading…'
                          : attachment.status === 'error'
                            ? attachment.error || 'Upload failed'
                            : 'Ready'}
                      </small>
                      {props.onRemoveAttachment ? (
                        <button
                          type="button"
                          className="jl-attachment-remove"
                          aria-label={`Remove ${attachment.name}`}
                          onClick={() => props.onRemoveAttachment?.(attachment.id)}
                        >
                          ×
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="jl-composer-bottom">
                <div className="jl-media-actions">
                  <button
                    type="button"
                    className="jl-icon-button"
                    aria-label="Add image"
                    onClick={() => protect('attach-image', () => props.onAddMedia('image'))}
                  >
                    <Icon name="image" />
                  </button>
                  <button
                    type="button"
                    className="jl-icon-button"
                    aria-label="Add video"
                    onClick={() => protect('attach-video', () => props.onAddMedia('video'))}
                  >
                    <Icon name="video" />
                  </button>
                </div>
                <div className="jl-mode" role="group" aria-label="Content type">
                  <button type="button" aria-pressed={mode === 'post'} onClick={() => setMode('post')}>
                    Post
                  </button>
                  <button type="button" aria-pressed={mode === 'job'} onClick={() => setMode('job')}>
                    Job
                  </button>
                </div>
                <button type="button" className="jl-primary jl-publish" disabled={publishDisabled} onClick={() => void publish()}>
                  {busy === 'publish' ? 'Posting…' : mode === 'post' ? 'Post' : 'Create job'}
                </button>
              </div>
            </section>

            <section className="jl-search-tools" aria-label="Find opportunities">
              <label className="jl-search">
                <Icon name="search" />
                <input
                  aria-label="Search jobs, companies, skills and locations"
                  placeholder="Search jobs, companies, skills, locations"
                  value={props.filters.query}
                  onChange={(event) => props.onFiltersChange({ ...props.filters, query: event.target.value })}
                />
              </label>
              <div className="jl-filter-row">
                <label className="jl-country">
                  <Icon name="globe" />
                  <select
                    aria-label="Country"
                    value={props.filters.country}
                    onChange={(event) => props.onFiltersChange({ ...props.filters, country: event.target.value })}
                  >
                    <option value="">All countries</option>
                    {props.countries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={`jl-chip ${props.filters.remote ? 'selected' : ''}`}
                  aria-pressed={props.filters.remote}
                  onClick={() => props.onFiltersChange({ ...props.filters, remote: !props.filters.remote })}
                >
                  <Icon name="remote" />
                  Remote
                </button>
                <button
                  type="button"
                  className={`jl-chip ${props.eligibilityActive ? 'selected' : ''}`}
                  aria-pressed={Boolean(props.eligibilityActive)}
                  onClick={() => protect('personalised-eligibility', props.onEligibility)}
                >
                  <Icon name="spark" />
                  Eligible for me
                </button>
                {props.sources && props.sources.length > 0 ? (
                  <label className="jl-country jl-source-filter">
                    <Icon name="jobs" />
                    <select
                      aria-label="Job source"
                      value={props.filters.source}
                      onChange={(event) => props.onFiltersChange({ ...props.filters, source: event.target.value })}
                    >
                      <option value="">All sources</option>
                      {props.sources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {props.sync ? (
                <div className={`jl-sync ${props.sync.stale ? 'stale' : ''}`} role="status">
                  <span>
                    {props.sync.lastUpdatedLabel
                      ? `Last updated ${props.sync.lastUpdatedLabel}`
                      : 'Waiting for the first provider update'}
                  </span>
                  {props.sync.stale ? <strong>Sync delayed — showing cached jobs</strong> : null}
                  {props.sync.errorCount ? (
                    <small>
                      {props.sync.errorCount} source{props.sync.errorCount === 1 ? '' : 's'} could not refresh; existing jobs are kept.
                    </small>
                  ) : null}
                </div>
              ) : null}
              {props.filterError ? (
                <p className="jl-filter-error" role="alert">
                  {props.filterError}
                </p>
              ) : null}
            </section>

            {props.user && props.applications && props.applications.total > 0 ? (
              <button type="button" className="jl-applications" onClick={() => props.onNavigate('/applications')}>
                <span className="jl-app-icon">
                  <Icon name="applications" />
                </span>
                <span>
                  <strong>My applications</strong>
                  <small>
                    {props.applications.inReview} in review · {props.applications.interviews} interview
                    {props.applications.interviews === 1 ? '' : 's'}
                  </small>
                </span>
                <Icon name="arrow" />
              </button>
            ) : (
              <div className="jl-guest">
                <span>{props.user ? 'Discover opportunities across every country.' : 'Find your next opportunity.'}</span>
                <button type="button" onClick={() => props.onNavigate('/boards')}>
                  Explore job boards <Icon name="arrow" />
                </button>
              </div>
            )}

            {notice ? (
              <div className="jl-notice" role="status">
                {notice}
              </div>
            ) : null}

            {props.loading ? (
              <div className="jl-state" role="status">
                Loading opportunities…
              </div>
            ) : props.error ? (
              <div className="jl-state" role="alert">
                <h2>We couldn’t load the feed</h2>
                <p>{props.error}</p>
                <button type="button" className="jl-primary" onClick={props.onRetry}>
                  Try again
                </button>
              </div>
            ) : props.items.length === 0 ? (
              <div className="jl-state">
                {props.filters.query || props.filters.country || props.filters.remote || props.filters.source || props.eligibilityActive ? (
                  <>
                    <h2>No opportunities match these filters</h2>
                    <p>Try a different country, source or search term. Your filters stay active.</p>
                    <button type="button" className="jl-primary" onClick={props.onClearFilters}>
                      Clear filters
                    </button>
                  </>
                ) : (props.catalogTotal ?? 0) === 0 ? (
                  <>
                    <h2>No jobs have been ingested yet</h2>
                    <p>
                      Approved job sources are connected, but no vacancies are stored right now. If this is a new
                      environment, run the initial provider sync. Existing records are never replaced with mock data.
                    </p>
                    <button type="button" className="jl-primary" onClick={props.onRetry}>
                      Refresh feed
                    </button>
                  </>
                ) : (
                  <>
                    <h2>Nothing to show yet</h2>
                    <p>Try refreshing the feed or explore the job-board directory.</p>
                    <button type="button" className="jl-primary" onClick={props.onRetry}>
                      Refresh feed
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {!props.loading && !props.error ? (
              <div className="jl-feed">
                {props.items.map((item) =>
                  item.kind === 'job' ? (
                    <article className="jl-card jl-job" key={`job-${item.id}`}>
                      <div className="jl-card-identity">
                        <Avatar identity={item.company} square />
                        <div className="jl-card-body">
                          <div className="jl-meta">
                            <strong>{item.company.name}</strong>
                            <small>{item.publishedLabel}</small>
                            <span className={`jl-origin ${item.origin}`}>
                              {item.origin === 'native' ? 'Native job' : 'Imported job'}
                            </span>
                            <button
                              type="button"
                              className="jl-icon-button jl-more"
                              aria-label={`More options for ${item.title}`}
                              onClick={() => props.onItemMenu(item)}
                            >
                              <Icon name="more" />
                            </button>
                          </div>
                          <button type="button" className="jl-job-title" onClick={() => props.onNavigate(`/jobs/${encodeURIComponent(item.id)}`)}>
                            {item.title}
                          </button>
                          <div className="jl-location">
                            <Icon name="pin" />
                            {item.location}
                          </div>
                          {item.origin === 'imported' && item.sourceName ? (
                            <div className="jl-source-line">
                              via {item.sourceName}
                              {item.sourceAttribution ? <span title={item.sourceAttribution}> · source listing</span> : null}
                            </div>
                          ) : null}
                          {item.skills.length > 0 ? (
                            <div className="jl-tags">
                              {item.skills.slice(0, 6).map((skill) => (
                                <span key={skill}>{skill}</span>
                              ))}
                            </div>
                          ) : null}
                          {item.salaryLabel ? (
                            <div className="jl-salary">
                              <Icon name="money" />
                              {item.salaryLabel}
                            </div>
                          ) : null}
                          <p className="jl-summary">{item.summary}</p>
                          <div className="jl-job-actions">
                            <button
                              type="button"
                              className="jl-primary"
                              onClick={() =>
                                item.origin === 'native'
                                  ? protect(`apply:${item.id}`, () => props.onApply(item))
                                  : props.onApply(item)
                              }
                            >
                              {item.origin === 'native' ? 'Apply now' : 'Apply at source ↗'}
                            </button>
                            <button
                              type="button"
                              className={`jl-square ${item.saved ? 'is-saved' : ''}`}
                              aria-label={item.saved ? 'Unsave job' : 'Save job'}
                              aria-pressed={item.saved}
                              disabled={busy !== null}
                              onClick={() => protect(`save:${item.id}`, () => void perform(`save:${item.id}`, () => props.onToggleSave(item)))}
                            >
                              <Icon name="saved" filled={item.saved} />
                            </button>
                            <button
                              type="button"
                              className="jl-square"
                              aria-label={`Share ${item.title}`}
                              disabled={busy !== null}
                              onClick={() => void perform('share', () => props.onShare(item))}
                            >
                              <Icon name="share" />
                            </button>
                          </div>
                          {item.origin === 'imported' ? (
                            <p className="jl-external-note">
                              Opens {item.sourceName || 'the original source'} in a new tab. Joblite does not record an
                              application until you choose to mark it yourself.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ) : (
                    <article className="jl-card jl-post" key={`post-${item.id}`}>
                      <div className="jl-post-top">
                        <Avatar identity={item.author} />
                        <div>
                          <div className="jl-meta">
                            <strong>{item.author.name}</strong>
                            <small>{item.publishedLabel}</small>
                          </div>
                          {item.subtitle ? <small className="jl-subtitle">{item.subtitle}</small> : null}
                        </div>
                        <button type="button" className="jl-icon-button jl-more" aria-label={`More options for ${item.author.name}'s post`} onClick={() => props.onItemMenu(item)}>
                          <Icon name="more" />
                        </button>
                      </div>
                      <p className="jl-post-text">{item.body}</p>
                      {item.media && item.media.length > 0 ? (
                        <div className={`jl-post-media-grid ${item.media.length > 1 ? 'multiple' : ''}`}>
                          {item.media.map((media, index) => (
                            <button
                              key={media.id || `${media.url}-${index}`}
                              type="button"
                              className="jl-media-button"
                              aria-label={
                                media.kind === 'video'
                                  ? `Open video${media.alt ? `: ${media.alt}` : ''} in full-screen viewer`
                                  : `Open image${media.alt ? `: ${media.alt}` : ''} in full-screen viewer`
                              }
                              onClick={(event) => {
                                event.stopPropagation()
                                props.onOpenMedia(item, index)
                              }}
                            >
                              {media.kind === 'image' ? (
                                <img
                                  className="jl-post-media"
                                  src={media.url}
                                  alt={media.alt || 'Post attachment'}
                                  loading="lazy"
                                />
                              ) : (
                                <>
                                  <video
                                    className="jl-post-media"
                                    src={videoThumbnailSrc(media.url)}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    poster={media.poster}
                                    aria-hidden="true"
                                    tabIndex={-1}
                                  />
                                  <span className="jl-media-play" aria-hidden="true">
                                    <Icon name="play" filled />
                                  </span>
                                </>
                              )}
                              {item.media && item.media.length > 1 ? (
                                <span className="jl-media-index" aria-hidden="true">
                                  {index + 1}/{item.media.length}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="jl-post-actions">
                        <button
                          type="button"
                          disabled={busy !== null}
                          aria-label={`${item.commentCount} comments`}
                          onClick={() => protect(`comment:${item.id}`, () => void perform('comment', () => props.onPostAction(item, 'comment')))}
                        >
                          <Icon name="comment" />
                          {item.commentCount}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          className={item.liked ? 'liked' : ''}
                          aria-pressed={item.liked}
                          aria-label={`${item.liked ? 'Unlike' : 'Like'} post, ${item.likeCount} likes`}
                          onClick={() => protect(`like:${item.id}`, () => void perform('like', () => props.onPostAction(item, 'like')))}
                        >
                          <Icon name="heart" filled={item.liked} />
                          {item.likeCount}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          aria-label="Share post"
                          onClick={() => void perform('share', () => props.onShare(item))}
                        >
                          <Icon name="share" />
                        </button>
                      </div>
                    </article>
                  )
                )}
              </div>
            ) : null}

            {!props.loading && !props.error && props.hasMore ? (
              <button type="button" className="jl-load-more" onClick={props.onLoadMore} disabled={props.loadingMore}>
                {props.loadingMore ? 'Loading more…' : 'Load more opportunities'}
              </button>
            ) : null}

            {props.boards.length > 0 ? (
              <section className="jl-boards" aria-label="Job board directory">
                <h2>Explore job boards</h2>
                {props.boards.map((board) => (
                  <a key={board.id} href={board.url} target="_blank" rel="noopener noreferrer">
                    <strong>{board.name} ↗</strong>
                    <span>{board.coverage}</span>
                    {board.feedStatus ? <small>{board.feedStatus}</small> : null}
                    {board.lastSuccessfulRefreshLabel ? <small>Updated {board.lastSuccessfulRefreshLabel}</small> : null}
                  </a>
                ))}
              </section>
            ) : null}
          </main>

          <aside className="jl-desktop-info">
            <h2>Your next opportunity</h2>
            <p>Explore jobs, discover professional updates, and connect with opportunities.</p>
            <button type="button" className="jl-primary" onClick={() => props.onNavigate('/boards')}>
              Browse job boards
            </button>
          </aside>
        </div>

        <nav className="jl-bottom-nav" aria-label="Mobile navigation">
          {NAV.map((item) => (
            <button
              type="button"
              key={item.path}
              className={item.path === '/' ? 'active' : ''}
              aria-current={item.path === '/' ? 'page' : undefined}
              onClick={() => (item.private ? protect(item.label.toLowerCase(), () => props.onNavigate(item.path)) : props.onNavigate(item.path))}
            >
              <span className="jl-nav-icon">
                <Icon name={item.icon} filled={item.path === '/'} />
                {item.label === 'Applications' && props.user && props.applications && props.applications.total > 0 ? (
                  <span className="jl-count">{props.applications.total > 99 ? '99+' : props.applications.total}</span>
                ) : null}
              </span>
              <small>{item.label}</small>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
