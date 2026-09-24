// Carry the original output only when generation succeeded but local validation failed.
export class CardFormatError extends Error {
  constructor(readonly output: string, readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Invalid knowledge card format.')
    this.name = 'CardFormatError'
  }
}
