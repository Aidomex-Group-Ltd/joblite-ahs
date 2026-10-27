import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { preRecordPrivacyChoice } from './helpers'

const artifacts = join(process.cwd(), 'artifacts', 'screenshots')

async function screenshot(page: Page, name: string) {
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true })
}

test('guest application, passwordless verification, composer publishing, and media viewer journeys', async ({ page, context, request }) => {
  test.setTimeout(300000)
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => { consoleErrors.push(error.message); console.log(`PAGEERROR ${error.stack || error.message}`) })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // A guest's expected /me 401 and registration challenge 428 are logged by Chromium as failed resources.
    if (/server responded with a status of (401|428)/.test(message.text())) return
    consoleErrors.push(message.text())
  })
  page.on('response', (response) => { if (response.url().includes('/api/v1/') && response.status() >= 400) console.log(`API ${response.status()} ${response.url()}`) })
  await context.route('https://jobs.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>External fixture</title>' }))
  await preRecordPrivacyChoice(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Joblite AHIS home' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Create a post or job/ })).toBeVisible()
  await screenshot(page, 'home-mobile-guest')

  const privateApi = await request.get('/api/v1/me')
  expect(privateApi.status()).toBe(401)
  const deepRoute = await request.get('/jobs?q=E2E')
  expect(deepRoute.status()).toBe(200)
  expect(await deepRoute.text()).toContain('<div id="root"></div>')
  const deepResponse = await page.goto('/jobs?q=E2E', { waitUntil: 'commit' })
  expect(deepResponse?.status()).toBe(200)
  await page.waitForLoadState('networkidle')
  const deepHtml = await request.get('/jobs?q=E2E')
  expect((await deepHtml.text()).match(/property="og:title"/g)?.length).toBe(1)
  expect((await deepHtml.text())).toContain('Joblite AHIS | Local Jobs &amp; Remote Opportunities')
  const publicJobHtml = await request.get('/jobs/job_e2e')
  expect(publicJobHtml.status()).toBe(200)
  expect(await publicJobHtml.text()).toContain('E2E Software Engineer · Fixture Employer | Joblite AHIS')
  await expect(page.getByText('E2E Software Engineer').first()).toBeVisible({ timeout: 45000 })
  await expect(page.getByPlaceholder('Search jobs, skills or companies')).toHaveValue('E2E')
  await screenshot(page, 'jobs-mobile')
  await page.getByRole('button', { name: /Apply at source/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Sign in to continue to the original job posting.')).toBeVisible()
  await screenshot(page, 'auth-sheet-email')
  await page.getByRole('button', { name: 'Close sign in' }).click()
  await expect(page.getByPlaceholder('Search jobs, skills or companies')).toHaveValue('E2E')
  await expect(page.getByText('E2E Software Engineer')).toBeVisible()

  const email = 'journey-new@joblite.test'
  await page.getByRole('button', { name: /Apply at source/ }).first().click()
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await expect(page.getByText('Check your email', { exact: true })).toBeVisible({ timeout: 30000 })
  await screenshot(page, 'auth-sheet-code')
  await expect.poll(async () => {
    const result = await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)
    return result.status()
  }).toBe(200)
  const mail = await (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).json()
  await page.getByLabel('Verification code').fill(mail.data.code)
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page.getByRole('heading', { name: 'Set up your Joblite account' })).toBeVisible()
  await screenshot(page, 'signup-onboarding')
  await page.getByLabel('Your name').fill('E2E Candidate')
  await page.getByLabel('Where are you based?').selectOption('UG')
  await page.getByRole('radio', { name: /I’m looking for work/ }).check()
  await page.getByLabel('Role or kind of work you’re looking for').fill('Software engineer')
  await expect(page.getByLabel(/By creating an account, you agree to Joblite’s/)).toBeVisible()
  await page.getByLabel(/By creating an account, you agree to Joblite’s/).check()
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Create my account' }).click()
  await expect(page.getByRole('link', { name: /Continue to E2E Fixture Board/ })).toBeVisible({ timeout: 45000 })
  await expect(page.getByText(/opens an external website/)).toBeVisible()
  await screenshot(page, 'apply-continuation')
  const popupPromise = context.waitForEvent('page')
  await page.getByRole('link', { name: /Continue to E2E Fixture Board/ }).click()
  const popup = await popupPromise
  await expect(popup).toHaveURL('https://jobs.example.test/roles/fixture-1/apply')
  await popup.close()
  await expect(page.getByText('E2E Software Engineer')).toBeVisible()
  expect((await context.request.get('/api/v1/me/applications')).status()).toBe(200)
  const tracking = await context.request.get('/api/v1/me/summary')
  expect((await tracking.json()).data.external_tracked).toBe(0)

  // Session persists across route transitions and publishing uses a real media upload.
  await page.goto('/compose')
  await page.getByLabel('Post text').fill('A real local E2E post with an image attachment.')
  const picker = page.locator('input[type="file"][accept*="image"]')
  await picker.setInputFiles(join(process.cwd(), 'public/media/poster.jpg'))
  await expect(page.getByText(/100%|Uploaded/)).toBeVisible({ timeout: 15000 }).catch(() => undefined)
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled({ timeout: 15000 })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page).toHaveURL('/')
  const mediaButton = page.getByRole('button', { name: /Open image.*full-screen viewer/ }).first()
  await expect(mediaButton).toBeVisible()
  const beforeScroll = await page.evaluate(() => window.scrollY)
  await mediaButton.click()
  await expect(page.getByRole('button', { name: 'Close media viewer' })).toBeVisible()
  await expect(page).toHaveURL(/\/posts\/[^/]+\/media\/0$/)
  await screenshot(page, 'media-viewer-mobile')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL('/')
  const afterScroll = await page.evaluate(() => window.scrollY)
  expect(Math.abs(afterScroll - beforeScroll)).toBeLessThanOrEqual(1)

  await context.request.post('/api/v1/auth/logout', { data: {} })

  // Every requested route renders the same shared theme on a small and wide viewport.
  const routes = ['/', '/sign-in', '/signup', '/onboarding', '/settings', '/notifications', '/hiring', '/saved', '/applications', '/jobs', '/legal', '/legal/terms', '/legal/privacy', '/legal/cookies', '/legal/acceptable-use', '/legal/community-guidelines', '/legal/job-disclaimer', '/legal/privacy-rights']
  for (const viewport of [{ width: 390, height: 844, name: 'mobile' }, { width: 1440, height: 1000, name: 'desktop' }]) {
    await page.setViewportSize(viewport)
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await expect(page.locator('body')).toBeVisible()
      if (route.startsWith('/legal')) await expect(page.getByText('Draft for legal review').first()).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflow: Array.from(document.body.querySelectorAll<HTMLElement>('*')).map((item) => ({
          tag: item.tagName, className: typeof item.className === 'string' ? item.className : '',
          right: Math.round(item.getBoundingClientRect().right), left: Math.round(item.getBoundingClientRect().left),
        })).filter((item) => item.right > window.innerWidth + 2 || item.left < -2).slice(0, 8),
      }))
      if (dimensions.scrollWidth > dimensions.width) console.log(`OVERFLOW ${route} ${viewport.name} ${JSON.stringify(dimensions)}`)
      expect(dimensions.scrollWidth <= dimensions.width).toBeTruthy()
      await screenshot(page, `${route === '/' ? 'home' : route.slice(1)}-${viewport.name}`)
    }
  }
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.status()).toBe(200)
  expect((await manifest.json()).icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  for (const iconPath of ['/joblite.png', '/apple-touch-icon.png', '/share-card.v1.png']) {
    const response = await request.get(iconPath)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
  }
  const shareImage = await (await request.get('/share-card.v1.png')).body()
  expect(shareImage.readUInt32BE(16)).toBe(1200)
  expect(shareImage.readUInt32BE(20)).toBe(630)
  expect(consoleErrors).toEqual([])
})
