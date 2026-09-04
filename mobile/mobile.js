const STORAGE_KEY = "course-radar-mobile-v1";
const MAX_PERIOD = 12;

const state = {
  currentWeek: 1,
  selectedDay: 1,
  courses: [],
  selectedClasses: null
};

const weekInput = document.getElementById("weekInput");
const prevWeek = document.getElementById("prevWeek");
const nextWeek = document.getElementById("nextWeek");
const statusText = document.getElementById("statusText");
const importFile = document.getElementById("importFile");
const replaceFile = document.getElementById("replaceFile");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const classFilter = document.getElementById("classFilter");
const classFilterWrap = document.getElementById("classFilterWrap");
const dayTabs = document.getElementById("dayTabs");
const courseList = document.getElementById("courseList");

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAY_TEXT_TO_INDEX = {
  "星期一": 1,
  "星期二": 2,
  "星期三": 3,
  "星期四": 4,
  "星期五": 5,
  "星期六": 6,
  "星期日": 7,
  "星期天": 7,
  "周一": 1,
  "周二": 2,
  "周三": 3,
  "周四": 4,
  "周五": 5,
  "周六": 6,
  "周日": 7
};

const ROW_PERIOD_TEXT_MAP = {
  "第一二节": "1-2",
  "第三四节": "3-4",
  "第五六节": "5-6",
  "第七八节": "7-8",
  "第九十节": "9-10",
  "第十一二节": "11-12"
};

function parseWeeks(weeksText) {
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
    const valid = raw.weeks.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    if (valid.length > 0) weeks = [...new Set(valid)].sort((a, b) => a - b);
  } else if (typeof raw.weeks === "string") {
    weeks = parseWeeks(raw.weeks);
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

function parsePeriodText(periodText) {
  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(periodText || "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > MAX_PERIOD) return null;
  return { start, end };
}

function parseRowPeriodLabel(labelText) {
  const text = String(labelText || "").trim();
  if (!text) return null;
  if (ROW_PERIOD_TEXT_MAP[text]) return parsePeriodText(ROW_PERIOD_TEXT_MAP[text]);
  const digits = [...text.matchAll(/\d+/g)].map((item) => Number(item[0]));
  if (digits.length >= 2) {
    const start = digits[0];
    const end = digits[1];
    if (start >= 1 && end <= MAX_PERIOD && end >= start) return { start, end };
  }
  return null;
}

function parseBracketPeriod(textLine) {
  const match = /\[(\d{1,2}(?:-\d{1,2})+)\]节/.exec(String(textLine || ""));
  if (!match) return null;
  const values = match[1].split("-").map((x) => Number(x));
  if (values.length < 2 || values.some((n) => !Number.isInteger(n))) return null;
  const start = Math.min(...values);
  const end = Math.max(...values);
  if (start < 1 || end > MAX_PERIOD) return null;
  return { start, end };
}

function parseInlineCampusSchedule(textLine) {
  const match = /[（(]?\s*([0-9,\-\uFF0C\u3001\s]+)周\s*\[(\d{1,2}(?:-\d{1,2})+)节\]\s*[）)]?/.exec(String(textLine || ""));
  if (!match) return null;
  const weeks = parseWeekExpression(match[1]);
  const period = parsePeriodText(match[2]);
  if (!weeks || !period) return null;
  return { weeks, period };
}

function parseWeekExpression(weekExpression) {
  const normalized = String(weekExpression || "")
    .replace(/\s+/g, "")
    .replace(/[\uFF0C\u3001]/g, ",")
    .replace(/[^0-9,\-]/g, "");
  return parseWeeks(normalized);
}

function splitCellCourseBlocks(cellText) {
  const lines = String(cellText || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const blocks = [];
  let current = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";
    const startsNextCourse = /^\[[^\]]+\]$/.test(nextLine) && current.length > 0;
    if (startsNextCourse) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
    if (/\[\d{1,2}(?:-\d{1,2})+\]节/.test(line) && !parseInlineCampusSchedule(line)) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks.filter((block) => block.some((line) => /\[周\]/.test(line) || parseInlineCampusSchedule(line)));
}

function parseCampusCourseBlock(lines, day, rowFallbackPeriod) {
  const weekLineIndex = lines.findIndex((line) => /\[周\]/.test(line));
  let weeks = null;
  let period = null;
  let scheduleLineIndex = weekLineIndex;

  if (weekLineIndex >= 0) {
    const weekMatch = /([0-9,\-\uFF0C\u3001\s]+)\[周\]/.exec(lines[weekLineIndex]);
    if (!weekMatch) return null;
    weeks = parseWeekExpression(weekMatch[1]);
    const periodLine = lines.find((line) => /\[\d{1,2}(?:-\d{1,2})+\]节/.test(line));
    period = periodLine ? parseBracketPeriod(periodLine) : rowFallbackPeriod;
  } else {
    scheduleLineIndex = lines.findIndex((line) => parseInlineCampusSchedule(line));
    if (scheduleLineIndex < 0) return null;
    const parsedSchedule = parseInlineCampusSchedule(lines[scheduleLineIndex]);
    weeks = parsedSchedule.weeks;
    period = parsedSchedule.period;
  }

  if (!weeks || weeks.length === 0) return null;
  if (!period) return null;

  const titleAndTeacher = lines.slice(0, scheduleLineIndex);
  if (titleAndTeacher.length === 0) return null;

  let name = titleAndTeacher[0];
  let teacher = "";
  if (titleAndTeacher.length >= 2) {
    teacher = titleAndTeacher[titleAndTeacher.length - 1];
    name = titleAndTeacher.slice(0, -1).join(" ");
  }
  const location = lines[scheduleLineIndex + 1] || "";
  const className = lines[scheduleLineIndex + 2] || "";

  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    teacher: teacher.trim(),
    location: location.trim(),
    className: className.trim(),
    day,
    period,
    weeks,
    color: "#ff8e3c"
  };
}

function parseCampusTimetableRows(rows) {
  const headerRowIndex = rows.findIndex((row) => {
    const dayCount = row.filter((cell) => WEEKDAY_TEXT_TO_INDEX[String(cell || "").trim()]).length;
    return dayCount >= 5;
  });
  if (headerRowIndex < 0) throw new Error("无法识别星期表头");

  const dayColumnMap = {};
  rows[headerRowIndex].forEach((cell, colIndex) => {
    const day = WEEKDAY_TEXT_TO_INDEX[String(cell || "").trim()];
    if (day) dayColumnMap[colIndex] = day;
  });

  const parsedCourses = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowPeriod = parseRowPeriodLabel(row[0]);
    for (const [columnKey, day] of Object.entries(dayColumnMap)) {
      const colIndex = Number(columnKey);
      const rawCell = String(row[colIndex] || "").trim();
      if (!rawCell) continue;
      const blocks = splitCellCourseBlocks(rawCell);
      for (const block of blocks) {
        const course = parseCampusCourseBlock(block, day, rowPeriod);
        if (course) parsedCourses.push(course);
      }
    }
  }

  return dedupeCourses(parsedCourses);
}

