import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { createPublicKey, verify } from 'node:crypto';
import QRCode from 'qrcode';

const id = '00000000-0000-4000-8000-000000000001';
const shiftId = '00000000-0000-4000-8000-000000000002';
const nonce = 'abcdefghijklmnopqrstuvwx01234567';
const origin = 'http://127.0.0.1:3123';
const qr = `${origin}/phone#attempt=${id}&nonce=${nonce}`;
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' } });

type State = { confirmed: boolean; decided: boolean; decision: 'allow' | 'deny'; open: boolean; publicKey: string | null; locations: Record<string, unknown>[]; cancels: number; scans: number; geoCalls: number; pendingGeo: boolean };
async function setup(context: BrowserContext, role: 'worker' | 'gate', state: State) {
  let authNonce = '';
  function jwt() {
    const payload = { sub: `${role}-test`, preferred_username: role, realm_access: { roles: [role] }, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, nonce: authNonce };
    return `${Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test`;
  }
  await context.route('http://127.0.0.1:8181/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/3p-cookies/')) return route.fulfill({ contentType: 'text/html', body: '<script>parent.postMessage("unsupported", "*")</script>' });
    if (url.pathname.endsWith('/auth')) {
      authNonce = url.searchParams.get('nonce') || '';
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', url.searchParams.get('state')!); callback.searchParams.set('code', 'test-code');
      return route.fulfill({ status: 302, headers: { location: callback.toString() } });
    }
    if (url.pathname.endsWith('/token')) return json(route, { access_token: jwt(), id_token: jwt(), refresh_token: jwt(), token_type: 'Bearer', expires_in: 3600 });
    return json(route, {});
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success: PositionCallback) => {
      const state = window as unknown as { geoCalls: number; geoSuccess: PositionCallback; pendingGeo?: boolean };
      state.geoCalls = (state.geoCalls || 0) + 1;
      state.geoSuccess = success;
      if (!state.pendingGeo) success({ coords: { latitude: 55.75, longitude: 37.61, accuracy: 25 }, timestamp: Date.now() } as GeolocationPosition);
    } } });
  });
  await context.route('http://127.0.0.1:8182/**', async route => {
    if (route.request().method() === 'OPTIONS') return json(route, {});
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = route.request().postDataJSON() || {};
    if (url.pathname === '/devices') {
      state.publicKey = body.public_key;
      return json(route, { device_id: 'device-test', reason_human: 'Телефон привязан.' }, 201);
    }
    if (url.pathname === '/me') return json(route, { person: { id: 'person-test', full_name: 'Тестовый рабочий' }, shift: state.open ? { shift_id: shiftId, started_at: new Date().toISOString() } : null });
    if (url.pathname === '/locations') {
      state.locations.push(body);
      if (!state.open) return json(route, { reason_human: 'Смена закрыта.' }, 422);
      return json(route, { location_id: 'location-test', shift_id: shiftId, recorded_at: new Date().toISOString(), reason_human: 'Точка записана.' }, 201);
    }
    if (url.pathname === '/attempts' && method === 'POST') {
      state.confirmed = false; state.decided = false;
      return json(route, { attempt_id: id, nonce, expires_at: new Date(Date.now() + 25000).toISOString(), direction: body.direction }, 201);
    }
    if (url.pathname.endsWith('/scan')) {
      state.scans++;
      const key = createPublicKey({ key: Buffer.from(state.publicKey!, 'base64'), type: 'spki', format: 'der' });
      const verified = verify('sha256', Buffer.from(nonce), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(body.signature, 'base64url'));
      expect(verified).toBe(true); expect(body.nonce).toBe(nonce); expect(body.person_id).toBeUndefined();
      state.confirmed = true;
      return json(route, { confirmed: true, reason_human: 'Телефон подтвердил попытку.' });
    }
    if (url.pathname.endsWith('/cancel')) { state.cancels++; return json(route, { reason_human: 'Код отменён.' }); }
    if (url.pathname.endsWith('/decide')) {
      expect(state.confirmed).toBe(true); expect(body.nonce).toBe(nonce); expect(body.image_base64).toMatch(/^data:image\/png;base64,/);
      state.decided = true;
      return json(route, { decision: state.decision, reason: state.decision === 'deny' ? 'Лицо не совпало с эталоном.' : 'Проход разрешён. Смена открыта.' });
    }
    if (url.pathname === `/attempts/${id}`) return json(route, { attempt_id: id, direction: 'in', expires_at: new Date(Date.now() + 25000).toISOString(), status: state.decided ? 'decided' : state.confirmed ? 'scanned' : 'pending', decision: state.decided ? state.decision : null, reason_human: state.decided ? 'Результат сервера.' : null });
    return json(route, { reason_human: 'Не найдено.' }, 404);
  });
}
function state(): State { return { confirmed: false, decided: false, decision: 'deny', open: false, publicKey: null, locations: [], cancels: 0, scans: 0, geoCalls: 0, pendingGeo: false }; }
async function login(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole('button', { name: 'Войти через Keycloak' }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
}

test('планшет ждёт подпись; загрузка кадра и отказ сервера; закрытие отменяет QR', async ({ context, page }) => {
  const s = state(); await setup(context, 'gate', s); await login(page, '/gate');
  await page.getByRole('button', { name: 'Открыть QR', exact: true }).click();
  await expect(page.getByAltText('Одноразовый QR для телефона рабочего')).toBeVisible();
  const file = page.locator('input[type=file]');
  await expect(file).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Отправить кадр на проверку' })).toBeDisabled();
  s.confirmed = true;
  await expect(file).toBeEnabled();
  await file.setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: await QRCode.toBuffer('frame') });
  await page.getByRole('button', { name: 'Отправить кадр на проверку' }).click();
  await expect(page.getByText('Проход не разрешён', { exact: true })).toBeVisible();
  await expect(page.getByText('Лицо не совпало с эталоном.')).toBeVisible();
  await page.screenshot({ path: 'test-results/gate-denied-test.png', fullPage: true });
  await page.getByRole('button', { name: 'Открыть новый QR' }).click();
  await page.getByRole('button', { name: 'Закрыть QR' }).click();
  await expect.poll(() => s.cancels).toBe(1);
});

