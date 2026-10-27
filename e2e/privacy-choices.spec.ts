import { expect, test } from '@playwright/test'

async function storedChoice(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.localStorage.getItem('joblite:privacy-choice'))
}

test('privacy choices dialog opens on launch and disappears after a choice is recorded', async ({ page }) => {
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: 'Privacy choices' })
  await expect(dialog).toBeVisible()

  await page.getByRole('button', { name: 'Reject optional' }).click()
  await expect(dialog).not.toBeVisible()

  // A recorded choice keeps the dialog closed on later launches.
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Privacy choices' })).not.toBeVisible()
  expect(await storedChoice(page)).toBe('reject_optional')
})

test('the privacy choices dialog is keyboard operable and restores focus to its trigger', async ({ page }) => {
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: 'Privacy choices' })
  await expect(dialog).toBeVisible()
  // The dialog is modal and contains the focused control.
  await expect(page.getByRole('button', { name: 'Close privacy choices' })).toBeFocused()

  // Focus is trapped inside the dialog: shift+tab from the first control wraps to the last.
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Withdraw optional choice' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Close privacy choices' })).toBeFocused()

  // Escape dismisses without recording a choice.
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await storedChoice(page)).toBeNull()

  // Reopening from the persistent trigger and dismissing restores focus to it.
  const trigger = page.getByRole('button', { name: 'Privacy choices' })
  await trigger.click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('a visitor can change and withdraw the recorded choice through the API', async ({ page }) => {
  const recorded: Array<Record<string, unknown>> = []
  await page.route('**/api/v1/legal/choices', async (route) => {
    recorded.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { recorded: true } }) })
  })

  await page.goto('/')
  const dialog = page.getByRole('dialog', { name: 'Privacy choices' })

  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Accept optional' }).click()
  await expect(dialog).not.toBeVisible()
  expect(await storedChoice(page)).toBe('accept_optional')
  expect(recorded.at(-1)).toMatchObject({ action: 'consent_grant', purpose: 'optional_tracking' })

  // Change the choice through the persistent control.
  await page.getByRole('button', { name: 'Privacy choices' }).click()
  await expect(dialog).toBeVisible()
  await expect(page.getByText('Your current choice is stored on this device.')).toBeVisible()
  await page.getByRole('button', { name: 'Reject optional' }).click()
  expect(await storedChoice(page)).toBe('reject_optional')
  expect(recorded.at(-1)).toMatchObject({ action: 'consent_refusal', purpose: 'optional_tracking' })

  // Withdraw the choice; a withdrawal is recorded and the stored choice reflects it.
  await page.getByRole('button', { name: 'Privacy choices' }).click()
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Withdraw optional choice' }).click()
  await expect(dialog).not.toBeVisible()
  expect(await storedChoice(page)).toBe('reject_optional')
  expect(recorded.at(-1)).toMatchObject({ action: 'withdrawal', purpose: 'optional_tracking' })
  expect(recorded.every((body) => typeof body.anonymous_id === 'string' && /^[a-f\d-]{36}$/i.test(body.anonymous_id))).toBe(true)
})

test('the privacy choices dialog works on a mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: 'Privacy choices' })
  await expect(dialog).toBeVisible()

  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      width: rect.width,
      bottom: Math.round(rect.bottom),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  expect(layout.width).toBeLessThanOrEqual(layout.viewportWidth)
  // On small screens the dialog is anchored to the bottom of the viewport.
  expect(Math.abs(layout.bottom - layout.viewportHeight)).toBeLessThanOrEqual(2)
  expect(layout.overflow).toBe(false)

  await page.getByRole('button', { name: 'Reject optional' }).click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
})