function parseImportDataFromJson(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return { currentWeek: 1, courses: parsed.map(normalizeCourse).filter(Boolean) };
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.courses)) {
    const week = Number.isInteger(parsed.currentWeek) && parsed.currentWeek > 0 ? parsed.currentWeek : 1;
    return { currentWeek: week, courses: parsed.courses.map(normalizeCourse).filter(Boolean) };
  }
  throw new Error("invalid-json");
}

async function parseImportFile(file) {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (ext === ".json") {
    return parseImportDataFromJson(await file.text());
  }

  if (ext === ".xls" || ext === ".xlsx") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("empty-sheet");
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });
    return { currentWeek: 1, courses: parseCampusTimetableRows(rows) };
  }

  throw new Error("unsupported-file");
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.courses)) return;

  state.currentWeek = Number.isInteger(parsed.currentWeek) && parsed.currentWeek > 0 ? parsed.currentWeek : 1;
  state.selectedDay = Number.isInteger(parsed.selectedDay) && parsed.selectedDay >= 1 && parsed.selectedDay <= 7 ? parsed.selectedDay : 1;
  state.courses = dedupeCourses(parsed.courses.map(normalizeCourse).filter(Boolean));
  state.selectedClasses = Array.isArray(parsed.selectedClasses) ? parsed.selectedClasses : null;
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

function getClassNames() {
  return [...new Set(state.courses.map((course) => course.className).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
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

function renderDayTabs() {
  dayTabs.innerHTML = DAY_LABELS.map((label, i) => {
    const day = i + 1;
    const active = state.selectedDay === day ? "active" : "";
    return `<button type="button" data-day="${day}" class="${active}">${label}</button>`;
  }).join("");

  dayTabs.querySelectorAll("button[data-day]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDay = Number(button.dataset.day);
      saveState();
      render();
    });
  });
}

function renderCourseList() {
  const list = state.courses
    .filter((course) =>
      course.day === state.selectedDay &&
      course.weeks.includes(state.currentWeek) &&
      courseMatchesSelectedClass(course)
    )
    .sort((a, b) => a.period.start - b.period.start);
  const displayList = mergeCoursesForDisplay(list);

  if (displayList.length === 0) {
    courseList.innerHTML = '<div class="empty">这一天没有课程</div>';
    return;
  }

  courseList.innerHTML = displayList.map((course) => {
    const periodText = `${course.period.start}-${course.period.end}节`;
    const classLabel = course.classLabel || (course.className ? course.className : "公共课");
    const meta = [periodText, course.teacher, course.location, classLabel, `周${formatWeeks(course.weeks)}`].filter(Boolean).join(" / ");
    return `
      <article class="course-card" style="border-left-color:${course.color}">
        <strong>${escapeHtml(course.name)}</strong>
        <p>${escapeHtml(meta)}</p>
      </article>
    `;
  }).join("");
}

function renderStatus() {
  statusText.textContent = state.courses.length > 0
    ? `已保存 ${state.courses.length} 门课程`
    : "请导入课表文件";
}

function render() {
  weekInput.value = String(state.currentWeek);
  renderClassFilter();
  renderDayTabs();
  renderCourseList();
  renderStatus();
}

function setWeek(nextWeek) {
  const parsed = Number(nextWeek);
  if (!Number.isInteger(parsed) || parsed < 1) return;
  state.currentWeek = parsed;
  saveState();
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
    saveState();
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
  const payload = {
    currentWeek: state.currentWeek,
    selectedDay: state.selectedDay,
    selectedClasses: state.selectedClasses,
    courses: state.courses
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "course-radar-mobile-backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

function clearSchedule() {
  if (!confirm("确定要删除当前课表吗？")) return;
  state.courses = [];
  state.currentWeek = 1;
  saveState();
  render();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("service worker 注册失败", error);
    });
  }
}

function wireEvents() {
  weekInput.addEventListener("change", () => setWeek(weekInput.value));
  prevWeek.addEventListener("click", () => setWeek(Math.max(1, state.currentWeek - 1)));
  nextWeek.addEventListener("click", () => setWeek(state.currentWeek + 1));
  importFile.addEventListener("change", () => handleImport("merge"));
  replaceFile.addEventListener("change", () => handleImport("replace"));
  exportBtn.addEventListener("click", exportState);
  clearBtn.addEventListener("click", clearSchedule);
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
}

function init() {
  wireEvents();
  loadState();
  render();
  registerServiceWorker();
}

init();
