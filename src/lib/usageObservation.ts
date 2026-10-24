import { AsyncLocalStorage } from "node:async_hooks"

type Observer = (output: Record<string, unknown>, prompt?: string) => Promise<void>
const observer = new AsyncLocalStorage<Observer>()

export async function observeProviderUsage(output: Record<string, unknown>, prompt?: string): Promise<void> {
  await observer.getStore()?.(output, prompt)
}

export function withUsageObserver<Result>(observe: Observer, run: () => Result): Result {
  return observer.run(observe, run)
}
