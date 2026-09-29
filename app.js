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
    projectItem: $('#projectItem'), projectNameDisplay: $('#projectNameDisplay'), editProjectNameInput: $('#editProjectNameInput'), deleteProject: $('#deleteProject'),
    addProject: $('#addProject'), memberList: $('#memberList'), memberNameInput: $('#memberNameInput'), addMember: $('#addMember'),
    toggleWorkdayMode: $('#toggleWorkdayMode'), workdayDialog: $('#workdayDialog'), workdayProjectName: $('#workdayProjectName'),
    workdayMonthLabel: $('#workdayMonthLabel'), workdayCalendarGrid: $('#workdayCalendarGrid'), workdayPrevMonth: $('#workdayPrevMonth'), workdayNextMonth: $('#workdayNextMonth'),
    openShare: $('#openShare'), shareToggleLabel: $('#shareToggleLabel'), saveShareImage: $('#saveShareImage'), shareHeader: $('#shareHeader'), shareTitle: $('#shareTitle'), shareMeta: $('#shareMeta'),
    backupButton: $('#backupButton'), restoreButton: $('#restoreButton'), restoreInput: $('#restoreInput'), toast: $('#toast')
  };

  const now = new Date();
  let state = loadState();
  let viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
  let selectedDateKey = null;
  let shareMode = false;
  let toastTimer = null;
  let openSwipeRow = null;

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function defaultState() {
    const projectId = uid('project');
    return {
      version: 1,
      selectedProjectId: projectId,
      updatedAt: new Date().toISOString(),
      projects: [{ id: projectId, name: 'プロジェクトA', members: [], shifts: {}, workdays: {} }]
    };
  }

  function normalizeState(value) {
    if (!value || !Array.isArray(value.projects) || value.projects.length === 0) return defaultState();
    value.version = 1;
    value.projects = value.projects.map(project => ({
      id: String(project.id || uid('project')),
      name: String(project.name || '名称未設定'),
      members: Array.isArray(project.members) ? project.members.map(member => ({ id: String(member.id || uid('member')), name: String(member.name || '') })).filter(member => member.name) : [],
      shifts: project.shifts && typeof project.shifts === 'object' ? project.shifts : {},
      workdays: project.workdays && typeof project.workdays === 'object' ? project.workdays : {}
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
    if (elements.workdayDialog.open) renderWorkdayCalendar();
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
      if (!outside && project.workdays[key]) classes.push('is-workday');
      if (!outside && isToday) classes.push('is-today');

      const memberOrder = new Map(project.members.map((member, index) => [member.id, index]));
      const validAssignments = outside ? [] : (project.shifts[key] || [])
        .filter(item => memberMap.has(item.memberId))
        .sort((a, b) => memberOrder.get(a.memberId) - memberOrder.get(b.memberId));
      const visible = validAssignments.slice(0, 3);
      const entries = visible.map(item => `<span class="shift-entry">${iconForSlot(item.slot)}<span class="shift-name">${escapeHtml(memberMap.get(item.memberId))}</span></span>`).join('');
      const more = validAssignments.length > 3 ? `<span class="more-count">ほか${validAssignments.length - 3}名</span>` : '';
      const aria = `${month + 1}月${rawDay}日${!outside && project.workdays[key] ? '、勤務日' : ''}${validAssignments.length ? `、${validAssignments.map(item => `${memberMap.get(item.memberId)} ${SLOT_LABELS[item.slot]}`).join('、')}` : ''}`;
      cells.push(`<button class="${classes.join(' ')}" type="button" data-date="${outside ? '' : key}" ${outside || shareMode ? 'disabled' : ''} aria-label="${escapeHtml(aria)}"><span class="day-number">${cellDate.getDate()}</span><span class="shift-list">${entries}${more}</span></button>`);
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

  function toggleWorkday(key) {
    const project = selectedProject();
    if (project.workdays[key]) delete project.workdays[key];
    else project.workdays[key] = true;
    saveState();
    renderCalendar();
    renderWorkdayCalendar();
  }

  function openWorkdayDialog() {
    renderWorkdayCalendar();
    elements.workdayDialog.showModal();
  }

  function renderWorkdayCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();
    const totalCells = firstDay + daysInMonth <= 35 ? 35 : 42;
    const holidays = japaneseHolidayKeys(year);
    const project = selectedProject();
    const cells = [];

    elements.workdayProjectName.textContent = project.name;
    elements.workdayMonthLabel.textContent = `${year}年${month + 1}月`;
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
      const classes = ['day-cell'];
      if (outside) classes.push('is-outside');
      if (!outside && dow === 0) classes.push('is-sunday');
      if (!outside && dow === 6) classes.push('is-saturday');
      if (!outside && holidays.has(key)) classes.push('is-holiday');
      if (!outside && project.workdays[key]) classes.push('is-workday');
      const aria = `${month + 1}月${rawDay}日${!outside && project.workdays[key] ? '、勤務日' : ''}`;
      cells.push(`<button class="${classes.join(' ')}" type="button" data-workday-date="${outside ? '' : key}" ${outside ? 'disabled' : ''} aria-pressed="${!outside && project.workdays[key] ? 'true' : 'false'}" aria-label="${escapeHtml(aria)}"><span class="day-number">${cellDate.getDate()}</span></button>`);
    }
    elements.workdayCalendarGrid.innerHTML = cells.join('');
    elements.workdayCalendarGrid.querySelectorAll('[data-workday-date]').forEach(button => {
      if (button.dataset.workdayDate) button.addEventListener('click', () => toggleWorkday(button.dataset.workdayDate));
    });
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
    elements.projectNameDisplay.textContent = project.name;
    elements.editProjectNameInput.value = project.name;
    elements.deleteProject.disabled = state.projects.length === 1;
    elements.projectItem.classList.remove('is-open', 'is-editing');
    elements.memberList.innerHTML = project.members.length
      ? project.members.map(member => `
        <div class="swipe-row member-item" data-member-id="${escapeHtml(member.id)}">
          <div class="swipe-actions" aria-label="${escapeHtml(member.name)}の操作">
            <button class="swipe-edit" type="button">編集</button>
            <button class="swipe-delete" type="button">削除</button>
          </div>
          <div class="swipe-content member-content">
            <span class="member-name-display">${escapeHtml(member.name)}</span>
            <input class="inline-edit-input member-name-edit" type="text" maxlength="12" value="${escapeHtml(member.name)}" aria-label="${escapeHtml(member.name)}の表示名">
            <button class="drag-handle" type="button" aria-label="${escapeHtml(member.name)}を並び替える"><span class="drag-handle-lines"></span></button>
          </div>
        </div>`).join('')
      : '<p class="empty-message">メンバーはまだ登録されていません</p>';
    setupSwipeRows();
    setupMemberDragging();
  }

  function saveProjectName() {
    const name = elements.editProjectNameInput.value.trim();
    if (!name) {
      elements.editProjectNameInput.value = selectedProject().name;
      showToast('プロジェクト名を入力してください');
    } else if (name !== selectedProject().name) {
      selectedProject().name = name;
      saveState('プロジェクト名を変更しました');
    }
    elements.projectNameDisplay.textContent = selectedProject().name;
    elements.projectItem.classList.remove('is-editing');
    renderProjectOptions();
    renderCalendar();
  }

  function editProjectName() {
    elements.projectItem.classList.remove('is-open');
    elements.projectItem.classList.add('is-editing');
    elements.editProjectNameInput.focus();
    elements.editProjectNameInput.select();
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

  function saveMemberName(row) {
    const project = selectedProject();
    const memberId = row.dataset.memberId;
    const index = project.members.findIndex(member => member.id === memberId);
    if (index < 0) return;
    const input = row.querySelector('.member-name-edit');
    const name = input.value.trim();
    if (!name) {
      input.value = project.members[index].name;
      showToast('表示する名前を入力してください');
    } else if (project.members.some(member => member.id !== memberId && member.name === name)) {
      input.value = project.members[index].name;
      showToast('同じ名前が登録されています');
    } else if (name !== project.members[index].name) {
      project.members[index].name = name;
      saveState('メンバー名を変更しました');
    }
    row.querySelector('.member-name-display').textContent = project.members[index].name;
    row.classList.remove('is-editing');
    renderCalendar();
  }

  function editMemberName(row) {
    row.classList.remove('is-open');
    row.classList.add('is-editing');
    const input = row.querySelector('.member-name-edit');
    input.focus();
    input.select();
  }

  function deleteMember(memberId) {
    const project = selectedProject();
    const member = project.members.find(item => item.id === memberId);
    if (!member || !confirm(`「${member.name}」を削除しますか？\n登録済みの勤務情報からも削除されます`)) return;
    project.members = project.members.filter(item => item.id !== memberId);
    Object.keys(project.shifts).forEach(key => {
      project.shifts[key] = project.shifts[key].filter(item => item.memberId !== memberId);
      if (project.shifts[key].length === 0) delete project.shifts[key];
    });
    saveState('メンバーを削除しました');
    renderSettings();
    renderCalendar();
  }

  function closeSwipeRows(except = null) {
    document.querySelectorAll('.swipe-row.is-open').forEach(row => {
      if (row !== except) row.classList.remove('is-open');
    });
    openSwipeRow = except;
  }

  function setupSwipeRows() {
    document.querySelectorAll('.swipe-row').forEach(row => {
      const content = row.querySelector('.swipe-content');
      if (!content || content.dataset.swipeReady) return;
      content.dataset.swipeReady = 'true';
      let startX = 0;
      let startY = 0;
      let dragging = false;

      content.addEventListener('pointerdown', event => {
        if (event.target.closest('.drag-handle') || event.target.closest('input')) return;
        startX = event.clientX;
        startY = event.clientY;
        dragging = true;
        content.style.transition = 'none';
        content.setPointerCapture(event.pointerId);
        closeSwipeRows(row.classList.contains('is-open') ? row : null);
      });
      content.addEventListener('pointermove', event => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) return;
        const base = row.classList.contains('is-open') ? -116 : 0;
        const offset = Math.max(-116, Math.min(0, base + dx));
        content.style.transform = `translateX(${offset}px)`;
      });
      const finish = event => {
        if (!dragging) return;
        dragging = false;
        const dx = event.clientX - startX;
        content.style.transition = '';
        content.style.transform = '';
        if (dx < -38) {
          closeSwipeRows(row);
          row.classList.add('is-open');
        } else if (dx > 28) {
          row.classList.remove('is-open');
          closeSwipeRows();
        }
      };
      content.addEventListener('pointerup', finish);
      content.addEventListener('pointercancel', () => {
        dragging = false;
        content.style.transition = '';
        content.style.transform = '';
      });
    });
  }

  function setupMemberDragging() {
    elements.memberList.querySelectorAll('.drag-handle').forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        closeSwipeRows();
        const row = handle.closest('.member-item');
        row.classList.add('is-dragging');
        handle.setPointerCapture(event.pointerId);

        const move = moveEvent => {
          const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.member-item');
          if (!target || target === row || target.parentElement !== elements.memberList) return;
          const rect = target.getBoundingClientRect();
          if (moveEvent.clientY < rect.top + rect.height / 2) target.before(row);
          else target.after(row);
        };
        const finish = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', finish);
          handle.removeEventListener('pointercancel', finish);
          row.classList.remove('is-dragging');
          const project = selectedProject();
          const memberMap = new Map(project.members.map(member => [member.id, member]));
          project.members = [...elements.memberList.querySelectorAll('.member-item')].map(item => memberMap.get(item.dataset.memberId));
          saveState('メンバーの順番を変更しました');
          renderSettings();
          renderCalendar();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
      });
    });
  }

  function addProject() {
    const name = elements.projectNameInput.value.trim();
    if (!name) return showToast('プロジェクト名を入力してください');
    const project = { id: uid('project'), name, members: [], shifts: {}, workdays: {} };
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
    elements.openShare.setAttribute('aria-pressed', String(enabled));
    elements.shareToggleLabel.textContent = enabled ? '共有表示終了' : '共有表示';
    renderCalendar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateShareHeader() {
    const project = selectedProject();
    elements.shareTitle.textContent = `${viewDate.getFullYear()}年${viewDate.getMonth() + 1}月 シフト表`;
    const updated = new Date(state.updatedAt);
    const formatted = `${updated.getFullYear()}年${updated.getMonth() + 1}月${updated.getDate()}日`;
    elements.shareMeta.textContent = `${project.name}　最終更新 ${formatted}`;
  }

  function fitCanvasText(context, value, maxWidth) {
    const text = String(value);
    if (context.measureText(text).width <= maxWidth) return text;
    let shortened = text;
    while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
    return `${shortened}…`;
  }

  function drawSunIcon(context, x, y) {
    context.save();
    context.strokeStyle = '#18212b';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(x, y, 7, 0, Math.PI * 2);
    context.stroke();
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * 11, y + Math.sin(angle) * 11);
      context.lineTo(x + Math.cos(angle) * 15, y + Math.sin(angle) * 15);
      context.stroke();
    }
    context.restore();
  }

  function drawSunriseIcon(context, x, y) {
    context.save();
    context.strokeStyle = '#18212b';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x - 15, y + 7);
    context.lineTo(x + 15, y + 7);
    context.moveTo(x - 9, y + 5);
    context.arc(x, y + 5, 9, Math.PI, Math.PI * 2);
    context.moveTo(x, y - 14);
    context.lineTo(x, y - 9);
    context.moveTo(x - 13, y - 8);
    context.lineTo(x - 10, y - 5);
    context.moveTo(x + 13, y - 8);
    context.lineTo(x + 10, y - 5);
    context.stroke();
    context.restore();
  }

  function createShareCanvas() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();
    const totalCells = firstDay + daysInMonth <= 35 ? 35 : 42;
    const rows = totalCells / 7;
    const holidays = japaneseHolidayKeys(year);
    const project = selectedProject();
    const memberMap = new Map(project.members.map(member => [member.id, member.name]));
    const memberOrder = new Map(project.members.map((member, index) => [member.id, index]));
    const width = 1400;
    const side = 70;
    const gridWidth = width - side * 2;
    const columnWidth = gridWidth / 7;
    const headerHeight = 160;
    const weekdayHeight = 64;
    const cellHeight = 170;
    const height = headerHeight + weekdayHeight + rows * cellHeight + 50;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const fontFamily = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif';

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#18212b';
    context.font = `600 44px ${fontFamily}`;
    context.fillText(`${year}年${month + 1}月 シフト表`, width / 2, 52);
    const updated = new Date(state.updatedAt);
    const updatedText = `${updated.getFullYear()}年${updated.getMonth() + 1}月${updated.getDate()}日`;
    context.fillStyle = '#6d7783';
    context.font = `400 25px ${fontFamily}`;
    context.fillText(fitCanvasText(context, `${project.name}　最終更新 ${updatedText}`, gridWidth), width / 2, 110);

    const weekdays = ['日','月','火','水','木','金','土'];
    context.fillStyle = '#f7f8fa';
    context.fillRect(side, headerHeight, gridWidth, weekdayHeight);
    context.font = `600 25px ${fontFamily}`;
    weekdays.forEach((label, index) => {
      context.fillStyle = index === 0 ? '#ba3d48' : index === 6 ? '#226aa6' : '#6d7783';
      context.fillText(label, side + columnWidth * index + columnWidth / 2, headerHeight + weekdayHeight / 2);
    });

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
      const column = index % 7;
      const row = Math.floor(index / 7);
      const x = side + column * columnWidth;
      const y = headerHeight + weekdayHeight + row * cellHeight;
      if (outside) context.fillStyle = '#f7f8fa';
      else if (project.workdays[key]) context.fillStyle = '#fff4c9';
      else if (dow === 0 || holidays.has(key)) context.fillStyle = '#fff2f3';
      else if (dow === 6) context.fillStyle = '#eef7ff';
      else context.fillStyle = '#ffffff';
      context.fillRect(x, y, columnWidth, cellHeight);
      context.strokeStyle = '#c7ced6';
      context.lineWidth = 2;
      context.strokeRect(x, y, columnWidth, cellHeight);

      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(x, y + cellHeight);
      context.lineTo(x + columnWidth, y + cellHeight);
      context.stroke();

      const dateBandHeight = 44;
      context.strokeStyle = '#c7ced6';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, y + dateBandHeight);
      context.lineTo(x + columnWidth, y + dateBandHeight);
      context.stroke();

      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `500 27px ${fontFamily}`;
      context.fillStyle = outside ? '#9ba3ac' : dow === 0 || holidays.has(key) ? '#ba3d48' : dow === 6 ? '#226aa6' : '#6d7783';
      context.fillText(String(cellDate.getDate()), x + columnWidth / 2, y + dateBandHeight / 2);

      if (!outside) {
        const assignments = (project.shifts[key] || [])
          .filter(item => memberMap.has(item.memberId))
          .sort((a, b) => memberOrder.get(a.memberId) - memberOrder.get(b.memberId));
        const visible = assignments.slice(0, 3);
        const entryHeight = 34;
        const moreHeight = assignments.length > 3 ? 27 : 0;
        const contentTop = y + dateBandHeight;
        const contentHeight = cellHeight - dateBandHeight;
        const groupHeight = visible.length * entryHeight + moreHeight;
        const groupTop = contentTop + Math.max(0, (contentHeight - groupHeight) / 2);
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.font = `500 27px ${fontFamily}`;
        context.fillStyle = '#18212b';
        visible.forEach((item, assignmentIndex) => {
          const entryY = groupTop + entryHeight * assignmentIndex + entryHeight / 2;
          let nameX = x + 14;
          if (item.slot === 'am') {
            drawSunriseIcon(context, x + 25, entryY);
            nameX = x + 48;
          } else if (item.slot === 'pm') {
            drawSunIcon(context, x + 25, entryY);
            nameX = x + 48;
          }
          context.fillStyle = '#18212b';
          context.fillText(fitCanvasText(context, memberMap.get(item.memberId), x + columnWidth - nameX - 8), nameX, entryY);
        });
        if (assignments.length > 3) {
          context.fillStyle = '#6d7783';
          context.font = `400 21px ${fontFamily}`;
          context.fillText(`ほか${assignments.length - 3}名`, x + 14, groupTop + visible.length * entryHeight + moreHeight / 2);
        }
      }
    }
    return canvas;
  }

  async function saveShareImage() {
    const canvas = createShareCanvas();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return showToast('画像を作成できませんでした');
    const projectName = selectedProject().name.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${viewDate.getFullYear()}年${viewDate.getMonth() + 1}月_シフト表_${projectName}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('画像ファイルを保存しました');
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
  elements.openSettings.addEventListener('click', () => {
    renderSettings();
    elements.settingsDialog.showModal();
  });
  elements.addProject.addEventListener('click', addProject);
  elements.deleteProject.addEventListener('click', deleteSelectedProject);
  elements.projectItem.querySelector('.swipe-edit').addEventListener('click', editProjectName);
  elements.editProjectNameInput.addEventListener('blur', saveProjectName);
  elements.editProjectNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
    if (event.key === 'Escape') {
      event.target.value = selectedProject().name;
      event.target.blur();
    }
  });
  elements.addMember.addEventListener('click', addMember);
  elements.memberList.addEventListener('click', event => {
    const row = event.target.closest('.member-item');
    if (!row) return;
    if (event.target.closest('.swipe-edit')) editMemberName(row);
    if (event.target.closest('.swipe-delete')) deleteMember(row.dataset.memberId);
  });
  elements.memberList.addEventListener('focusout', event => {
    if (event.target.matches('.member-name-edit')) saveMemberName(event.target.closest('.member-item'));
  });
  elements.memberList.addEventListener('keydown', event => {
    if (!event.target.matches('.member-name-edit')) return;
    if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
    if (event.key === 'Escape') {
      const member = selectedProject().members.find(item => item.id === event.target.closest('.member-item').dataset.memberId);
      if (member) event.target.value = member.name;
      event.target.blur();
    }
  });
  elements.projectNameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addProject(); } });
  elements.memberNameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addMember(); } });
  elements.addAssignment.addEventListener('click', addAssignment);
  elements.prevDay.addEventListener('click', () => moveSelectedDay(-1));
  elements.nextDay.addEventListener('click', () => moveSelectedDay(1));
  elements.toggleWorkdayMode.addEventListener('click', () => {
    elements.settingsDialog.close();
    openWorkdayDialog();
  });
  elements.workdayPrevMonth.addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendar();
    renderWorkdayCalendar();
  });
  elements.workdayNextMonth.addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendar();
    renderWorkdayCalendar();
  });
  elements.openShare.addEventListener('click', () => toggleShare(!shareMode));
  elements.saveShareImage.addEventListener('click', saveShareImage);
  elements.backupButton.addEventListener('click', backup);
  elements.restoreButton.addEventListener('click', () => elements.restoreInput.click());
  elements.restoreInput.addEventListener('change', event => restore(event.target.files[0]));

  [elements.dayDialog, elements.settingsDialog, elements.workdayDialog].forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  });
  elements.settingsDialog.addEventListener('pointerdown', event => {
    if (!event.target.closest('.swipe-row')) closeSwipeRows();
  });

  render();
})();
