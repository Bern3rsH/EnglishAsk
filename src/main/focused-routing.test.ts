import { expect, it } from 'vitest'
import { COMPARISON_CARD_PROMPT, CONTENT_FOCUS_AND_LANGUAGE_RULES, ROUTER_CLASSIFIER_PROMPT } from '../shared/prompt-design'
import { getSelectedCardModules } from '../shared/card-modules'
import type { RouterModule } from '../shared/router'
import { parseRouterClassification } from './router-classifier'

it('instructs Router to separate analytical dimensions without banning grammar concepts', () => {
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('Separate learning objects from analytical dimensions')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('targets ["went", "go", "gone"]')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('Keep that requirement in focusText')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('Grammar concepts remain valid targets')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('Select the smallest set that fully covers the request')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('If the user explicitly requests separate sections, preserve them')
})

it('assigns detailed rules to one section without silently deleting required sections', () => {
  expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('one owning module')
  expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('grammar covers other constraints')
  expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('do not remove required modules')
})

it('limits same-lemma sections without narrowing all comparison defaults', () => {
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('see/saw/seen')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('select ["comparison", "examples"]')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('takes precedence over the general comparison defaults')
  expect(ROUTER_CLASSIFIER_PROMPT).toContain('Do not remove usage from all comparisons')
  expect(COMPARISON_CARD_PROMPT).toContain('When usage is not selected, cover all requested selection conditions in comparison')
  expect(getSelectedCardModules({ inputType: 'comparison', modules: [] }))
    .toEqual(['comparison', 'usage', 'examples'])
})

it.each([
  { modules: ['comparison', 'examples'] },
  { modules: ['comparison', 'usage', 'examples'] }
])('preserves conditional or explicitly selected modules: $modules', ({ modules }) => {
  expect(getSelectedCardModules({ inputType: 'comparison', modules: modules as RouterModule[] })).toEqual(modules)
})

// Parser preservation checks, not evidence of live model compliance.
it.each([
  ['went', 'go', 'gone'],
  ['主动语态', '被动语态'],
  ['go 的被动语态', 'send 的被动语态']
])('preserves legitimately selected targets: %j', (...targets) => {
  const route = { inputType: 'comparison', structureType: 'multi_target_comparison',
    targetText: targets.join(' vs '), targets, focusText: 'requested grammar distinction',
    intent: 'compare_difference', modules: ['comparison', 'grammar', 'tense', 'voice', 'examples'],
    confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card' }
  expect(parseRouterClassification(JSON.stringify(route))).toEqual(route)
})
