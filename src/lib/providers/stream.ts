import { publicError } from "@/lib/apiErrors"
import { withProviderSignal } from "@/lib/providerRequest"

export function createProviderStream(req: Request, produce: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>): Response {
  const cancellation = new AbortController()
  const signal = AbortSignal.any([req.signal, cancellation.signal])
  let cancelled = false
  let production: Promise<void> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      production = withProviderSignal(signal, async () => {
        try {
          await produce(controller)
        } catch (error) {
          if (!cancelled) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: publicError(error) })}\n\n`))
        } finally {
          if (!cancelled) controller.close()
        }
      })
      return production
    },
    async cancel() {
      cancelled = true
      cancellation.abort()
      await production
    }
  })
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" } })
}
