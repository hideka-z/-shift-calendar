const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Executes the real app (including event setup) without a browser or real data
function boot(seed) {
  const nodes = new Map();
  const storage = new Map([['shift-calendar-v1', JSON.stringify(seed)]]);
  const calls = [];
  const frames = [];
  const canvas = { width: 0, height: 0 };
  const context = new Proxy({ measureText: text => ({ width: String(text).length * 20 }) }, {
    get(target, key) {
      return key in target ? target[key] : (...args) => calls.push({ method: key, args, color: target.fillStyle });
    }
  });
  canvas.getContext = () => context;

  function node() {
    const result = {
      clientHeight: 460, scrollTop: 0, open: false, hidden: false, value: '', textContent: '',
      dataset: {}, listeners: {}, style: { setProperty(name, value) { this[name] = value; } },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this[name] = value; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector() { return node(); },
      querySelectorAll(selector) {
        if (selector === '[data-date]') return this.children.filter(child => child.dataset.date);
        if (selector === '[data-workday-date]') return this.children.filter(child => child.dataset.workdayDate);
        return [];
      },
      children: []
    };
    let html = '';
    Object.defineProperty(result, 'innerHTML', {
      get: () => html,
      set(value) {
        html = value;
        result.children = [...value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => {
          const child = node();
          child.attrs = match[1]; child.innerHTML = match[2];
          child.disabled = /\sdisabled(?:\s|$)/.test(match[1]);
          child.dataset.date = match[1].match(/data-date="([^"]+)"/)?.[1];
          child.dataset.workdayDate = match[1].match(/data-workday-date="([^"]+)"/)?.[1];
          return child;
        });
      }
    });
    return result;
  }
  const window = { scrollY: 0, addEventListener() {}, scrollTo({ top }) { this.scrollY = top; } };
  const realDate = Date;
  class FixedDate extends realDate {
    constructor(...args) { super(...(args.length ? args : ['2026-11-20T00:00:00Z'])); }
    static now() { return new realDate('2026-11-20T00:00:00Z').getTime(); }
  }
  const sandbox = {
    Date: FixedDate, window, document: {
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
      querySelectorAll: () => [], createElement: () => canvas
    },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; }
  };
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const marker = "  elements.prevMonth.addEventListener";
  assert.ok(source.includes(marker));
  vm.runInNewContext(source.replace(marker, `
    globalThis.api = {
      elements, calendarRange, workdayRange, scrollPosition, restoreScrollPosition,
      layoutCalendar, startOfWeek, addDays, daysBetween, keyForDate, periodLabel,
      scrollToDate, renderCalendar, renderWorkdayCalendar, handleCalendarScroll,
      toggleShare, createShareCanvas, openWorkdayDialog, openDay, addAssignment,
      moveSelectedDay, toggleWorkday, moveCalendarMonth, resizeCalendars, setProject,
      getState: () => state, getShareStart: () => shareStartDate
    };
  ` + marker), sandbox);
  return {
    api: sandbox.api, storage, calls, canvas, window,
    flush() { while (frames.length) frames.shift()(); }
  };
}

const seed = {
  version: 1, selectedProjectId: 'p1', updatedAt: '2026-11-20T00:00:00.000Z',
  projects: [{
    id: 'p1', name: 'テスト', members: [
      { id: 'a', name: '田中' }, { id: 'b', name: '山田' },
      { id: 'c', name: '佐藤' }, { id: 'd', name: '鈴木' }
    ], shifts: {
      '2026-12-26': [{ memberId: 'c', slot: 'all' }],
      '2026-12-27': [{ memberId: 'a', slot: 'am' }],
      '2027-01-01': [{ memberId: 'b', slot: 'pm' }],
      '2027-01-30': [{ memberId: 'd', slot: 'all' }],
      '2027-01-31': [{ memberId: 'c', slot: 'all' }]
    }, workdays: { '2027-01-01': true }
  }, { id: 'p2', name: '別', members: [], shifts: {}, workdays: {} }]
};
const app = boot(seed);
const { api } = app;
const project = () => api.getState().projects[0];
const position = () => api.scrollPosition(api.elements.calendarViewport, api.calendarRange);
const key = date => api.keyForDate(date);
const parse = key => new Date(`${key}T00:00:00`);
function go(date, fraction = 0) {
  api.scrollToDate(parse(date));
  api.elements.calendarViewport.scrollTop += fraction * api.calendarRange.rowHeight;
  api.handleCalendarScroll();
}
function child(date, workday = false) {
  return (workday ? api.elements.workdayCalendarGrid : api.elements.calendarGrid).children
    .find(node => node.dataset[workday ? 'workdayDate' : 'date'] === date);
}
assert.deepEqual(JSON.parse(app.storage.get('shift-calendar-v1')), seed);
assert.equal(key(position().week), '2026-11-01');
assert.equal(api.elements.calendarGrid.children.length, 546);
assert.equal(api.elements.calendarViewport.clientHeight / api.calendarRange.rowHeight, 5);
console.log('PASS: startup, existing data compatibility, bounded buffer and five-row layout calculation');

for (let year = 2025; year <= 2028; year++) {
  for (let month = 0; month < 12; month++) {
    api.scrollToDate(new Date(year, month, 1));
    const nodes = api.elements.calendarGrid.children;
    assert.equal(nodes.length, 546);
    const first = parse(nodes[0].dataset.date);
    assert.equal(first.getDay(), 0);
    nodes.forEach((node, index) => {
      assert.equal(node.dataset.date, key(api.addDays(first, index)));
      assert.equal(typeof node.listeners.click, 'function');
      assert.equal(node.disabled, false);
    });
  }
}
console.log('PASS: 48 months of contiguous, unique, editable dates including leap and year boundaries');

