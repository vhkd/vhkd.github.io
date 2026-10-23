const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/theme.js'), 'utf8');

function theme({ saved = null, blocked = false, dark = false, loading = false } = {}) {
  const attributes = new Map();
  const events = {};
  const listeners = {};
  const button = { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, cb) { events[k] = cb; } };
  const meta = { setAttribute(k, v) { this[k] = v; } };
  const media = { matches: dark, addEventListener(k, cb) { listeners.media = cb; } };
  const storage = {
    getItem() { if (blocked) throw new Error('denied'); return saved; },
    setItem(k, v) { if (blocked) throw new Error('denied'); saved = v; },
    removeItem() { if (blocked) throw new Error('denied'); saved = null; }
  };
  const document = {
    readyState: loading ? 'loading' : 'complete',
    documentElement: { setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k) },
    querySelector: () => meta, getElementById: () => button,
    addEventListener(k, cb) { listeners[k] = cb; }
  };
  const window = { localStorage: storage, matchMedia: () => media, addEventListener(k, cb) { listeners[k] = cb; } };
  vm.runInNewContext(source, { window, document });
  return { attributes, button, meta, media, storage, listeners, click: () => events.click(), saved: () => saved };
}

test('theme initializes before DOM ready and attaches the button afterwards', () => {
  const t = theme({ saved: 'light', dark: true, loading: true });
  assert.equal(t.attributes.get('data-theme'), 'light');
  assert.equal(t.meta.content, '#f6f1e8');
  t.listeners.DOMContentLoaded();
  assert.match(t.button.attrs['aria-label'], /日间，切换为自动/);
});

test('invalid preferences fall back to system; buttons cycle and persist all modes', () => {
  const t = theme({ saved: 'unexpected' });
  assert.equal(t.attributes.has('data-theme'), false);
  assert.equal(t.button.textContent, '◐');
  t.click(); assert.equal(t.attributes.get('data-theme'), 'dark'); assert.equal(t.saved(), 'dark');
  t.click(); assert.equal(t.attributes.get('data-theme'), 'light'); assert.equal(t.saved(), 'light');
  t.click(); assert.equal(t.attributes.has('data-theme'), false); assert.equal(t.saved(), null);
});

test('blocked storage does not prevent initialization or theme changes', () => {
  const t = theme({ blocked: true });
  t.click(); assert.equal(t.attributes.get('data-theme'), 'dark');
  t.click(); assert.equal(t.attributes.get('data-theme'), 'light');
  t.click(); assert.equal(t.attributes.has('data-theme'), false);
});

test('system mode tracks the OS; an explicit choice overrides it', () => {
  const t = theme();
  t.media.matches = true; t.listeners.media(); assert.equal(t.meta.content, '#111614');
  t.click(); t.click();
  t.listeners.media(); assert.equal(t.meta.content, '#f6f1e8');
});

test('a preference changed or cleared in another tab is applied', () => {
  const t = theme();
  t.storage.setItem('theme-preference', 'dark'); t.listeners.storage({ key: 'theme-preference' });
  assert.equal(t.attributes.get('data-theme'), 'dark');
  t.storage.removeItem(); t.listeners.storage({ key: null });
  assert.equal(t.attributes.has('data-theme'), false);
});
