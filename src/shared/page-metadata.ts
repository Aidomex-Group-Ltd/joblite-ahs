export type PageMetadata = {
  title: string
  description: string
  url: string
  type?: 'website' | 'article'
  image?: string
  imageType?: string
  imageWidth?: number
  imageHeight?: number
  imageAlt?: string
  noindex?: boolean
}

export const SITE_ORIGIN = 'https://joblite.online'
export const DEFAULT_SHARE_IMAGE = `${SITE_ORIGIN}/share-card.v1.png`
export const DEFAULT_METADATA: PageMetadata = {
  title: 'Joblite AHIS | Local Jobs & Remote Opportunities',
  description: 'Discover local jobs and remote opportunities.',
  url: `${SITE_ORIGIN}/`,
  type: 'website',
  image: DEFAULT_SHARE_IMAGE,
  imageType: 'image/png',
  imageWidth: 1200,
  imageHeight: 630,
  imageAlt: 'Joblite AHIS: Your next opportunity starts here. Discover local jobs and remote opportunities.',
}

export function escapeMetadata(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

export function metadataHeadMarkup(metadata: PageMetadata): string {
  const title = escapeMetadata(metadata.title)
  const description = escapeMetadata(metadata.description)
  const url = escapeMetadata(metadata.url)
  const image = escapeMetadata(metadata.image || DEFAULT_SHARE_IMAGE)
  const imageAlt = escapeMetadata(metadata.imageAlt || 'Joblite AHIS share preview')
  const tags = [
    `<title data-joblite-meta>${title}</title>`,
    `<meta data-joblite-meta name="description" content="${description}">`,
    `<link data-joblite-meta rel="canonical" href="${url}">`,
    `<meta data-joblite-meta property="og:type" content="${metadata.type || 'website'}">`,
    `<meta data-joblite-meta property="og:site_name" content="Joblite AHIS">`,
    `<meta data-joblite-meta property="og:title" content="${title}">`,
    `<meta data-joblite-meta property="og:description" content="${description}">`,
    `<meta data-joblite-meta property="og:url" content="${url}">`,
    `<meta data-joblite-meta property="og:image" content="${image}">`,
    `<meta data-joblite-meta property="og:image:alt" content="${imageAlt}">`,
    `<meta data-joblite-meta property="og:image:type" content="${escapeMetadata(metadata.imageType || 'image/png')}">`,
    ...(metadata.imageWidth ? [`<meta data-joblite-meta property="og:image:width" content="${metadata.imageWidth}">`] : []),
    ...(metadata.imageHeight ? [`<meta data-joblite-meta property="og:image:height" content="${metadata.imageHeight}">`] : []),
    `<meta data-joblite-meta name="twitter:card" content="summary_large_image">`,
    `<meta data-joblite-meta name="twitter:title" content="${title}">`,
    `<meta data-joblite-meta name="twitter:description" content="${description}">`,
    `<meta data-joblite-meta name="twitter:image" content="${image}">`,
    `<meta data-joblite-meta name="twitter:image:alt" content="${imageAlt}">`,
    ...(metadata.noindex ? ['<meta data-joblite-meta name="robots" content="noindex,nofollow">'] : []),
  ]
  return tags.join('\n    ')
}

export function applyPageMetadata(metadata: PageMetadata): void {
  if (typeof document === 'undefined') return
  const head = document.head
  head.querySelectorAll('title,meta[name="description"],meta[name="robots"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"]').forEach((node) => node.remove())
  const template = document.createElement('template')
  template.innerHTML = metadataHeadMarkup(metadata)
  head.appendChild(template.content.cloneNode(true))
}
