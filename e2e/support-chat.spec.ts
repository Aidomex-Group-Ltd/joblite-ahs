import { expect, test } from '@playwright/test'

test('support chatbot is keyboard-accessible, responsive, and keeps its chat in the page session', async ({ page }) => {
  await page.route('**/api/v1/support/chat', async (route) => {
    const payload = route.request().postDataJSON() as { messages: Array<{ role: string; content: string }> }
    expect(payload.messages.at(-1)).toMatchObject({ role: 'user', content: 'How do I track a native application?' })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { answer: 'Open My Applications to view native Joblite applications.' } }),
    })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const launcher = page.getByRole('button', { name: 'Support' })
  await launcher.click()
  const dialog = page.getByRole('dialog', { name: 'Joblite support' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Your question')).toBeFocused()
  await expect(page.getByText(/Don’t share verification codes/)).toBeVisible()

  await page.getByLabel('Your question').fill('How do I track a native application?')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('Open My Applications to view native Joblite applications.')).toBeVisible()

  const dimensions = await dialog.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport)
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport)

  await page.setViewportSize({ width: 320, height: 720 })
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(mobileOverflow).toBe(false)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(launcher).toBeFocused()
})
