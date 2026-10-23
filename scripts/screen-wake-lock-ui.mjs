// Uses the real shell and wake-lock service with synthetic browser grants; no Firebase access.
// First run: node scripts/greenpower/launch-preview.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:4318';
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

async function open(viewport, installed = true, supported = true) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(({ installed, supported }) => {
    const locks = [], pending = [];
    window.wakeTest = { calls: 0, mode: 'grant', locks, pending };
    class Sentinel extends EventTarget {
      released = false;
      async release() { this.released = true; this.dispatchEvent(new Event('release')); }
    }
    const grant = () => { const lock = new Sentinel(); locks.push(lock); return lock; };
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: installed });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: supported ? {
      request: () => {
        wakeTest.calls++;
        if (wakeTest.mode === 'denied') return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
        if (wakeTest.mode === 'pending') return new Promise(resolve => pending.push(() => resolve(grant())));
        return Promise.resolve(grant());
      }
    } : undefined });
  }, { installed, supported });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/apps?qa=1');
  await page.locator('app-apps, .appsPage, .mobile-brand, .shellBrandRow').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('.wakeLockButton').count(), 0, 'No persistent header control');
  await page.evaluate(async () => {
    const { fixture } = shellPreview;
    await fixture.componentInstance.router.navigate(['/settings']); fixture.detectChanges();
  });
  const control = page.getByRole('switch', { name: 'Keep screen on' });
  await control.waitFor();
  return { context, page, control, errors };
}

async function state(page, expected) {
  await page.waitForFunction(expected => {
    const service = shellPreview.fixture.componentInstance.screenWakeLock;
    let current; const subscription = service.state$.subscribe(value => current = value); subscription.unsubscribe();
    if (current !== expected) return false;
    shellPreview.fixture.detectChanges();
    return true;
  }, expected);
}

try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 844], [844, 390], [915, 412]]) {
    const { context, page, control, errors } = await open({ width, height });
    await state(page, 'active');
    assert.equal(await control.getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => wakeTest.calls), 1);
    const layout = async () => ({ main: await page.locator('#main_container').boundingBox(),
      button: await control.boundingBox(), scroll: await page.locator('#main_container').evaluate(el => el.scrollTop) });
    const before = await layout();
    assert.ok(before.button.x >= 0 && before.button.x + before.button.width <= width);
    assert.ok(before.button.height >= 44);
    await control.click(); await state(page, 'off');
    assert.equal(await control.getAttribute('aria-checked'), 'false');
    assert.deepEqual(await layout(), before);
    await page.evaluate(() => { wakeTest.mode = 'pending'; });
    await control.click(); await state(page, 'requesting');
    assert.equal(await control.getAttribute('aria-busy'), 'true');
    assert.deepEqual(await layout(), before);
    await page.evaluate(() => wakeTest.pending.shift()()); await state(page, 'active');
    await page.evaluate(() => wakeTest.locks.at(-1).release()); await state(page, 'blocked');
    assert.equal(await page.locator('#keep-screen-on-status').textContent(), 'Couldn’t keep screen on.');
    assert.deepEqual(await layout(), before);
    await control.click(); await page.evaluate(() => { wakeTest.mode = 'denied'; }); await control.click();
    await state(page, 'blocked'); assert.deepEqual(await layout(), before);
    await control.click(); await page.evaluate(() => { wakeTest.mode = 'grant'; });
    await control.focus(); await page.keyboard.press('Space'); await state(page, 'active');
    assert.equal(await page.locator('#keep-screen-on-status').textContent(), '');
    assert.deepEqual(await layout(), before);
    const calls = await page.evaluate(() => wakeTest.calls);
    await page.evaluate(async () => {
      const { fixture } = shellPreview;
      await fixture.componentInstance.router.navigate(['/apps']); fixture.detectChanges();
    });
    assert.equal(await page.getByRole('switch').count(), 0);
    assert.equal(await page.evaluate(() => wakeTest.calls), calls, 'Route changes share the existing lock');
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); }); await state(page, 'paused');
    await page.evaluate(() => { window.dispatchEvent(new Event('pageshow')); }); await state(page, 'active');
    assert.equal(await page.evaluate(() => wakeTest.calls), calls + 1);
    await page.evaluate(async () => {
      const { fixture } = shellPreview;
      await fixture.componentInstance.router.navigate(['/settings']); fixture.detectChanges();
    });
    assert.equal(await control.getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/perrinn-screen-awake-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, height, automaticInstalled: true, stableStates: true, keyboardToggle: true, routeLifetime: true, resumes: true }));
    await context.close();
  }
  for (const supported of [true, false]) {
    const { context, page, control, errors } = await open({ width: 390, height: 844 }, false, supported);
    assert.equal(await page.evaluate(() => wakeTest.calls), 0);
    assert.equal(await control.getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('#keep-screen-on-status').textContent(), supported ? '' : 'Not supported by this browser.');
    assert.equal(await control.isDisabled(), !supported);
    assert.deepEqual(errors, []); await context.close();
  }
  console.log('Browser opt-in and unsupported states passed. Physical phone auto-lock remains a device check.');
} finally { await browser.close(); }
