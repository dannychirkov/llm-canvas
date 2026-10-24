import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, mobileSnapshot, () => false)
}

function mobileSnapshot() { return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches }

function subscribe(onChange: () => void) {
  const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}
