import test from 'node:test';
import assert from 'node:assert/strict';
import { headerFindings, corsAllowed, resourceUrls } from './checks.mjs';

test('HSTS missing, disabled, short and durable policies are distinguished', () => {
  for (const value of ['', 'max-age=0', 'max-age=123']) {
    assert.equal(headerFindings({ 'strict-transport-security': value })[0].status, 'WARNING');
  }
  assert.equal(headerFindings({ 'strict-transport-security': 'max-age=31536000' })[0].status, 'PASS');
});
test('CORS requires matching origin, method and requested headers', () => {
  const headers = { 'access-control-allow-origin': 'https://perrinn.com',
    'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'Content-Type' };
  assert.equal(corsAllowed(headers, 'https://perrinn.com'), true);
  assert.equal(corsAllowed(headers, 'https://www.perrinn.com'), false);
  assert.equal(corsAllowed(headers, 'https://perrinn.com', 'DELETE'), false);
  assert.equal(corsAllowed(headers, 'https://perrinn.com', 'POST', ['authorization']), false);
});
test('mixed-content inventory excludes navigation and metadata and resolves relative assets', () => {
  const html = '<meta content="http://metadata.test"><a href="http://link.test">link</a>'
    + '<script src="/main.js"></script><link rel="stylesheet" href="//fonts.test/a.css">'
    + '<img src="http://image.test/a.png">';
  assert.deepEqual(resourceUrls(html, 'https://perrinn.com').map(url => url.href),
    ['https://perrinn.com/main.js', 'https://fonts.test/a.css', 'http://image.test/a.png']);
});
