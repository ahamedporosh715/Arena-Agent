'use strict';
// Loads the browser scripts of the app into a vm sandbox with the minimal
// browser globals they touch at load time (window, localStorage, XMLHttpRequest).
// Network access is replaced by a scriptable fake XMLHttpRequest so that the
// promise-based helpers can be exercised offline.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function createLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] || null,
    _store: store,
  };
}

// Fake XHR: `routes` is a function (method, url, body, headers) => response
// where response = { status, response, responseText, error: 'timeout'|'network' }.
function createFakeXHR(routes) {
  const calls = [];
  class FakeXHR {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.response = null;
      this.responseText = '';
      this.responseType = '';
      this.timeout = 0;
      this.headers = {};
      this.onreadystatechange = null;
      this.onerror = null;
      this.ontimeout = null;
      this.onload = null;
      this.onabort = null;
      this.upload = {};
      this.withCredentials = false;
    }
    open(method, url) { this.method = method; this.url = url; this.readyState = 1; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    getResponseHeader(k) { return (this._respHeaders || {})[k.toLowerCase()] || null; }
    abort() { this.aborted = true; if (this.onabort) this.onabort({}); }
    send(body) {
      calls.push({ method: this.method, url: this.url, body, headers: this.headers, responseType: this.responseType, timeout: this.timeout });
      const res = routes(this.method, this.url, body, this.headers) || { status: 404, responseText: 'not found' };
      setImmediate(() => {
        if (this.aborted) return;
        if (res.error === 'timeout') {
          if (this.ontimeout) this.ontimeout({ target: this });
          return;
        }
        if (res.error === 'network') {
          if (this.onerror) this.onerror({ target: this });
          return;
        }
        this.status = res.status == null ? 200 : res.status;
        this._respHeaders = res.headers || {};
        if (this.responseType === 'json') {
          this.response = res.response !== undefined ? res.response : (res.responseText ? safeJson(res.responseText) : null);
        } else if (this.responseType === 'blob' || this.responseType === 'arraybuffer') {
          this.response = res.response;
        } else {
          this.responseText = res.responseText !== undefined ? res.responseText : (res.response !== undefined ? JSON.stringify(res.response) : '');
          this.response = this.responseText;
        }
        this.readyState = 4;
        if (this.onreadystatechange) this.onreadystatechange({ target: this, currentTarget: this });
        if (this.onload) this.onload({ target: this, currentTarget: this });
      });
    }
  }
  FakeXHR.calls = calls;
  return FakeXHR;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function loadApp(opts = {}) {
  const localStorage = createLocalStorage(opts.localStorage || {});
  const XMLHttpRequest = createFakeXHR(opts.routes || (() => ({ error: 'network' })));
  const sandbox = {
    console: opts.quiet === false ? console : { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, parseInt, parseFloat, isFinite, isNaN,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, escape, unescape,
    URL, URLSearchParams, Blob, TextEncoder, TextDecoder,
    localStorage,
    XMLHttpRequest,
    navigator: opts.navigator || { userAgent: 'node-test' },
    document: opts.document || { body: {}, createElement: () => ({ style: {} }) },
    location: { href: 'app://ytm.arma7x.com/index.html', origin: 'app://ytm.arma7x.com' },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const files = opts.files || ['js/yt-extractor.js', 'js/utils.js', 'js/datastorage.js', 'js/yt-scrapper.js'];
  files.forEach((rel) => {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, context, { filename: rel });
  });
  context.__xhrCalls = XMLHttpRequest.calls;
  // top-level `const`/`let` bindings live in the global lexical scope, not on
  // the global object — expose an evaluator to reach them (e.g. DataStorage).
  context.$eval = (expr) => vm.runInContext(expr, context);
  return context;
}

// Values created inside the vm realm have foreign prototypes; strip them so
// strict deepEqual can compare structure only.
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

module.exports = { loadApp, createFakeXHR, createLocalStorage, plain, ROOT };
