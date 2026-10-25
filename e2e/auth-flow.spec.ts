import { expect, test } from '@playwright/test'

test('new signup, session persistence, logout, and returning-user login', async ({ browser, page, request }) => {
  test.setTimeout(120000)
  const email = `auth-flow-${Date.now()}@joblite.test`

  await page.goto('/signup?next=%2Fjobs')
  await page.getByLabel('Full name').fill('E2E Auth Candidate')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel(/By creating an account, you agree to Joblite’s/).check()
  await page.getByLabel(/I confirm that I am at least 18/).check()
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Enter your verification code' })).toBeVisible({ timeout: 45000 })
  await expect.poll(async () => {
    return (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).status()
  }).toBe(200)
  const firstMail = await (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).json()
  await page.getByLabel('Verification code').fill(firstMail.data.code)
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fjobs/)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page).toHaveURL(/\/jobs$/)

  const signupSession = await page.request.get('/api/v1/me')
  expect(signupSession.status()).toBe(200)
  const signedUpUser = (await signupSession.json()).data.user
  expect(signedUpUser.email).toBe(email)

  await page.reload()
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0)
  const reloadedSession = await page.request.get('/api/v1/me')
  expect(reloadedSession.status()).toBe(200)
  expect((await reloadedSession.json()).data.user.id).toBe(signedUpUser.id)

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible()
  await expect.poll(async () => (await page.request.get('/api/v1/me')).status()).toBe(401)

  const loginContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8787',
  })
  try {
    const loginPage = await loginContext.newPage()
    await loginContext.addCookies([{
      name: 'joblite_session',
      value: 'invalid-test-session',
      url: process.env.E2E_BASE_URL || 'http://127.0.0.1:8787',
      httpOnly: true,
    }])
    await loginPage.goto('/settings')
    await expect(loginPage.getByRole('button', { name: 'Continue with email' })).toBeVisible()
    await loginPage.goto('/sign-in')
    await expect(loginPage.getByRole('dialog')).toBeVisible()
    await loginPage.getByLabel('Email address').fill(email)
    await loginPage.getByRole('button', { name: 'Continue with email' }).click()
    await expect(loginPage.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 45000 })

    await expect.poll(async () => {
      return (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).status()
    }).toBe(200)
    const loginMail = await (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).json()
    expect(loginMail.data.challenge_id).not.toBe(firstMail.data.challenge_id)

    const incorrectCode = loginMail.data.code === '000000' ? '000001' : '000000'
    await loginPage.getByLabel('Verification code').fill(incorrectCode)
    await loginPage.getByRole('button', { name: 'Verify and continue' }).click()
    await expect(loginPage.getByRole('alert')).toContainText('invalid')
    expect((await loginPage.request.get('/api/v1/me')).status()).toBe(401)

    await loginPage.getByLabel('Verification code').fill(loginMail.data.code)
    await loginPage.getByRole('button', { name: 'Verify and continue' }).click()
    await expect(loginPage).toHaveURL(/\/$/)
    const loginSession = await loginPage.request.get('/api/v1/me')
    expect(loginSession.status()).toBe(200)
    const loggedInUser = (await loginSession.json()).data.user
    expect(loggedInUser.id).toBe(signedUpUser.id)
    expect(loggedInUser.email).toBe(email)

    await loginPage.reload()
    const persistedLogin = await loginPage.request.get('/api/v1/me')
    expect(persistedLogin.status()).toBe(200)
    expect((await persistedLogin.json()).data.user.id).toBe(signedUpUser.id)
  } finally {
    await loginContext.close()
  }
})
