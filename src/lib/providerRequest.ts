import { AsyncLocalStorage } from "node:async_hooks"

const requestSignal = new AsyncLocalStorage<AbortSignal>()

export function withProviderSignal<Result>(signal: AbortSignal, callback: () => Result): Result {
  return requestSignal.run(signal, callback)
}

export function providerFetch(input: string | URL | Request, options: RequestInit = {}): Promise<Response> {
  const signal = requestSignal.getStore()
  const signals = [AbortSignal.timeout(120_000), ...(signal ? [signal] : []), ...(options.signal ? [options.signal] : [])]
  return fetch(input, { ...options, redirect: "error", signal: AbortSignal.any(signals) })
}
