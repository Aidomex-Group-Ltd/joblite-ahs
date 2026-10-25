import { expect, test } from '@playwright/test'

test.describe('Signup and Onboarding E2E Journey', () => {
  test('recovers from a retryable delivery error and completes signup after test-mail delivery resumes', async ({ page, request }) => {
    let failFirstRequest = true
    await page.route('**/api/v1/auth/challenges', async (route) => {
      if (!failFirstRequest) {
        await route.continue()
        return
      }
      failFirstRequest = false
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'EMAIL_DELIVERY_FAILED',
            message: 'We could not send a sign-in code. Please retry shortly.',
            request_id: 'test-request-123',
            retry_after: 1,
          },
        }),
      })
    })

    await page.goto('/signup?next=%2Fjobs%3Fcountry%3DUG')
    await page.getByLabel('Full name').fill('Retry Candidate')
    const email = `retry-${Date.now()}@joblite.test`
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel(/By creating an account, you agree to Joblite’s/).check()
    await page.getByLabel(/I confirm that I am at least 18/).check()
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByRole('alert')).toContainText('Please retry shortly.')
    await expect(page.getByRole('alert')).toContainText('test-request-123')
    await expect(page.getByLabel('Full name')).toHaveValue('Retry Candidate')
    await expect(page.getByLabel('Email address')).toHaveValue(email)
    await expect(page.getByLabel('Verification code')).toHaveCount(0)
    const retry = page.getByRole('button', { name: /Try again in|Create account/ })
    await expect(retry).toBeEnabled({ timeout: 5000 })
    await retry.click()

    await expect(page.getByRole('heading', { name: 'Enter your verification code' })).toBeVisible()
    await expect.poll(async () => {
      return (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).status()
    }).toBe(200)
    const mail = await (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).json()
    await page.getByLabel('Verification code').fill(mail.data.code)
    await page.getByRole('button', { name: 'Verify and continue' }).click()
    await expect(page).toHaveURL(/\/onboarding/)
    expect((await page.request.get('/api/v1/me')).status()).toBe(200)
  })

  test('Complete signup, code verification, 3-step onboarding, and safe return URL', async ({ page, request }) => {
    test.setTimeout(120000)
    const email = `pw-onboarding-${Date.now()}@joblite.test`
    const nextUrl = '/jobs?country=UG'

    // 1. Visit /signup with a safe return path
    await page.goto(`/signup?next=${encodeURIComponent(nextUrl)}`)
    await expect(page.getByRole('heading', { name: 'Find your next opportunity.' })).toBeVisible()
    await expect(page.getByText('Access nearby jobs, worldwide opportunities, and remote roles tailored to your skills.')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Joblite worker hard-hat silhouette logo' })).toBeVisible()

    // 2. Validate form controls are present
    const nameInput = page.getByLabel('Full name')
    const emailInput = page.getByLabel('Email address')
    const termsCheck = page.getByLabel(/By creating an account, you agree to Joblite’s/)
    const ageCheck = page.getByLabel(/I confirm that I am at least 18/)
    const marketingCheck = page.getByLabel(/Email me optional Joblite job recommendations/)
    const submitBtn = page.getByRole('button', { name: 'Create account' })

    await expect(nameInput).toBeVisible()
    await expect(emailInput).toBeVisible()
    await expect(termsCheck).toBeVisible()
    await expect(ageCheck).toBeVisible()
    await expect(marketingCheck).toBeVisible()
    await expect(marketingCheck).not.toBeChecked()
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/legal/terms')
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy')

    const termsPopupPromise = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Terms of Service' }).click()
    const termsPage = await termsPopupPromise
    await expect(termsPage.getByRole('heading', { name: 'Terms of Service' })).toBeVisible()
    await termsPage.close()

    const privacyPopupPromise = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Privacy Policy' }).click()
    const privacyPage = await privacyPopupPromise
    await expect(privacyPage.getByRole('heading', { name: 'Privacy Notice' })).toBeVisible()
    await privacyPage.close()

    await expect(page.locator('.jl-signup-card').getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue browsing jobs' })).toBeVisible()

    // 3. Fill signup form
    await nameInput.fill('Sarah Candidate')
    await emailInput.fill(email)
    await termsCheck.check()
    await ageCheck.check()
    await submitBtn.click()

    // 4. Verification screen appears
    await expect(page.getByRole('heading', { name: 'Enter your verification code' })).toBeVisible()
    await expect(page.getByText(email, { exact: true })).toBeVisible()

    // 5. Fetch code from test mail sink
    await expect.poll(async () => {
      const res = await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)
      return res.status()
    }).toBe(200)

    const mail = await (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).json()
    await page.getByLabel('Verification code').fill(mail.data.code)
    await page.getByRole('button', { name: 'Verify and continue' }).click()

    // 6. Land on Onboarding Step 1
    await expect(page).toHaveURL(new RegExp(`/onboarding\\?next=${encodeURIComponent(nextUrl)}`))
    await expect(page.getByRole('heading', { name: 'How would you like to use Joblite?' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'How would you like to use Joblite?' })).toBeVisible()

    // Choose "Find a job"
    await page.getByRole('radio', { name: /Find a job/ }).check()
    await page.getByRole('button', { name: 'Continue' }).click()

    // 7. Onboarding Step 2: Preferences
    await expect(page.getByText('Preferences', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Set your job preferences' })).toBeVisible()

    // Select country
    await page.getByLabel('Where are you based?').selectOption('UG')
    await page.getByLabel('City or region').fill('Kampala')
    await page.getByLabel('Desired job titles or categories').fill('Full Stack Developer')

    // Add a skill
    await page.getByPlaceholder('Type a skill and press Enter').fill('TypeScript')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByRole('button', { name: 'Remove skill TypeScript' })).toBeVisible()

    // Work preference: Remote
    await page.getByRole('radio', { name: 'Remote' }).check()

    // Employment type: Full-time
    await page.getByRole('checkbox', { name: 'Full-time' }).check()

    // Experience level: Experienced / Mid-level
    await page.getByLabel('Experience level').selectOption('mid')

    await page.getByRole('button', { name: 'Continue' }).click()

    // 8. Onboarding Step 3: Review and Alerts
    await expect(page.getByText('Review & alerts', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Review & notifications' })).toBeVisible()

    // Summary assertions
    await expect(page.getByText('Full Stack Developer')).toBeVisible()
    await expect(page.getByText('Remote')).toBeVisible()

    // Check optional job alert opt-in
    const alertOptIn = page.getByLabel(/Email me job alerts matching these preferences/)
    await expect(alertOptIn).not.toBeChecked()
    await alertOptIn.check()

    // Select frequency
    await page.getByLabel('Frequency').selectOption('weekly')

    // Submit final onboarding
    await page.getByRole('button', { name: 'Start exploring jobs' }).click()

    // 9. Redirected to safe return path
    await expect(page).toHaveURL(/\/jobs\?country=UG/)
  })

  test('Onboarding can be skipped and does not cause redirect loops', async ({ page, request }) => {
    test.setTimeout(120000)
    const email = 'pw-skip@joblite.test'

    // Signup
    await page.goto('/signup')
    await page.getByLabel('Full name').fill('Skip Tester')
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel(/By creating an account, you agree to Joblite’s/).check()
    await page.getByLabel(/I confirm that I am at least 18/).check()
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect.poll(async () => {
      const res = await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)
      return res.status()
    }).toBe(200)

    const mail = await (await request.get(`/api/v1/auth/test-mail/latest?email=${encodeURIComponent(email)}`)).json()
    await page.getByLabel('Verification code').fill(mail.data.code)
    await page.getByRole('button', { name: 'Verify and continue' }).click()

    await expect(page).toHaveURL(/\/onboarding/)
    await expect(page.getByRole('heading', { name: 'How would you like to use Joblite?' })).toBeVisible()

    // Click "Skip for now"
    await page.getByRole('button', { name: 'Skip for now' }).click()

    // Lands on /jobs feed cleanly
    await expect(page).toHaveURL(/\/jobs$/)

    // Re-visiting /onboarding should redirect to / without loop
    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/jobs|\/$/)
  })

  test('Guest access allows exploring jobs, searching, and filtering without signup', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByPlaceholder('Search jobs, skills or companies')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Country' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Workplace' })).toBeVisible()

    // Guest can search
    await page.getByPlaceholder('Search jobs, skills or companies').fill('Developer')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/jobs\?q=Developer/)
  })
})
