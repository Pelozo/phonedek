import { createContext, useContext, type ReactNode } from 'react'
import { normalizeHostPlatform } from '@phonedek/shared'
import type { HostPlatform } from '@phonedek/shared'

const HostPlatformContext = createContext<HostPlatform>('linux')

export function HostPlatformProvider({
  platform,
  children,
}: {
  platform: string | null | undefined
  children: ReactNode
}) {
  return <HostPlatformContext.Provider value={normalizeHostPlatform(platform)}>{children}</HostPlatformContext.Provider>
}

export function useHostPlatform(): HostPlatform {
  return useContext(HostPlatformContext)
}