for (const start of ['2026-11-22', '2026-12-27', '2028-02-20']) {
  go(start, 0.32);
  const before = position();
  app.window.scrollY = 20;
  api.elements.openShare.listeners.click();
  const nodes = api.elements.calendarGrid.children;
  assert.equal(nodes.length, 35);
  assert.equal(nodes[0].dataset.date, start);
  assert.equal(nodes[34].dataset.date, key(api.addDays(parse(start), 34)));
  assert.equal(parse(nodes[34].dataset.date).getDay(), 6);
  assert.ok(nodes.every(node => node.disabled && !node.listeners.click));
  assert.equal(api.elements.shareTitle.textContent, `${api.periodLabel(parse(start), api.addDays(parse(start), 34))} シフト表`);
  app.calls.length = 0;
  api.createShareCanvas();
  assert.equal(app.canvas.width, 1400);
  assert.equal(app.canvas.height, 1124);
  assert.equal(app.calls.filter(call => call.method === 'strokeRect').length, 35);
  assert.equal(app.calls.filter(call => call.method === 'fillText' && call.args[2] >= 224 && call.args[1] % 180 === 160).length, 35);
  if (start === '2026-12-27') {
    assert.ok(child('2027-01-01').attrs.includes('is-holiday'));
    assert.ok(child('2027-01-01').attrs.includes('is-workday'));
    assert.ok(child('2026-12-27').innerHTML.includes('icon-sunrise'));
    assert.ok(child('2027-01-01').innerHTML.includes('icon-sun'));
    for (const name of ['田中', '山田', '鈴木']) assert.ok(app.calls.some(call => call.method === 'fillText' && call.args[0] === name));
    assert.ok(!app.calls.some(call => call.method === 'fillText' && call.args[0] === '佐藤'));
    assert.ok(app.calls.some(call => call.method === 'fillRect' && call.color === '#fff4c9'));
    assert.ok(app.calls.some(call => call.method === 'fillText' && call.args[0] === '1/1' && call.color === '#ba3d48'));
  }
  api.elements.openShare.listeners.click();
  const after = position();
  assert.equal(key(after.week), key(before.week));
  assert.ok(Math.abs(after.fraction - before.fraction) < 0.00001);
  assert.equal(app.window.scrollY, 20);
}
console.log('PASS: partial top week, exact 35-day screen/canvas, leap/year boundaries, title and offset restoration');

go('2026-12-27');
child('2027-01-01').listeners.click();
assert.equal(api.elements.dayDialog.open, true);
api.elements.memberSelect.value = 'a'; api.elements.slotSelect.value = 'am';
api.elements.addAssignment.listeners.click();
assert.equal(project().shifts['2027-01-01'].length, 2);
assert.equal(project().shifts['2027-01-01'][1].slot, 'am');
api.elements.nextDay.listeners.click();
assert.ok(api.elements.selectedDateLabel.textContent.startsWith('1月2日'));
assert.equal(key(position().week), '2026-12-27');
assert.deepEqual(JSON.parse(JSON.stringify(project().shifts['2026-12-26'])), seed.projects[0].shifts['2026-12-26']);
api.elements.dayDialog.close();
api.openWorkdayDialog();
assert.equal(key(api.scrollPosition(api.elements.workdayViewport, api.workdayRange).week), '2026-12-27');
child('2027-01-06', true).listeners.click();
assert.equal(project().workdays['2027-01-06'], true);
assert.equal(key(position().week), '2026-12-27');
child('2027-01-06', true).listeners.click();
assert.equal(project().workdays['2027-01-06'], undefined);
assert.equal(project().shifts['2027-01-01'].length, 2);
api.elements.workdayDialog.close();
console.log('PASS: assignments, day navigation, workday toggles and independent scroll positions');

for (const direction of [-1, 1]) {
  for (let count = 0; count < 12; count++) {
    const before = position().week;
    (direction > 0 ? api.elements.nextMonth : api.elements.prevMonth).listeners.click();
    assert.ok(api.daysBetween(before, position().week) * direction > 0);
  }
}
console.log('PASS: month shortcuts do not stick at overlapping month-start weeks');

for (const edge of [2, 68]) {
  for (let count = 0; count < 6; count++) {
    const expected = api.addDays(api.calendarRange.start, edge * 7);
    api.elements.calendarViewport.scrollTop = (edge + 0.25) * api.calendarRange.rowHeight;
    api.elements.calendarViewport.listeners.scroll(); app.flush();
    assert.equal(key(position().week), key(expected));
    assert.ok(Math.abs(position().fraction - 0.25) < 0.00001);
    assert.equal(api.elements.calendarGrid.children.length, 546);
  }
}
console.log('PASS: repeated scroll-buffer recentering maintains dates, fractional offset and bounded size');

const beforeResize = position();
api.elements.calendarViewport.clientHeight = 333;
api.resizeCalendars();
assert.equal(key(position().week), key(beforeResize.week));
assert.ok(Math.abs(position().fraction - beforeResize.fraction) < 0.00001);
assert.equal(api.calendarRange.rowHeight, 66.6);
api.setProject('p2');
assert.ok(!api.elements.calendarGrid.innerHTML.includes('shift-name'));
api.setProject('p1');
const reloaded = boot(JSON.parse(app.storage.get('shift-calendar-v1')));
assert.equal(reloaded.api.getState().projects[0].shifts['2027-01-01'].length, 2);
console.log('PASS: resize position calculation, project isolation and data reload');
