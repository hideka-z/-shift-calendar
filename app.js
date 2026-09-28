(() => {
  'use strict';

  const STORAGE_KEY = 'shift-calendar-v1';
  const SLOT_LABELS = { all: '終日', am: '午前', pm: '午後' };
  const $ = (selector) => document.querySelector(selector);

  const elements = {
    app: $('#app'), projectSelect: $('#projectSelect'), settingsProjectSelect: $('#settingsProjectSelect'),
    monthLabel: $('#monthLabel'), calendarGrid: $('#calendarGrid'), prevMonth: $('#prevMonth'), nextMonth: $('#nextMonth'),
    dayDialog: $('#dayDialog'), selectedDateLabel: $('#selectedDateLabel'), prevDay: $('#prevDay'), nextDay: $('#nextDay'), assignmentList: $('#assignmentList'),
    noAssignments: $('#noAssignments'), memberSelect: $('#memberSelect'), slotSelect: $('#slotSelect'), addAssignment: $('#addAssignment'),
    settingsDialog: $('#settingsDialog'), openSettings: $('#openSettings'), projectNameInput: $('#projectNameInput'),
    editProjectNameInput: $('#editProjectNameInput'), renameProject: $('#renameProject'), deleteProject: $('#deleteProject'),
    addProject: $('#addProject'), memberList: $('#memberList'), memberNameInput: $('#memberNameInput'), addMember: $('#addMember'),
    openShare: $('#openShare'), closeShare: $('#closeShare'), shareHeader: $('#shareHeader'), shareTitle: $('#shareTitle'), shareMeta: $('#shareMeta'),
    backupButton: $('#backupButton'), restoreButton: $('#restoreButton'), restoreInput: $('#restoreInput'), toast: $('#toast')
  };

  const now = new Date();
  let state = loadState();
  let viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
  let selectedDateKey = null;
  let shareMode = false;
  let toastTimer = null;

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function defaultState() {
    const projectId = uid('project');
    return {
      version: 1,
      selectedProjectId: projectId,
      updatedAt: new Date().toISOString(),
      projects: [{ id: projectId, name: 'プロジェクトA', members: [], shifts: {} }]
    };
  }

  function normalizeState(value) {
    if (!value || !Array.isArray(value.projects) || value.projects.length === 0) return defaultState();
    value.version = 1;
    value.projects = value.projects.map(project => ({
      id: String(project.id || uid('project')),
      name: String(project.name || '名称未設定'),
      members: Array.isArray(project.members) ? project.members.map(member => ({ id: String(member.id || uid('member')), name: String(member.name || '') })).filter(member => member.name) : [],
      shifts: project.shifts && typeof project.shifts === 'object' ? project.shifts : {}
    }));
    if (!value.projects.some(project => project.id === value.selectedProjectId)) value.selectedProjectId = value.projects[0].id;
    return value;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeState(JSON.parse(saved)) : defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveState(message) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (message) showToast(message);
  }

  function selectedProject() {
    return state.projects.find(project => project.id === state.selectedProjectId) || state.projects[0];
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function dateKey(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function nthWeekday(year, monthIndex, weekday, nth) {
    const first = new Date(year, monthIndex, 1).getDay();
    return 1 + ((7 + weekday - first) % 7) + (nth - 1) * 7;
  }

  function vernalEquinox(year) {
    if (year <= 1979) return Math.floor(20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
    if (year <= 2099) return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    return 20;
  }

  function autumnEquinox(year) {
    if (year <= 1979) return Math.floor(23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
    if (year <= 2099) return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    return 23;
  }

  function japaneseHolidayKeys(year) {
    const holidays = new Set();
    const add = (month, day) => holidays.add(dateKey(year, month - 1, day));
    add(1, 1);
    if (year >= 2000) add(1, nthWeekday(year, 0, 1, 2)); else add(1, 15);
    add(2, 11);
    if (year >= 2020) add(2, 23);
    add(3, vernalEquinox(year));
    add(4, 29); add(5, 3); add(5, 4); add(5, 5);
    if (year === 2020) add(7, 23);
    else if (year === 2021) add(7, 22);
    else if (year >= 2003) add(7, nthWeekday(year, 6, 1, 3));
    else add(7, 20);
    if (year === 2020) add(8, 10);
    else if (year === 2021) add(8, 8);
    else if (year >= 2016) add(8, 11);
    if (year >= 2003) add(9, nthWeekday(year, 8, 1, 3)); else add(9, 15);
    add(9, autumnEquinox(year));
    if (year === 2020) add(7, 24);
    else if (year === 2021) add(7, 23);
    else if (year >= 2000) add(10, nthWeekday(year, 9, 1, 2));
    else add(10, 10);
    add(11, 3); add(11, 23);
    if (year >= 1989 && year <= 2018) add(12, 23);

    const sorted = [...holidays].sort();
    for (let i = 1; i < sorted.length; i++) {
      const previous = new Date(`${sorted[i - 1]}T00:00:00`);
      const current = new Date(`${sorted[i]}T00:00:00`);
      if ((current - previous) / 86400000 === 2) {
        const between = new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + 1);
        if (between.getDay() !== 0) holidays.add(dateKey(between.getFullYear(), between.getMonth(), between.getDate()));
      }
    }

    [...holidays].sort().forEach(key => {
      const date = new Date(`${key}T00:00:00`);
      if (date.getDay() === 0) {
        let substitute = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
        while (holidays.has(dateKey(substitute.getFullYear(), substitute.getMonth(), substitute.getDate()))) {
          substitute = new Date(substitute.getFullYear(), substitute.getMonth(), substitute.getDate() + 1);
        }
        holidays.add(dateKey(substitute.getFullYear(), substitute.getMonth(), substitute.getDate()));
      }
    });
    return holidays;
  }

  function render() {
    renderProjectOptions();
    renderCalendar();
    if (elements.settingsDialog.open) renderSettings();
  }

  function renderProjectOptions() {
    const options = state.projects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('');
    elements.projectSelect.innerHTML = options;
    elements.settingsProjectSelect.innerHTML = options;
    elements.projectSelect.value = state.selectedProjectId;
    elements.settingsProjectSelect.value = state.selectedProjectId;
  }

  function iconForSlot(slot) {
    if (slot === 'am') return '<svg aria-label="午前"><use href="#icon-sunrise"/></svg>';
    if (slot === 'pm') return '<svg aria-label="午後"><use href="#icon-sun"/></svg>';
    return '';
  }

  function renderCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();
    const totalCells = firstDay + daysInMonth <= 35 ? 35 : 42;
    const holidays = japaneseHolidayKeys(year);
    const project = selectedProject();
    const memberMap = new Map(project.members.map(member => [member.id, member.name]));

    elements.monthLabel.textContent = `${year}年${month + 1}月`;
    const cells = [];
    for (let index = 0; index < totalCells; index++) {
      const rawDay = index - firstDay + 1;
      let cellDate;
      let outside = false;
      if (rawDay < 1) {
        cellDate = new Date(year, month - 1, previousMonthDays + rawDay);
        outside = true;
      } else if (rawDay > daysInMonth) {
        cellDate = new Date(year, month + 1, rawDay - daysInMonth);
        outside = true;
      } else {
        cellDate = new Date(year, month, rawDay);
      }
      const key = dateKey(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
      const dow = cellDate.getDay();
      const isToday = key === dateKey(now.getFullYear(), now.getMonth(), now.getDate());
      const classes = ['day-cell'];
      if (outside) classes.push('is-outside');
      if (!outside && dow === 0) classes.push('is-sunday');
      if (!outside && dow === 6) classes.push('is-saturday');
      if (!outside && holidays.has(key)) classes.push('is-holiday');
      if (!outside && isToday) classes.push('is-today');

      const memberOrder = new Map(project.members.map((member, index) => [member.id, index]));
      const validAssignments = outside ? [] : (project.shifts[key] || [])
        .filter(item => memberMap.has(item.memberId))
        .sort((a, b) => memberOrder.get(a.memberId) - memberOrder.get(b.memberId));
      const visible = validAssignments.slice(0, 3);
      const entries = visible.map(item => `<span class="shift-entry">${iconForSlot(item.slot)}<span class="shift-name">${escapeHtml(memberMap.get(item.memberId))}</span></span>`).join('');
      const more = validAssignments.length > 3 ? `<span class="more-count">ほか${validAssignments.length - 3}名</span>` : '';
      const aria = `${month + 1}月${rawDay}日${validAssignments.length ? `、${validAssignments.map(item => `${memberMap.get(item.memberId)} ${SLOT_LABELS[item.slot]}`).join('、')}` : ''}`;
      cells.push(`<button class="${classes.join(' ')}" type="button" data-date="${outside ? '' : key}" ${outside || shareMode ? 'disabled' : ''} aria-label="${escapeHtml(aria)}"><span class="day-number">${cellDate.getDate()}</span>${entries}${more}</button>`);
    }
    elements.calendarGrid.innerHTML = cells.join('');
    elements.calendarGrid.querySelectorAll('[data-date]').forEach(button => {
      if (button.dataset.date) button.addEventListener('click', () => openDay(button.dataset.date));
    });
    updateShareHeader();
  }

  function openDay(key) {
    selectedDateKey = key;
    renderDayDialog();
    elements.dayDialog.showModal();
  }

  function renderDayDialog() {
    const project = selectedProject();
    const date = new Date(`${selectedDateKey}T00:00:00`);
    const week = ['日','月','火','水','木','金','土'];
    elements.selectedDateLabel.textContent = `${date.getMonth() + 1}月${date.getDate()}日（${week[date.getDay()]}）`;
    const assignments = project.shifts[selectedDateKey] || [];
    const memberMap = new Map(project.members.map(member => [member.id, member.name]));
    const memberOrder = new Map(project.members.map((member, index) => [member.id, index]));
    const valid = assignments
      .filter(item => memberMap.has(item.memberId))
      .sort((a, b) => memberOrder.get(a.memberId) - memberOrder.get(b.memberId));
    elements.assignmentList.innerHTML = valid.map(item => `
      <div class="assignment-row" data-member-id="${escapeHtml(item.memberId)}">
        <span class="assignment-name">${escapeHtml(memberMap.get(item.memberId))}</span>
        <select class="assignment-slot" aria-label="${escapeHtml(memberMap.get(item.memberId))}の勤務区分">
          ${Object.entries(SLOT_LABELS).map(([value,label]) => `<option value="${value}" ${item.slot === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <button class="remove-button" type="button" aria-label="${escapeHtml(memberMap.get(item.memberId))}をこの日から外す">×</button>
      </div>`).join('');
    elements.noAssignments.hidden = valid.length > 0;
    elements.memberSelect.innerHTML = project.members.map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}</option>`).join('');
    elements.addAssignment.disabled = project.members.length === 0;
    elements.memberSelect.disabled = project.members.length === 0;

    elements.assignmentList.querySelectorAll('.assignment-slot').forEach(select => {
      select.addEventListener('change', event => {
        const memberId = event.target.closest('.assignment-row').dataset.memberId;
        const item = (project.shifts[selectedDateKey] || []).find(entry => entry.memberId === memberId);
        if (item) item.slot = event.target.value;
        saveState('勤務区分を変更しました');
        renderCalendar();
      });
    });
    elements.assignmentList.querySelectorAll('.remove-button').forEach(button => {
      button.addEventListener('click', event => {
        const memberId = event.target.closest('.assignment-row').dataset.memberId;
        project.shifts[selectedDateKey] = (project.shifts[selectedDateKey] || []).filter(item => item.memberId !== memberId);
        if (project.shifts[selectedDateKey].length === 0) delete project.shifts[selectedDateKey];
        saveState('勤務者を外しました');
        renderDayDialog();
        renderCalendar();
      });
    });
  }

  function addAssignment() {
    const project = selectedProject();
    if (!elements.memberSelect.value) return;
    project.shifts[selectedDateKey] ||= [];
    const existing = project.shifts[selectedDateKey].find(item => item.memberId === elements.memberSelect.value);
    if (existing) {
      existing.slot = elements.slotSelect.value;
      showToast('登録済みの勤務区分を変更しました');
    } else {
      project.shifts[selectedDateKey].push({ memberId: elements.memberSelect.value, slot: elements.slotSelect.value });
      showToast('勤務者を追加しました');
    }
    saveState();
    renderDayDialog();
    renderCalendar();
  }

  function moveSelectedDay(amount) {
    const current = new Date(`${selectedDateKey}T00:00:00`);
    const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + amount);
    selectedDateKey = dateKey(next.getFullYear(), next.getMonth(), next.getDate());
    if (viewDate.getFullYear() !== next.getFullYear() || viewDate.getMonth() !== next.getMonth()) {
      viewDate = new Date(next.getFullYear(), next.getMonth(), 1);
    }
    renderDayDialog();
    renderCalendar();
  }

  function renderSettings() {
    renderProjectOptions();
    const project = selectedProject();
    elements.editProjectNameInput.value = project.name;
    elements.deleteProject.disabled = state.projects.length === 1;
    elements.memberList.innerHTML = project.members.length
      ? project.members.map((member, index) => `
        <div class="member-item" data-member-id="${escapeHtml(member.id)}">
          <input class="member-name-edit" type="text" maxlength="12" value="${escapeHtml(member.name)}" aria-label="${escapeHtml(member.name)}の表示名">
          <button class="button member-save" type="button">変更</button>
          <button class="button member-move member-up" type="button" aria-label="${escapeHtml(member.name)}を上へ移動" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="button member-move member-down" type="button" aria-label="${escapeHtml(member.name)}を下へ移動" ${index === project.members.length - 1 ? 'disabled' : ''}>↓</button>
        </div>`).join('')
      : '<p class="empty-message">メンバーはまだ登録されていません</p>';
  }

  function renameSelectedProject() {
    const name = elements.editProjectNameInput.value.trim();
    if (!name) return showToast('プロジェクト名を入力してください');
    selectedProject().name = name;
    saveState('プロジェクト名を変更しました');
    render();
  }

  function deleteSelectedProject() {
    if (state.projects.length === 1) return showToast('最後のプロジェクトは削除できません');
    const project = selectedProject();
    if (!confirm(`「${project.name}」と勤務情報を削除しますか？`)) return;
    const index = state.projects.findIndex(item => item.id === project.id);
    state.projects.splice(index, 1);
    state.selectedProjectId = state.projects[Math.min(index, state.projects.length - 1)].id;
    saveState('プロジェクトを削除しました');
    render();
  }

  function updateMember(memberId, action) {
    const project = selectedProject();
    const index = project.members.findIndex(member => member.id === memberId);
    if (index < 0) return;

    if (action === 'save') {
      const row = elements.memberList.querySelector(`[data-member-id="${CSS.escape(memberId)}"]`);
      const name = row.querySelector('.member-name-edit').value.trim();
      if (!name) return showToast('表示する名前を入力してください');
      if (project.members.some(member => member.id !== memberId && member.name === name)) return showToast('同じ名前が登録されています');
      project.members[index].name = name;
      saveState('メンバー名を変更しました');
    } else {
      const nextIndex = action === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= project.members.length) return;
      [project.members[index], project.members[nextIndex]] = [project.members[nextIndex], project.members[index]];
      saveState('メンバーの順番を変更しました');
    }
    renderSettings();
    renderCalendar();
  }

  function addProject() {
    const name = elements.projectNameInput.value.trim();
    if (!name) return showToast('プロジェクト名を入力してください');
    const project = { id: uid('project'), name, members: [], shifts: {} };
    state.projects.push(project);
    state.selectedProjectId = project.id;
    elements.projectNameInput.value = '';
    saveState('プロジェクトを追加しました');
    render();
  }

  function addMember() {
    const name = elements.memberNameInput.value.trim();
    if (!name) return showToast('表示する名前を入力してください');
    const project = selectedProject();
    if (project.members.some(member => member.name === name)) return showToast('同じ名前が登録されています');
    project.members.push({ id: uid('member'), name });
    elements.memberNameInput.value = '';
    saveState('メンバーを登録しました');
    renderSettings();
  }

  function setProject(id) {
    state.selectedProjectId = id;
    saveState();
    render();
  }

  function toggleShare(enabled) {
    shareMode = enabled;
    elements.app.classList.toggle('share-mode', enabled);
    document.querySelectorAll('.edit-only').forEach(node => { node.hidden = enabled; });
    document.querySelectorAll('.share-only').forEach(node => { node.hidden = !enabled; });
    renderCalendar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateShareHeader() {
    const project = selectedProject();
    elements.shareTitle.textContent = `${viewDate.getFullYear()}年${viewDate.getMonth() + 1}月 シフト表`;
    const updated = new Date(state.updatedAt);
    const formatted = `${updated.getMonth() + 1}月${updated.getDate()}日 ${String(updated.getHours()).padStart(2,'0')}:${String(updated.getMinutes()).padStart(2,'0')}`;
    elements.shareMeta.textContent = `${project.name}　最終更新 ${formatted}`;
  }

  function backup() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    anchor.href = url;
    anchor.download = `shift-calendar-backup-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast('バックアップを保存しました');
  }

  async function restore(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const restored = normalizeState(parsed);
      if (!confirm('現在のデータを、選択したバックアップの内容に置き換えますか？')) return;
      state = restored;
      saveState('バックアップを復元しました');
      render();
    } catch {
      showToast('このファイルは復元に使用できません');
    } finally {
      elements.restoreInput.value = '';
    }
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
  }

  elements.prevMonth.addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderCalendar(); });
  elements.nextMonth.addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderCalendar(); });
  elements.projectSelect.addEventListener('change', event => setProject(event.target.value));
  elements.settingsProjectSelect.addEventListener('change', event => setProject(event.target.value));
  elements.openSettings.addEventListener('click', () => { renderSettings(); elements.settingsDialog.showModal(); });
  elements.addProject.addEventListener('click', addProject);
  elements.renameProject.addEventListener('click', renameSelectedProject);
  elements.deleteProject.addEventListener('click', deleteSelectedProject);
  elements.addMember.addEventListener('click', addMember);
  elements.memberList.addEventListener('click', event => {
    const row = event.target.closest('.member-item');
    if (!row) return;
    if (event.target.closest('.member-save')) updateMember(row.dataset.memberId, 'save');
    if (event.target.closest('.member-up')) updateMember(row.dataset.memberId, 'up');
    if (event.target.closest('.member-down')) updateMember(row.dataset.memberId, 'down');
  });
  elements.projectNameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addProject(); } });
  elements.memberNameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addMember(); } });
  elements.addAssignment.addEventListener('click', addAssignment);
  elements.prevDay.addEventListener('click', () => moveSelectedDay(-1));
  elements.nextDay.addEventListener('click', () => moveSelectedDay(1));
  elements.openShare.addEventListener('click', () => toggleShare(true));
  elements.closeShare.addEventListener('click', () => toggleShare(false));
  elements.backupButton.addEventListener('click', backup);
  elements.restoreButton.addEventListener('click', () => elements.restoreInput.click());
  elements.restoreInput.addEventListener('change', event => restore(event.target.files[0]));

  [elements.dayDialog, elements.settingsDialog].forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  });

  render();
})();
