import { GrammarReviewError } from './grammar-review'

export class CardReviewError extends GrammarReviewError {
  constructor(readonly output: string, error: GrammarReviewError) {
    super(error.code, error.elapsedMs, error.statusCode)
  }
}
