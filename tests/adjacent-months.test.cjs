const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the real calendar functions with a small DOM/canvas recorder, without
// loading or changing any real browser data
function createApp() {
  const nodes = new Map();
  const storage = new Map();
  const canvasCalls = [];
  const context = new Proxy({
    measureText: text => ({ width: String(text).length * 20 })
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => canvasCalls.push({ method: property, args, color: target.fillStyle });
    }
  });
  function node() {
    return {
      innerHTML: '', value: '', textContent: '', hidden: false, open: false,
      classList: { add() {}, remove() {}, toggle() {} },
      listeners: {},
      queryCache: new Map(),
      addEventListener(type, listener) { this.listeners[type] = listener; },
      showModal() { this.open = true; },
      setAttribute() {},
      querySelectorAll(selector) {
        const attribute = selector === '[data-date]' ? 'data-date'
          : selector === '[data-workday-date]' ? 'data-workday-date' : null;
        if (!attribute) return [];
        const cacheKey = selector + this.innerHTML;
        if (this.queryCache.has(cacheKey)) return this.queryCache.get(cacheKey);
        const result = [...this.innerHTML.matchAll(/<button\b[^>]*>/g)].map(match => {
          const value = match[0].match(new RegExp(`${attribute}="([^"]*)"`));
          if (!value) return null;
          return Object.assign(node(), {
            dataset: attribute === 'data-date' ? { date: value[1] } : { workdayDate: value[1] },
            disabled: /\sdisabled(?:\s|>)/.test(match[0])
          });
        }).filter(Boolean);
        this.queryCache.set(cacheKey, result);
        return result;
      }
    };
  }
  const sandbox = {
    document: {
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, node());
        return nodes.get(selector);
      },
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return { getContext: () => context };
      },
      querySelectorAll: () => []
    },
    window: { scrollTo() {} },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: () => 1, clearTimeout() {}, console
  };
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = source.indexOf("  elements.prevMonth.addEventListener");
  assert.ok(start > 0, 'Found startup boundary');
  const instrumented = source.slice(0, start) + `
    globalThis.api = {
      elements, renderCalendar, renderWorkdayCalendar, createShareCanvas,
      openDay, addAssignment, toggleWorkday, toggleShare, moveSelectedDay,
      setMonth(year, month) { viewDate = new Date(year, month - 1, 1); },
      getMonth() { return [viewDate.getFullYear(), viewDate.getMonth() + 1]; },
      getState() { return state; },
      selectedProject, setProject
    };
  })();`;
  vm.runInNewContext(instrumented, sandbox);
  return { api: sandbox.api, canvasCalls, storage };
}

function cells(html, attribute = 'data-date') {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({
    key: match[1].match(new RegExp(`${attribute}="([^"]*)"`))?.[1],
    attrs: match[1], html: match[2]
  }));
}

const { api, canvasCalls, storage } = createApp();
const project = api.selectedProject();
project.members = [
  { id: 'a', name: '田中' }, { id: 'b', name: '山田' },
  { id: 'c', name: '佐藤' }, { id: 'd', name: '鈴木' }
];

// Every visible cell has a valid actual date, including leap days and years
for (let year = 2025; year <= 2028; year++) {
  for (let month = 1; month <= 12; month++) {
    api.setMonth(year, month);
    api.renderCalendar();
    api.renderWorkdayCalendar();
    const main = cells(api.elements.calendarGrid.innerHTML);
    const work = cells(api.elements.workdayCalendarGrid.innerHTML, 'data-workday-date');
    const count = new Date(year, month - 1, 1).getDay() + new Date(year, month, 0).getDate() <= 35 ? 35 : 42;
    assert.equal(main.length, count);
    assert.equal(work.length, count);
    const first = new Date(year, month - 1, 1);
    first.setDate(1 - first.getDay());
    main.forEach((cell, i) => {
      const actual = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      const key = `${actual.getFullYear()}-${String(actual.getMonth() + 1).padStart(2, '0')}-${String(actual.getDate()).padStart(2, '0')}`;
      assert.equal(cell.key, key);
      assert.equal(work[i].key, key);
      assert.ok(!/\sdisabled(?:\s|$)/.test(cell.attrs));
      assert.ok(!/\sdisabled(?:\s|$)/.test(work[i].attrs));
      assert.ok(cell.attrs.includes(`${actual.getFullYear()}年${actual.getMonth() + 1}月${actual.getDate()}日`));
    });
  }
}
console.log('PASS: 48 months, valid and editable dates, 5/6 rows, leap day and year boundaries');

