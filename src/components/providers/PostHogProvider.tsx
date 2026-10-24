'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { initPostHog } from '@/lib/posthog'
import { trackPageView } from '@/lib/analytics'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const analyticsEnabled = status === 'authenticated' && session?.user?.analyticsEnabled === true

  useEffect(() => {
    // Initialize PostHog with analytics setting
    initPostHog(analyticsEnabled)
    return () => initPostHog(false)
  }, [analyticsEnabled])

  useEffect(() => {
    // Track page views on route changes only if analytics is enabled
    if (pathname && analyticsEnabled) {
      trackPageView(pathname)
    }
  }, [pathname, analyticsEnabled])

  return <>{children}</>
}

// Component for manual page view tracking
export function PostHogPageView() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname) {
      trackPageView(pathname)
    }
  }, [pathname])

  return null
}