test('скрытие вкладки не отменяет QR', async ({ context, page }) => {
  const s = state(); await setup(context, 'gate', s); await login(page, '/gate');
  await page.getByRole('button', { name: 'Открыть QR', exact: true }).click();
  await expect(page.getByAltText('Одноразовый QR для телефона рабочего')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByAltText('Одноразовый QR для телефона рабочего')).toBeVisible();
  expect(s.cancels).toBe(0);
  await page.getByRole('button', { name: 'Закрыть QR' }).click();
  await expect.poll(() => s.cancels).toBe(1);
});

test('телефон хранит ключ, подписывает QR; GPS только при смене, симуляция останавливает GPS и выход отключает зоны', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const s = state(); await setup(context, 'worker', s); await login(page, '/phone');
  await expect(page.getByText('Открытой смены нет', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { geoCalls?: number }).geoCalls || 0)).toBe(0);
  await page.getByRole('button', { name: 'Привязать этот телефон' }).click();
  await expect(page.getByText('Телефон привязан.', { exact: true })).toBeVisible();
  await page.locator('summary').click(); await page.locator('#qr-link').fill(qr);
  await page.getByRole('button', { name: 'Прочитать ссылку' }).click();
  await page.getByRole('button', { name: 'Подтвердить попытку' }).click();
  await expect.poll(() => s.scans).toBe(1);
  await expect(page.getByRole('button', { name: 'Подтвердить попытку' })).toBeDisabled();
  s.open = true; s.decided = true; s.decision = 'allow';
  await expect(page.getByText('Вы на объекте', { exact: true })).toBeVisible();
  await expect.poll(() => s.locations.length).toBe(1);
  expect(s.locations[0]).toEqual({ source: 'gps', shift_id: shiftId, lat: 55.75, lng: 37.61 });
  await page.getByRole('button', { name: 'Включить симуляцию' }).click();
  await page.getByRole('button', { name: 'Бетон', exact: true }).click();
  await expect.poll(() => s.locations.length).toBe(2);
  expect(s.locations[1]).toEqual({ source: 'button', shift_id: shiftId, zone_name: 'Бетон' });
  await page.screenshot({ path: 'test-results/phone-simulation-test.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  s.open = false;
  await page.getByRole('button', { name: 'Обновить смену / Повторить' }).click();
  await expect(page.getByText('Открытой смены нет', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Бетон', exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Войти через Keycloak' }).click();
  await expect(page.getByRole('button', { name: 'Повторить привязку этого телефона' })).toBeEnabled();
  expect(s.publicKey).not.toBeNull();
});

test('поздний ответ GPS после скрытия страницы не отправляется', async ({ context, page }) => {
  const s = state(); s.open = true; await setup(context, 'worker', s);
  await context.addInitScript(() => { (window as unknown as { pendingGeo: boolean }).pendingGeo = true; });
  await login(page, '/phone');
  await expect.poll(() => page.evaluate(() => (window as unknown as { geoCalls?: number }).geoCalls || 0)).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    (window as unknown as { geoSuccess: PositionCallback }).geoSuccess({ coords: { latitude: 55, longitude: 37, accuracy: 20 }, timestamp: Date.now() } as GeolocationPosition);
  });
  await page.getByText('Состояние смены неизвестно', { exact: true }).waitFor();
  expect(s.locations).toHaveLength(0);
});

