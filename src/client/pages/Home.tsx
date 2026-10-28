import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import JobliteHome, {
  Attachment,
  Board,
  FeedItem,
  JobItem,
  JobliteHomeProps,
  PostItem,
  User as HomeUser,
} from '../components/JobliteHome'
import { apiDelete, apiGet, apiPost, errorMessage, isAbortError, uploadMedia, uploadVideoInParts } from '../lib/api'
import {
  formatMegabytes,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  VIDEO_HARD_MAX_BYTES,
  VIDEO_RECOMMENDED_MAX_BYTES,
  VIDEO_TYPES,
} from '../../shared/media-limits'
import LargeVideoDialog from '../components/LargeVideoDialog'
import MediaLightbox from '../components/MediaLightbox'
import {
  formatLocation,
  formatRelativeTime,
  formatSalary,
  publicationLabel,
  publicJobUrl,
  publicPostUrl,
  safeExternalUrl,
  summarize,
} from '../lib/format'
import { signInPath, useSession } from '../lib/session'
import MediaViewer, { type ViewerPost } from '../components/MediaViewer'
import { useAuthExperience } from '../components/AuthExperience'

const DRAFT_KEY = 'joblite:pendingDraft'

type JobApi = {
  id: string
  title: string
  body: string
  origin: 'native' | 'imported'
  application_method: string
  canonical_url: string | null
  application_url: string | null
  location_text: string | null
  salary_text: string | null
  source_name: string | null
  source_attribution: string | null
  published_at: number | null
  discovered_at: number | null
  created_at: number
  workplace_arrangement: string | null
  company_name: string | null
  org_name: string | null
  org_slug: string | null
  eligibility_mode: string | null
  skills: string[]
  salary: { min_minor: number | null; max_minor: number | null; currency: string | null; period: string | null } | null
  locations: Array<{ city: string | null; country_code: string | null }>
  saved: boolean
}

type PostApi = {
  id: string
  body: string
  created_at: number
  author_id: string
  author_name: string
  author_handle: string | null
  author_headline: string | null
  comment_count: number
  like_count: number
  liked: boolean
  is_own: boolean
  media: Array<{ id: string; kind: 'image' | 'video'; url: string; alt: string }>
}

type BoardApi = {
  id: string
  name: string
  url: string
  coverage: string
  permission_label: string
  imported_jobs: number
  last_success_at: number | null
  importing: boolean
}

type FeedEntry = { at: number; item: FeedItem }

type FeedMeta = {
  catalogTotal: number
  sources: { id: string; name: string }[]
  sync: { last_success_at: number | null; stale: boolean; errors: Array<{ source_name: string; message: string }> } | null
  lastUpdatedLabel?: string
}

function jobToItem(job: JobApi): FeedItem {
  const companyName = job.org_name || job.company_name || 'Organization'
  return {
    kind: 'job',
    id: job.id,
    company: { name: companyName },
    title: job.title,
    publishedLabel: publicationLabel(job.published_at, job.discovered_at || job.created_at),
    location: formatLocation(job.locations, job.workplace_arrangement, job.location_text),
    origin: job.origin === 'imported' ? 'imported' : 'native',
    skills: job.skills || [],
    salaryLabel: formatSalary(job.salary, job.salary_text),
    summary: summarize(job.body, 240),
    saved: Boolean(job.saved),
    sourceName: job.source_name || undefined,
    sourceAttribution: job.source_attribution || undefined,
    applyUrl: job.application_url || job.canonical_url || undefined,
    timestamp: job.published_at || job.discovered_at || job.created_at,
  }
}

function postToItem(post: PostApi): FeedItem {
  return {
    kind: 'post',
    id: post.id,
    author: { name: post.author_name },
    authorHandle: post.author_handle || undefined,
    subtitle: post.author_headline || undefined,
    publishedLabel: formatRelativeTime(post.created_at),
    body: post.body,
    media: (post.media || []).map((media) => ({ id: media.id, kind: media.kind, url: media.url, alt: media.alt })),
    commentCount: post.comment_count,
    likeCount: post.like_count,
    liked: Boolean(post.liked),
    isOwn: Boolean(post.is_own),
    timestamp: post.created_at,
  }
}

