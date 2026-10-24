import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const artifacts = join(process.cwd(), 'artifacts', 'screenshots')

async function screenshot(page: Page, name: string) {
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true })
}

test('guest application, passwordless verification, composer publishing, and media viewer journeys', async ({ page, context, request }) => {
  test.setTimeout(120000)
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => { consoleErrors.push(error.message); console.log(`PAGEERROR ${error.stack || error.message}`) })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // A guest's expected /me 401 is logged by Chromium as a failed resource.
    if (/server responded with a status of 401/.test(message.text())) return
    consoleErrors.push(message.text())
  })
  page.on('response', (response) => { if (response.url().includes('/api/v1/') && response.status() >= 400) console.log(`API ${response.status()} ${response.url()}`) })
  await context.route('https://jobs.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>External fixture</title>' }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Joblite AHS home' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Create a post or job/ })).toBeVisible()
  await screenshot(page, 'home-mobile-guest')

  const privateApi = await request.get('/api/v1/me')
  expect(privateApi.status()).toBe(401)
  const deepRoute = await request.get('/jobs?q=E2E')
  expect(deepRoute.status()).toBe(200)
  expect(await deepRoute.text()).toContain('<div id="root"></div>')
  const deepResponse = await page.goto('/jobs?q=E2E', { waitUntil: 'commit' })
  expect(deepResponse?.status()).toBe(200)
  await expect(page.getByText('E2E Software Engineer')).toBeVisible()
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
  await expect(page.getByRole('link', { name: /Continue to E2E Fixture Board/ })).toBeVisible()
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
  expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll)

  await context.request.post('/api/v1/auth/logout', { data: {} })

  // Every requested route renders the same shared theme on a small and wide viewport.
  const routes = ['/', '/sign-in', '/settings', '/notifications', '/hiring', '/saved', '/applications', '/jobs']
  for (const viewport of [{ width: 390, height: 844, name: 'mobile' }, { width: 1440, height: 1000, name: 'desktop' }]) {
    await page.setViewportSize(viewport)
    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
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
  expect(consoleErrors).toEqual([])
})