test('роль рабочего не получает действия контролёра', async ({ context, page }) => {
  await setup(context, 'worker', state()); await login(page, '/gate');
  await expect(page.getByText('Для этого экрана нужна роль контролёра.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть QR', exact: true })).toBeDisabled();
});

test('камера распознаёт QR из видеопотока и выключается', async ({ context, page }) => {
  const s = state(); await setup(context, 'worker', s);
  const code = QRCode.create(qr, { errorCorrectionLevel: 'M' });
  await context.addInitScript(({ size, modules }) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = (size + 8) * 6;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = 'black';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y * size + x]) ctx.fillRect((x + 4) * 6, (y + 4) * 6, 6, 6);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const stream = canvas.captureStream(4);
      const timer = setInterval(() => ctx.drawImage(canvas, 0, 0), 100);
      const track = stream.getVideoTracks()[0]; const stop = track.stop.bind(track);
      track.stop = () => { (window as unknown as { cameraStopped: boolean }).cameraStopped = true; clearInterval(timer); stop(); };
      return stream;
    } });
  }, { size: code.modules.size, modules: Array.from(code.modules.data) });
  await login(page, '/phone');
  await page.getByRole('button', { name: 'Включить камеру' }).click();
  await expect(page.getByText('QR получен', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Включить камеру' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { cameraStopped: boolean }).cameraStopped)).toBe(true);
});

test('GPS не отправляется чаще минуты; после остановки и в симуляции таймер не отправляет GPS', async ({ context, page }) => {
  const s = state(); s.open = true; await setup(context, 'worker', s);
  await page.clock.install(); await login(page, '/phone');
  await expect.poll(() => s.locations.length).toBe(1);
  await page.clock.fastForward(50000);
  expect(s.locations).toHaveLength(1);
  await page.clock.fastForward(15000);
  await expect.poll(() => s.locations.length).toBe(2);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  await page.clock.fastForward(70000);
  expect(s.locations).toHaveLength(2);
  await page.getByRole('button', { name: 'Включить симуляцию' }).click();
  await page.clock.fastForward(70000);
  expect(s.locations).toHaveLength(2);
});

test('повторный скан показывает отказ в заголовке', async ({ context, page }) => {
  const s = state(); await setup(context, 'worker', s); await login(page, '/phone');
  await page.getByRole('button', { name: 'Привязать этот телефон' }).click();
  await expect(page.getByText('Телефон привязан.', { exact: true })).toBeVisible();
  const replay = 'Этот код уже использован. Повторный проход невозможен.';
  await context.route('**/attempts/*/scan', route => json(route, { confirmed: false, reason: replay, reason_human: replay, reason_code: 'PROOF_REPLAY' }));
  await page.locator('summary').click(); await page.locator('#qr-link').fill(qr);
  await page.getByRole('button', { name: 'Прочитать ссылку' }).click();
  await page.getByRole('button', { name: 'Подтвердить попытку' }).click();
  await expect(page.locator('.status strong', { hasText: replay })).toBeVisible();
  await expect(page.getByText(replay, { exact: true })).toHaveCount(2);
  await expect(page.getByText('Телефон подтвердил попытку', { exact: true })).toHaveCount(0);
});

test('потерянный ответ scan восстанавливается чтением собственной попытки', async ({ context, page }) => {
  const s = state(); await setup(context, 'worker', s); await login(page, '/phone');
  await page.getByRole('button', { name: 'Привязать этот телефон' }).click();
  await expect(page.getByText('Телефон привязан.', { exact: true })).toBeVisible();
  await context.route('**/attempts/*/scan', async route => { s.confirmed = true; await route.abort(); });
  await page.locator('summary').click(); await page.locator('#qr-link').fill(qr);
  await page.getByRole('button', { name: 'Прочитать ссылку' }).click();
  await page.getByRole('button', { name: 'Подтвердить попытку' }).click();
  await expect(page.getByText('Телефон подтвердил попытку', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить попытку' })).toBeDisabled();
});

test('потерянный ответ decide не разрешает повтор; серверный итог восстанавливается', async ({ context, page }) => {
  const s = state(); await setup(context, 'gate', s); await login(page, '/gate');
  await page.getByRole('button', { name: 'Открыть QR', exact: true }).click(); s.confirmed = true;
  const file = page.locator('input[type=file]'); await expect(file).toBeEnabled();
  await file.setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: await QRCode.toBuffer('frame') });
  await context.route('**/attempts/*/decide', async route => { await route.abort(); });
  await page.getByRole('button', { name: 'Отправить кадр на проверку' }).click();
  await expect(page.getByText('Результат пока неизвестен', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить кадр на проверку' })).toBeDisabled();
  s.decided = true; s.decision = 'allow';
  await expect(page.getByText('Проход разрешён сервером', { exact: true })).toBeVisible();
});
