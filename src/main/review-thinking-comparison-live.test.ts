import { readFile, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { reviewGrammar } from './grammar-review'

const TEST_TIMEOUT_MS = 60_000
const baseClassification: RouterClassification = {
  inputType: 'grammar_concept', structureType: 'abstract_concept', targetText: 'present perfect',
  targets: ['present perfect'], focusText: '', intent: 'explain_grammar', modules: ['grammar'],
  confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card'
}
const complexSamples = [
  { name: 'when-overgeneralization', target: 'present perfect',
    content: 'when 是已结束过去时间的标志，所以所有 when 从句都不能用现在完成时。',
    expected: /语境|未来|不.*决定/, retained: ['when'], unchanged: false },
  { name: 'when-correct', target: 'present perfect',
    content: 'when 本身不决定时态；when I was a child 给出已结束的过去时间，而 when you have finished 可以表示未来某个动作之前完成。',
    expected: /when you have finished/, retained: ['when I was a child', 'when you have finished'], unchanged: true },
  { name: 'participle-form', target: 'present perfect',
    content: '过去分词的形式一定不同于一般过去式，所以 have worked 是错误的。',
    expected: /相同|同形|一样/, retained: ['worked'], unchanged: false },
  { name: 'go-passive', target: 'go',
    content: 'go 的过去分词是 gone，所以表示去某地时，被动语态应使用 be gone。',
    expected: /不及物|不构成|不是|不能|不应[^。]*被动语态|并不[^。]*被动语态/, retained: ['gone'], unchanged: false },
  { name: 'ask-object', target: 'ask sb to do sth',
    content: '在 ask sb to do sth 中，sb 是间接宾语。',
    expected: /直接宾语|宾语|补足语/, retained: ['sb'], unchanged: false },
  { name: 'paragraph-preservation', target: 'I had planned to walk home. However, it started to rain, so I took a taxi instead.',
    content: '第一句 I had planned to walk home 交代原计划步行。第二句 it started to rain 交代下雨，I took a taxi 交代结果；so 连接原因与结果，instead 指乘车代替步行。However 是并列连词。',
    expected: /副词/, retained: ['walk home', 'started to rain', 'took a taxi', 'instead'], unchanged: false }
]
const complexRun = process.env.REVIEW_THINKING_COMPLEX_LIVE === '1'
const sampleNames = complexRun ? complexSamples.map(sample => sample.name) : ['actual-draft', 'correct-rule', 'incorrect-rule']
const cases = sampleNames.flatMap((name, index) =>
  (process.env.REVIEW_THINKING_PRODUCTION_LIVE === '1' ? ['production']
    : index % 2 === 0 ? ['low', 'off'] : ['off', 'low']).map(mode => ({ name, mode })))

it.skipIf(process.env.REVIEW_THINKING_COMPARISON_LIVE !== '1').each(cases)('$name / $mode', async sample => {
  const settings = JSON.parse(await readFile(process.env.COVERAGE_REGRESSION_SETTINGS_PATH!, 'utf8')) as {
    modelProvider: ModelProvider; apiKeys: Record<string, string>; models: Record<string, string>
  }
  expect(settings.modelProvider).toBe('deepseek')
  let classification = baseClassification
  let sourceQuestion = '讲解现在完成时的结构。'
  let draft: KnowledgeCard = { cardType: 'grammar_concept', targetText: 'present perfect',
    targets: ['present perfect'], answer: '下面说明现在完成时。', sections: [{ module: 'grammar', content:
      sample.name === 'incorrect-rule'
        ? '只要前面是 have/has，后面的形式就是过去分词。worked 与过去式可以同形。'
        : '在现在完成时结构中，助动词 have/has 后接过去分词。worked 与过去式可以同形。' }] }
  if (sample.name === 'actual-draft') {
    const fixture = JSON.parse(await readFile(process.env.REVIEW_THINKING_SAMPLE_PATH!, 'utf8'))
    draft = fixture.outcome.card
    classification = fixture.outcome.classification
    sourceQuestion = fixture.question
  }
  const complexSample = complexSamples.find(fixture => fixture.name === sample.name)
  if (complexSample) {
    const paragraph = complexSample.name === 'paragraph-preservation'
    const pattern = complexSample.name === 'ask-object'
    const word = complexSample.name === 'go-passive'
    classification = { ...baseClassification, targetText: complexSample.target, targets: [complexSample.target],
      inputType: paragraph ? 'paragraph' : pattern ? 'pattern' : word ? 'word' : 'grammar_concept',
      structureType: paragraph ? 'long_text' : pattern ? 'pattern' : word ? 'single_word' : 'abstract_concept',
      modules: [paragraph ? 'sentence_structure' : 'grammar'] }
    draft = { cardType: paragraph ? 'paragraph' : pattern ? 'pattern' : word ? 'word' : 'grammar_concept',
      targetText: complexSample.target, targets: [complexSample.target], answer: '下面说明相关语法。',
      sections: [{ module: classification.modules[0], content: complexSample.content }] }
    sourceQuestion = paragraph ? '分析这段话的逻辑和结构。' : `解释 ${complexSample.target} 的相关语法。`
  }
  const nativeFetch = globalThis.fetch
  const requests: unknown[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const body = JSON.parse(init!.body as string)
    if (sample.mode === 'off') {
      delete body.reasoning_effort
      body.thinking = { type: 'disabled' }
    } else if (sample.mode === 'low') {
      body.reasoning_effort = 'low'
      body.thinking = { type: 'enabled' }
    } else {
      expect(body.reasoning_effort).toBe('none')
    }
    const start = performance.now()
    const record: Record<string, unknown> = { thinking: body.thinking, reasoningEffort: body.reasoning_effort }
    requests.push(record)
    try {
      const response = await nativeFetch(input, { ...init, body: JSON.stringify(body) })
      record.status = response.status
      record.headersMs = Math.round(performance.now() - start)
      const result = await response.clone().json()
      record.usage = result.usage
      return response
    } catch (error) {
      record.errorName = error instanceof Error ? error.name : 'unknown'
      throw error
    } finally { record.elapsedMs = Math.round(performance.now() - start) }
  })
  const started = performance.now()
  let reviewed: KnowledgeCard | undefined
  let failure: string | undefined
  try {
    reviewed = await reviewGrammar(draft, classification, {
      apiKey: settings.apiKeys.deepseek, modelName: settings.models.deepseek, modelProvider: 'deepseek',
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS - 5_000),
      prompt: JSON.stringify({ sourceQuestion, router: classification, settings: { answerLanguage: 'zh' } })
    })
    if (complexSample) {
      if (complexSample.unchanged) expect(reviewed).toEqual(draft)
      else expect(reviewed.sections[0].content).not.toBe(complexSample.content)
      expect(reviewed.sections[0].content).toMatch(complexSample.expected)
      for (const fragment of complexSample.retained) expect(reviewed.sections[0].content).toContain(fragment)
      expect(reviewed.targets).toEqual(draft.targets)
      expect(reviewed.sections.map(section => section.module)).toEqual(classification.modules)
    } else if (sample.name === 'incorrect-rule') {
      const content = reviewed.sections[0].content
      expect(content).toMatch(/助动词|完成时结构/)
      expect(content).toContain('worked')
      expect(content).not.toContain('只要前面是 have/has，后面的形式就是过去分词。')
    } else if (sample.name === 'correct-rule') {
      expect(reviewed).toEqual(draft)
    } else {
      // The real generated draft is not a gold-standard answer: valid corrections are allowed.
      expect(reviewed.cardType).toBe(draft.cardType)
      expect(reviewed.targets).toEqual(draft.targets)
      expect(reviewed.sections.map(section => section.module)).toEqual(draft.sections.map(section => section.module))
      expect(reviewed.sections.find(section => section.module === 'examples'))
        .toEqual(draft.sections.find(section => section.module === 'examples'))
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unknown'
    throw error
  } finally {
    spy.mockRestore()
    await writeFile(`${process.env.REVIEW_THINKING_OUTPUT_PREFIX}-${sample.name}-${sample.mode}.json`,
      JSON.stringify({ ...sample, model: settings.models.deepseek, elapsedMs: Math.round(performance.now() - started),
        requests, draft, reviewed, failure }, null, 2))
  }
}, TEST_TIMEOUT_MS)
