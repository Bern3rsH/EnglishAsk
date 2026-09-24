export const resolveGeminiApiKey = (
  storedApiKey: string | undefined,
  environmentApiKey: string | undefined
): string | undefined => {
  return storedApiKey ?? environmentApiKey
}
