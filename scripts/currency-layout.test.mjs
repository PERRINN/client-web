// Production CSS with synthetic currencies; no Firebase reads or preference writes.
// Set PLAYWRIGHT_MODULE and PLAYWRIGHT_CHANNEL for an external browser installation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const labels = ['US Dollar', 'British Pound Sterling', 'Euro', 'A very long currency designation that must wrap'];

test('currency options wrap without clipping on Buy PRN and Settings', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      for (const screen of ['buy-prn', 'settings']) {
        const buy = screen === 'buy-prn';
        const css = read(`src/app/${screen}.component.css`).replaceAll(':host', 'currency-page');
        const list = `<ul class="listLight ${buy ? 'currency-selector-list' : ''}">${labels.map(label =>
          `<li class="${buy ? 'currency-item' : ''}"><button type="button" aria-pressed="false" class="${buy ? 'buttonToggle currency-btn' : 'buttonBlack'}">${label}</button></li>`).join('')}</ul>`;
        await page.setContent(`<style>${read('src/styles.css')}\n${css}</style><currency-page style="display:block">
          <div class="${buy ? 'buyPage' : 'settingsPage'}"><div class="${buy ? 'buyWrap' : 'island settingsSection'}">
          <div class="${buy ? 'buy-island' : 'settings-currency-container'}">${list}</div></div></div></currency-page>`);
        const buttons = page.locator('button');
        const initial = await buttons.evaluateAll(elements => elements.map(el => {
          const box = el.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }));
        for (const button of await buttons.all()) {
          const size = await button.evaluate(el => ({
            clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
            height: el.getBoundingClientRect().height,
            right: el.getBoundingClientRect().right
          }));
          assert.equal(size.clipped, false, `${screen} ${width}: label clipped`);
          assert.ok(size.height >= 44 && size.right <= width, `${screen} ${width}: control bounds`);
        }
        // Selection must neither move controls nor remove the selected button from keyboard navigation.
        await buttons.nth(1).evaluate((el, selectedClass) => {
          el.classList.add(selectedClass);
          el.setAttribute('aria-pressed', 'true');
        }, buy ? 'selected' : 'activeCurrency');
        await buttons.nth(1).focus();
        assert.equal(await buttons.nth(1).evaluate(el => el === document.activeElement), true);
        assert.deepEqual(await buttons.evaluateAll(elements => elements.map(el => {
          const box = el.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        })), initial);
        await page.screenshot({ path: `/tmp/currency-${screen}-${width}.png`, fullPage: true });
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
