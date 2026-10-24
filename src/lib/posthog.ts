import posthog from 'posthog-js'

let initialized = false
let consent = false

export function isAnalyticsEnabled(): boolean {
  return typeof window !== 'undefined' && consent && initialized
}

export const initPostHog = (analyticsEnabled = false) => {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
  consent = typeof window !== 'undefined' && process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true' && analyticsEnabled === true && Boolean(key && host)
  if (!consent) {
    if (initialized) {
      posthog.opt_out_capturing()
      posthog.reset()
    }
    return
  }
  if (initialized) {
    posthog.opt_in_capturing({ captureEventName: false })
    return
  }
  posthog.init(key!, {
    api_host: host!,
    person_profiles: 'identified_only',
    persistence: 'memory',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_decide: true,
  })
  initialized = true
}

export { posthog }
