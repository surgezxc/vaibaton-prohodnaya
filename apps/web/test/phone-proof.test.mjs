import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { generateProof, signNonce, parseAttempt } from '../src/lib/phone-proof.ts';

const origin = 'https://gate.example';
const id = '00000000-0000-4000-8000-000000000001';
const nonce = 'abcdefghijklmnopqrstuvwx01234567';

test('WebCrypto-подпись совместима с проверкой nonce backend', async () => {
  const proof = await generateProof();
  const signature = Buffer.from(await signNonce(proof.privateKey, nonce), 'base64url');
  const key = createPublicKey({ key: Buffer.from(proof.publicKey, 'base64'), format: 'der', type: 'spki' });
  assert.equal(verify('sha256', Buffer.from(nonce), { key, dsaEncoding: 'ieee-p1363' }, signature), true);
  assert.equal(verify('sha256', Buffer.from(nonce + 'old'), { key, dsaEncoding: 'ieee-p1363' }, signature), false);
  const other = await generateProof();
  const otherKey = createPublicKey({ key: Buffer.from(other.publicKey, 'base64'), format: 'der', type: 'spki' });
  assert.equal(verify('sha256', Buffer.from(nonce), { key: otherKey, dsaEncoding: 'ieee-p1363' }, signature), false);
});

test('приватный ключ не экспортируется через WebCrypto и сохраняет свойства при клонировании', async () => {
  const proof = await generateProof();
  assert.equal(proof.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('jwk', proof.privateKey));
  const cloned = structuredClone(proof.privateKey);
  assert.equal(cloned.extractable, false);
  const signature = await signNonce(cloned, nonce);
  assert.ok(signature.length > 0);
});

test('ссылка QR читается только с origin приложения и валидными полями', () => {
  assert.deepEqual(parseAttempt(`${origin}/phone#attempt=${id}&nonce=${nonce}`, origin), { attempt_id: id, nonce });
  for (const link of [
    `https://foreign.example/phone#attempt=${id}&nonce=${nonce}`,
    `${origin}/gate#attempt=${id}&nonce=${nonce}`,
    `${origin}/phone#attempt=wrong&nonce=${nonce}`,
    `${origin}/phone#attempt=${id}&nonce=short`,
    'javascript:alert(1)',
  ]) assert.throws(() => parseAttempt(link, origin));
});
