/**
 * Preset prompts for new Gemini nodes
 * Short, interesting prompts designed to quickly test Gemini functionality
 */
export const PRESET_PROMPTS = [
  "What is 2+2?",
  "Write a haiku about code",
  "Explain AI in one sentence",
  "What's the capital of France?",
  "Count from 1 to 5",
  "What color is the sky?",
  "Say hello in Spanish",
  "What is a variable?",
  "Name 3 fruits",
  "What time is it?",
  "Define 'algorithm'",
  "What's 10% of 50?",
  "List 2 programming languages",
  "What is the opposite of 'hot'?",
  "How many days in a week?",
  "What does 'API' stand for?",
  "Name a primary color",
  "What is 3 squared?",
  "Define 'database'",
  "What comes after Monday?"
] as const

/**
 * Get a random preset prompt
 */
export function getRandomPresetPrompt(): string {
  const randomIndex = Math.floor(Math.random() * PRESET_PROMPTS.length)
  return PRESET_PROMPTS[randomIndex]
}
