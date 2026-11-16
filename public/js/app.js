// ===== 作業管理雲端系統 主程式 =====
const PREFIX_BASE = "index";

const STATUS_META = {
  red: { label: "未繳交", icon: "📌", next: "green" },
  green: { label: "已繳交", icon: "🌟", next: "orange" },
  orange: { label: "待訂正", icon: "✏️", next: "blue" },
  blue: { label: "已訂正", icon: "🎉", next: "red" },
};

let classList = [];
let currentClass = localStorage.getItem("currentClass") || "";
let students = [];
let homeworks = {};

let activeView = "calendar";
let calCursor = new Date();
let currentModalDateKey = "";
let currentChecklistDateKey = "";
let activeHwIndex = 0;
let checklistFilter = "all";
let checklistMode = window.innerWidth <= 768 ? "cards" : "table";

// ===== 工具函式 =====
function showToast(msg) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
window.showToast = showToast;

let lastSyncToastTime = 0;
function showSyncSuccessToast() {
  const now = Date.now();
  if (now - lastSyncToastTime > 2000) {
    lastSyncToastTime = now;
    showToast("☁️ 作業登記已成功同步至雲端");
  }
}
window.showSyncSuccessToast = showSyncSuccessToast;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function getTodayKey() {
  return toDateKey(new Date());
}

function toInputDate(dateKey) {
  const parts = String(dateKey).split("-");
  if (parts.length !== 3) return "";
  const y = parts[0];
  const m = parts[1].padStart(2, "0");
  const d = parts[2].padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromInputDate(val) {
  if (!val) return getTodayKey();
  const [y, m, d] = val.split("-").map(Number);
  return `${y}-${m}-${d}`;
}

function formatReadableDate(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${y}年${m}月${d}日（週${weekdays[dt.getDay()]}）`;
}

// ===== 資料讀寫 =====
function getClassPrefix(cName = currentClass) {
  return `${PREFIX_BASE}_${cName}_`;
}

function readClassList() {
  try {
    const raw = localStorage.getItem(`${PREFIX_BASE}_classList`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeClassList(list) {
  classList = list;
  localStorage.setItem(`${PREFIX_BASE}_classList`, JSON.stringify(list));
}

function loadCurrentClassData() {
  classList = readClassList();
  if (!currentClass || !classList.includes(currentClass)) {
    currentClass = classList[0] || "";
    if (currentClass) localStorage.setItem("currentClass", currentClass);
  }

  const label = document.getElementById("currentClassLabel");
  if (label) label.textContent = currentClass || "尚未選擇班級";

  const banner = document.getElementById("emptyClassBanner");
  if (banner) banner.style.display = classList.length === 0 ? "block" : "none";

  if (!currentClass) {
    students = [];
    homeworks = {};
    return;
  }

  try {
    students = JSON.parse(localStorage.getItem(getClassPrefix() + "students") || "[]");
  } catch {
    students = [];
  }
  try {
    homeworks = JSON.parse(localStorage.getItem(getClassPrefix() + "homeworks") || "{}");
  } catch {
    homeworks = {};
  }
}

function saveStudents(list) {
  if (!CloudSync.requireEdit()) return false;
  students = list;
  localStorage.setItem(getClassPrefix() + "students", JSON.stringify(list));
  return true;
}

function saveHomeworks(map) {
  if (!CloudSync.requireEdit()) return false;
  homeworks = map;
  localStorage.setItem(getClassPrefix() + "homeworks", JSON.stringify(map));
  return true;
}

function getChecklistData(dateKey) {
  if (!currentClass) return {};
  try {
    const raw = localStorage.getItem(getClassPrefix() + `checklist_${dateKey}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChecklistData(dateKey, data) {
  if (!CloudSync.requireEdit()) return false;
  localStorage.setItem(getClassPrefix() + `checklist_${dateKey}`, JSON.stringify(data));
  return true;
}

// ===== 視圖切換 =====
function switchView(view) {
  activeView = view;
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `view-${view}`);
  });

  if (view === "calendar") renderCalendar();
  else if (view === "checklist") {
    if (!currentChecklistDateKey) currentChecklistDateKey = getTodayKey();
    renderChecklistView();
  } else if (view === "tracking") {
    renderTrackingSetup();
  } else if (view === "settings") {
    renderSettingsView();
  }
}

// ===== 視圖 1：作業日曆 =====
function changeMonth(delta) {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
  renderCalendar();
}

function goToday() {
  calCursor = new Date();
  renderCalendar();
}

