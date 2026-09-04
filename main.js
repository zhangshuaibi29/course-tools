const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const XLSX = require("xlsx");

const DATA_FILE_NAME = "schedule-data.json";
const AUTHOR_WEBSITE = "https://zhangshuaibi29.cn";
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

function getDataFilePath() {
  return path.join(app.getPath("userData"), DATA_FILE_NAME);
}

async function readScheduleFile() {
  try {
    const content = await fs.readFile(getDataFilePath(), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeScheduleFile(payload) {
  const filePath = getDataFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return true;
}

function parseWeeks(weeksText) {
  const chunks = String(weeksText || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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

function parsePeriodText(periodText) {
  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(periodText || "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > 12) return null;
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
    if (start >= 1 && end <= 12 && end >= start) return { start, end };
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
  if (start < 1 || end > 12) return null;
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
  if (Object.keys(dayColumnMap).length === 0) throw new Error("无法识别星期列");

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

function parseJsonImport(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return { currentWeek: 1, courses: parsed };
  }
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.courses)) {
    return {
      currentWeek: Number.isInteger(parsed.currentWeek) && parsed.currentWeek > 0 ? parsed.currentWeek : 1,
      courses: parsed.courses
    };
  }
  throw new Error("无效的JSON课表格式");
}

function parseUploadedScheduleFile(payload) {
  if (!payload || !payload.fileName || !Array.isArray(payload.bytes)) {
    throw new Error("缺少文件数据");
  }

  const ext = path.extname(payload.fileName).toLowerCase();
  const buffer = Buffer.from(payload.bytes);

  if (ext === ".json") {
    return parseJsonImport(buffer.toString("utf8"));
  }

  if (ext === ".xls" || ext === ".xlsx") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("课表文件没有工作表");
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });
    const courses = parseCampusTimetableRows(rows);
    return { currentWeek: 1, courses };
  }

  throw new Error("不支持的文件类型");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#fff8ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("index.html");
}

ipcMain.handle("schedule:load", async () => readScheduleFile());
ipcMain.handle("schedule:save", async (_event, payload) => writeScheduleFile(payload));
ipcMain.handle("schedule:parse-file", async (_event, payload) => parseUploadedScheduleFile(payload));
ipcMain.handle("author:open", async () => {
  await shell.openExternal(AUTHOR_WEBSITE);
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
