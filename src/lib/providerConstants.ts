import type { CredentialProviderId } from "@/lib/providers/registry"
export type ProviderKey = CredentialProviderId

export const DEFAULT_MODELS: Record<ProviderKey, string[]> = {
  gemini: ['models/gemini-2.5-pro', 'models/gemini-2.5-flash', 'models/gemini-2.5-flash-lite'],
  openai: ['gpt-5.1', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1'],
  openrouter: ['x-ai/grok-4.1-fast', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat-v3-0324', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-thinking']
}

