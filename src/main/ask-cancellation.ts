export const isAbortError = (error: unknown): boolean => {
  return error instanceof Error && error.name === 'AbortError'
}

export class AskRequestCancellationRegistry {
  private readonly controllers = new Map<string, AbortController>()

  start(requestId: string): AbortController {
    if (this.controllers.has(requestId)) {
      throw new Error('A request with this ID is already running.')
    }

    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    return controller
  }

  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId)

    if (!controller) {
      return false
    }

    controller.abort()
    return true
  }

  finish(requestId: string, controller: AbortController): void {
    if (this.controllers.get(requestId) === controller) {
      this.controllers.delete(requestId)
    }
  }
}
