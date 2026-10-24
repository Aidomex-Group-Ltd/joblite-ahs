import { arbeitnowAdapter } from './arbeitnow'
import { greenhouseAdapter } from './greenhouse'
import { leverAdapter } from './lever'
import { remoteOkAdapter } from './remoteok'
import { remotiveAdapter } from './remotive'
import type { ProviderAdapter } from './types'

const ADAPTERS: Record<string, ProviderAdapter> = {
  arbeitnow: arbeitnowAdapter,
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  remoteok: remoteOkAdapter,
  remotive: remotiveAdapter,
}

export function getAdapter(name: unknown): ProviderAdapter | null {
  if (typeof name !== 'string') return null
  return ADAPTERS[name.toLowerCase()] || null
}

export const PROVIDER_ADAPTER_NAMES = Object.keys(ADAPTERS)

export { arbeitnowAdapter, greenhouseAdapter, leverAdapter, remoteOkAdapter, remotiveAdapter }
