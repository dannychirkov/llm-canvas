import { customChat } from "@/lib/providers/customChat"
import { boundedSummary } from "@/lib/providers/boundedSummary"
import { customModelContextWindow } from "@/lib/providers/customTypes"
import type { CustomEndpoint } from "@/lib/providers/customTypes"
import type { RequestOptions, SummaryLength, SummaryStyle } from "@/types"

export async function customSummary(endpoint: CustomEndpoint & { apiKey: string; headers: Record<string, string> }, input: RequestOptions & { modelName: string; text: string; summaryLength?: SummaryLength; summaryStyle?: SummaryStyle }, progress?: (event: unknown) => void) {
  return boundedSummary(input, customModelContextWindow(endpoint, input.modelName), (prompt, outputLimit) => customChat(endpoint, { ...input, finalPrompt: prompt, max_tokens: outputLimit }), progress)
}