// Clicking an adjacent-month cell opens that exact date without changing month
api.setMonth(2026, 12);
api.renderCalendar();
const nextButton = api.elements.calendarGrid.querySelectorAll('[data-date]').find(button => button.dataset.date === '2027-01-01');
nextButton.listeners.click();
assert.ok(api.elements.dayDialog.open);
assert.equal(api.elements.selectedDateLabel.textContent, '1月1日（金）');
assert.equal(JSON.stringify(api.getMonth()), '[2026,12]');
api.elements.memberSelect.value = 'a';
api.elements.slotSelect.value = 'am';
api.addAssignment();
assert.equal(project.shifts['2027-01-01'][0].slot, 'am');
api.elements.slotSelect.value = 'pm';
api.addAssignment();
assert.equal(project.shifts['2027-01-01'].length, 1);
assert.equal(project.shifts['2027-01-01'][0].slot, 'pm');
api.toggleWorkday('2027-01-01');
assert.equal(project.workdays['2027-01-01'], true);
let nextCell = cells(api.elements.calendarGrid.innerHTML).find(cell => cell.key === '2027-01-01');
assert.ok(nextCell.html.includes('田中'));
assert.ok(nextCell.html.includes('icon-sun'));
assert.ok(nextCell.attrs.includes('is-outside'));
assert.ok(nextCell.attrs.includes('is-workday'));
assert.ok(nextCell.attrs.includes('is-holiday'));
assert.ok(cells(api.elements.workdayCalendarGrid.innerHTML, 'data-workday-date')
  .find(cell => cell.key === '2027-01-01').attrs.includes('aria-pressed="true"'));
api.setMonth(2027, 1);
api.renderCalendar();
assert.ok(cells(api.elements.calendarGrid.innerHTML).find(cell => cell.key === '2027-01-01').html.includes('田中'));
assert.equal(JSON.parse(storage.get('shift-calendar-v1')).projects[0].shifts['2027-01-01'][0].slot, 'pm');
console.log('PASS: adjacent-day assignment, AM/PM update, workday toggle, persistent data and next-month consistency');

// Previous-month shifts, display ordering, removed members and overflow count
project.shifts['2026-12-31'] = [
  { memberId: 'd', slot: 'all' }, { memberId: 'b', slot: 'pm' },
  { memberId: 'a', slot: 'am' }, { memberId: 'c', slot: 'all' },
  { memberId: 'removed', slot: 'all' }
];
api.renderCalendar();
const prevCell = cells(api.elements.calendarGrid.innerHTML).find(cell => cell.key === '2026-12-31');
assert.ok(prevCell.html.includes('田中'));
assert.ok(prevCell.html.indexOf('田中') < prevCell.html.indexOf('山田'));
assert.ok(prevCell.html.includes('icon-sunrise'));
assert.ok(prevCell.html.includes('ほか1名'));
assert.ok(!prevCell.html.includes('removed'));
api.toggleWorkday('2026-12-31');
api.toggleWorkday('2026-12-31');
assert.ok(!project.workdays['2026-12-31']);
assert.equal(project.shifts['2026-12-31'].length, 5);
console.log('PASS: previous month, member order, missing members, overflow and independent workday color');

// Sharing stays read-only but keeps the exact same data and colors
api.toggleShare(true);
assert.ok(cells(api.elements.calendarGrid.innerHTML).every(cell => cell.attrs.includes('disabled')));
assert.ok(cells(api.elements.calendarGrid.innerHTML).find(cell => cell.key === '2026-12-31').html.includes('田中'));
api.createShareCanvas();
assert.ok(canvasCalls.some(call => call.method === 'fillText' && call.args[0] === '田中'));
assert.ok(canvasCalls.some(call => call.method === 'fillText' && call.args[0] === 'ほか1名'));
api.setMonth(2026, 12);
canvasCalls.length = 0;
api.createShareCanvas();
assert.ok(canvasCalls.some(call => call.method === 'fillText' && call.args[0] === '田中' && call.args[2] > 224 + 4 * 170));
assert.ok(canvasCalls.some(call => call.method === 'fillRect' && call.color === '#fff4c9' && call.args[1] > 224));
const jan1Number = canvasCalls.find(call => call.method === 'fillText' && call.args[0] === '1' && call.args[2] > 224 + 4 * 170);
assert.equal(jan1Number.color, '#ba3d48');
api.toggleShare(false);
assert.ok(cells(api.elements.calendarGrid.innerHTML).every(cell => !cell.attrs.includes('disabled')));
console.log('PASS: share read-only mode and saved-image adjacent shifts, workday colors and next-year holiday');

// Project isolation is retained when the same date exists in multiple projects
const firstId = project.id;
api.getState().projects.push({ id: 'second', name: '別プロジェクト', members: project.members, shifts: {}, workdays: {} });
api.setProject('second');
assert.ok(!api.elements.calendarGrid.innerHTML.includes('shift-name">田中'));
api.setProject(firstId);
assert.ok(api.elements.calendarGrid.innerHTML.includes('shift-name">田中'));
console.log('PASS: project-specific shifts and workdays remain isolated');
