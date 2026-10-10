import { test, expect, type BrowserContext, type Route } from '@playwright/test';

const origin = 'http://127.0.0.1:3123';
const reply = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type' } });
async function fixture(context: BrowserContext) {
  const start = Date.now() - 3600000;
  const state = { open: true, fail: false, reads: 0, writes: 0, points: [
    { at: new Date(start - 1000).toISOString(), source: 'gps', lat: 1, lng: 2, zone_name: 'Курилка' },
    { at: new Date().toISOString(), source: 'gps', lat: 55.75, lng: 37.61, zone_name: 'Бетон' },
  ] };
  await context.addInitScript(() => sessionStorage.setItem('prohodnaya.session', JSON.stringify({ token: 'test-token', sub: 'manager-test', username: 'manager', roles: ['manager'] })));
  await context.route('http://127.0.0.1:8182/**', async r => {
    if (r.request().method() === 'OPTIONS') return reply(r, {});
    if (r.request().method() !== 'GET') state.writes++;
    const url = new URL(r.request().url());
    if (url.pathname === '/site/now') { state.reads++; return reply(r, state.fail ? { reason_human: 'Сеть недоступна' } : { inside: state.open ? [{ person_id: 'p1', full_name: 'Рабочий Тест', shift_id: 's1', started_at: new Date(start).toISOString() }] : [] }, state.fail ? 503 : 200); }
    if (url.pathname === '/analytics/routes') return reply(r, { people: [{ person_id: 'p1', full_name: 'Рабочий Тест', visits: [], points: state.points }] });
    return reply(r, { people: [], zones: [], plans: [], by_person: [] });
  });
  return state;
}

test('живые точки обновляются раз в минуту, старые смены исключаются, закрытый рабочий исчезает', async ({ context, page }) => {
  const s = await fixture(context);
  await page.clock.install();
  await page.goto('/manager');
  const board = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Местоположение рабочих', exact: true }) }).first();
  await expect(board.getByRole('region', { name: 'Зона: Бетон', exact: true }).getByRole('button', { name: /Рабочий Тест/ })).toBeVisible();
  await expect(board.getByText('55.750000, 37.610000')).toBeVisible();
  await expect(board.getByRole('list', { name: 'Последние отметки рабочего' }).locator('li')).toHaveCount(1);
  s.points.push({ at: new Date().toISOString(), source: 'button', lat: 0, lng: 0, zone_name: 'Котлован' });
  const reads = s.reads;
  await page.clock.fastForward(59000); expect(s.reads).toBe(reads);
  await page.clock.fastForward(1000);
  await expect(board.getByRole('region', { name: 'Зона: Котлован', exact: true }).getByRole('button', { name: /Симуляция с телефона/ })).toBeVisible();
  await board.getByRole('checkbox', { name: 'Обновлять раз в 60 секунд' }).uncheck();
  await expect(board.getByRole('button', { name: 'Обновить местоположения' })).toBeEnabled();
  const stoppedReads = s.reads;
  await page.clock.fastForward(135000);
  await expect(board.getByRole('button', { name: /Рабочий Тест.*Устарело/ })).toBeVisible();
  expect(s.reads).toBe(stoppedReads);
  s.fail = true;
  await board.getByRole('button', { name: 'Обновить местоположения' }).click();
  await expect(board.getByRole('alert')).toContainText('могли устареть');
  s.fail = false; s.open = false;
  await board.getByRole('button', { name: 'Обновить местоположения' }).click();
  await expect(board.getByText(/Открытых смен нет/)).toBeVisible();
  await expect(board.getByRole('button', { name: /● Рабочий Тест/ })).toHaveCount(0);
});

test('демо перемещает только вымышленного рабочего, не пишет в API и доступно на телефоне', async ({ context, page }) => {
  const s = await fixture(context); s.open = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/manager');
  await page.getByRole('button', { name: 'Попробовать демо' }).click();
  for (const zone of ['Бетон', 'Котлован', 'Курилка']) {
    await page.getByRole('button', { name: `Демо: ${zone}`, exact: true }).click();
    await expect(page.getByRole('region', { name: `Зона: ${zone}`, exact: true }).getByRole('button', { name: /Демо-рабочий/ })).toBeVisible();
  }
  expect(s.writes).toBe(0);
  await expect(page.getByText('Демо · без записи в базу')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/location-demo-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Реальные смены', exact: true }).click();
  await expect(page.getByText(/^Открытых смен нет\./)).toBeVisible();
  await expect(page.getByRole('button', { name: /● Демо-рабочий/ })).toHaveCount(0);
});
