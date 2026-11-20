const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const project = {
  id: 'p1', name: 'テストプロジェクト',
  members: [
    { id: 'a', name: '田中' }, { id: 'b', name: '山田' },
    { id: 'c', name: '佐藤' }, { id: 'd', name: '鈴木' }
  ],
  shifts: {
    '2026-12-26': [{ memberId: 'a', slot: 'all' }],
    '2026-12-27': [{ memberId: 'a', slot: 'am' }],
    '2027-01-01': [{ memberId: 'b', slot: 'pm' }],
    '2027-01-30': [{ memberId: 'd', slot: 'all' }],
    '2027-01-31': [{ memberId: 'c', slot: 'all' }]
  },
  workdays: { '2026-12-27': true, '2027-01-01': true }
};
const seed = {
  version: 1, selectedProjectId: 'p1', updatedAt: '2026-11-20T00:00:00.000Z',
  projects: [project, { id: 'p2', name: '別プロジェクト', members: [], shifts: {}, workdays: {} }]
};

async function topPosition(page, workday = false) {
  return page.evaluate(workday => {
    const viewport = document.querySelector(workday ? '#workdayViewport' : '#calendarViewport');
    const grid = viewport.firstElementChild;
    const height = grid.firstElementChild.getBoundingClientRect().height;
    const index = Math.floor(viewport.scrollTop / height + 0.000001);
    return {
      key: grid.children[index * 7].dataset[workday ? 'workdayDate' : 'date'],
      fraction: Math.max(0, viewport.scrollTop / height - index),
      top: viewport.scrollTop, height,
      viewportHeight: viewport.clientHeight,
      cells: grid.children.length
    };
  }, workday);
}

async function setTop(page, key, fraction = 0, workday = false) {
  await page.evaluate(({ key, fraction, workday }) => {
    const viewport = document.querySelector(workday ? '#workdayViewport' : '#calendarViewport');
    const grid = viewport.firstElementChild;
    const index = [...grid.children].findIndex(cell => cell.dataset[workday ? 'workdayDate' : 'date'] === key);
    if (index < 0 || index % 7 !== 0) throw new Error('Missing Sunday: ' + key);
    viewport.scrollTop = (index / 7 + fraction) * grid.firstElementChild.getBoundingClientRect().height;
  }, { key, fraction, workday });
  await page.waitForTimeout(100);
}

