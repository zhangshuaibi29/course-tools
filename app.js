const STORAGE_KEY = "course-radar-data-v3";
const MAX_PERIOD = 12;
const ZOOM_STORAGE_KEY = "course-radar-zoom-v1";
const MANAGE_PANEL_STORAGE_KEY = "course-radar-manage-panel-v1";
const AUTHOR_WEBSITE = "https://zhangshuaibi29.cn";
const MIN_ZOOM = 70;
const MAX_ZOOM = 150;
const ZOOM_STEP = 10;

const state = {
  currentWeek: 1,
  courses: [],
  selectedClasses: null,
  managerSearch: "",
  managerSelectedIds: new Set(),
  managePanelExpanded: true
};

const appRoot = document.querySelector(".app");
const tableBody = document.getElementById("tableBody");
const weekInput = document.getElementById("weekInput");
const weekHint = document.getElementById("weekHint");
const prevWeek = document.getElementById("prevWeek");
const nextWeek = document.getElementById("nextWeek");
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");
const replaceFile = document.getElementById("replaceFile");
const clearBtn = document.getElementById("clearBtn");
const classFilter = document.getElementById("classFilter");
const classFilterWrap = document.getElementById("classFilterWrap");
const manageToggleBtn = document.getElementById("manageToggleBtn");
const aboutAuthorBtn = document.getElementById("aboutAuthorBtn");
const editScheduleBtn = document.getElementById("editScheduleBtn");
const courseManagerModal = document.getElementById("courseManagerModal");
const closeCourseManagerBtn = document.getElementById("closeCourseManagerBtn");
const courseManagerList = document.getElementById("courseManagerList");
const courseManagerHint = document.getElementById("courseManagerHint");
const courseManagerSearch = document.getElementById("courseManagerSearch");
const courseEditorForm = document.getElementById("courseEditorForm");
const editCourseId = document.getElementById("editCourseId");
const editCourseName = document.getElementById("editCourseName");
const editCourseDay = document.getElementById("editCourseDay");
const editCourseClassName = document.getElementById("editCourseClassName");
const editCoursePeriodStart = document.getElementById("editCoursePeriodStart");
const editCoursePeriodEnd = document.getElementById("editCoursePeriodEnd");
const editCourseWeeks = document.getElementById("editCourseWeeks");
const editCourseTeacher = document.getElementById("editCourseTeacher");
const editCourseLocation = document.getElementById("editCourseLocation");
const cancelCourseEditBtn = document.getElementById("cancelCourseEditBtn");

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const PERIOD_GROUPS = Array.from({ length: MAX_PERIOD / 2 }, (_, index) => {
  const start = index * 2 + 1;
  return { start, end: start + 1, label: `${start}-${start + 1}` };
});
const COURSE_NAME_COLLATOR = new Intl.Collator("zh-CN-u-co-pinyin", {
  numeric: true,
  sensitivity: "base"
});

function parseWeeksText(weeksText) {
  const chunks = String(weeksText || "").split(",").map((part) => part.trim()).filter(Boolean);
  const result = new Set();
  for (const chunk of chunks) {
    if (chunk.includes("-")) {
      const [left, right] = chunk.split("-").map((n) => Number(n.trim()));
      if (!Number.isInteger(left) || !Number.isInteger(right) || left < 1 || right < left) return null;
      for (let w = left; w <= right; w += 1) result.add(w);
    } else {
      const week = Number(chunk);
      if (!Number.isInteger(week) || week < 1) return null;
      result.add(week);
    }
  }
  if (result.size === 0) return null;
  return [...result].sort((a, b) => a - b);
}

function normalizeCourse(raw) {
  if (!raw || typeof raw !== "object") return null;

  const name = String(raw.name || "").trim();
  if (!name) return null;

  const day = Number(raw.day);
  if (!Number.isInteger(day) || day < 1 || day > 7) return null;

  const periodRaw = raw.period || {};
  const start = Number(periodRaw.start);
  const end = Number(periodRaw.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > MAX_PERIOD || end < start) return null;

  let weeks = null;
  if (Array.isArray(raw.weeks)) {
    const validWeeks = raw.weeks.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    if (validWeeks.length > 0) weeks = [...new Set(validWeeks)].sort((a, b) => a - b);
  } else if (typeof raw.weeks === "string") {
    weeks = parseWeeksText(raw.weeks);
  }
  if (!weeks || weeks.length === 0) return null;

  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color || "").trim()) ? raw.color : "#ff8e3c";

  return {
    id: crypto.randomUUID(),
    name,
    teacher: String(raw.teacher || "").trim(),
    location: String(raw.location || "").trim(),
    className: String(raw.className || raw.class || "").trim(),
    day,
    period: { start, end },
    weeks,
    color
  };
}

