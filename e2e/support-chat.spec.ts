import { expect, test } from '@playwright/test'
import { preRecordPrivacyChoice } from './helpers'

// The support launcher stays hidden until the inference provider is configured
// and functional. This guards against exposing a chat that cannot answer.
test('support chat launcher stays hidden while the inference provider is unavailable', async ({ page }) => {
  await preRecordPrivacyChoice(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Support' })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Joblite support' })).toHaveCount(0)
})