function mergeEntries(jobs: FeedItem[], posts: FeedItem[]): FeedItem[] {
  const entries: FeedEntry[] = [
    ...jobs.map((item) => ({ at: item.timestamp || 0, item })),
    ...posts.map((item) => ({ at: item.timestamp || 0, item })),
  ]
  return entries.sort((a, b) => b.at - a.at).map((entry) => entry.item)
}

export default function Home() {
  const navigate = useNavigate()
  const session = useSession()
  const { openAuth } = useAuthExperience()

  const [countries, setCountries] = useState<{ code: string; name: string }[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [boardsError, setBoardsError] = useState<string | null>(null)

  const [jobs, setJobs] = useState<JobItem[]>([])
  const [posts, setPosts] = useState<PostItem[]>([])
  const [jobsHasMore, setJobsHasMore] = useState(false)
  const [postsHasMore, setPostsHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedError, setFeedError] = useState<string | undefined>()
  const [filterError, setFilterError] = useState<string | undefined>()
  const [shareNotice, setShareNotice] = useState('')
  const [menuItem, setMenuItem] = useState<FeedItem | null>(null)
  const [applications, setApplications] = useState<JobliteHomeProps['applications']>()

  const [tab, setTab] = useState<'discover' | 'following'>('discover')
  const [filters, setFilters] = useState({ query: '', country: '', remote: false, source: '' })
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [eligible, setEligible] = useState(false)
  const [feedMeta, setFeedMeta] = useState<FeedMeta>({ catalogTotal: 0, sources: [], sync: null })
  const [viewer, setViewer] = useState<{ post: PostItem; index: number } | null>(null)
  const viewerOpen = useRef(false)
  const viewerScroll = useRef(0)
  const viewerTrigger = useRef<HTMLElement | null>(null)
  const [lightbox, setLightbox] = useState<{ post: PostItem; index: number; thumbnail: HTMLElement } | null>(null)
  const lightboxOpen = useRef(false)

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const uploading = attachments.some((attachment) => attachment.status === 'uploading')
  const [largeVideo, setLargeVideo] = useState<File | null>(null)
  const uploadControllers = useRef<Map<string, AbortController>>(new Map())
  const [pendingDraft, setPendingDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingKind = useRef<'image' | 'video'>('image')
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controllers = uploadControllers.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(filters.query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [filters.query])

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(DRAFT_KEY)
      if (stored) {
        setPendingDraft(stored)
        window.sessionStorage.removeItem(DRAFT_KEY)
      }
    } catch {
      // sessionStorage may be unavailable; the draft simply stays local to the composer.
    }
  }, [])

  const loadBoards = useCallback(async () => {
    try {
      const response = await apiGet<BoardApi[]>('/boards')
      setBoards(
        (response.data || []).map((board) => ({
          id: board.id,
          name: board.name,
          url: board.url,
          coverage: board.coverage,
          feedStatus: board.importing
            ? `${board.permission_label} · ${board.imported_jobs} imported job${board.imported_jobs === 1 ? '' : 's'}`
            : `${board.permission_label} · not imported`,
          lastSuccessfulRefreshLabel: board.last_success_at ? formatRelativeTime(board.last_success_at) : undefined,
        }))
      )
      setBoardsError(null)
    } catch (error) {
      setBoardsError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void loadBoards()
    const onFocus = () => void loadBoards()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [loadBoards])

  useEffect(() => {
    apiGet<{ code: string; name: string }[]>('/countries')
      .then((response) => setCountries(response.data || []))
      .catch(() => setCountries([]))
  }, [])

  const loadFeed = useCallback(
    async (mode: 'replace' | 'append') => {
      const jobFiltersActive = Boolean(debouncedQuery || filters.country || filters.remote || eligible)
      const followingOnly = tab === 'following'
      if (followingOnly && !session.user) {
        setJobs([])
        setPosts([])
        setLoading(false)
        return
      }

      const id = ++requestId.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (mode === 'replace') {
        setLoading(true)
        setFeedError(undefined)
      } else {
        setLoadingMore(true)
      }

      const jobsOffset = mode === 'append' ? jobs.length : 0
      const postsOffset = mode === 'append' ? posts.length : 0

      try {
        const jobParams = new URLSearchParams({ limit: '10', offset: String(jobsOffset) })
        if (debouncedQuery) jobParams.set('q', debouncedQuery)
        if (filters.country) jobParams.set('country', filters.country)
        if (filters.remote) jobParams.set('remote', '1')
        if (filters.source) jobParams.set('source', filters.source)
        if (eligible) jobParams.set('eligible', 'me')

        const postParams = new URLSearchParams({ limit: '10', offset: String(postsOffset) })
        if (followingOnly) postParams.set('following', '1')

        const [jobsResponse, postsResponse] = await Promise.all([
          followingOnly ? Promise.resolve(null) : apiGet<JobApi[]>(`/jobs?${jobParams.toString()}`, controller.signal),
          followingOnly || jobFiltersActive
            ? Promise.resolve(null)
            : apiGet<PostApi[]>(`/posts?${postParams.toString()}`, controller.signal),
        ])

        if (id !== requestId.current) return

        if (jobsResponse) {
          const mapped = (jobsResponse.data || []).map(jobToItem).filter((item): item is JobItem => item.kind === 'job')
          setJobs((current) => (mode === 'append' ? dedupeJobs([...current, ...mapped]) : mapped))
          setJobsHasMore(Boolean(jobsResponse.meta?.has_more))
          const meta = jobsResponse.meta as Record<string, any> | undefined
          const sync = meta?.sync as FeedMeta['sync'] | undefined
          setFeedMeta({
            catalogTotal: Number(meta?.catalog_total || 0),
            sources: Array.isArray(meta?.sources) ? meta.sources : [],
            sync: sync || null,
            lastUpdatedLabel: meta?.last_updated_at ? formatRelativeTime(meta.last_updated_at) : undefined,
          })
        } else if (mode === 'replace') {
          setJobs([])
          setJobsHasMore(false)
        }

        if (postsResponse) {
          const mapped = (postsResponse.data || []).map(postToItem).filter((item): item is PostItem => item.kind === 'post')
          setPosts((current) => (mode === 'append' ? dedupePosts([...current, ...mapped]) : mapped))
          setPostsHasMore(Boolean(postsResponse.meta?.has_more))
        } else if (mode === 'replace') {
          setPosts([])
          setPostsHasMore(false)
        }

        setFeedError(undefined)
        setFilterError(undefined)
      } catch (error) {
        if (isAbortError(error) || id !== requestId.current) return
        setFeedError(errorMessage(error))
        if (mode === 'replace') {
          setJobs([])
          setPosts([])
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [debouncedQuery, eligible, filters.country, filters.remote, filters.source, jobs.length, posts.length, session.user, tab]
  )

  useEffect(() => {
    void loadFeed('replace')
    // The feed reloads only when server-side filter inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filters.country, filters.remote, filters.source, eligible, tab, session.user?.id])

  useEffect(() => {
    if (!session.user) {
      setApplications(undefined)
      return
    }
    apiGet<{ applications: { total: number; inReview: number; interviews: number }; saved: number }>('/me/summary')
      .then((response) => setApplications(response.data.applications))
      .catch(() => setApplications(undefined))
  }, [session.user])

  const items = useMemo(() => {
    const followingOnly = tab === 'following'
    const jobFiltersActive = Boolean(debouncedQuery || filters.country || filters.remote || filters.source || eligible)
    if (followingOnly) return posts
    if (jobFiltersActive) return jobs
    return mergeEntries(jobs, posts)
  }, [debouncedQuery, eligible, filters.country, filters.remote, filters.source, jobs, posts, tab])

  const handleSignIn = useCallback(
    (intent: string, nextPath?: string) => {
      if (intent === 'publish-post') {
        try {
          window.sessionStorage.setItem(DRAFT_KEY, pendingDraft)
        } catch {
          // ignore storage restrictions
        }
      }
      openAuth({ intent, nextPath: intent === 'publish-post' ? '/compose' : nextPath || (window.location.pathname + window.location.search) })
    },
    [navigate, openAuth, pendingDraft]
  )

  const handleApply = useCallback(
    (job: JobItem) => {
      if (job.origin === 'native') {
        navigate(`/jobs/${encodeURIComponent(job.id)}`)
        return
      }
      const applyUrl = safeExternalUrl(job.applyUrl)
      if (!applyUrl) {
        setShareNotice('This imported job has no verified application link yet. Open the job for details.')
        navigate(`/jobs/${encodeURIComponent(job.id)}`)
        return
      }
      if (!session.user) {
        openAuth({ intent: 'apply-source', jobId: job.id, nextPath: window.location.pathname + window.location.search })
        return
      }
      window.open(applyUrl, '_blank', 'noopener,noreferrer')
    },
    [navigate, openAuth, session.user]
  )

  const restoreFeedPosition = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo(0, viewerScroll.current)
      viewerTrigger.current?.focus({ preventScroll: true })
    })
  }, [])

  const closeViewer = useCallback(() => {
    if (!viewerOpen.current) return
    viewerOpen.current = false
    setViewer(null)
    document.body.classList.remove('jl-viewer-open')
    restoreFeedPosition()
    if (window.history.state && (window.history.state as Record<string, unknown>).jobliteViewer) {
      window.history.back()
    } else {
      window.history.replaceState(null, '', '/')
    }
  }, [restoreFeedPosition])

  const openViewer = useCallback((post: PostItem, index: number, replaceHistory = false) => {
    viewerTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    viewerScroll.current = window.scrollY
    document.querySelectorAll('video').forEach((video) => video.pause())
    viewerOpen.current = true
    setViewer({ post, index })
    document.body.classList.add('jl-viewer-open')
    const url = `/posts/${encodeURIComponent(post.id)}/media/${index}`
    if (replaceHistory) window.history.replaceState({ jobliteViewer: true }, '', url)
    else if (window.location.pathname !== url) window.history.pushState({ jobliteViewer: true }, '', url)
  }, [])

  const openMedia = useCallback((post: PostItem, index: number, thumbnail: HTMLElement) => {
    document.querySelectorAll('video').forEach((video) => video.pause())
    lightboxOpen.current = true
    setLightbox({ post, index, thumbnail })
    document.body.classList.add('jl-viewer-open')
    // A history entry lets the phone's back gesture collapse the media instead of leaving the feed.
    window.history.pushState({ jobliteLightbox: true }, '', window.location.href)
  }, [])

  const finishLightbox = useCallback(() => {
    if (!lightboxOpen.current) return
    lightboxOpen.current = false
    setLightbox(null)
    document.body.classList.remove('jl-viewer-open')
    if (window.history.state && (window.history.state as Record<string, unknown>).jobliteLightbox) window.history.back()
  }, [])

  // Sign-in sits below the lightbox, so collapse first and act once the lightbox history entry is gone.
  const collapseLightboxThen = useCallback(
    (action: () => void) => {
      const ownsEntry = Boolean(window.history.state && (window.history.state as Record<string, unknown>).jobliteLightbox)
      if (ownsEntry) window.addEventListener('popstate', () => action(), { once: true })
      finishLightbox()
      if (!ownsEntry) action()
    },
    [finishLightbox]
  )

  const lightboxToViewer = useCallback(
    (post: PostItem, index: number) => {
      lightboxOpen.current = false
      setLightbox(null)
      openViewer(post, index, true)
    },
    [openViewer]
  )

  useEffect(() => {
    const onPopState = () => {
      if (lightboxOpen.current) {
        lightboxOpen.current = false
        setLightbox(null)
        document.body.classList.remove('jl-viewer-open')
        return
      }
      if (!viewerOpen.current) return
      viewerOpen.current = false
      setViewer(null)
      document.body.classList.remove('jl-viewer-open')
      restoreFeedPosition()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.body.classList.remove('jl-viewer-open')
    }
  }, [restoreFeedPosition])

  const closeWithAuth = useCallback(
    (intent: string) => {
      handleSignIn(intent, window.location.pathname + window.location.search)
    },
    [handleSignIn]
  )

  const handlePostChanged = useCallback((postId: string, patch: Partial<ViewerPost>) => {
    setPosts((current) =>
      current.map((item) =>
        item.id === postId
          ? {
              ...item,
              liked: patch.liked ?? item.liked,
              likeCount: patch.like_count ?? item.likeCount,
              commentCount: patch.comment_count ?? item.commentCount,
            }
          : item
      )
    )
    setViewer((current) =>
      current && current.post.id === postId
        ? {
            ...current,
            post: {
              ...current.post,
              liked: patch.liked ?? current.post.liked,
              likeCount: patch.like_count ?? current.post.likeCount,
              commentCount: patch.comment_count ?? current.post.commentCount,
            },
          }
        : current
    )
  }, [])

  const handleToggleSave = useCallback(
    async (job: JobItem) => {
      if (job.saved) {
        await apiDelete(`/jobs/${encodeURIComponent(job.id)}/save`)
      } else {
        await apiPost(`/jobs/${encodeURIComponent(job.id)}/save`)
      }
      const update = (item: FeedItem): FeedItem =>
        item.kind === 'job' && item.id === job.id ? { ...item, saved: !item.saved } : item
      setJobs((current) => current.map(update).filter((item): item is JobItem => item.kind === 'job'))
    },
    []
  )

  const handlePostAction = useCallback(
    async (post: PostItem, action: 'like' | 'comment') => {
      if (action === 'comment') {
        navigate(`/posts/${encodeURIComponent(post.id)}`)
        return
      }
      if (post.liked) {
        const response = await apiDelete<{ liked: boolean; like_count: number }>(`/posts/${encodeURIComponent(post.id)}/like`)
        setPosts((current) =>
          current.map((item) =>
            item.id === post.id ? { ...item, liked: response.data.liked, likeCount: response.data.like_count } : item
          )
        )
      } else {
        const response = await apiPost<{ liked: boolean; like_count: number }>(`/posts/${encodeURIComponent(post.id)}/like`)
        setPosts((current) =>
          current.map((item) =>
            item.id === post.id ? { ...item, liked: response.data.liked, likeCount: response.data.like_count } : item
          )
        )
      }
    },
    [navigate]
  )

  async function handlePublish(body: string, mediaIds: string[]) {
    await apiPost('/posts', { body, media_ids: mediaIds })
    // The uploaded media is now referenced by the post; only clear local previews.
    for (const attachment of attachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
    setAttachments([])
    await loadFeed('replace')
  }

  const handleShare = useCallback(async (item: FeedItem) => {
    const url = item.kind === 'job' ? publicJobUrl(item.id) : publicPostUrl(item.id)
    const title = item.kind === 'job' ? item.title : 'Joblite AHS update'
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setShareNotice('Link copied to clipboard.')
      window.setTimeout(() => setShareNotice(''), 3000)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      throw new Error('Could not share this link. Copy it from your browser instead.')
    }
  }, [])

  function handleAddMedia(kind: 'image' | 'video') {
    pendingKind.current = kind
    if (fileInputRef.current) {
      fileInputRef.current.accept = (kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES).join(',')
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  function handleFileSelected(file: File | null) {
    if (!file) return
    const kind = pendingKind.current
    const maxBytes = kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_HARD_MAX_BYTES
    const allowed = kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES
    const localId = `local_${Date.now()}`

    if (!allowed.includes(file.type)) {
      setAttachments((current) => [
        ...current,
        { id: localId, name: file.name, kind, status: 'error', error: `Unsupported type. Use ${kind === 'image' ? 'JPEG, PNG, WebP or GIF' : 'MP4 or WebM'}.` },
      ])
      return
    }
    if (file.size > maxBytes) {
      setAttachments((current) => [
        ...current,
        { id: localId, name: file.name, kind, status: 'error', error: `File is larger than the ${formatMegabytes(maxBytes)} maximum.` },
      ])
      return
    }
    if (kind === 'video' && file.size > VIDEO_RECOMMENDED_MAX_BYTES) {
      setLargeVideo(file)
      return
    }
    void startUpload(file, kind, false)
  }

  async function startUpload(file: File, kind: 'image' | 'video', acknowledgeLargeFile: boolean) {
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined
    const controller = new AbortController()
    uploadControllers.current.set(localId, controller)
    setAttachments((current) => [...current, { id: localId, name: file.name, kind, status: 'uploading', previewUrl, progress: 0 }])
    try {
      const media = kind === 'video'
        ? await uploadVideoInParts(file, {
          acknowledgeLargeFile,
          signal: controller.signal,
          onProgress: (percent) => {
            setAttachments((current) =>
              current.map((attachment) => (attachment.id === localId ? { ...attachment, progress: percent } : attachment))
            )
          },
        })
        : await uploadMedia(file, 'post_image')
      if (controller.signal.aborted) {
        void apiDelete(`/media/${encodeURIComponent(media.id)}`).catch(() => {})
        return
      }
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === localId
            ? { ...attachment, id: media.id, status: 'ready', progress: 100, error: undefined }
            : attachment
        )
      )
    } catch (error) {
      if (isAbortError(error)) return
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === localId ? { ...attachment, status: 'error', error: errorMessage(error) } : attachment
        )
      )
    } finally {
      uploadControllers.current.delete(localId)
    }
  }

  function removeAttachment(id: string) {
    const target = attachments.find((attachment) => attachment.id === id)
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    uploadControllers.current.get(id)?.abort()
    if (target?.status === 'ready') {
      void apiDelete(`/media/${encodeURIComponent(target.id)}`).catch(() => {})
    }
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  const handleEligibility = useCallback(() => {
    if (!session.user) {
      handleSignIn('personalised-eligibility')
      return
    }
    if (!session.profile?.country_code) {
      setFilterError('Add your country in Settings to filter jobs you are eligible for.')
      return
    }
    setFilterError(undefined)
    setEligible((current) => !current)
  }, [handleSignIn, session.profile?.country_code, session.user])

  const handleMenu = useCallback((item: FeedItem) => setMenuItem(item), [])

  async function deleteOwnPost(post: PostItem) {
    await apiDelete(`/posts/${encodeURIComponent(post.id)}`)
    setPosts((current) => current.filter((item) => item.id !== post.id))
    setMenuItem(null)
  }

  const user: HomeUser | null = session.user ? { name: session.user.display_name || session.user.email.split('@')[0] } : null

  return (
    <div className="jl-page-home">
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => handleFileSelected(event.target.files?.[0] || null)}
      />

      {largeVideo ? (
        <LargeVideoDialog
          files={[{ name: largeVideo.name, size: largeVideo.size }]}
          onConfirm={() => {
            const file = largeVideo
            setLargeVideo(null)
            void startUpload(file, 'video', true)
          }}
          onCancel={() => setLargeVideo(null)}
        />
      ) : null}

      <JobliteHome
        user={user}
        items={items}
        countries={countries}
        boards={boards}
        loading={loading}
        error={feedError}
        applications={applications}
        filters={filters}
        onFiltersChange={(next) => {
          setFilters({ query: next.query, country: next.country, remote: next.remote, source: next.source || '' })
          setFilterError(undefined)
        }}
        sources={feedMeta.sources}
        catalogTotal={feedMeta.catalogTotal}
        sync={
          feedMeta.sync
            ? {
                lastUpdatedLabel: feedMeta.lastUpdatedLabel,
                stale: feedMeta.sync.stale,
                errorCount: feedMeta.sync.errors?.length || 0,
              }
            : undefined
        }
        onClearFilters={() => {
          setFilters({ query: '', country: '', remote: false, source: '' })
          setEligible(false)
          setFilterError(undefined)
        }}
        tab={tab}
        onTabChange={setTab}
        onSignIn={handleSignIn}
        onNavigate={navigate}
        onCompose={() => navigate('/compose')}
        onOpenMedia={openMedia}
        onRetry={() => void loadFeed('replace')}
        onPublish={handlePublish}
        onAddMedia={handleAddMedia}
        onApply={handleApply}
        onToggleSave={handleToggleSave}
        onPostAction={handlePostAction}
        onShare={handleShare}
        onItemMenu={handleMenu}
        onEligibility={handleEligibility}
        onNotifications={() => navigate('/notifications')}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        uploading={uploading}
        hasMore={
          tab === 'following'
            ? postsHasMore
            : debouncedQuery || filters.country || filters.remote || filters.source || eligible
              ? jobsHasMore
              : jobsHasMore || postsHasMore
        }
        loadingMore={loadingMore}
        onLoadMore={() => void loadFeed('append')}
        filterError={filterError}
        unreadNotifications={session.unreadNotifications}
        eligibilityActive={eligible}
        initialDraft={pendingDraft}
        onDraftChange={setPendingDraft}
      />

      {shareNotice ? (
        <div className="jl-toast" role="status">
          {shareNotice}
        </div>
      ) : null}
      {boardsError ? (
        <div className="jl-toast jl-toast-error" role="alert">
          Job board directory could not be refreshed: {boardsError}
        </div>
      ) : null}

      {lightbox ? (
        <MediaLightbox
          media={(lightbox.post.media || []).map((media) => ({ kind: media.kind, url: media.url, alt: media.alt, poster: media.poster }))}
          initialIndex={lightbox.index}
          getThumbnail={(index) => {
            const sibling = lightbox.thumbnail.parentElement?.children[index]
            return sibling instanceof HTMLElement ? sibling : lightbox.thumbnail
          }}
          onCollapsed={finishLightbox}
          social={(() => {
            const post = posts.find((item) => item.id === lightbox.post.id) ?? lightbox.post
            return {
              liked: post.liked,
              likeCount: post.likeCount,
              replyCount: post.commentCount,
              shareUrl: publicPostUrl(post.id),
              signedIn: Boolean(session.user),
              onLike: async () => {
                if (!session.user) {
                  collapseLightboxThen(() => handleSignIn('like'))
                  return
                }
                await handlePostAction(post, 'like')
              },
              onReply: (index: number) => lightboxToViewer(post, index),
            }
          })()}
        />
      ) : null}

      {viewer ? (
        <MediaViewer
          postId={viewer.post.id}
          initialIndex={viewer.index}
          initialPost={{
            id: viewer.post.id,
            body: viewer.post.body,
            created_at: viewer.post.timestamp || Math.floor(Date.now() / 1000),
            author_name: viewer.post.author.name,
            author_handle: viewer.post.authorHandle || null,
            author_headline: viewer.post.subtitle || null,
            media: (viewer.post.media || []).map((media) => ({
              id: media.id,
              kind: media.kind,
              url: media.url,
              alt: media.alt,
              poster: media.poster,
              captionsUrl: media.captionsUrl,
            })),
            like_count: viewer.post.likeCount,
            comment_count: viewer.post.commentCount,
            liked: viewer.post.liked,
            is_own: viewer.post.isOwn,
          }}
          signedIn={Boolean(session.user)}
          onClose={closeViewer}
          onRequireAuth={closeWithAuth}
          onPostChanged={handlePostChanged}
          onDeleted={(postId) => setPosts((current) => current.filter((item) => item.id !== postId))}
        />
      ) : null}

      {menuItem ? (
        <div className="jl-sheet-backdrop" role="presentation" onClick={() => setMenuItem(null)}>
          <div
            className="jl-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={menuItem.kind === 'job' ? 'Job options' : 'Post options'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="jl-sheet-handle" aria-hidden="true" />
            <h2>{menuItem.kind === 'job' ? menuItem.title : 'Post options'}</h2>
            <div className="jl-sheet-actions">
              {menuItem.kind === 'job' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/jobs/${encodeURIComponent(menuItem.id)}`)
                      setMenuItem(null)
                    }}
                  >
                    Open job details
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleSave(menuItem).then(() => setMenuItem(null))
                    }}
                  >
                    {menuItem.saved ? 'Remove from saved' : 'Save job'}
                  </button>
                  {menuItem.origin === 'imported' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const url = safeExternalUrl(menuItem.applyUrl)
                        if (url && !session.user) openAuth({ intent: 'apply-source', jobId: menuItem.id, nextPath: window.location.pathname + window.location.search })
                        else if (url) window.open(url, '_blank', 'noopener,noreferrer')
                        setMenuItem(null)
                      }}
                    >
                      Apply at source
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      void handleShare(menuItem).then(() => setMenuItem(null))
                    }}
                  >
                    Share job
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/posts/${encodeURIComponent(menuItem.id)}`)
                      setMenuItem(null)
                    }}
                  >
                    Open post and comments
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleShare(menuItem).then(() => setMenuItem(null))
                    }}
                  >
                    Share post
                  </button>
                  {menuItem.isOwn ? (
                    <button type="button" className="danger" onClick={() => void deleteOwnPost(menuItem)}>
                      Delete my post
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <button type="button" className="jl-sheet-close" onClick={() => setMenuItem(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function dedupeJobs(items: JobItem[]): JobItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function dedupePosts(items: PostItem[]): PostItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}