function dedupeCourses(courses) {
  const seen = new Set();
  const result = [];
  for (const course of courses) {
    const key = [
      course.name,
      course.teacher,
      course.location,
      course.className,
      course.day,
      `${course.period.start}-${course.period.end}`,
      course.weeks.join(",")
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(course);
  }
  return result;
}

function parseImportDataFromJson(text) {
  const parsed = JSON.parse(text);
  let importedCoursesRaw = [];
  let importedWeek = state.currentWeek;

  if (Array.isArray(parsed)) {
    importedCoursesRaw = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.courses)) {
    importedCoursesRaw = parsed.courses;
    if (Number.isInteger(parsed.currentWeek) && parsed.currentWeek > 0) importedWeek = parsed.currentWeek;
  } else {
    throw new Error("invalid-format");
  }

  const normalized = importedCoursesRaw.map(normalizeCourse).filter(Boolean);
  if (normalized.length === 0) throw new Error("empty-courses");
  return { courses: normalized, currentWeek: importedWeek };
}

function getFileExtension(fileName) {
  const name = String(fileName || "").toLowerCase();
  const index = name.lastIndexOf(".");
  if (index < 0) return "";
  return name.slice(index);
}

async function parseImportFile(file) {
  const ext = getFileExtension(file.name);
  if (ext === ".json") {
    const text = await file.text();
    return parseImportDataFromJson(text);
  }

  if ((ext === ".xls" || ext === ".xlsx") && window.courseRadarStore && typeof window.courseRadarStore.parseScheduleFile === "function") {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const parsed = await window.courseRadarStore.parseScheduleFile({
      fileName: file.name,
      bytes: Array.from(uint8)
    });
    if (!parsed || !Array.isArray(parsed.courses) || parsed.courses.length === 0) {
      throw new Error("empty-courses");
    }
    const normalized = parsed.courses.map(normalizeCourse).filter(Boolean);
    if (normalized.length === 0) throw new Error("empty-courses");
    return {
      courses: normalized,
      currentWeek: Number.isInteger(parsed.currentWeek) && parsed.currentWeek > 0 ? parsed.currentWeek : state.currentWeek
    };
  }

  throw new Error("unsupported-file");
}

function formatWeeks(weeks) {
  const sorted = [...weeks].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let last = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === last + 1) {
      last = current;
    } else {
      ranges.push(start === last ? `${start}` : `${start}-${last}`);
      start = current;
      last = current;
    }
  }
  ranges.push(start === last ? `${start}` : `${start}-${last}`);
  return ranges.join(",");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getCourseClassLabel(course) {
  return course.classLabel || (course.className ? course.className : "公共课");
}

function courseCardHtml(course) {
  const periodText = `${course.period.start}-${course.period.end}节`;
  const dayText = DAY_LABELS[course.day - 1] || "";
  const classLabel = getCourseClassLabel(course);
  const meta = [dayText, course.teacher, course.location, classLabel, `周${formatWeeks(course.weeks)}`].filter(Boolean).join(" / ");
  return `
    <article class="course-card" style="border-left-color:${course.color}">
      <strong>${escapeHtml(course.name)}</strong>
      <p>${escapeHtml(periodText)}</p>
      <p>${escapeHtml(meta)}</p>
    </article>
  `;
}

