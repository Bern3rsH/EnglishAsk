import { expect, it } from 'vitest'
import { normalizeOllamaBaseUrl } from './ollama-url'

it('defaults legacy settings to loopback and normalizes HTTP/HTTPS origins', () => {
  expect(normalizeOllamaBaseUrl()).toBe('http://127.0.0.1:11434')
  expect(normalizeOllamaBaseUrl(' https://OLLAMA.example.com/ ')).toBe('https://ollama.example.com')
  expect(normalizeOllamaBaseUrl('http://[::1]:11435')).toBe('http://[::1]:11435')
})

it.each(['', 'localhost:11434', 'ftp://localhost', 'http://user:secret@localhost',
  'http://localhost/api/chat', 'http://localhost?token=secret', 'http://localhost#section',
  'http://localhost?', 'http://local\nhost', null, 42, 'a'.repeat(2049)])(
  'rejects invalid or credential-bearing addresses without echoing input %j', value => {
    expect(() => normalizeOllamaBaseUrl(value)).toThrow('Ollama 服务地址')
    expect(() => normalizeOllamaBaseUrl(value)).not.toThrow('secret')
  })