async function run() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'styles.css', 'app.js'].includes(relative)) {
      response.writeHead(404); response.end(); return;
    }
    response.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(path.join(root, relative)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true, args: ['--no-sandbox']
  }).catch(error => { server.close(); throw error; });
  const context = await browser.newContext({
    viewport: { width: 390, height: 744 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, timezoneId: 'Asia/Tokyo', acceptDownloads: true
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(seed => {
    if (!localStorage.getItem('shift-calendar-v1')) localStorage.setItem('shift-calendar-v1', JSON.stringify(seed));
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-11-20T00:00:00Z'])); }
      static now() { return new RealDate('2026-11-20T00:00:00Z').getTime(); }
    };
    // Record the real canvas draw calls while still letting the browser draw
    const getContext = HTMLCanvasElement.prototype.getContext;
    window.drawCalls = [];
    HTMLCanvasElement.prototype.getContext = function(...args) {
      const ctx = getContext.apply(this, args);
      if (!ctx || ctx.recorded) return ctx;
      ctx.recorded = true;
      for (const name of ['fillText', 'fillRect', 'strokeRect']) {
        const original = ctx[name];
        ctx[name] = function(...values) {
          window.drawCalls.push({ method: name, args: values, color: ctx.fillStyle });
          return original.apply(this, values);
        };
      }
      return ctx;
    };
  }, seed);

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForTimeout(150);
    const initial = await topPosition(page);
    assert.equal(initial.key, '2026-11-01');
    assert.equal(initial.cells, 78 * 7);
    assert.ok(Math.abs(initial.viewportHeight / initial.height - 5) < 0.02);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('shift-calendar-v1'))), seed);
    console.log('PASS: existing backup data, five visible weeks and initial month');

    await setTop(page, '2026-12-27', 0.32);
    const beforeShare = await topPosition(page);
    assert.equal(beforeShare.key, '2026-12-27');
    await page.locator('#openShare').click();
    const sharedKeys = await page.locator('#calendarGrid > button').evaluateAll(nodes => nodes.map(node => node.dataset.date));
    assert.equal(sharedKeys.length, 35);
    assert.equal(sharedKeys[0], '2026-12-27');
    assert.equal(sharedKeys[34], '2027-01-30');
    assert.equal(await page.locator('#calendarGrid > button:disabled').count(), 35);
    assert.equal(await page.locator('#shareTitle').textContent(), '2026年12月27日〜2027年1月30日 シフト表');
    assert.equal(await page.locator('[data-date="2027-01-01"] .day-number').textContent(), '1/1');
    assert.ok(await page.locator('[data-date="2027-01-01"]').evaluate(node => node.classList.contains('is-holiday')));
    assert.equal(await page.locator('[data-date="2027-01-01"]').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 244, 201)');
    assert.equal(await page.locator('[data-date="2026-12-27"] .shift-name').textContent(), '田中');
    assert.equal(await page.locator('[data-date="2027-01-30"] .shift-name').textContent(), '鈴木');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#saveShareImage').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), '2026-12-27_2027-01-30_シフト表_テストプロジェクト.png');
    const screenshotDir = process.env.QA_OUTPUT_DIR || '/tmp';
    const imagePath = path.join(screenshotDir, 'shift-five-week-export.png');
    await download.saveAs(imagePath);
    const png = fs.readFileSync(imagePath);
    assert.equal(png.readUInt32BE(16), 1400);
    assert.equal(png.readUInt32BE(20), 1124);
    const calls = await page.evaluate(() => window.drawCalls);
    const calendarDates = calls.filter(call => call.method === 'fillText' && call.args[2] >= 224 && call.args[1] % 180 === 160);
    assert.equal(calendarDates.length, 35);
    assert.ok(calls.some(call => call.method === 'fillText' && call.args[0] === '田中'));
    assert.ok(calls.some(call => call.method === 'fillText' && call.args[0] === '鈴木'));
    assert.ok(!calls.some(call => call.method === 'fillText' && call.args[0] === '佐藤'));
    await page.screenshot({ path: path.join(screenshotDir, 'shift-share-screen.png'), fullPage: true });
    await page.locator('#openShare').click();
    await page.waitForTimeout(100);
    const afterShare = await topPosition(page);
    assert.equal(afterShare.key, beforeShare.key);
    assert.ok(Math.abs(afterShare.fraction - beforeShare.fraction) < 0.02);
    console.log('PASS: partial top week, year boundary, exact 35 dates, read-only share, image dimensions and scroll restoration');

    // Edit at a month boundary and navigate forward in the same input sheet
    await setTop(page, '2026-12-27');
    await page.locator('[data-date="2027-01-01"]').click();
    assert.ok(await page.locator('#dayDialog').evaluate(node => node.open));
    await page.locator('#memberSelect').selectOption('a');
    await page.locator('#slotSelect').selectOption('am');
    await page.locator('#addAssignment').click();
    await page.locator('#nextDay').click();
    assert.ok((await page.locator('#selectedDateLabel').textContent()).startsWith('1月2日'));
    await page.locator('#dayDialog button[aria-label="閉じる"]').click();
    const shifts = await page.evaluate(() => JSON.parse(localStorage.getItem('shift-calendar-v1')).projects[0].shifts);
    assert.equal(shifts['2027-01-01'].length, 2);
    assert.equal(shifts['2027-01-01'][1].slot, 'am');
    assert.deepEqual(shifts['2026-12-26'], project.shifts['2026-12-26']);
    console.log('PASS: month-boundary assignment and day navigation retain all existing shifts');

    // Workdays use the same scroll model but never move the main calendar
    const beforeWorkdays = await topPosition(page);
    await page.locator('#openSettings').click();
    await page.locator('#toggleWorkdayMode').click();
    assert.equal((await topPosition(page, true)).key, beforeWorkdays.key);
    await setTop(page, '2027-01-03', 0.2, true);
    await page.locator('[data-workday-date="2027-01-06"]').click();
    assert.equal(await page.locator('[data-workday-date="2027-01-06"]').getAttribute('aria-pressed'), 'true');
    assert.equal((await topPosition(page, true)).key, '2027-01-03');
    await page.locator('#workdayNextMonth').click();
    assert.notEqual((await topPosition(page, true)).key, '2027-01-03');
    await page.locator('#workdayDialog button[aria-label="閉じる"]').click();
    assert.equal((await topPosition(page)).key, beforeWorkdays.key);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('shift-calendar-v1')).projects[0].workdays['2027-01-06']), true);
    console.log('PASS: scrolling workday settings, persisted color and independent main scroll');

    // Both navigation buttons must move, even at a shared month-start week
    for (let i = 0; i < 4; i++) {
      const before = (await topPosition(page)).key;
      await page.locator('#nextMonth').click();
      assert.ok((await topPosition(page)).key > before);
    }
    for (let i = 0; i < 4; i++) {
      const before = (await topPosition(page)).key;
      await page.locator('#prevMonth').click();
      assert.ok((await topPosition(page)).key < before);
    }
    console.log('PASS: month shortcuts never get stuck at shared weeks');

    // Exercise both rolling-buffer edges repeatedly; each buffer remains bounded
    for (const direction of ['up', 'down']) {
      for (let repeat = 0; repeat < 4; repeat++) {
        const expected = await page.evaluate(direction => {
          const viewport = document.querySelector('#calendarViewport');
          const grid = viewport.firstElementChild;
          const height = grid.firstElementChild.getBoundingClientRect().height;
          const index = direction === 'up' ? 2 : 68;
          const expected = grid.children[index * 7].dataset.date;
          viewport.scrollTop = (index + 0.25) * height;
          return expected;
        }, direction);
        await page.waitForTimeout(100);
        const current = await topPosition(page);
        assert.equal(current.key, expected);
        assert.ok(Math.abs(current.fraction - 0.25) < 0.02);
        assert.equal(current.cells, 546);
      }
    }
    console.log('PASS: past/future buffer extension preserves date, partial offset and bounded DOM size');

    // Fresh reload and responsive viewport changes do not lose stored records
    await page.reload();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-date="2027-01-01"] .shift-name').count(), 2);
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 660 }, { width: 844, height: 390 }, { width: 768, height: 1024 }]) {
      const before = await topPosition(page);
      await page.setViewportSize(viewport);
      await page.waitForTimeout(150);
      const after = await topPosition(page);
      assert.equal(after.key, before.key);
      assert.ok(Math.abs(after.fraction - before.fraction) < 0.03);
      assert.ok(Math.abs(after.viewportHeight / after.height - 5) < 0.03);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.locator('#openShare').isVisible());
    }
    await page.setViewportSize({ width: 390, height: 744 });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(process.env.QA_OUTPUT_DIR || '/tmp', 'shift-edit-screen.png'), fullPage: true });
    await page.locator('#projectSelect').selectOption('p2');
    assert.equal(await page.locator('#calendarGrid .shift-name').count(), 0);
    await page.locator('#projectSelect').selectOption('p1');
    assert.ok(await page.locator('#calendarGrid .shift-name').count() > 0);
    assert.deepEqual(errors, []);
    console.log('PASS: reload, four viewport sizes, no horizontal overflow, project isolation and no browser errors');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
