import { expect, test } from '@playwright/test'

test('guest browsing remains public while mobile ATS entry requires sign-in', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/jobs')
  await expect(page.getByPlaceholder('Search jobs, skills or companies')).toBeVisible()

  const hiringData = await request.get('/api/v1/organizations/unknown-organization/overview')
  expect(hiringData.status()).toBe(401)

  await page.goto('/hiring')
  await expect(page.getByRole('heading', { name: 'Manage your hiring pipeline' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue with email' }).click()
  const dialog = page.getByRole('dialog', { name: 'Welcome to Joblite' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveClass(/is-sheet/)
  await expect(page.getByLabel('Email address')).toBeFocused()
})

test('mobile email verification establishes the session before ATS access', async ({ page, request }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 390, height: 844 })
  const email = `mobile-auth-${Date.now()}@joblite.test`

  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Mobile Auth Candidate')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel(/By creating an account, you agree to Joblite’s/).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Enter your verification code' })).toBeVisible()

  await expect.poll(async () => (
    await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)
  ).status()).toBe(200)
  const mail = await (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).json()
  await page.getByLabel('Verification code').fill(mail.data.code)
  await page.getByRole('button', { name: 'Verify and continue' }).click()

  await expect(page).toHaveURL(/\/onboarding/)
  expect((await page.request.get('/api/v1/me')).status()).toBe(200)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page).toHaveURL(/\/jobs$/)
  await page.goto('/hiring')
  await expect(page.getByRole('heading', { name: 'Create an employer organization' })).toBeVisible()
})
