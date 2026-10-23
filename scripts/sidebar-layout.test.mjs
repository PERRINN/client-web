// Browser layout regression using production shell CSS and synthetic content; no Firebase access.
// Run with node --test; set PLAYWRIGHT_MODULE when Playwright is installed outside this repo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../', import.meta.url);
const styles = readFileSync(new URL('src/styles.css', root), 'utf8');
const shell = readFileSync(new URL('src/app/app.component.css', root), 'utf8').replaceAll(':host', 'app-root');

test('sidebar controls stay reachable in short viewports without moving page content', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const [width, height] of [[844, 390], [915, 412], [640, 280], [390, 844], [1440, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
      for (const count of [0, 12]) {
        await page.setContent(`<style>${styles}\n${shell}</style><app-root>
          <div class="appShell sidebarShell">
            <header class="mobileShellHeader"><button>Menu</button></header>
            <div class="shellSidebar sidebarOpen">
              <nav class="navLeft">${['PERRINN', 'Team', 'Discover', 'Apps'].map(label => `<button class="iconBtn">${label}</button>`).join('')}</nav>
              <div class="conversationSpace"><section class="sideProfile">${Array.from({ length: count }, (_, i) => `<button style="display:block;height:42px;width:100%">Conversation ${i}</button>`).join('')}</section></div>
              <section class="automaticSection"><div class="automaticList">${Array.from({ length: count }, (_, i) => `<button class="automaticRow">Update ${i}</button>`).join('')}</div></section>
              <div class="navRight"><button class="accountRow"><span class="accountInfo"><span class="accountName">Your profile</span><span class="accountBalance">0 PRN</span></span></button></div>
            </div>
            <div id="main_container"><div class="contentWrap"><div class="contentCard"><button id="page-action">Page action</button></div></div></div>
          </div></app-root>`);
        const sidebar = page.locator('.shellSidebar');
        const origin = await page.locator('#main_container').boundingBox();
        assert.ok(await page.locator('.sideProfile').evaluate(el => el.clientHeight >= 42), `${width}x${height}: conversation row`);
        assert.equal(await page.locator('.automaticList').evaluate(el => el.clientHeight), 126);
        const short = height < 500;
        assert.equal(await sidebar.evaluate(el => el.scrollHeight > el.clientHeight), short, `${width}x${height}: outer overflow`);
        // A browser wheel gesture must scroll the outer sidebar; script-only scrolling
        // also works with overflow:hidden and would miss the original regression.
        await page.mouse.move(100, 80);
        await page.mouse.wheel(0, 1000);
        if (short) await page.waitForFunction(() => document.querySelector('.shellSidebar').scrollTop > 0);
        if (short) {
          await sidebar.evaluate(el => { el.scrollTop = 0; });
          const client = await page.context().newCDPSession(page);
          await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 150 }] });
          for (const y of [130, 110, 90, 70, 50]) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y }] });
          }
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await page.waitForFunction(() => document.querySelector('.shellSidebar').scrollTop > 0);
          await client.detach();
        }
        await page.locator('.accountRow').focus();
        const account = await page.locator('.accountRow').boundingBox();
        assert.ok(account.y >= 0 && account.y + account.height <= height, `${width}x${height}: profile reachable`);
        assert.deepEqual(await page.locator('#main_container').boundingBox(), origin);
        assert.equal(await page.locator('#main_container').evaluate(el => el.scrollTop), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (count) {
          for (const selector of ['.sideProfile', '.automaticList']) {
            assert.ok(await page.locator(selector).evaluate(el => el.scrollHeight > el.clientHeight));
            await page.locator(selector).evaluate(el => { el.scrollTop = 42; });
            assert.ok(await page.locator(selector).evaluate(el => el.scrollTop > 0));
          }
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
