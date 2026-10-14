// ver2 — Weekly calendar. 일정은 event_dummy.csv, 수면 수치는 A_dummy120.csv에서 읽는다.

const EVENTS_CSV = "../data/event_dummy.csv";
const BIOMARKER_CSV = "../data/A_dummy120.csv";
const BIOMARKER_CREW = "A"; // 생체 데이터는 A 대원 것만 있다

// 디자인 시안의 "지금" (UTC 2026-01-04 12:30, SOL 004)
const MISSION_START = "2026-01-01";
const NOW = "2026-01-04 12:30";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const STATUS = {
  "정상": { label: "Normal", cls: "" },
  "경고": { label: "Needs attention", cls: "warn" },
  "위험": { label: "Critical", cls: "alert" },
};
const HEALTH_CHECKS = {
  "Self-reported sleep quality": { label: "How well you slept", unit: "" },
  "TST": { label: "Time asleep", unit: " h" },
  "SE": { label: "Sleep efficiency", unit: "%" },
  "WASO": { label: "Awake during the night", unit: " min" },
};

const state = {
  events: [],
  biomarkers: [],
  weekStart: MISSION_START,
  selected: NOW.slice(0, 10),
  filter: "all",
  crew: "A",
};

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function loadCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return parseCsv(await res.text());
}

// 날짜는 "YYYY-MM-DD" 문자열로 다루고 계산할 때만 UTC Date로 바꾼다
const toDate = d => new Date(d + "T00:00:00Z");
const addDays = (d, n) => new Date(toDate(d).getTime() + n * 864e5).toISOString().slice(0, 10);
const missionDay = d => Math.round((toDate(d) - toDate(MISSION_START)) / 864e5) + 1;
const dayLabel = d => "DAY " + String(missionDay(d)).padStart(3, "0");
const pad2 = n => String(n).padStart(2, "0");

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function eventsOn(date) {
  return state.events.filter(e =>
    e.start_timestamp.startsWith(date) && e.Member.split(",").includes(state.crew));
}

function biomarker(date, name) {
  if (state.crew !== BIOMARKER_CREW) return null;
  return state.biomarkers.find(b => b.timestamp.startsWith(date) && b.Biomarker === name) || null;
}

const isMeal = e => /meal/i.test(e.activity_summary);

function renderWeek() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  const first = toDate(days[0]), last = toDate(days[6]);
  const sameMonth = first.getUTCMonth() === last.getUTCMonth();
  document.getElementById("range").textContent =
    `${MONTHS[first.getUTCMonth()]} ${pad2(first.getUTCDate())}–` +
    `${sameMonth ? "" : MONTHS[last.getUTCMonth()] + " "}${pad2(last.getUTCDate())}, ${last.getUTCFullYear()}`;

  const week = document.getElementById("week");
  week.replaceChildren(...days.map(renderDay));
}

function renderDay(date) {
  const d = toDate(date);
  const day = el("button", "day" + (date === state.selected ? " selected" : ""));
  day.append(
    el("div", "dow", `${DOW[d.getUTCDay()]} ${pad2(d.getUTCDate())}`),
    el("div", "daynum", dayLabel(date)),
  );

  const f = state.filter;
  const tst = biomarker(date, "TST");
  const showSleep = f === "all" || f === "biomarkers" || (f === "alerts" && tst && tst.Status !== "정상");
  if (showSleep) {
    const status = tst ? STATUS[tst.Status] : null;
    const sleep = el("div", "sleep" + (status ? " " + status.cls : ""));
    sleep.append(
      el("div", "when", tst ? `${tst.timestamp.slice(11, 16)} · Sleep` : "Sleep"),
      el("div", "value", tst ? `${tst.Figure} h  ${status.label}` : "No measurement"),
    );
    day.append(sleep);
  }

  if (f === "all" || f === "mission" || f === "meals") {
    const events = eventsOn(date).filter(e => f === "all" || (f === "meals") === isMeal(e));
    const list = el("ul");
    for (const e of events) {
      const item = el("li", "", `${e.start_timestamp.slice(11, 16)} ${e.activity_summary}`);
      item.title = `${e.start_timestamp.slice(11, 16)}–${e.end_timestamp.slice(11, 16)} · ${e.activity_type} · Crew ${e.Member}`;
      list.append(item);
    }
    if (!events.length) list.append(el("li", "empty", f === "meals" ? "No meals" : "No mission records"));
    day.append(list);
  }

  day.addEventListener("click", () => { state.selected = date; render(); });
  return day;
}

function renderLog() {
  const date = state.selected;
  document.getElementById("log-sub").textContent = `${dayLabel(date)} · Latest records first`;

  const records = state.crew !== BIOMARKER_CREW ? [] : state.biomarkers
    .filter(b => b.timestamp.startsWith(date) && HEALTH_CHECKS[b.Biomarker] && b.timestamp <= NOW)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const body = document.getElementById("log");
  if (!records.length) {
    const cell = el("td", "", "No measurements for this day.");
    cell.colSpan = 3;
    const row = el("tr");
    row.append(cell);
    body.replaceChildren(row);
    return;
  }
  body.replaceChildren(...records.map(b => {
    const check = HEALTH_CHECKS[b.Biomarker], status = STATUS[b.Status];
    const row = el("tr");
    row.append(
      el("td", "", `${dayLabel(date)} ${b.timestamp.slice(11, 16)}`),
      el("td", "", check.label),
      el("td", status.cls, `${b.Figure}${check.unit} · ${status.label}`),
    );
    return row;
  }));
}

function render() {
  renderWeek();
  renderLog();
}

async function init() {
  document.getElementById("utc").textContent = `UTC ${NOW}`;
  document.getElementById("sol").textContent = "SOL " + String(missionDay(NOW.slice(0, 10))).padStart(3, "0");

  try {
    [state.events, state.biomarkers] = await Promise.all([loadCsv(EVENTS_CSV), loadCsv(BIOMARKER_CSV)]);
  } catch (err) {
    document.getElementById("week").textContent =
      `Could not load data (${err.message}). Serve the prep folder over HTTP and open /dashboard/.`;
    return;
  }

  const crews = [...new Set(state.events.flatMap(e => e.Member.split(",")))].sort();
  const crewSelect = document.getElementById("crew");
  crewSelect.replaceChildren(...crews.map(c => new Option(`Crew ${c}`, c)));
  crewSelect.value = state.crew;
  crewSelect.addEventListener("change", () => { state.crew = crewSelect.value; render(); });

  for (const chip of document.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter;
      document.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === chip));
      render();
    });
  }
  document.getElementById("prev").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); render(); });
  document.getElementById("next").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); render(); });

  render();
}

init();
