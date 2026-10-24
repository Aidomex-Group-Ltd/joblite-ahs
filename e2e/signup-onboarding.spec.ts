import { expect, test } from '@playwright/test'

test.describe('Signup and Onboarding E2E Journey', () => {
  test('Complete signup, code verification, 3-step onboarding, and safe return URL', async ({ page, request }) => {
    test.setTimeout(120000)
    const email = 'pw-onboarding@joblite.test'
    const nextUrl = '/jobs?country=UG'

    // 1. Visit /signup with a safe return path
    await page.goto(`/signup?next=${encodeURIComponent(nextUrl)}`)
    await expect(page.getByRole('heading', { name: 'Find your next opportunity.' })).toBeVisible()
    await expect(page.getByText('Access nearby jobs, worldwide opportunities, and remote roles with transparent pay.')).toBeVisible()
    await expect(page.locator('img[src="/joblite.png"]')).toBeVisible()

    // 2. Validate form controls are present
    const nameInput = page.getByLabel('Full name')
    const emailInput = page.getByLabel('Email address')
    const termsCheck = page.getByLabel(/I agree to the current Terms of Service/)
    const ageCheck = page.getByLabel(/I confirm that I am at least 18/)
    const marketingCheck = page.getByLabel(/Email me optional Joblite product updates/)
    const submitBtn = page.getByRole('button', { name: 'Create account' })

    await expect(nameInput).toBeVisible()
    await expect(emailInput).toBeVisible()
    await expect(termsCheck).toBeVisible()
    await expect(ageCheck).toBeVisible()
    await expect(marketingCheck).toBeVisible()
    await expect(marketingCheck).not.toBeChecked()
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue browsing jobs' })).toBeVisible()

    // 3. Fill signup form
    await nameInput.fill('Sarah Candidate')
    await emailInput.fill(email)
    await termsCheck.check()
    await ageCheck.check()
    await submitBtn.click()

    // 4. Verification screen appears
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()

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
    await expect(page.getByText('Step 1 of 3')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'How would you like to use Joblite?' })).toBeVisible()

    // Choose "Find a job"
    await page.getByRole('button', { name: /Find a job/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // 7. Onboarding Step 2: Preferences
    await expect(page.getByText('Step 2 of 3')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your preferences' })).toBeVisible()

    // Select country
    await page.getByLabel('Country').selectOption('UG')
    await page.getByLabel('City or region').fill('Kampala')
    await page.getByLabel('Desired job titles or categories').fill('Full Stack Developer')

    // Add a skill
    await page.getByPlaceholder('e.g. TypeScript, React, SQL').fill('TypeScript')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('TypeScript ×')).toBeVisible()

    // Work preference: Remote
    await page.getByRole('button', { name: 'Remote' }).click()

    // Employment type: Full-time
    await page.getByRole('button', { name: 'Full-time' }).click()

    // Experience level: Experienced / Mid-level
    await page.getByLabel('Experience level').selectOption('mid')

    await page.getByRole('button', { name: 'Continue' }).click()

    // 8. Onboarding Step 3: Review and Alerts
    await expect(page.getByText('Step 3 of 3')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Alerts & review' })).toBeVisible()

    // Summary assertions
    await expect(page.getByText('Full Stack Developer')).toBeVisible()
    await expect(page.getByText('Remote')).toBeVisible()

    // Check optional job alert opt-in
    const alertOptIn = page.getByLabel('Receive email alerts for matching jobs')
    await expect(alertOptIn).not.toBeChecked()
    await alertOptIn.check()

    // Select frequency
    await page.getByLabel('Alert frequency').selectOption('weekly')

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
    await page.getByLabel(/I agree to the current Terms of Service/).check()
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
    await expect(page.getByText('Step 1 of 3')).toBeVisible()

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
