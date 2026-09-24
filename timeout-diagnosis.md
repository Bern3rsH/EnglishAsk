# 2026-09-23: Present continuous timeout diagnosis

The app displayed `[timeout] Grammar review exceeded its 45-second time limit` for the latest `现在进行时` request. Its original terminal output was unavailable; the following are independent reproductions with the same question and configured deepseek-v4-flash model, not the original request trace.

## Reproduction 1

- Router completed in 8.647s, including 1,729 reasoning tokens.
- Generation received HTTP 200 headers in 173ms, but the complete response did not arrive. At 66.181s it failed with TypeError terminated / UND_ERR_SOCKET / other side closed.
- No retry or review request occurred. Total: 74.834s.
- This shows a response-body transport interruption, but does not identify whether the upstream service or an intermediary closed the connection.

## Reproduction 2

| Stage | Time | Reasoning tokens | HTTP attempts |
| --- | ---: | ---: | ---: |
| Router | 1.494s | 144 | 1 |
| Generation | 15.960s | 2,603 | 1 |
| Grammar review | 42.760s | 8,769 | 1 |

Total: 60.222s. Review received HTTP 200 headers in 146ms and completed without corrections. Actual outgoing review JSON contained reasoning_effort=low; the setting was not dropped by the SDK. Review completion_tokens=8,777, of which 8,769 were reasoning tokens. No 429/5xx response or retry occurred in this run.

## Interpretation and limits

The confirmed review latency contributor is extensive reasoning despite low effort: 42.76s leaves only about 2.24s before the app's fixed review deadline. This plausibly explains the original timeout, but its original trace is still needed for attribution. The first reproduction also demonstrated an independent response-body connection failure. Neither result proves a provider outage or a local proxy fault.

DeepSeek documents thinking enabled with high effort by default and keep-alive responses before inference finishes. Router/generation requests omit reasoning_effort; review explicitly sends low. HTTP 200 alone therefore does not establish a completed model response.

- https://api-docs.deepseek.com/guides/thinking_mode/
- https://api-docs.deepseek.com/quick_start/rate_limit/

Evidence: /tmp/englishask-timeout-0923.json and /tmp/englishask-timeout-0923-repeat.json; executable opt-in test: src/main/timeout-diagnostic-live.test.ts. The test reads a response clone before returning the original non-streaming response, so it is diagnostic instrumentation, not a byte-for-byte timing replay of the app. No application timeout/model settings or conversation history were changed.

## Paired review thinking comparison

Ran two rounds on three identical input pairs, keeping the 45s production review limit and the same review prompt. Low explicitly used thinking enabled plus reasoning_effort=low; off used thinking disabled without reasoning_effort. Only the diagnostic test rewrote outgoing parameters; application settings were unchanged.

| Fixture | Low, rounds 1 / 2 | Off, rounds 1 / 2 |
| --- | --- | --- |
| Actual present-continuous draft | 30.044s / 3.020s | 0.547s / 0.608s |
| Correct scoped auxiliary-have rule | 3.583s / 3.999s | 0.576s / 0.547s |
| Incorrect unscoped have rule | 6.586s / 5.702s | 1.317s / 0.919s |

All 12 HTTP review calls succeeded without retries/timeouts. Both modes preserved the known-correct rule and corrected the deliberately unscoped rule in both rounds. Low reasoning tokens were 6140/561 for the full draft, 728/754 for the correct rule and 1336/1131 for the incorrect rule. Off responses did not report reasoning tokens; actual thinking=disabled was verified on the outgoing requests.

Important quality limitation: the actual draft is not gold-standard correct. In round 1 low added qualifiers to the meaning and consonant-doubling rules; off made no changes. In round 2 neither changed it. This is evidence of review variability, not proof that either mode is universally accurate. The initial test wrongly required the real draft to remain identical and reported one assertion failure; it was corrected to preserve structure/examples while allowing reviewed prose to change. The known-correct fixture still requires exact equality. Round 2 passed all six checks.

These are small sequential samples with differing server cache states, not a controlled latency percentile benchmark. They support a substantial speed advantage for disabled thinking on these inputs, but do not establish equivalent detection of complex errors. No runtime switch was made. Results: /tmp/englishask-thinking-compare-*.json and /tmp/englishask-thinking-repeat-*.json. Opt-in test: src/main/review-thinking-comparison-live.test.ts.

## Complex grammar follow-up

Six paired fixtures ran through the real review path with the same 45s limit. All 12 model calls completed. Initial automated checks passed 10/12: both go-passive outputs correctly rejected the passive claim, but the assertion omitted their negative wording. Expanded only that negative-expression assertion and reran both go-passive modes: 2/2 passed. Inspected all saved corrections, not just pattern matches.

| Fixture | Low | Off | Observed result |
| --- | ---: | ---: | --- |
| Overgeneralized when tense restriction | 3.396s | 1.307s | Both scoped the time-frame rule and retained future completion |
| Correct when boundary | 4.297s | 0.651s | Both preserved the original exactly |
| Incorrect participle-form claim | 4.619s | 1.647s | Both accepted worked and explained shared forms |
| go passive claim | 4.199s | 1.266s | Both distinguished ordinary movement, perfect and state |
| ask sb to do object role | 3.710s | 1.048s | Both rejected the indirect-object label for this pattern |
| Paragraph correction/preservation | 3.549s | 1.199s | Both corrected However and retained walk/rain/taxi/instead context |

The first-pass means were 3.962s low and 1.186s off (about 70% shorter for off on this sample). The go-passive recheck took 3.036s low and 1.798s off; these extra calls are not mixed into the balanced first-pass mean. No timeouts occurred. No checked semantic omission, unnecessary rewrite of the known-correct fixture, or paragraph-coverage loss was observed in off mode.

This supports trying disabled thinking for review alone, but is not a claim of equal accuracy on every complex grammar topic. Generation behavior and application settings remain unchanged. Source tests: 745 passed; frontend typecheck passed. Full npm test still has the previously observed unrelated Node-test/Vitest discovery issue in scripts/jev-gateway.test.mjs.

Evidence: /tmp/englishask-thinking-complex-*.json, /tmp/englishask-thinking-complex-recheck-*.json and corresponding logs. Reproduce with REVIEW_THINKING_COMPARISON_LIVE=1 and REVIEW_THINKING_COMPLEX_LIVE=1, the settings path, and an output prefix.

## Production change

At user approval, changed direct deepseek-v4-flash/pro grammar-review requests to SDK reasoningEffort=none, serialized as reasoning_effort=none. DeepSeek documents this as disabling thinking. Real-SDK wire tests verify the outgoing parameter and unchanged generation/routing/legacy-model behavior; other providers remain unchanged.

The first production-path test caught one unnecessary expansion of a correct introduction (five other cases passed). Added a review instruction explicitly preserving neutral introductions and rejecting completeness-only rewrites. All six production-path cases then passed, with durations 1.068s, 0.586s, 1.211s, 1.057s, 0.770s and 1.024s. Production-mode tests assert the actual adapter parameter rather than forcing the experimental override. Evidence: /tmp/englishask-review-production-final-*.json.

The 45s timeout, validation, draft reuse and main answer-generation strategy are unchanged. This optimizes review latency, not a guarantee on total answer latency or universal semantic correctness. No existing Asks or Notes were modified.
