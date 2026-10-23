(function () {
  'use strict';
  var key = 'theme-preference';
  var order = ['system', 'dark', 'light'];
  var labels = { system: '自动', dark: '夜间', light: '日间' };
  var icons = { system: '◐', dark: '☾', light: '☼' };
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var button;

  function normalize(value) {
    return order.indexOf(value) === -1 ? 'system' : value;
  }

  function readPreference() {
    try { return normalize(window.localStorage.getItem(key)); }
    catch (_) { return 'system'; }
  }

  var current = readPreference();

  function apply() {
    if (current === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', current);

    var dark = current === 'dark' || (current === 'system' && media.matches);
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', dark ? '#111614' : '#f6f1e8');

    if (button) {
      var next = order[(order.indexOf(current) + 1) % order.length];
      var label = '主题：' + labels[current] + '，切换为' + labels[next];
      button.textContent = icons[current];
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
  }

  // Apply before the stylesheet renders to avoid a flash of the wrong theme.
  apply();

  function init() {
    button = document.getElementById('theme-toggle');
    if (!button) return;
    apply();
    button.addEventListener('click', function () {
      current = order[(order.indexOf(current) + 1) % order.length];
      try {
        if (current === 'system') window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, current);
      } catch (_) { /* Theme switching still works when storage is unavailable. */ }
      apply();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  media.addEventListener('change', apply);
  window.addEventListener('storage', function (event) {
    if (event.key === key || event.key === null) {
      current = readPreference();
      apply();
    }
  });
}());
