import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../src/lib/pass-api.ts';

test('API передаёт JWT и поля запроса, сохраняя серверный отказ с HTTP 200', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/attempts/example/scan'));
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options.body), { nonce: 'nonce', signature: 'signature' });
    return new Response(JSON.stringify({ confirmed: false, reason_human: 'Чужое устройство.' }), { status: 200 });
  };
  try {
    const result = await apiRequest('/attempts/example/scan', 'test-token', { nonce: 'nonce', signature: 'signature' });
    assert.equal(result.confirmed, false);
  } finally { globalThis.fetch = original; }
});

test('неуспешный HTTP возвращает русскую причину сервера', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ reason_human: 'Нужен вход через Keycloak.' }), { status: 401 });
  try { await assert.rejects(apiRequest('/devices', 'test-token', {}), /Нужен вход через Keycloak/); }
  finally { globalThis.fetch = original; }
});

test('невалидный ответ не становится успехом', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>ошибка</html>', { status: 200 });
  try { await assert.rejects(apiRequest('/devices', 'test-token', {}), /некорректный ответ/); }
  finally { globalThis.fetch = original; }
});
