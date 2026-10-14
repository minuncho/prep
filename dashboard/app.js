// ver2 — Weekly calendar. 일정은 event_dummy.csv, 수면 수치는 A_dummy120.csv에서 읽는다.

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const HEALTH_CHECKS = {
  "Self-reported sleep quality": { label: "How well you slept", unit: "" },
  "TST": { label: "Time asleep", unit: " h" },
  "SL": { label: "Time to fall asleep", unit: " min" },
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
    .filter(b => b.timestamp.startsWith(date))
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
    // 이름을 풀어 쓴 항목 외에는 CSV의 Biomarker 이름을 그대로 보여준다
    const check = HEALTH_CHECKS[b.Biomarker] || { label: b.Biomarker, unit: "" };
    const status = STATUS[b.Status];
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
  renderClock();

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
