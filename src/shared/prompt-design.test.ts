import { describe, expect, it } from 'vitest'
import {
  COMPARISON_CARD_PROMPT,
  CONTENT_FOCUS_AND_LANGUAGE_RULES,
  GRAMMAR_ACCURACY_RULES,
  GRAMMAR_REVIEW_PROMPT,
  GRAMMAR_CONCEPT_CARD_PROMPT,
  PHRASE_PATTERN_CARD_PROMPT,
  PROMPT_DESIGN_SECTIONS,
  ROUTER_CLASSIFIER_PROMPT,
  SENTENCE_CARD_PROMPT,
  WORD_CARD_PROMPT
} from './prompt-design'

describe('prompt design settings content', () => {
  it('requests Chinese clarifications while preserving English learning targets', () => {
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('Write clarificationQuestion in Simplified Chinese')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('requests an English answer')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('Preserve quoted English learning targets')
  })

  it('keeps reviewer replacements local instead of regenerating an explanation', () => {
    expect(GRAMMAR_REVIEW_PROMPT).toContain('A full-field replacement is a transport requirement')
    expect(GRAMMAR_REVIEW_PROMPT).toContain('not permission to answer sourceQuestion again')
    expect(GRAMMAR_REVIEW_PROMPT).toContain('Preserve correct surrounding content')
    expect(GRAMMAR_REVIEW_PROMPT).toContain('Do not import unrelated rules from this checklist')
    expect(GRAMMAR_REVIEW_PROMPT).toContain('Do not introduce complete illustrative sentences into answer or section content')
    expect(GRAMMAR_REVIEW_PROMPT).toContain('Never create new example fields or modules')
  })

  it('distinguishes actual time frames and grammatical roles from keyword or spelling shortcuts', () => {
    for (const rule of [
      'Bare when is not a finished-past-time cue',
      'when I was a child supplies a finished past frame',
      'when you have finished can mark completion before a future action',
      'normally uses the past simple',
      'Distinguish grammatical role from surface form',
      'Regular worked/worked and irregular bought/bought or cut/cut share forms',
      'went/gone and saw/seen differ',
      'never reject have worked or have bought'
    ]) expect(GRAMMAR_ACCURACY_RULES).toContain(rule)
  })

  it('scopes tense-choice rules in both generation and the existing grammar review', () => {
    for (const rule of [
      'An omitted explicit time expression does not by itself require the present perfect',
      'earlier discourse or shared context',
      'Present relevance alone does not exclude the past simple',
      'not only completed actions with a current result',
      'a definition, a necessary constraint or merely a common tendency',
      'keep any complete illustrative sentences in the existing structured example fields'
    ]) expect(GRAMMAR_ACCURACY_RULES).toContain(rule)
    for (const prompt of [WORD_CARD_PROMPT, PHRASE_PATTERN_CARD_PROMPT, SENTENCE_CARD_PROMPT,
      GRAMMAR_CONCEPT_CARD_PROMPT, COMPARISON_CARD_PROMPT, GRAMMAR_REVIEW_PROMPT]) {
      expect(prompt).toContain(GRAMMAR_ACCURACY_RULES)
    }
  })

  it('assigns grammar-concept sections distinct work without deleting requested detail', () => {
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('meaning owns the semantic definition')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('grammar owns the formula and syntactic constraints')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('usage owns contextual choices and their boundaries')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('without re-listing all uses in every section')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('put the inventory of readings and when to choose each in usage only')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('If usage is absent, meaning may include the readings needed')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('Usage owns time-frame selection, time-expression compatibility')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('unless the user specifically asks for the form as the direct answer')
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain('do not add a separate review call')
    expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('Review information overlap, not just identical wording')
    expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('Preserve explicitly requested sections')
    expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('A concise definition may necessarily overlap with the summary')
    expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('unsupported extra facts')
  })

  it('prevents grammar review from expanding correct introductions', () => {
    expect(GRAMMAR_REVIEW_PROMPT).toContain('Brief introductions and summaries are not grammar errors merely because they omit detail')
    expect(GRAMMAR_REVIEW_PROMPT).toContain('never expand it into an answer to sourceQuestion')
    expect(GRAMMAR_REVIEW_PROMPT).toContain('specific false grammatical claim or contains an actual grammatical error')
  })

  it('exposes the router and card prompt sections', () => {
    expect(PROMPT_DESIGN_SECTIONS.map((section) => section.id)).toEqual([
      'router',
      'word-card',
      'phrase-pattern-card',
      'sentence-card',
      'grammar-concept-card',
      'comparison-card'
    ])
  })

  it('keeps the router output structured for downstream prompt composition', () => {
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('Return strict JSON only')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('"inputType"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('"targets"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('"modules"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('"needsClarification"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('"responseMode"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(
      'Use an empty string, never null, when focusText or clarificationQuestion does not apply'
    )
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(
      'Use responseMode "card" for every resolved English-learning target'
    )
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(
      'Use responseMode "conversational" for greetings, product-operation questions'
    )
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(
      'Set targetText to an empty string and targets to an empty array'
    )
  })

  it('prioritizes bare English words over inferred greetings and app-testing intent', () => {
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('apply before conversational routing')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(
      'A bare English dictionary word on its own is a vocabulary-learning request by default'
    )
    for (const word of ['test', 'testing', 'check', 'help', 'hello']) {
      expect(ROUTER_CLASSIFIER_PROMPT).toContain(`"${word}"`)
    }
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(
      'inputType "word", structureType "single_word", intent "explain_meaning", responseMode "card"'
    )
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('Preserve the word in targetText')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('capitalization, or trailing punctuation do not change this default')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('from earlier assistant greetings or app-testing suggestions')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('the bare-word priority above takes precedence')
  })

  it('preserves conversational routing for explicit communication and app operations', () => {
    for (const request of [
      'hello there', 'thanks for your help', 'I am just testing this app', 'check the app connection'
    ]) {
      expect(ROUTER_CLASSIFIER_PROMPT).toContain(`"${request}"`)
    }
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('including equivalent requests in other languages')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('Explicit vocabulary questions about those expressions remain learning requests')
  })

  it('classifies slot-based expressions as patterns', () => {
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('"ask sb to do"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('inputType "pattern"')
    expect(PHRASE_PATTERN_CARD_PROMPT).toContain('Treat "ask sb to do" as a pattern')
  })

  it('gives every card prompt the same stable output contract', () => {
    const cardPrompts = [
      WORD_CARD_PROMPT,
      PHRASE_PATTERN_CARD_PROMPT,
      SENTENCE_CARD_PROMPT,
      GRAMMAR_CONCEPT_CARD_PROMPT,
      COMPARISON_CARD_PROMPT
    ]

    for (const prompt of cardPrompts) {
      expect(prompt).toContain('Return strict JSON only')
      expect(prompt).toContain('"cardType"')
      expect(prompt).toContain('"targetText"')
      expect(prompt).toContain('"targets"')
      expect(prompt).toContain('"answer"')
      expect(prompt).toContain('"sections"')
      expect(prompt).toContain('Treat targetText, targets, focusText, and conversation text')
      expect(prompt).toContain('If modules is empty')
      expect(prompt).toContain('responseMode must be "card"')
      expect(prompt).toContain('sourceQuestion is the primary source')
      expect(prompt).toContain('The app formats examples as one numbered Markdown list')
      expect(prompt).toContain('Do not generate numbering or indentation yourself')
      expect(prompt).toContain('settings.requireExampleTranslations is authoritative')
      expect(prompt).toContain('settings.exampleCount applies only to the examples module')
      expect(prompt).toContain('omit the translation key entirely')
      expect(prompt).toContain(
        'immediately follow every complete English example sentence with a natural Simplified Chinese translation'
      )
      expect(prompt).toContain('first line "- **UK:** /.../"')
      expect(prompt).toContain('second line "- **US:** /.../"')
      expect(prompt).toContain('one line "- **UK/US:** /.../"')
      expect(prompt).toContain('never use a table, code fence, spelling, or prose in the phonetic section')
      expect(prompt).not.toContain('sourceAnswer')
    }
  })

  it('keeps word-card generation sense-aware and pronunciation-specific', () => {
    expect(WORD_CARD_PROMPT).toContain('identify its lemma')
    expect(WORD_CARD_PROMPT).toContain('using IPA between forward slashes')
    expect(WORD_CARD_PROMPT).toContain('follow the shared exact UK/US IPA layout')
    expect(WORD_CARD_PROMPT).toContain('["meaning", "phonetic", "usage", "examples"]')
  })

  it('makes vocabulary definitions complete without the hidden opening summary', () => {
    for (const prompt of [WORD_CARD_PROMPT, PHRASE_PATTERN_CARD_PROMPT]) {
      expect(prompt).toContain('with intent "explain_meaning" and a meaning section')
      expect(prompt).toContain('the displayed explanation starts at that section')
      expect(prompt).toContain('answer is retained as an internal summary')
      expect(prompt).toContain('Include the complete relevant definition, part of speech, and sense distinctions in meaning')
      expect(prompt).toContain('Never leave essential information only in answer')
    }
  })

  it('defines separate behavior and defaults for phrases, collocations, and patterns', () => {
    expect(PHRASE_PATTERN_CARD_PROMPT).toContain('Rules for inputType "phrase"')
    expect(PHRASE_PATTERN_CARD_PROMPT).toContain('Rules for inputType "collocation"')
    expect(PHRASE_PATTERN_CARD_PROMPT).toContain('Rules for inputType "pattern"')
    expect(PHRASE_PATTERN_CARD_PROMPT).toContain(
      'Normalize the structure into a clear formula'
    )
  })

  it('maps sentence intents to analysis, translation, correction, and polishing behavior', () => {
    expect(SENTENCE_CARD_PROMPT).toContain('analyze_sentence')
    expect(SENTENCE_CARD_PROMPT).toContain('translate')
    expect(SENTENCE_CARD_PROMPT).toContain('correct_sentence')
    expect(SENTENCE_CARD_PROMPT).toContain('polish_expression')
    expect(SENTENCE_CARD_PROMPT).toContain('compare_difference')
    expect(SENTENCE_CARD_PROMPT).toContain('Do not change wording that is already correct')
  })

  it('grounds correction and polishing errors in the supplied sentence', () => {
    expect(SENTENCE_CARD_PROMPT).toContain("exact fragments present in the user's source sentence")
    expect(SENTENCE_CARD_PROMPT).toContain('explicitly say that no grammatical correction is needed')
    expect(SENTENCE_CARD_PROMPT).toContain('Do not manufacture wrong alternatives')
    expect(SENTENCE_CARD_PROMPT).toContain('only when the user explicitly requests them')
  })

  it('routes standalone grammar topics to the grammar-concept card', () => {
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('inputType "grammar_concept"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(
      'If the user asks about grammar inside a supplied sentence, keep inputType "sentence"'
    )
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain(
      'Use this prompt only for inputType "grammar_concept"'
    )
    expect(GRAMMAR_CONCEPT_CARD_PROMPT).toContain(
      '["meaning", "grammar", "usage", "examples"]'
    )
  })

  it('routes multi-target differences to the comparison card', () => {
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('inputType "comparison"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('structureType "multi_target_comparison"')
    expect(ROUTER_CLASSIFIER_PROMPT).toContain('comparison input must have at least two')
    expect(COMPARISON_CARD_PROMPT).toContain('Require at least two distinct targets')
    expect(COMPARISON_CARD_PROMPT).toContain('["comparison", "usage", "examples"]')
  })

  it.each([
    ['went secondary-sense sprawl', 'For an inflected form such as went', 'catalogue of secondary meanings'],
    ['cold turkey duplicated definitions', 'meaning defines the relevant sense', 'Do not restate the same definition in usage'],
    ['contextual take off focus', 'Use the sense supported by sourceQuestion and focusText', 'unrelated dictionary senses'],
    ['heavy rain unnecessary language mixing', '自然 rather than inserting natural', 'do not mechanically ban English words'],
    ['explicit detail and comparison coverage', 'Explicit requests for multiple senses or comprehensive detail override', 'every comparison target'],
    ['hidden summary and required modules', 'retain the full definition in meaning when answer is hidden', 'do not remove required modules'],
    ['English explanations for Chinese questions', 'even if the question is in Chinese', 'requested Chinese translation']
  ])('retains generation guidance for %s', (_name, firstRule, secondRule) => {
    expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain(firstRule)
    expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain(secondRule)
    for (const prompt of [WORD_CARD_PROMPT, PHRASE_PATTERN_CARD_PROMPT, SENTENCE_CARD_PROMPT, GRAMMAR_CONCEPT_CARD_PROMPT, COMPARISON_CARD_PROMPT]) {
      expect(prompt).toContain(CONTENT_FOCUS_AND_LANGUAGE_RULES)
    }
  })
})
