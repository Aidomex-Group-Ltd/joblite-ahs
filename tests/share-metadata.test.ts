import { describe, expect, it } from 'vitest'
import { DEFAULT_METADATA, metadataHeadMarkup } from '../src/shared/page-metadata'

describe('Joblite social metadata', () => {
  it('emits the full branded homepage preview with absolute HTTPS image details', () => {
    const html = metadataHeadMarkup(DEFAULT_METADATA)
    expect(html).toContain('<title data-joblite-meta>Joblite AHIS | Local Jobs &amp; Remote Opportunities</title>')
    expect(html).toContain('property="og:url" content="https://joblite.online/"')
    expect(html).toContain('property="og:image" content="https://joblite.online/share-card.v1.png"')
    expect(html).toContain('property="og:image:width" content="1200"')
    expect(html).toContain('property="og:image:height" content="630"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
  })

  it('escapes dynamic text and attribute values before writing them into HTML', () => {
    const html = metadataHeadMarkup({ ...DEFAULT_METADATA, title: 'A <script>alert("x")</script> & "job"' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('A &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;job&quot;')
  })
})
