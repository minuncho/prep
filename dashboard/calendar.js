// 주간 캘린더 화면 (화성·지구 공용). 일정은 event_dummy.csv, 수면 수치는 A_dummy120.csv에서 읽는다.
// 지구 화면에는 대원 카드, 검토 필요 목록, 대원 선택 탭이 더 있다.

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const TODAY = NOW.slice(0, 10);
const state = {
  events: [],
  biomarkers: [],
  weekStart: MISSION_START,
  filter: "all",
  crew: currentCrew(),
};

function eventsOn(date) {
  return state.events.filter(e =>
    e.start_timestamp.startsWith(date) && e.Member.split(",").includes(state.crew));
}

function biomarker(date, name, crew = state.crew) {
  if (crew !== BIOMARKER_CREW) return null;
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

  document.getElementById("week").replaceChildren(...days.map(renderDay));
}

// 날짜 칸을 누르면 그날의 Daily records 화면으로 간다
function renderDay(date) {
  const d = toDate(date);
  const day = el("a", "day" + (date === TODAY ? " selected" : ""));
  day.href = pageUrl("daily.html", { date, crew: SIDE === "earth" ? state.crew : "" });
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
  return day;
}

// 오늘 기록을 최신순으로
function renderLog() {
  document.getElementById("log-sub").textContent = `${dayLabel(TODAY)} · Latest records first`;

  const records = state.crew !== BIOMARKER_CREW ? [] : state.biomarkers
    .filter(b => b.timestamp.startsWith(TODAY))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const body = document.getElementById("log");
  if (!records.length) {
    const cell = el("td", "", "No measurements supplied for this crew member.");
    cell.colSpan = 3;
    const row = el("tr");
    row.append(cell);
    body.replaceChildren(row);
    return;
  }
  body.replaceChildren(...records.map(b => {
    const check = HEALTH_CHECKS[b.Biomarker] || { label: b.Biomarker, unit: "" };
    const status = STATUS[b.Status];
    const row = el("tr");
    row.append(
      el("td", "", `${dayLabel(TODAY)} ${b.timestamp.slice(11, 16)}`),
      el("td", "", check.label),
      el("td", status.cls, `${b.Figure}${check.unit} · ${status.label}`),
    );
    return row;
  }));
}

// 가장 최근 메시지 한 개
function renderRecent() {
  const thread = loadThread(state.crew, biomarker(TODAY, "TST"));
  const last = thread[thread.length - 1];
  const other = SIDE === "earth" ? "crew" : "doctor";
  const lastFromOther = [...thread].reverse().find(m => m.from === other);
  const shown = SIDE === "earth" ? last : lastFromOther;

  document.getElementById("recent-who").textContent =
    SIDE === "earth" ? `Crew member ${state.crew} · 1:1 chat` : "Ground doctor · 1:1 chat";
  const bubble = document.getElementById("recent-bubble");
  if (!shown) {
    bubble.replaceChildren(el("div", "when", "No messages yet"), document.createTextNode("Start a 1:1 conversation."));
  } else {
    bubble.replaceChildren(el("div", "when", `${dayLabel(TODAY)} ${shown.time} UTC`), document.createTextNode(shown.text));
  }
  document.getElementById("recent-link").href = pageUrl("conversation.html", { crew: SIDE === "earth" ? state.crew : "" });
}

// 지구 화면: 대원 카드와 검토 필요 목록
function renderCrewOverview() {
  const cards = document.getElementById("crew-cards");
  if (!cards) return;

  cards.replaceChildren(...CREWS.map(crew => {
    const tst = biomarker(TODAY, "TST", crew);
    const se = biomarker(TODAY, "SE", crew);
    const card = el("a", "crew-card" + (crew === state.crew ? " selected" : ""));
    card.href = pageUrl("index.html", { crew });
    card.append(el("div", "name", `Crew ${crew}`));
    if (tst) {
      const status = STATUS[tst.Status];
      card.append(
        el("div", "state " + status.cls, tst.Status === "정상" ? "Sleep looks normal" : `${status.label} sleep alert`),
        el("div", "muted", `Sleep ${tst.Figure} h` + (se ? ` · Efficiency ${se.Figure}%` : "")),
        el("div", "muted small", `${dayLabel(TODAY)} ${tst.timestamp.slice(11, 16)} UTC`),
      );
    } else {
      card.append(
        el("div", "state", "Awaiting health data"),
        el("div", "muted", "No measurements supplied"),
        el("div", "muted small", "Assigned crew member"),
      );
    }
    return card;
  }));

  const flagged = CREWS.flatMap(crew => {
    const checks = ["TST", "SE", "WASO"].map(n => biomarker(TODAY, n, crew)).filter(b => b && b.Status !== "정상");
    if (!checks.length) return [];
    const text = checks.map(b => `${HEALTH_CHECKS[b.Biomarker].label} ${b.Figure}${HEALTH_CHECKS[b.Biomarker].unit}`).join("  |  ");
    const row = el("a", "review-row", `Crew ${crew}  ·  ${text}`);
    row.href = pageUrl("daily.html", { date: TODAY, crew });
    return [row];
  });
  document.getElementById("review").replaceChildren(...(flagged.length ? flagged : [el("p", "muted", "Nothing needs review today.")]));

  for (const tab of document.querySelectorAll("#crew-tabs a")) {
    tab.href = pageUrl("index.html", { crew: tab.dataset.crew });
    tab.classList.toggle("active", tab.dataset.crew === state.crew);
  }
}

function render() {
  renderCrewOverview();
  renderWeek();
  renderLog();
  renderRecent();
}

async function init() {
  renderTopbar("calendar");

  try {
    [state.events, state.biomarkers] = await Promise.all([loadCsv(EVENTS_CSV), loadCsv(BIOMARKER_CSV)]);
  } catch (err) {
    document.getElementById("week").textContent =
      `Could not load data (${err.message}). Serve the prep folder over HTTP.`;
    return;
  }

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
