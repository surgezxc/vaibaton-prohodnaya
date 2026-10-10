import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { decodeQr } from '../src/lib/qr-reader.ts';
import { parseAttempt } from '../src/lib/phone-proof.ts';

test('распознаёт QR из кадра и передаёт ту же попытку, пустой кадр не считается QR', () => {
  const origin = 'https://gate.example';
  const id = '00000000-0000-4000-8000-000000000001';
  const nonce = 'abcdefghijklmnopqrstuvwx01234567';
  const text = `${origin}/phone#attempt=${id}&nonce=${nonce}`;
  const code = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const width = (code.modules.size + 8) * 5;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / 5) - 4, col = Math.floor(x / 5) - 4;
    const dark = row >= 0 && col >= 0 && row < code.modules.size && col < code.modules.size && code.modules.get(row, col);
    if (dark) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  assert.equal(decodeQr(data, width, width), text);
  assert.deepEqual(parseAttempt(decodeQr(data, width, width), origin), { attempt_id: id, nonce });
  assert.equal(decodeQr(new Uint8ClampedArray(width * width * 4).fill(255), width, width), null);
});
