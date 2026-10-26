import { expect, test } from '@playwright/test'

const post = {
  id: 'media-fixture',
  body: 'A readable post caption that remains available with the expanded media.',
  created_at: Math.floor(Date.now() / 1000),
  author_name: 'Fixture Author',
  author_handle: 'fixture-author',
  author_headline: 'Product designer',
  media: [
    {
      kind: 'image',
      url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%221200%22 viewBox=%220 0 800 1200%22%3E%3Crect width=%22800%22 height=%221200%22 fill=%22%23087cff%22/%3E%3C/svg%3E',
      alt: 'Blue portrait artwork',
    },
    {
      kind: 'image',
      url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22800%22 viewBox=%220 0 1200 800%22%3E%3Crect width=%221200%22 height=%22800%22 fill=%22%23071f56%22/%3E%3C/svg%3E',
      alt: 'Navy landscape artwork',
    },
  ],
  like_count: 3,
  comment_count: 1,
  liked: false,
  is_own: false,
}

test('media opens as a viewport-filling mobile viewer with readable feed text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/v1/posts/media-fixture', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: post }) })
  )
  await page.route('**/api/v1/posts/media-fixture/comments', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  )

  await page.goto('/posts/media-fixture/media/0')
  const viewer = page.getByRole('dialog', { name: 'Post media viewer' })
  await expect(viewer).toBeVisible()
  await expect(page.getByAltText('Blue portrait artwork')).toBeVisible()
  await expect(page.getByText(post.body)).toBeVisible()

  const dimensions = await page.locator('.mv-backdrop').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight }
  })
  expect(dimensions.width).toBe(dimensions.viewportWidth)
  expect(dimensions.height).toBe(dimensions.viewportHeight)
  const stageHeight = await page.locator('.mv-stage').evaluate((element) => element.getBoundingClientRect().height)
  expect(stageHeight).toBeGreaterThan(700)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByAltText('Navy landscape artwork')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('media-viewer-mobile.png') })

  const textSizes = await page.evaluate(() => {
    const app = document.createElement('div')
    app.className = 'jl-app'
    app.innerHTML = [
      '<article class="jl-card jl-post">',
      '<div class="jl-meta"><strong>Author name</strong><small>2h</small></div>',
      '<p class="jl-subtitle">Product designer</p>',
      '<p class="jl-post-text">Readable post</p>',
      '<p class="jl-summary">Readable job preview</p>',
      '<ul class="comment-list"><li><p>Readable comment text at the base size.</p></li></ul>',
      '<button class="jl-primary">Primary action</button><div class="jl-post-actions"><button>Like</button></div>',
      '<label>Search<input /></label><select><option>Remote</option></select><textarea></textarea>',
      '<p class="jl-post-text">https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</p>',
      '</article>',
    ].join('')
    document.body.append(app)
    const size = (selector: string) => getComputedStyle(app.querySelector(selector)!).fontSize
    const contrast = (selector: string) => {
      const element = app.querySelector(selector)!
      const style = getComputedStyle(element)
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number)
      const luminance = (value: string) => {
        const channels = rgb(value).map((channel) => {
          const normalized = channel / 255
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      }
      const foreground = luminance(style.color)
      const background = luminance(style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(app).backgroundColor : style.backgroundColor)
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    }
    const body = getComputedStyle(app.querySelector('.jl-post-text')!)
    const result = {
      body: body.fontSize,
      bodyLine: body.lineHeight,
      root: getComputedStyle(document.documentElement).fontSize,
      summary: size('.jl-summary'),
      comment: size('.comment-list p'),
      meta: size('.jl-meta small'),
      subtitle: size('.jl-subtitle'),
      author: size('.jl-meta strong'),
      input: size('input'),
      select: size('select'),
      textarea: size('textarea'),
      primaryContrast: contrast('.jl-primary'),
      actionContrast: contrast('.jl-post-actions button'),
      overflow: app.scrollWidth > app.clientWidth,
    }
    app.remove()
    return result
  })
  expect(textSizes.root).toBe('16px')
  expect(textSizes.body).toBe('16px')
  expect(Number.parseFloat(textSizes.bodyLine)).toBeGreaterThanOrEqual(24)
  expect(textSizes.summary).toBe('16px')
  expect(textSizes.comment).toBe('16px')
  expect(textSizes.author).toBe('16px')
  expect(textSizes.meta).toBe('14px')
  expect(textSizes.subtitle).toBe('14px')
  expect(textSizes.input).toBe('16px')
  expect(textSizes.select).toBe('16px')
  expect(textSizes.textarea).toBe('16px')
  expect(textSizes.primaryContrast).toBeGreaterThanOrEqual(4.5)
  expect(textSizes.actionContrast).toBeGreaterThanOrEqual(4.5)
  expect(textSizes.overflow).toBe(false)

  await page.setViewportSize({ width: 1280, height: 900 })
  const desktopStage = await page.locator('.mv-stage').evaluate((element) => element.getBoundingClientRect().width)
  expect(desktopStage).toBeGreaterThan(700)
  await page.screenshot({ path: testInfo.outputPath('media-viewer-desktop.png') })

  // A 320 CSS-pixel viewport models 200% zoom on a 640px-wide screen.
  await page.setViewportSize({ width: 320, height: 720 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
