import assert from 'node:assert/strict'
import test from 'node:test'
import { ENDPOINT, tryJev } from './jev-gateway.mjs'

const validResponse = {
  model: 'typesafe-ai/jev',
  answers: { translation: { type: 'boolean', probability: 0.99 } }
}

test('missing credentials fail before sending a request', async () => {
  await assert.rejects(tryJev({ fetchImpl: () => assert.fail('must not send') }), /AI_GATEWAY_API_KEY/)
})

test('uses Gateway evaluation contract and extracts the probability', async () => {
  const result = await tryJev({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      assert.equal(url, ENDPOINT)
      assert.equal(options.headers.Authorization, 'Bearer test-key')
      assert.equal(options.method, 'POST')
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'typesafe-ai/jev')
      assert.equal(body.questions.translation.type, 'boolean')
      return Response.json(validResponse)
    }
  })
  assert.equal(result.translationProbability, 0.99)
  assert.ok(result.elapsedMs >= 0)
})

for (const status of [401, 402, 403, 429, 500]) {
  test(`HTTP ${status} fails without exposing the response body`, async () => {
    await assert.rejects(tryJev({
      apiKey: 'test-key',
      fetchImpl: async () => new Response('secret-echo', { status })
    }), error => error.message.includes(String(status)) && !error.message.includes('secret-echo'))
  })
}

for (const probability of [-1, 1.1, '0.9', null]) {
  test(`rejects invalid probability ${JSON.stringify(probability)}`, async () => {
    await assert.rejects(tryJev({
      apiKey: 'test-key',
      fetchImpl: async () => Response.json({
        ...validResponse, answers: { translation: { type: 'boolean', probability } }
      })
    }), /格式无效/)
  })
}

test('rejects missing answers and non-JSON success responses', async () => {
  for (const response of [Response.json({}), new Response('<html>error</html>')]) {
    await assert.rejects(tryJev({ apiKey: 'test-key', fetchImpl: async () => response }))
  }
})

test('reports timeouts and network failures without echoing secrets', async () => {
  for (const [error, expected] of [
    [new DOMException('secret-echo', 'TimeoutError'), /超时/],
    [new Error('secret-echo'), /检查网络/]
  ]) {
    await assert.rejects(tryJev({
      apiKey: 'test-key', fetchImpl: async () => { throw error }
    }), failure => expected.test(failure.message) && !failure.message.includes('secret-echo'))
  }
})