function renderCalendar() {
  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  document.getElementById("calendarTitle").textContent = `${year}年 ${month + 1}月`;

  const grid = document.getElementById("calendarGrid");
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = getTodayKey();

  let html = "";
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-cell empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${month + 1}-${d}`;
    const isToday = dateKey === todayKey;
    const hwList = (homeworks[dateKey] || []).filter((x) => x.trim() !== "");
    const checklist = getChecklistData(dateKey);

    let previewHtml = "";
    let badgeHtml = "";

    if (hwList.length > 0) {
      previewHtml = `<div class="cal-hw-preview">${hwList.map(escapeHtml).join("、")}</div>`;
      let totalChecks = hwList.length * students.length;
      let doneChecks = 0;
      if (totalChecks > 0) {
        hwList.forEach((hw) => {
          const map = checklist[hw] || {};
          students.forEach((stu) => {
            const st = map[stu] || "red";
            if (st === "green" || st === "blue") doneChecks++;
          });
        });
      }
      const allDone = totalChecks > 0 && doneChecks === totalChecks;
      const pct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;
      badgeHtml = `
        <div class="cal-footer">
          <div class="cal-badges">
            <span class="cal-pill">${hwList.length} 項作業</span>
            ${students.length > 0 ? `<span class="cal-pill ${allDone ? "done" : "pending"}">${doneChecks}/${totalChecks}</span>` : ""}
          </div>
          ${students.length > 0 ? `<div class="cal-progress-track"><div class="cal-progress-fill" style="width:${pct}%"></div></div>` : ""}
        </div>
      `;
    }

    html += `
      <div class="cal-cell ${isToday ? "today" : ""}" onclick="onCalendarDayClick('${dateKey}')">
        <div class="cal-day-top">
          <span class="cal-day-num">${d}</span>
        </div>
        ${previewHtml}
        ${badgeHtml}
      </div>
    `;
  }

  grid.innerHTML = html;
}

function onCalendarDayClick(dateKey) {
  if (!currentClass) {
    showToast("請先建立或選擇班級");
    switchView("settings");
    return;
  }
  const hwList = (homeworks[dateKey] || []).filter((x) => x.trim() !== "");
  if (hwList.length > 0 && !CloudSync.isEdit()) {
    currentChecklistDateKey = dateKey;
    switchView("checklist");
    return;
  }
  openDayHomeworkModal(dateKey);
}

function openTodayChecklist() {
  if (!currentClass) {
    showToast("請先建立或選擇班級");
    switchView("settings");
    return;
  }
  currentChecklistDateKey = getTodayKey();
  switchView("checklist");
}

// ===== 每日作業登記彈窗 =====
function openDayHomeworkModal(dateKey) {
  if (!currentClass) {
    showToast("請先建立或選擇班級");
    switchView("settings");
    return;
  }
  currentModalDateKey = dateKey;
  document.getElementById("dayHwModalTitle").textContent = `📝 ${formatReadableDate(dateKey)} 作業`;
  const existing = (homeworks[dateKey] || []).join("\n");
  document.getElementById("dayHwTextarea").value = existing;
  openModal("dayHomeworkModal");
}

function appendQuickHw(text) {
  const ta = document.getElementById("dayHwTextarea");
  const cur = ta.value.trim();
  ta.value = cur ? `${cur}\n${text}` : text;
  ta.focus();
}

function saveDayHomework() {
  if (!CloudSync.requireEdit()) return;
  const lines = document
    .getElementById("dayHwTextarea")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const next = { ...homeworks };
  if (lines.length === 0) {
    delete next[currentModalDateKey];
  } else {
    next[currentModalDateKey] = lines;
  }
  saveHomeworks(next);
  closeModal("dayHomeworkModal");
  renderCalendar();
  if (activeView === "checklist" && currentChecklistDateKey === currentModalDateKey) {
    renderChecklistView();
  }
  showToast("✅ 作業已儲存並同步雲端");
}

function goChecklistFromModal() {
  const target = currentModalDateKey;
  if (CloudSync.isEdit()) {
    const lines = document
      .getElementById("dayHwTextarea")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      const next = { ...homeworks, [target]: lines };
      saveHomeworks(next);
    }
  }
  closeModal("dayHomeworkModal");
  currentChecklistDateKey = target;
  switchView("checklist");
}

function openProjectionFromModal() {
  const lines = document
    .getElementById("dayHwTextarea")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  closeModal("dayHomeworkModal");
  renderProjection(currentModalDateKey, lines);
}

function openProjectionModal(dateKey) {
  const lines = (homeworks[dateKey] || []).filter((x) => x.trim() !== "");
  renderProjection(dateKey, lines);
}

function renderProjection(dateKey, lines) {
  document.getElementById("projClassTitle").textContent = currentClass || "聯絡簿";
  document.getElementById("projDateTitle").textContent = formatReadableDate(dateKey);
  const ol = document.getElementById("projList");
  if (!lines || lines.length === 0) {
    ol.innerHTML = `<li style="list-style:none; color:#64748b;">本日尚未登記作業</li>`;
  } else {
    ol.innerHTML = lines.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }
  openModal("projectionModal");
}

// ===== 視圖 2：作業檢核 =====
function onChecklistDateChange(val) {
  currentChecklistDateKey = fromInputDate(val);
  activeHwIndex = 0;
  renderChecklistView();
}

function toggleChecklistMode() {
  checklistMode = checklistMode === "cards" ? "table" : "cards";
  renderChecklistView();
}

function setChecklistFilter(filter) {
  checklistFilter = filter;
  document.querySelectorAll(".filter-pill").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === filter);
  });
  renderChecklistCards();
}

function setActiveHw(idx) {
  activeHwIndex = idx;
  renderChecklistView();
}

function renderChecklistView() {
  if (!currentChecklistDateKey) currentChecklistDateKey = getTodayKey();
  const dateInput = document.getElementById("checklistDateInput");
  if (dateInput) dateInput.value = toInputDate(currentChecklistDateKey);

  const toggleBtn = document.getElementById("toggleModeBtn");
  if (toggleBtn) {
    toggleBtn.textContent = checklistMode === "cards" ? "📊 切換表格" : "📱 切換卡片";
  }

  const hwList = (homeworks[currentChecklistDateKey] || []).filter((x) => x.trim() !== "");
  const tabsEl = document.getElementById("checklistHwTabs");
  const summaryEl = document.getElementById("checklistSummary");
  const toolbarEl = document.getElementById("checklistToolbar");
  const cardsEl = document.getElementById("checklistCardsContainer");
  const tableEl = document.getElementById("checklistTableContainer");

  if (!currentClass || students.length === 0) {
    tabsEl.innerHTML = "";
    summaryEl.innerHTML = "";
    toolbarEl.style.display = "none";
    cardsEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">尚無學生名單，請先至「班級與名單」新增學生。</div>`;
    cardsEl.style.display = "grid";
    tableEl.style.display = "none";
    return;
  }

  if (hwList.length === 0) {
    tabsEl.innerHTML = "";
    summaryEl.innerHTML = "";
    toolbarEl.style.display = "none";
    cardsEl.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <p>${formatReadableDate(currentChecklistDateKey)} 尚未登記作業。</p>
        <button class="btn btn-primary" onclick="openDayHomeworkModal('${currentChecklistDateKey}')">✏️ 立即登記作業</button>
      </div>
    `;
    cardsEl.style.display = "grid";
    tableEl.style.display = "none";
    return;
  }

  if (activeHwIndex >= hwList.length) activeHwIndex = 0;
  const checklist = getChecklistData(currentChecklistDateKey);

  tabsEl.innerHTML = hwList
    .map((hw, idx) => {
      const map = checklist[hw] || {};
      let done = 0;
      students.forEach((s) => {
        const st = map[s] || "red";
        if (st === "green" || st === "blue") done++;
      });
      return `
        <button class="hw-tab ${idx === activeHwIndex ? "active" : ""}" onclick="setActiveHw(${idx})">
          <span>${escapeHtml(hw)}</span>
          <span class="hw-count">${done}/${students.length}</span>
        </button>
      `;
    })
    .join("");

  const activeHw = hwList[activeHwIndex];
  const hwMap = checklist[activeHw] || {};
  const counts = { green: 0, red: 0, orange: 0, blue: 0 };
  students.forEach((s) => {
    const st = hwMap[s] || "red";
    counts[st] = (counts[st] || 0) + 1;
  });

  summaryEl.innerHTML = `
    <div class="summary-box green"><span class="label">已繳交</span><span class="num">${counts.green}</span></div>
    <div class="summary-box red"><span class="label">未繳交</span><span class="num">${counts.red}</span></div>
    <div class="summary-box orange"><span class="label">待訂正</span><span class="num">${counts.orange}</span></div>
    <div class="summary-box blue"><span class="label">已訂正</span><span class="num">${counts.blue}</span></div>
  `;

  if (checklistMode === "cards") {
    toolbarEl.style.display = "flex";
    cardsEl.style.display = "grid";
    tableEl.style.display = "none";
    renderChecklistCards();
  } else {
    toolbarEl.style.display = "none";
    cardsEl.style.display = "none";
    tableEl.style.display = "block";
    renderChecklistTable(hwList, checklist);
  }
}

function renderChecklistCards() {
  const hwList = (homeworks[currentChecklistDateKey] || []).filter((x) => x.trim() !== "");
  if (hwList.length === 0) return;
  const activeHw = hwList[activeHwIndex] || hwList[0];
  const checklist = getChecklistData(currentChecklistDateKey);
  const hwMap = checklist[activeHw] || {};

  const filtered = students
    .map((s, idx) => ({ name: s, no: idx + 1, status: hwMap[s] || "red" }))
    .filter((item) => {
      if (checklistFilter === "incomplete") return item.status === "red" || item.status === "orange";
      if (checklistFilter === "red") return item.status === "red";
      if (checklistFilter === "orange") return item.status === "orange";
      return true;
    });

  const cardsEl = document.getElementById("checklistCardsContainer");
  if (filtered.length === 0) {
    cardsEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">此篩選條件目前沒有學生 🎉</div>`;
    return;
  }

  cardsEl.innerHTML = filtered
    .map((item) => {
      const meta = STATUS_META[item.status] || STATUS_META.red;
      const safeStu = item.name.replace(/'/g, "\\'");
      const safeHw = activeHw.replace(/'/g, "\\'");
      return `
        <button class="stu-card status-${item.status}" onclick="cycleStudentHw('${currentChecklistDateKey}', '${safeHw}', '${safeStu}')">
          <span class="stu-no">${item.no}</span>
          <span class="stu-name">${escapeHtml(item.name)}</span>
          <span class="stu-status-badge">${meta.icon} ${meta.label}</span>
        </button>
      `;
    })
    .join("");
}

function renderChecklistTable(hwList, checklist) {
  const tableEl = document.getElementById("checklistTableContainer");
  const headerCols = hwList
    .map((hw) => {
      const safeHw = hw.replace(/'/g, "\\'");
      return `<th onclick="cycleWholeAssignment('${currentChecklistDateKey}', '${safeHw}')" title="點擊可整欄切換">${escapeHtml(hw)}</th>`;
    })
    .join("");

  const rows = students
    .map((stu, idx) => {
      const safeStu = stu.replace(/'/g, "\\'");
      const cells = hwList
        .map((hw) => {
          const st = (checklist[hw] && checklist[hw][stu]) || "red";
          const meta = STATUS_META[st] || STATUS_META.red;
          const safeHw = hw.replace(/'/g, "\\'");
          return `<td><button class="status-chip ${st}" onclick="cycleStudentHw('${currentChecklistDateKey}', '${safeHw}', '${safeStu}')">${meta.icon} ${meta.label}</button></td>`;
        })
        .join("");

      return `
        <tr>
          <td class="stu-col" onclick="cycleWholeStudent('${currentChecklistDateKey}', '${safeStu}')" title="點擊可整列切換">${idx + 1}. ${escapeHtml(stu)}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  tableEl.innerHTML = `
    <table class="checklist-table">
      <thead>
        <tr>
          <th style="text-align:left;">座號 / 姓名</th>
          ${headerCols}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function cycleStudentHw(dateKey, hwName, studentName) {
  if (!CloudSync.requireEdit()) return;
  const data = getChecklistData(dateKey);
  if (!data[hwName]) data[hwName] = {};
  const cur = data[hwName][studentName] || "red";
  data[hwName][studentName] = (STATUS_META[cur] || STATUS_META.red).next;
  saveChecklistData(dateKey, data);
  renderChecklistView();
}

function markAllSubmitted() {
  if (!CloudSync.requireEdit()) return;
  const hwList = (homeworks[currentChecklistDateKey] || []).filter((x) => x.trim() !== "");
  if (hwList.length === 0) return;
  const activeHw = hwList[activeHwIndex];
  const data = getChecklistData(currentChecklistDateKey);
  if (!data[activeHw]) data[activeHw] = {};
  students.forEach((stu) => {
    data[activeHw][stu] = "green";
  });
  saveChecklistData(currentChecklistDateKey, data);
  renderChecklistView();
  showToast(`✅ 已將「${activeHw}」全班設為已繳交`);
}

function cycleAllCurrentAssignment() {
  const hwList = (homeworks[currentChecklistDateKey] || []).filter((x) => x.trim() !== "");
  if (hwList.length === 0) return;
  cycleWholeAssignment(currentChecklistDateKey, hwList[activeHwIndex]);
}

function cycleWholeAssignment(dateKey, hwName) {
  if (!CloudSync.requireEdit()) return;
  const data = getChecklistData(dateKey);
  if (!data[hwName]) data[hwName] = {};
  students.forEach((stu) => {
    const cur = data[hwName][stu] || "red";
    data[hwName][stu] = (STATUS_META[cur] || STATUS_META.red).next;
  });
  saveChecklistData(dateKey, data);
  renderChecklistView();
}

function cycleWholeStudent(dateKey, stu) {
  if (!CloudSync.requireEdit()) return;
  const hwList = (homeworks[dateKey] || []).filter((x) => x.trim() !== "");
  const data = getChecklistData(dateKey);
  hwList.forEach((hw) => {
    if (!data[hw]) data[hw] = {};
    const cur = data[hw][stu] || "red";
    data[hw][stu] = (STATUS_META[cur] || STATUS_META.red).next;
  });
  saveChecklistData(dateKey, data);
  renderChecklistView();
}

function copyMissingReport() {
  const dateKey = currentChecklistDateKey || getTodayKey();
  const hwList = (homeworks[dateKey] || []).filter((x) => x.trim() !== "");
  const data = getChecklistData(dateKey);

  const lines = [`【${currentClass || ""} ${formatReadableDate(dateKey)} 作業缺交/訂正名單】`];
  let hasIssue = false;

  hwList.forEach((hw) => {
    const map = data[hw] || {};
    const missing = [];
    const fix = [];
    students.forEach((stu) => {
      const st = map[stu] || "red";
      if (st === "red") missing.push(stu);
      else if (st === "orange") fix.push(stu);
    });
    if (missing.length || fix.length) {
      hasIssue = true;
      lines.push(`\n📌 ${hw}`);
      if (missing.length) lines.push(`  未繳交 (${missing.length})：${missing.join("、")}`);
      if (fix.length) lines.push(`  待訂正 (${fix.length})：${fix.join("、")}`);
    }
  });

  if (!hasIssue) lines.push("\n全班作業皆已完成繳交！🎉");

  const text = lines.join("\n");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast("📋 已複製缺交名單"));
  } else {
    prompt("請複製以下名單：", text);
  }
}

function openIncompleteSummaryModal() {
  const dateKey = currentChecklistDateKey || getTodayKey();
  document.getElementById("incompleteModalTitle").textContent = `👀 ${formatReadableDate(dateKey)} 未完成名單`;
  renderIncompleteSummaryBody(dateKey);
  openModal("incompleteSummaryModal");
}

function renderIncompleteSummaryBody(dateKey) {
  const bodyEl = document.getElementById("incompleteSummaryBody");
  const hwList = (homeworks[dateKey] || []).filter((x) => x.trim() !== "");
  if (!currentClass || students.length === 0) {
    bodyEl.innerHTML = `<div class="empty-state">尚未建立班級或學生名單</div>`;
    return;
  }
  if (hwList.length === 0) {
    bodyEl.innerHTML = `<div class="empty-state">本日尚未登記作業</div>`;
    return;
  }

  const data = getChecklistData(dateKey);
  bodyEl.innerHTML = hwList
    .map((hw) => {
      const map = data[hw] || {};
      const missing = [];
      const fix = [];
      students.forEach((stu, idx) => {
        const st = map[stu] || "red";
        if (st === "red") missing.push({ stu, no: idx + 1 });
        else if (st === "orange") fix.push({ stu, no: idx + 1 });
      });

      const totalIncomplete = missing.length + fix.length;
      const safeHw = hw.replace(/'/g, "\\'");

      if (totalIncomplete === 0) {
        return `
          <div class="inc-hw-card" style="background: var(--emerald-soft); border-color: var(--emerald-border);">
            <div class="inc-hw-header" style="margin-bottom:0;">
              <span class="inc-hw-title">${escapeHtml(hw)}</span>
              <span class="badge" style="background: var(--emerald); color: #fff;">🎉 全班完成</span>
            </div>
          </div>
        `;
      }

      const missingHtml = missing.length
        ? `
          <div class="inc-group">
            <div class="inc-group-label red">📌 未繳交（${missing.length} 人）</div>
            <div class="inc-stu-pills">
              ${missing.map((m) => `<button class="inc-stu-pill red" onclick="quickCompleteFromSummary('${dateKey}', '${safeHw}', '${m.stu.replace(/'/g, "\\'")}', 'green')">${m.no}. ${escapeHtml(m.stu)}</button>`).join("")}
            </div>
          </div>
        `
        : "";

      const fixHtml = fix.length
        ? `
          <div class="inc-group">
            <div class="inc-group-label orange">✏️ 待訂正（${fix.length} 人）</div>
            <div class="inc-stu-pills">
              ${fix.map((m) => `<button class="inc-stu-pill orange" onclick="quickCompleteFromSummary('${dateKey}', '${safeHw}', '${m.stu.replace(/'/g, "\\'")}', 'blue')">${m.no}. ${escapeHtml(m.stu)}</button>`).join("")}
            </div>
          </div>
        `
        : "";

      return `
        <div class="inc-hw-card">
          <div class="inc-hw-header">
            <span class="inc-hw-title">${escapeHtml(hw)}</span>
            <span class="badge">尚有 ${totalIncomplete} 人</span>
          </div>
          ${missingHtml}
          ${fixHtml}
        </div>
      `;
    })
    .join("");
}

function quickCompleteFromSummary(dateKey, hwName, stuName, targetStatus) {
  if (!CloudSync.requireEdit()) return;
  const data = getChecklistData(dateKey);
  if (!data[hwName]) data[hwName] = {};
  data[hwName][stuName] = targetStatus;
  saveChecklistData(dateKey, data);
  renderIncompleteSummaryBody(dateKey);
  if (activeView === "checklist" && currentChecklistDateKey === dateKey) {
    renderChecklistView();
  }
  showToast(`🌟 已將 ${stuName} 的「${hwName}」標記為${targetStatus === "blue" ? "已訂正" : "已繳交"}`);
}

async function exportChecklistPng() {
  if (typeof html2canvas !== "function") {
    showToast("圖片匯出元件載入中，請稍後再試");
    return;
  }
  const target = checklistMode === "cards"
    ? document.getElementById("checklistCardsContainer")
    : document.getElementById("checklistTableContainer");
  if (!target) return;
  showToast("正在產生圖片...");
  const canvas = await html2canvas(target, { backgroundColor: "#f8fafc", scale: 2 });
  const link = document.createElement("a");
  link.download = `${currentClass || "作業檢核"}_${currentChecklistDateKey}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// ===== 視圖 3：作業追蹤 =====
function switchTrackingTab(sub) {
  document.querySelectorAll(".sub-tab").forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
  document.querySelectorAll(".track-pane").forEach((p) => p.classList.toggle("active", p.id === `track-${sub}`));
  document.getElementById("trackingResults").innerHTML = "";
}

function renderTrackingSetup() {
  const today = toInputDate(getTodayKey());
  const startEl = document.getElementById("trackStartDate");
  const endEl = document.getElementById("trackEndDate");
  if (startEl && !startEl.value) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    startEl.value = toInputDate(toDateKey(d));
  }
  if (endEl && !endEl.value) endEl.value = today;

  const sel = document.getElementById("trackStudentSelect");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = students.map((s, i) => `<option value="${escapeHtml(s)}">${i + 1}. ${escapeHtml(s)}</option>`).join("");
    if (prev && students.includes(prev)) sel.value = prev;
  }
}

function getSortedHomeworkDates(startStr, endStr) {
  const start = startStr ? new Date(startStr + "T00:00:00") : null;
  const end = endStr ? new Date(endStr + "T23:59:59") : null;

  return Object.keys(homeworks)
    .filter((dk) => {
      const [y, m, d] = dk.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      if (start && dt < start) return false;
      if (end && dt > end) return false;
      return (homeworks[dk] || []).length > 0;
    })
    .sort((a, b) => {
      const [ay, am, ad] = a.split("-").map(Number);
      const [by, bm, bd] = b.split("-").map(Number);
      return new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad);
    });
}

function runTrackByRange() {
  const startVal = document.getElementById("trackStartDate").value;
  const endVal = document.getElementById("trackEndDate").value;
  const dates = getSortedHomeworkDates(startVal, endVal);
  const resEl = document.getElementById("trackingResults");

  const items = [];
  dates.forEach((dk) => {
    const data = getChecklistData(dk);
    (homeworks[dk] || []).forEach((hw) => {
      const map = data[hw] || {};
      students.forEach((stu) => {
        const st = map[stu] || "red";
        if (st === "red" || st === "orange") {
          items.push({ dk, hw, stu, st });
        }
      });
    });
  });

  if (items.length === 0) {
    resEl.innerHTML = `<div class="empty-state">此區間內沒有未完成或待訂正的作業 🎉</div>`;
    return;
  }

  resEl.innerHTML = items
    .map((it) => {
      const meta = STATUS_META[it.st];
      const safeHw = it.hw.replace(/'/g, "\\'");
      const safeStu = it.stu.replace(/'/g, "\\'");
      return `
        <div class="track-item-card">
          <div>
            <div class="track-item-title">${escapeHtml(it.stu)} — ${escapeHtml(it.hw)}</div>
            <div class="track-item-meta">${formatReadableDate(it.dk)}</div>
          </div>
          <button class="status-chip ${it.st}" onclick="quickResolveTracking('${it.dk}', '${safeHw}', '${safeStu}', 'range')">${meta.label}（點此補登）</button>
        </div>
      `;
    })
    .join("");
}

function runTrackByStudent() {
  const stu = document.getElementById("trackStudentSelect").value;
  const resEl = document.getElementById("trackingResults");
  if (!stu) {
    resEl.innerHTML = `<div class="empty-state">請先選擇學生</div>`;
    return;
  }

  const dates = getSortedHomeworkDates("", "");
  const items = [];
  dates.forEach((dk) => {
    const data = getChecklistData(dk);
    (homeworks[dk] || []).forEach((hw) => {
      const st = (data[hw] && data[hw][stu]) || "red";
      if (st === "red" || st === "orange") {
        items.push({ dk, hw, stu, st });
      }
    });
  });

  if (items.length === 0) {
    resEl.innerHTML = `<div class="empty-state">${escapeHtml(stu)} 所有作業皆已完成！🎉</div>`;
    return;
  }

  resEl.innerHTML = items
    .map((it) => {
      const meta = STATUS_META[it.st];
      const safeHw = it.hw.replace(/'/g, "\\'");
      const safeStu = it.stu.replace(/'/g, "\\'");
      return `
        <div class="track-item-card">
          <div>
            <div class="track-item-title">${escapeHtml(it.hw)}</div>
            <div class="track-item-meta">${formatReadableDate(it.dk)}</div>
          </div>
          <button class="status-chip ${it.st}" onclick="quickResolveTracking('${it.dk}', '${safeHw}', '${safeStu}', 'student')">${meta.label}（點此補登）</button>
        </div>
      `;
    })
    .join("");
}

function quickResolveTracking(dk, hw, stu, mode) {
  if (!CloudSync.requireEdit()) return;
  const data = getChecklistData(dk);
  if (!data[hw]) data[hw] = {};
  const cur = data[hw][stu] || "red";
  data[hw][stu] = cur === "orange" ? "blue" : "green";
  saveChecklistData(dk, data);
  showToast(`✅ 已更新 ${stu} 的「${hw}」狀態`);
  if (mode === "range") runTrackByRange();
  else runTrackByStudent();
}

function runTrackSearch() {
  const startVal = document.getElementById("searchStartDate").value;
  const endVal = document.getElementById("searchEndDate").value;
  const kw = document.getElementById("searchKeyword").value.trim().toLowerCase();
  const dates = getSortedHomeworkDates(startVal, endVal);
  const resEl = document.getElementById("trackingResults");

  const matched = [];
  dates.forEach((dk) => {
    const list = (homeworks[dk] || []).filter((hw) => !kw || hw.toLowerCase().includes(kw));
    if (list.length > 0) matched.push({ dk, list });
  });

  if (matched.length === 0) {
    resEl.innerHTML = `<div class="empty-state">找不到符合條件的作業紀錄</div>`;
    return;
  }

  resEl.innerHTML = matched
    .map((m) => `
      <div class="track-item-card">
        <div>
          <div class="track-item-title">${formatReadableDate(m.dk)}</div>
          <div class="track-item-meta">${m.list.map(escapeHtml).join("、")}</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="currentChecklistDateKey='${m.dk}'; switchView('checklist');">前往檢核 →</button>
      </div>
    `)
    .join("");
}

// ===== 視圖 4：班級與名單管理 =====
function renderSettingsView() {
  const listEl = document.getElementById("settingsClassList");
  if (classList.length === 0) {
    listEl.innerHTML = `<div class="empty-state">尚未建立任何班級</div>`;
  } else {
    listEl.innerHTML = classList
      .map((c) => {
        const safeC = c.replace(/'/g, "\\'");
        const isActive = c === currentClass;
        return `
          <div class="manage-row ${isActive ? "active-class" : ""}">
            <strong>${escapeHtml(c)} ${isActive ? '<span class="badge">目前使用</span>' : ""}</strong>
            <div class="manage-row-actions">
              ${!isActive ? `<button class="btn btn-secondary btn-sm" onclick="selectClass('${safeC}')">切換</button>` : ""}
              <button class="btn btn-danger btn-sm" onclick="deleteClass('${safeC}')">刪除</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  document.getElementById("studentCountPill").textContent = `${students.length} 人`;
  const stuListEl = document.getElementById("studentManageList");
  if (!currentClass) {
    stuListEl.innerHTML = `<div class="empty-state">請先選擇或新增班級</div>`;
  } else if (students.length === 0) {
    stuListEl.innerHTML = `<div class="empty-state">尚未新增學生</div>`;
  } else {
    stuListEl.innerHTML = students
      .map((s, idx) => `
        <div class="manage-row">
          <span><strong>${idx + 1}.</strong> ${escapeHtml(s)}</span>
          <div class="manage-row-actions">
            ${idx > 0 ? `<button class="btn btn-ghost btn-sm" onclick="moveStudent(${idx}, -1)">↑</button>` : ""}
            ${idx < students.length - 1 ? `<button class="btn btn-ghost btn-sm" onclick="moveStudent(${idx}, 1)">↓</button>` : ""}
            <button class="btn btn-danger btn-sm" onclick="removeStudent(${idx})">刪除</button>
          </div>
        </div>
      `)
      .join("");
  }

  const shareUrl = `${location.origin}${location.pathname}`;
  document.getElementById("shareLinkInput").value = shareUrl;
  document.getElementById("shareQrImg").src =
    `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareUrl)}`;
}

function promptAddClass() {
  if (!CloudSync.requireEdit()) return;
  const name = prompt("請輸入新班級名稱（例如：六年甲班）：");
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (classList.includes(trimmed)) {
    showToast("班級名稱已存在");
    return;
  }
  writeClassList([...classList, trimmed]);
  selectClass(trimmed);
  showToast(`✅ 已建立班級「${trimmed}」`);
}

function selectClass(name) {
  currentClass = name;
  localStorage.setItem("currentClass", name);
  loadCurrentClassData();
  renderCalendar();
  if (activeView === "settings") renderSettingsView();
  if (activeView === "checklist") renderChecklistView();
  closeModal("classModal");
  showToast(`已切換至「${name}」`);
}

function deleteClass(name) {
  if (!CloudSync.requireEdit()) return;
  if (!confirm(`確定要刪除班級「${name}」及所有作業紀錄嗎？`)) return;
  const prefix = getClassPrefix(name);
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith(prefix)) localStorage.removeItem(k);
  });
  const next = classList.filter((c) => c !== name);
  writeClassList(next);
  if (currentClass === name) currentClass = next[0] || "";
  loadCurrentClassData();
  renderSettingsView();
  showToast(`已刪除班級「${name}」`);
}

function addSingleStudent() {
  if (!currentClass) return showToast("請先選擇班級");
  if (!CloudSync.requireEdit()) return;
  const input = document.getElementById("singleStudentInput");
  const name = input.value.trim();
  if (!name) return;
  if (students.includes(name)) return showToast("名單中已有此學生");
  saveStudents([...students, name]);
  input.value = "";
  renderSettingsView();
  showToast(`✅ 已新增「${name}」`);
}

function toggleBulkStudentBox() {
  const box = document.getElementById("bulkStudentBox");
  box.style.display = box.style.display === "none" ? "block" : "none";
}

function addBulkStudents() {
  if (!currentClass) return showToast("請先選擇班級");
  if (!CloudSync.requireEdit()) return;
  const ta = document.getElementById("bulkStudentTextarea");
  const lines = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return;
  const merged = [...students];
  lines.forEach((s) => {
    if (!merged.includes(s)) merged.push(s);
  });
  saveStudents(merged);
  ta.value = "";
  toggleBulkStudentBox();
  renderSettingsView();
  showToast(`✅ 已批次加入學生名單（共 ${merged.length} 人）`);
}

function moveStudent(idx, delta) {
  if (!CloudSync.requireEdit()) return;
  const next = [...students];
  const target = idx + delta;
  if (target < 0 || target >= next.length) return;
  [next[idx], next[target]] = [next[target], next[idx]];
  saveStudents(next);
  renderSettingsView();
}

function removeStudent(idx) {
  if (!CloudSync.requireEdit()) return;
  const name = students[idx];
  if (!confirm(`確定要從名單移除「${name}」嗎？`)) return;
  const next = students.filter((_, i) => i !== idx);
  saveStudents(next);
  renderSettingsView();
}

// ===== 備份與相容匯入 =====
function exportBackupJson(scope) {
  const payload = { version: "homework-cloud-v1", exportedAt: new Date().toISOString(), data: {} };
  if (scope === "current") {
    if (!currentClass) return showToast("尚未選擇班級");
    payload.className = currentClass;
    const prefix = getClassPrefix(currentClass);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(prefix)) payload.data[k] = localStorage.getItem(k);
    }
  } else {
    payload.classList = classList;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (CloudSync.isSyncKey(k)) payload.data[k] = localStorage.getItem(k);
    }
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = scope === "current" ? `${currentClass}_作業備份.json` : `全部班級_作業備份.json`;
  a.click();
}

function handleImportJson(ev) {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  if (!CloudSync.requireEdit()) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      let importedCount = 0;

      // 支援本系統與舊版 teacher-tools 匯出格式
      if (parsed && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
        const currentClasses = new Set(readClassList());
        if (Array.isArray(parsed.classList)) {
          parsed.classList.forEach((c) => currentClasses.add(c));
        }
        if (parsed.className) {
          currentClasses.add(parsed.className);
        }
        for (const [k, v] of Object.entries(parsed.data)) {
          if (k.endsWith("_students") || k.endsWith("_homeworks") || k.includes("_checklist_") || k === "index_classList") {
            const valStr = typeof v === "string" ? v : JSON.stringify(v);
            localStorage.setItem(k, valStr);
            importedCount++;
            const match = k.match(/^index_([^_]+)_/);
            if (match && match[1]) currentClasses.add(match[1]);
          }
        }
        writeClassList([...currentClasses]);
      } else if (parsed && typeof parsed === "object") {
        // 純 key-value 匯入
        for (const [k, v] of Object.entries(parsed)) {
          if (k.startsWith("index_") && (k.endsWith("_students") || k.endsWith("_homeworks") || k.includes("_checklist_") || k === "index_classList")) {
            localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
            importedCount++;
          }
        }
      }

      loadCurrentClassData();
      renderCalendar();
      renderSettingsView();
      showToast(`✅ 成功匯入 ${importedCount} 筆資料並同步雲端`);
    } catch (err) {
      showToast("❌ 匯入失敗：檔案格式不正確");
    }
  };
  reader.readAsText(file);
}

function copyShareLink() {
  const input = document.getElementById("shareLinkInput");
  input.select();
  navigator.clipboard?.writeText(input.value);
  showToast("📋 已複製唯讀分享網址");
}

function forcePushNow() {
  if (!CloudSync.requireEdit()) return;
  CloudSync.pushNow().then((ok) => {
    if (ok) showToast("☁️ 已強制上傳最新資料");
  });
}

function forcePullNow() {
  CloudSync.pullNow();
}

// ===== 彈窗與認證控制 =====
function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

function openClassModal() {
  const listEl = document.getElementById("quickClassList");
  if (classList.length === 0) {
    listEl.innerHTML = `<div class="empty-state">尚未建立任何班級</div>`;
  } else {
    listEl.innerHTML = classList
      .map((c) => {
        const safeC = c.replace(/'/g, "\\'");
        const active = c === currentClass;
        return `
          <button class="manage-row ${active ? "active-class" : ""}" style="width:100%; cursor:pointer;" onclick="selectClass('${safeC}')">
            <strong>${escapeHtml(c)}</strong>
            <span>${active ? "✅ 目前班級" : "切換 →"}</span>
          </button>
        `;
      })
      .join("");
  }
  openModal("classModal");
}

function handleSyncPillClick() {
  if (!CloudSync.isEdit()) {
    openAuthModal("目前為「唯讀檢視模式」，請先輸入管理密碼解鎖進入編輯模式。");
  } else {
    CloudSync.pullNow();
  }
}

function handleEditModeClick() {
  if (CloudSync.isEdit()) {
    if (confirm("確定要離開編輯模式（鎖定為唯讀）嗎？")) {
      CloudSync.lockEdit().then(() => showToast("🔒 已切換為檢視模式"));
    }
  } else {
    openAuthModal();
  }
}

function openAuthModal(customHint) {
  const hintEl = document.getElementById("authHintText");
  const errEl = document.getElementById("authErrorMsg");
  errEl.style.display = "none";
  if (customHint) {
    hintEl.textContent = customHint;
  } else if (!CloudSync.hasPassSet()) {
    hintEl.textContent = "尚未設定管理密碼：本次輸入的密碼將成為本系統的管理密碼，請牢記。";
  } else {
    hintEl.textContent = "輸入管理密碼後即可在手機或電腦修改作業並自動同步雲端。";
  }
  document.getElementById("authPassInput").value = "";
  openModal("authModal");
  setTimeout(() => document.getElementById("authPassInput").focus(), 100);
}
window.openAuthModal = openAuthModal;

async function submitAuthPass() {
  const pass = document.getElementById("authPassInput").value.trim();
  const remember = document.getElementById("authRememberCheck").checked;
  const errEl = document.getElementById("authErrorMsg");
  if (!pass) {
    errEl.textContent = "請輸入管理密碼";
    errEl.style.display = "block";
    return;
  }
  try {
    await CloudSync.authenticate(pass, remember);
    closeModal("authModal");
    showToast("🔓 已進入編輯模式，修改將自動同步雲端");
  } catch (err) {
    errEl.textContent = err.message || "密碼錯誤";
    errEl.style.display = "block";
  }
}

window.onCloudDataUpdated = () => {
  loadCurrentClassData();
  if (activeView === "calendar") renderCalendar();
  else if (activeView === "checklist") renderChecklistView();
  else if (activeView === "settings") renderSettingsView();
};

document.addEventListener("DOMContentLoaded", async () => {
  loadCurrentClassData();
  renderCalendar();
  await CloudSync.init();
  loadCurrentClassData();
  renderCalendar();
});
