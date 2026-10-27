import type { BrowserContext, Page } from '@playwright/test'

// The privacy-choice dialog opens automatically on launch until a choice is
// recorded. Journeys that are not about that dialog record a choice up front so
// the modal does not intercept their interactions.
export async function preRecordPrivacyChoice(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    try {
      window.localStorage.setItem('joblite:privacy-choice', 'reject_optional')
    } catch {
      // Storage can be unavailable; the journey under test does not depend on it.
    }
  })
}