function getClassNames() {
  return [...new Set(state.courses.map((course) => course.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function courseMatchesSelectedClass(course) {
  return !course.className || state.selectedClasses === null || state.selectedClasses.includes(course.className);
}

function courseMergeKey(course) {
  return [
    course.name,
    course.teacher,
    course.location,
    course.day,
    `${course.period.start}-${course.period.end}`,
    course.weeks.join(",")
  ].join("|");
}

function mergeCoursesForDisplay(courses) {
  const groups = new Map();
  for (const course of courses) {
    const key = courseMergeKey(course);
    let group = groups.get(key);
    if (!group) {
      group = { course, classNames: [], hasPublic: false };
      groups.set(key, group);
    }
    if (course.className) group.classNames.push(course.className);
    else group.hasPublic = true;
  }

  return [...groups.values()].map((group) => {
    const classNames = [...new Set(group.classNames)].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const classLabel = group.hasPublic
      ? "公共课"
      : classNames.length > 1
        ? `适用：${classNames.join("、")}`
        : classNames[0] || "公共课";
    return { ...group.course, classLabel };
  });
}

function renderClassFilter() {
  if (!classFilter || !classFilterWrap) return;
  const classNames = getClassNames();
  const showFilter = classNames.length >= 2;
  classFilterWrap.hidden = !showFilter;
  if (!showFilter) {
    state.selectedClasses = null;
    classFilter.innerHTML = "";
    return;
  }

  if (state.selectedClasses === null) {
    state.selectedClasses = [...classNames];
  } else {
    state.selectedClasses = state.selectedClasses.filter((className) => classNames.includes(className));
  }

  const allSelected = state.selectedClasses.length === classNames.length;
  classFilter.innerHTML = `
    <div class="class-filter-actions">
      <button type="button" data-class-action="all" ${allSelected ? "disabled" : ""}>全选</button>
      <button type="button" data-class-action="none" ${state.selectedClasses.length === 0 ? "disabled" : ""}>清空</button>
    </div>
    <div class="class-filter-options">
      ${classNames.map((className) => `
        <label>
          <input type="checkbox" data-class-name="${escapeHtml(className)}" ${state.selectedClasses.includes(className) ? "checked" : ""}>
          <span>${escapeHtml(className)}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function sortedCourses() {
  return [...state.courses].sort((a, b) =>
    compareCourseNames(a.name, b.name) ||
    COURSE_NAME_COLLATOR.compare(a.className || "公共课", b.className || "公共课") ||
    a.day - b.day ||
    a.period.start - b.period.start ||
    a.period.end - b.period.end
  );
}

function courseNameSortGroup(name) {
  const first = [...String(name || "").trim()][0] || "";
  if (/[0-9]/.test(first)) return 0;
  if (/[A-Za-z]/.test(first)) return 1;
  if (/[\u3400-\u9FFF]/.test(first)) return 2;
  return 3;
}

function compareCourseNames(leftName, rightName) {
  const leftGroup = courseNameSortGroup(leftName);
  const rightGroup = courseNameSortGroup(rightName);
  return leftGroup - rightGroup || COURSE_NAME_COLLATOR.compare(leftName, rightName);
}

function courseMatchesManagerSearch(course) {
  const query = state.managerSearch.trim().toLocaleLowerCase("zh-CN");
  if (!query) return true;
  const searchable = [
    course.name,
    course.teacher,
    course.location,
    course.className || "公共课",
    DAY_LABELS[course.day - 1],
    `${course.period.start}-${course.period.end}`,
    formatWeeks(course.weeks)
  ].join(" ").toLocaleLowerCase("zh-CN");
  return searchable.includes(query);
}

function renderCourseManager() {
  if (!courseManagerList || !courseManagerHint) return;
  const visibleCourses = sortedCourses().filter(courseMatchesManagerSearch);
  const validIds = new Set(state.courses.map((course) => course.id));
  state.managerSelectedIds = new Set(
    [...state.managerSelectedIds].filter((courseId) => validIds.has(courseId))
  );
  courseManagerHint.textContent = state.courses.length > 0
    ? `当前共有 ${state.courses.length} 条课程记录，已选 ${state.managerSelectedIds.size} 条`
    : "当前没有课程记录";

  if (state.courses.length === 0) {
    courseManagerList.innerHTML = '<p class="manager-empty">请先导入课表。</p>';
    return;
  }

  if (visibleCourses.length === 0) {
    courseManagerList.innerHTML = '<p class="manager-empty">没有找到匹配的课程。</p>';
    return;
  }

  courseManagerList.innerHTML = visibleCourses.map((course) => {
    const periodText = `${course.period.start}-${course.period.end}节`;
    const detail = [
      `${DAY_LABELS[course.day - 1]} ${periodText}`,
      course.teacher,
      course.location,
      getCourseClassLabel(course),
      `周${formatWeeks(course.weeks)}`
    ].filter(Boolean).join(" / ");
    return `
      <article class="manager-course">
        <input class="manager-course-check" type="checkbox" data-manager-course-check="${escapeHtml(course.id)}" ${state.managerSelectedIds.has(course.id) ? "checked" : ""} aria-label="选择 ${escapeHtml(course.name)}">
        <div class="manager-course-info">
          <strong>${escapeHtml(course.name)}</strong>
          <p>${escapeHtml(detail)}</p>
        </div>
        <div class="manager-course-actions">
          <button type="button" data-edit-course="${escapeHtml(course.id)}">编辑</button>
          <button type="button" class="danger-text" data-delete-course="${escapeHtml(course.id)}">删除</button>
        </div>
      </article>
    `;
  }).join("");
}

function openCourseManager() {
  courseManagerModal.hidden = false;
  courseEditorForm.hidden = true;
  state.managerSearch = "";
  state.managerSelectedIds.clear();
  courseManagerSearch.value = "";
  renderCourseManager();
}

function closeCourseManager() {
  courseManagerModal.hidden = true;
  courseEditorForm.hidden = true;
}

function startCourseEdit(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;

  editCourseId.value = course.id;
  editCourseName.value = course.name;
  editCourseDay.value = String(course.day);
  editCourseClassName.value = course.className;
  editCoursePeriodStart.value = String(course.period.start);
  editCoursePeriodEnd.value = String(course.period.end);
  editCourseWeeks.value = formatWeeks(course.weeks);
  editCourseTeacher.value = course.teacher.replace(/^\[|\]$/g, "");
  editCourseLocation.value = course.location;
  courseEditorForm.hidden = false;
  courseEditorForm.scrollIntoView({ behavior: "smooth", block: "start" });
  requestAnimationFrame(() => {
    editCourseName.focus({ preventScroll: true });
    const cursorPosition = editCourseName.value.length;
    editCourseName.setSelectionRange(cursorPosition, cursorPosition);
  });
}

function cancelCourseEdit() {
  courseEditorForm.hidden = true;
  editCourseId.value = "";
  courseManagerList.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveCourseEdit(event) {
  event.preventDefault();
  const course = state.courses.find((item) => item.id === editCourseId.value);
  if (!course) return;

  const name = editCourseName.value.trim();
  const day = Number(editCourseDay.value);
  const start = Number(editCoursePeriodStart.value);
  const end = Number(editCoursePeriodEnd.value);
  const weeks = parseWeeksText(editCourseWeeks.value);
  if (!name || !Number.isInteger(day) || day < 1 || day > 7 ||
      !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 1 || end < start || end > MAX_PERIOD || !weeks) {
    alert("请填写正确的课程名称、星期、节次和周次。");
    return;
  }

  course.name = name;
  course.teacher = editCourseTeacher.value.trim();
  course.location = editCourseLocation.value.trim();
  course.className = editCourseClassName.value.trim();
  course.day = day;
  course.period = { start, end };
  course.weeks = weeks;
  state.courses = dedupeCourses(state.courses);
  state.selectedClasses = null;
  await saveState();
  render();
  renderCourseManager();
  cancelCourseEdit();
}

async function deleteCourse(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;
  const classLabel = getCourseClassLabel(course);
  if (!confirm(`确定删除“${course.name}”（${classLabel}）吗？`)) return;

  state.courses = state.courses.filter((item) => item.id !== courseId);
  state.managerSelectedIds.delete(courseId);
  await saveState();
  render();
  renderCourseManager();
}

async function deleteSelectedCourses() {
  const selectedIds = new Set(state.managerSelectedIds);
  if (selectedIds.size === 0) {
    alert("请先勾选要删除的课程。");
    return;
  }
  if (!confirm(`确定删除选中的 ${selectedIds.size} 条课程记录吗？`)) return;

  state.courses = state.courses.filter((course) => !selectedIds.has(course.id));
  state.managerSelectedIds.clear();
  cancelCourseEdit();
  await saveState();
  render();
  renderCourseManager();
}

function handleManagerBatchAction(action) {
  const visibleIds = sortedCourses()
    .filter(courseMatchesManagerSearch)
    .map((course) => course.id);

  if (action === "select-all") {
    visibleIds.forEach((courseId) => state.managerSelectedIds.add(courseId));
  } else if (action === "invert") {
    visibleIds.forEach((courseId) => {
      if (state.managerSelectedIds.has(courseId)) state.managerSelectedIds.delete(courseId);
      else state.managerSelectedIds.add(courseId);
    });
  } else if (action === "clear-selection") {
    state.managerSelectedIds.clear();
  } else if (action === "delete-selected") {
    deleteSelectedCourses();
    return;
  }
  renderCourseManager();
}

function loadZoom() {
  const saved = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
  return Number.isFinite(saved) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, saved)) : 100;
}

function loadManagePanelState() {
  const saved = localStorage.getItem(MANAGE_PANEL_STORAGE_KEY);
  return saved === null ? true : saved !== "collapsed";
}

function applyManagePanelState() {
  document.body.classList.toggle("manage-collapsed", !state.managePanelExpanded);
  if (!manageToggleBtn) return;
  manageToggleBtn.textContent = state.managePanelExpanded ? "《" : "》";
  manageToggleBtn.title = state.managePanelExpanded ? "收拢课表管理" : "展开课表管理";
  manageToggleBtn.setAttribute("aria-expanded", String(state.managePanelExpanded));
}

function toggleManagePanel() {
  state.managePanelExpanded = !state.managePanelExpanded;
  localStorage.setItem(
    MANAGE_PANEL_STORAGE_KEY,
    state.managePanelExpanded ? "expanded" : "collapsed"
  );
  applyManagePanelState();
}

async function openAuthorWebsite() {
  if (!confirm(`是否打开作者网站？\n${AUTHOR_WEBSITE}`)) return;
  if (window.courseRadarStore && typeof window.courseRadarStore.openAuthorWebsite === "function") {
    await window.courseRadarStore.openAuthorWebsite();
    return;
  }
  window.open(AUTHOR_WEBSITE, "_blank", "noopener,noreferrer");
}

function applyZoom() {
  document.body.style.zoom = `${state.zoomPercent}%`;
}

function changeZoom(delta) {
  state.zoomPercent = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoomPercent + delta));
  localStorage.setItem(ZOOM_STORAGE_KEY, String(state.zoomPercent));
  applyZoom();
}

function render() {
  weekInput.value = String(state.currentWeek);
  weekHint.textContent = `第 ${state.currentWeek} 周课程`;
  renderClassFilter();

  const rows = [];
  for (const group of PERIOD_GROUPS) {
    const cells = [`<td>${group.label}</td>`];
    for (let day = 1; day <= 7; day += 1) {
      const matched = state.courses.filter((course) => {
        const inDay = course.day === day;
        const startsInGroup = course.period.start >= group.start && course.period.start <= group.end;
        const inWeek = course.weeks.includes(state.currentWeek);
        return inDay && startsInGroup && inWeek && courseMatchesSelectedClass(course);
      });
      const displayMatched = mergeCoursesForDisplay(matched);

      const occupiedLater = state.courses.some((course) => {
        const inDay = course.day === day;
        const inWeek = course.weeks.includes(state.currentWeek);
        const inRangeButNotStart = course.period.start < group.start && course.period.end >= group.start;
        return inDay && inWeek && inRangeButNotStart && courseMatchesSelectedClass(course);
      });

      if (displayMatched.length === 0 && !occupiedLater) {
        cells.push('<td><span class="empty">-</span></td>');
      } else if (displayMatched.length === 0 && occupiedLater) {
        cells.push('<td><span class="empty">↑</span></td>');
      } else {
        cells.push(`<td><div class="course-stack">${displayMatched.map(courseCardHtml).join("")}</div></td>`);
      }
    }
    rows.push(`<tr>${cells.join("")}</tr>`);
  }

  tableBody.innerHTML = rows.join("");
}

async function saveState() {
  const payload = {
    currentWeek: state.currentWeek,
    selectedClasses: state.selectedClasses,
    courses: state.courses
  };
  if (window.courseRadarStore && typeof window.courseRadarStore.saveSchedule === "function") {
    await window.courseRadarStore.saveSchedule(payload);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

async function loadState() {
  let payload = null;
  if (window.courseRadarStore && typeof window.courseRadarStore.loadSchedule === "function") {
    payload = await window.courseRadarStore.loadSchedule();
  } else {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) payload = JSON.parse(raw);
  }
  if (!payload || !Array.isArray(payload.courses)) return;

  const normalizedCourses = payload.courses.map(normalizeCourse).filter(Boolean);
  state.courses = dedupeCourses(normalizedCourses);
  state.currentWeek = Number.isInteger(payload.currentWeek) && payload.currentWeek > 0 ? payload.currentWeek : 1;
  state.selectedClasses = Array.isArray(payload.selectedClasses) ? payload.selectedClasses : null;
}

async function setWeek(nextWeek) {
  const parsed = Number(nextWeek);
  if (!Number.isInteger(parsed) || parsed < 1) return;
  state.currentWeek = parsed;
  await saveState();
  render();
}

async function handleImport(mode) {
  const input = mode === "replace" ? replaceFile : importFile;
  const [file] = input.files;
  if (!file) return;

  try {
    const imported = await parseImportFile(file);
    if (mode === "replace") {
      state.courses = imported.courses;
      state.currentWeek = imported.currentWeek;
      state.selectedClasses = null;
    } else {
      state.courses = dedupeCourses([...state.courses, ...imported.courses]);
      state.selectedClasses = null;
    }

    await saveState();
    render();
    alert(mode === "replace"
      ? `替换成功，当前共有 ${state.courses.length} 门课程。`
      : `导入成功，当前共有 ${state.courses.length} 门课程。`);
  } catch (error) {
    console.error(error);
    alert("导入失败：请使用 JSON 或教务系统导出的 XLS/XLSX 文件。");
  } finally {
    input.value = "";
  }
}

function exportState() {
  const payload = { currentWeek: state.currentWeek, courses: state.courses };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "course-radar-backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function clearSchedule() {
  if (!confirm("确定要删除当前课表吗？")) return;
  state.courses = [];
  state.currentWeek = 1;
  await saveState();
  render();
}

function wireEvents() {
  manageToggleBtn?.addEventListener("click", toggleManagePanel);
  aboutAuthorBtn?.addEventListener("click", openAuthorWebsite);
  weekInput.addEventListener("change", () => setWeek(weekInput.value));
  prevWeek.addEventListener("click", () => setWeek(Math.max(1, state.currentWeek - 1)));
  nextWeek.addEventListener("click", () => setWeek(state.currentWeek + 1));
  importFile.addEventListener("change", () => handleImport("merge"));
  replaceFile.addEventListener("change", () => handleImport("replace"));
  exportBtn.addEventListener("click", exportState);
  editScheduleBtn.addEventListener("click", openCourseManager);
  clearBtn.addEventListener("click", clearSchedule);
  closeCourseManagerBtn.addEventListener("click", closeCourseManager);
  cancelCourseEditBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    cancelCourseEdit();
  });
  courseEditorForm.addEventListener("submit", saveCourseEdit);
  courseManagerSearch.addEventListener("input", () => {
    state.managerSearch = courseManagerSearch.value;
    renderCourseManager();
  });
  courseManagerModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-course-manager]")) closeCourseManager();
    const batchAction = event.target.closest("[data-manager-action]")?.dataset.managerAction;
    if (batchAction) handleManagerBatchAction(batchAction);
    const editId = event.target.closest("[data-edit-course]")?.dataset.editCourse;
    if (editId) startCourseEdit(editId);
    const deleteId = event.target.closest("[data-delete-course]")?.dataset.deleteCourse;
    if (deleteId) deleteCourse(deleteId);
  });
  courseManagerModal.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-manager-course-check]");
    if (!checkbox) return;
    if (checkbox.checked) state.managerSelectedIds.add(checkbox.dataset.managerCourseCheck);
    else state.managerSelectedIds.delete(checkbox.dataset.managerCourseCheck);
    renderCourseManager();
  });
  classFilter?.addEventListener("change", (event) => {
    if (!event.target.matches("input[data-class-name]")) return;
    state.selectedClasses = [...classFilter.querySelectorAll("input[data-class-name]:checked")]
      .map((input) => input.dataset.className);
    saveState();
    render();
  });
  classFilter?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-class-action]")?.dataset.classAction;
    if (!action) return;
    const classNames = getClassNames();
    state.selectedClasses = action === "all" ? [...classNames] : [];
    saveState();
    render();
  });
  window.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }, { passive: false });
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditableTarget = target instanceof HTMLElement &&
      (target.matches("input, textarea, select") || target.isContentEditable);
    if (isEditableTarget) return;

    if (event.ctrlKey && event.key === "0") {
      event.preventDefault();
      state.zoomPercent = 100;
      localStorage.setItem(ZOOM_STORAGE_KEY, "100");
      applyZoom();
    }
  });
}

async function init() {
  state.zoomPercent = loadZoom();
  state.managePanelExpanded = loadManagePanelState();
  applyManagePanelState();
  applyZoom();
  wireEvents();
  await loadState();
  render();
}

init();
