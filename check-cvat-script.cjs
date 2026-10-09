const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(editing = false) { this.editing = editing; }
  closest() { return this.editing ? this : null; }
}
class HTMLElement extends Element {}
function load(source, origin, hasRoot = true) {
  const listeners = new Map();
  const classes = new Set();
  const styles = [];
  const root = {
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    appendChild(style) { styles.push(style.textContent); },
  };
  function register(surface) {
    return (name, callback) => {
      const key = `${surface}:${name}`;
      listeners.set(key, [...(listeners.get(key) || []), callback]);
    };
  }
  const document = {
    documentElement: hasRoot ? root : null,
    addEventListener: register('document'),
    createElement: () => ({}),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  vm.runInNewContext(source, {
    location: { origin }, document,
    window: { addEventListener: register('window') }, Element, HTMLElement,
  });
  function fire(name, values = {}) {
    const event = {
      key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
      target: new HTMLElement(), prevented: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { throw Error('Annotation event propagation was blocked'); },
      ...values,
    };
    for (const callback of listeners.get(name) || []) callback(event);
    return event;
  }
  return { listeners, styles, root, document, fire };
}

const fixed = fs.readFileSync(require('node:path').join(__dirname, 'cvat-shortcuts.user.js'), 'utf8');
function matches(source, address) {
  const url = new URL(address);
  return [...source.matchAll(/^\/\/\s*@match\s+(\S+)/gm)].some(([, pattern]) =>
    pattern.endsWith('/*') && url.origin === pattern.slice(0, -2));
}
const cloud = 'https://app.cvat.ai/tasks/1/jobs/2';
for (const address of [cloud, 'https://app.cvat.ai/', 'http://10.43.2.147:8080/tasks/1/jobs/2', 'http://10.43.2.12:8080/']) {
  assert.equal(matches(fixed, address), true, address);
  const app = load(fixed, new URL(address).origin);
  for (const listener of ['window:dblclick', 'window:wheel', 'document:input', 'window:keydown', 'window:keypress', 'window:keyup', 'window:contextmenu', 'window:selectstart']) {
    assert.ok(app.listeners.has(listener), listener);
  }
  assert.equal(app.styles.length, 1);
}
for (const address of ['https://example.com/', 'https://app.cvat.ai.example.com/', 'http://10.43.2.12:8081/']) {
  assert.equal(matches(fixed, address), false, address);
  vm.runInNewContext(fixed, { location: { origin: new URL(address).origin } });
}
const app = load(fixed, 'https://app.cvat.ai');
assert.equal(app.fire('window:selectstart').prevented, true);
assert.equal(app.fire('window:selectstart', { target: new HTMLElement(true) }).prevented, false);
assert.equal(app.fire('window:selectstart', { target: { parentElement: new HTMLElement(true) } }).prevented, false);
assert.equal(app.fire('window:contextmenu').prevented, true);
assert.equal(app.fire('window:contextmenu', { altKey: true }).prevented, false);
assert.equal(app.fire('window:contextmenu', { target: new HTMLElement(true) }).prevented, false);
assert.equal(app.fire('window:keydown', { ctrlKey: true, key: 'a', code: 'KeyA' }).prevented, true);
assert.equal(app.fire('window:keydown', { metaKey: true, key: 'a', code: 'KeyA' }).prevented, true);
assert.equal(app.fire('window:keydown', { ctrlKey: true, key: 'a', code: 'KeyA', target: new HTMLElement(true) }).prevented, false);
app.fire('window:keydown', { key: 'Alt', altKey: true });
assert.equal(app.fire('window:selectstart').prevented, false);
app.fire('window:keyup', { key: 'Alt' });
assert.equal(app.fire('window:selectstart').prevented, true);
app.fire('window:keydown', { key: 'Alt', altKey: true });
app.fire('window:blur');
assert.equal(app.fire('window:selectstart').prevented, true);
const mask = new Element();
mask.namespaceURI = 'http://www.w3.org/2000/svg';
mask.closest = () => mask;
const doubleClick = app.fire('window:dblclick', { button: 0, target: mask });
assert.equal(doubleClick.shiftKey, true, 'Double click still activates Edit mask');
assert.equal(doubleClick.prevented, false);
const early = load(fixed, 'https://app.cvat.ai', false);
assert.equal(early.styles.length, 0);
early.document.documentElement = early.root;
early.fire('document:DOMContentLoaded');
assert.equal(early.styles.length, 1, 'Style installs when document root becomes available');
console.log('PASS: host matching; blocked selection/context menu/Ctrl+A; editable and Alt exceptions; Alt release/blur; Edit mask double click; early DOM startup. Simulated events only.');
