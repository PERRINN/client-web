// Render the production Settings email form and service with synthetic Auth.
// No Firebase app is initialized; the browser may access only this local server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(resolve(tmpdir(), 'perrinn-account-email-'));
const template = await readFile(root + '/src/app/settings.component.html', 'utf8');
const marker = '<div class="title">Email address</div>', start = template.indexOf(marker), end = template.indexOf('</form>', start) + 7;
assert.ok(start > 0 && end > start);
const section = '<div class="settingsPage"><div class="settingsPageTitle">Settings</div><section class="island settingsSection">'
  + template.slice(start, end) + '</section><section class="island" id="following">PERRINN contract</section></div>';
const styles = await readFile(root + '/src/app/settings.component.css', 'utf8');
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {Component,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {FormsModule} from '@angular/forms';
import {BehaviorSubject} from 'rxjs';
import {AccountEmailService} from '${root}/src/app/accountEmail.service';
let mode='ready',finish,requests=0;
const user={uid:'alice',email:'current@example.test',
  async verifyBeforeUpdateEmail(address){requests++;if(mode==='recent')throw {code:'auth/requires-recent-login'};
    if(mode==='error')throw {code:'auth/network-request-failed'};
    if(mode==='pending')await new Promise(resolve=>finish=resolve);},
  async reauthenticateWithCredential(){if(mode==='wrong')throw {code:'auth/invalid-credential'};},async reload(){}
};
const state=new BehaviorSubject(user),auth={user:state,currentUser:Promise.resolve(user)};
const service=new AccountEmailService(auth);
const Area=Component({selector:'email-test',standalone:false,template:${JSON.stringify(section)},styles:[${JSON.stringify(styles)}]})(class {email=service;});
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[FormsModule],declarations:[Area],providers:[provideZoneChangeDetection()]});
const fixture=TestBed.createComponent(Area);document.querySelector('.contentCard').append(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();
window.emailUI={mode(value){mode=value;},async finish(){finish?.();await new Promise(resolve=>setTimeout(resolve,0));fixture.detectChanges();},stats(){return {requests,password:service.password,sent:service.sent};},
  reset(){service.cancel();mode='ready';fixture.detectChanges();},signout(){auth.currentUser=Promise.resolve(null);state.next(null);fixture.detectChanges();}};
`);
await build({ entryPoints: [output + '/entry.ts'], outfile: output + '/bundle.js', bundle: true, platform: 'browser', format: 'iife',
  nodePaths: [root + '/node_modules'], tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }, logLevel: 'silent' });
const globalStyles = await readFile(root + '/src/styles.css', 'utf8');
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? await readFile(output + '/bundle.js') :
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + globalStyles
    + 'html,body{height:100%;margin:0}.shell{height:100dvh;overflow:hidden}header{height:48px}#main_container{height:calc(100dvh - 48px);overflow:auto}.contentCard{max-width:560px;padding:16px;margin:auto}</style></head>'
    + '<body><app-root><div class="shell"><header>PERRINN</header><main id="main_container"><div class="contentCard"></div></main></div></app-root><script src="/bundle.js"></script></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.emailUI);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(() => window.emailUI.reset());
    const following = () => page.locator('#following').boundingBox();
    const origin = await following(), shell = await page.locator('#main_container').boundingBox();
    const stable = async () => {
      assert.deepEqual(await following(), origin, 'email state must not move the following section');
      assert.deepEqual(await page.locator('#main_container').boundingBox(), shell);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('.settings-email').evaluate(el => el.scrollWidth > el.clientWidth), false);
    };
    const input = page.getByRole('textbox', { name: 'Email address', exact: true });
    await input.fill('new@example.test');
    await page.evaluate(() => window.emailUI.mode('pending'));
    await page.getByRole('button', { name: 'Send verification', exact: true }).click();
    await page.getByText('Sending…', { exact: true }).waitFor(); await stable();
    assert.equal(await input.isDisabled(), true);
    await page.evaluate(() => window.emailUI.finish());
    await page.getByText('Verification email sent.', { exact: true }).waitFor(); await stable();
    await page.screenshot({ path: output + '/sent-' + width + '.png' });
    await page.getByRole('button', { name: 'Done', exact: true }).click(); await stable();
    await input.fill('new@example.test'); await page.evaluate(() => window.emailUI.mode('recent'));
    await input.press('Enter');
    const passwordField = page.getByLabel('Current password', { exact: true });
    await passwordField.waitFor(); await stable();
    assert.equal(await passwordField.getAttribute('type'), 'password');
    await page.evaluate(() => window.emailUI.mode('wrong'));
    await passwordField.fill('synthetic-password'); await passwordField.press('Enter');
    await page.getByRole('alert').getByText('Incorrect password. Try again.', { exact: true }).waitFor();
    assert.equal(await passwordField.inputValue(), ''); await stable();
    await page.screenshot({ path: output + '/reauth-' + width + '.png' });
    await passwordField.fill('synthetic-password'); await page.evaluate(() => window.emailUI.mode('ready'));
    await passwordField.press('Enter');
    await page.getByText('Verification email sent.', { exact: true }).waitFor(); await stable();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await input.fill('new@example.test'); await page.evaluate(() => window.emailUI.mode('error'));
    await input.press('Enter'); await page.getByRole('alert').waitFor(); await stable();
  }
  await page.evaluate(() => window.emailUI.signout());
  assert.equal(await page.getByRole('textbox', { name: 'Email address', exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Send verification' }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, widths: [1440, 390, 320], checks: ['verification', 'pending', 'reauthentication', 'password failure/retry', 'network error', 'cancel', 'sign-out', 'keyboard submit', 'stable section/shell', 'no overflow'], errors }));
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
