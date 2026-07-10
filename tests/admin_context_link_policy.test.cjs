const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const adminContext = fs.readFileSync(path.join(root, 'admin_context.js'), 'utf8');
const managementHtml = fs.readFileSync(path.join(root, 'management.html'), 'utf8');

assert(
  /href="admin\.html"[^>]*data-month-policy="latest"/.test(managementHtml),
  'Management Admin link should request the latest admin month instead of inheriting historical page month',
);

function makeAnchor(href, dataset = {}) {
  return {
    dataset,
    attrs: { href },
    getAttribute(name) { return this.attrs[name] || ''; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
}

const adminLink = makeAnchor('admin.html', { monthPolicy: 'latest' });
const reportLink = makeAnchor('debtor_analysis.html');
const anchors = [adminLink, reportLink];

class FakeDate extends Date {
  constructor(...args) {
    if (args.length) super(...args);
    else super('2026-07-10T00:00:00Z');
  }
  static now() {
    return new Date('2026-07-10T00:00:00Z').getTime();
  }
}

const context = {
  Date: FakeDate,
  URL,
  URLSearchParams,
  CustomEvent: function CustomEvent(type, init) {
    this.type = type;
    this.detail = init?.detail;
  },
  location: {
    href: 'https://example.test/management.html?month=may26',
    host: 'example.test',
  },
  localStorage: {
    store: {},
    getItem(key) { return this.store[key] || ''; },
    setItem(key, value) { this.store[key] = String(value); },
  },
  document: {
    readyState: 'complete',
    querySelectorAll(selector) {
      return selector === 'a[href]' ? anchors : [];
    },
    addEventListener() {},
  },
  window: {
    location: {
      search: '?month=may26',
    },
    dispatchEvent() {},
  },
};
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.window.CustomEvent = context.CustomEvent;
context.window.URLSearchParams = URLSearchParams;
context.window.URL = URL;
context.window.Date = FakeDate;

vm.createContext(context);
vm.runInContext(adminContext, context);

assert.strictEqual(
  new URL(reportLink.attrs.href).searchParams.get('month'),
  'may26',
  'Default links should still inherit the working historical month',
);
assert.strictEqual(
  new URL(adminLink.attrs.href).searchParams.get('month'),
  'jul26',
  'Latest-policy Admin link should use the current admin month, not the historical management month',
);

console.log('admin_context_link_policy.test.cjs passed');
