// 화성(우주인)·지구(의사) 화면이 같이 쓰는 데이터 경로, CSV 읽기, 날짜 계산, 저장소.

// 데이터 경로는 이 파일(dashboard/common.js) 위치를 기준으로 잡는다
const DATA_DIR = new URL("../data/", document.currentScript.src);
const EVENTS_CSV = new URL("event.csv", DATA_DIR).href;
// 대원별 바이오마커 기록 (A_data.csv ~ D_data.csv)
const crewCsv = crew => new URL(`${crew}_data.csv`, DATA_DIR).href;
const INSTRUCTION_CSV = new URL("instruction.csv", DATA_DIR).href;
const BIOMARKERS_CSV = new URL("biomarkers.csv", DATA_DIR).href;

// 지금 보는 화면이 어느 쪽인지. 지구 쪽은 의사가 대원 A~D를 골라 본다
const SIDE = location.pathname.includes("/earth/") ? "earth" : "mars";
const CREWS = ["A", "B", "C", "D"];
const DEFAULT_CREW = "A"; // 고른 대원이 없을 때
const CREW_KEY = "dashboard.crew"; // 우주인이 온보딩에서 고른 대원

// 지구↔화성 통신 간격. 메시지·안내는 이만큼 늦게 도착하고, 화성 시계는 이만큼 늦게 간다 (space-sim과 같은 방식)
const LINK_DELAY_MS = 20 * 60000;
const CLOCK_LAG_MS = SIDE === "mars" ? LINK_DELAY_MS : 0;
const sideNow = () => Date.now() - CLOCK_LAG_MS;
// ms → "YYYY-MM-DD HH:MM:SS" (UTC)
const fmtUtc = ms => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

// 미션 시계. 대원 데이터(A~D_data.csv)와 일정(event.csv)이 2026-10-01부터 120일치라서, 실제 하루가 지날 때마다
// 미션 하루가 넘어가고 120일이 지나면 처음으로 돌아간다. 시각(시:분:초)은 실제 UTC를 그대로 쓴다.
// ?day=4 처럼 주면 그 미션 날로 고정해서 볼 수 있다.
const MISSION_START = "2026-10-01";
const DATA_DAYS = 120;
const DAY_MS = 864e5;
const MISSION_START_MS = Date.parse(MISSION_START + "T00:00:00Z");
const DAY_OVERRIDE = Math.min(Math.max(parseInt(new URLSearchParams(location.search).get("day"), 10) || 0, 0), DATA_DAYS);
function missionMs(realMs) {
  const sinceStart = Math.floor((realMs - MISSION_START_MS) / DAY_MS);
  const index = DAY_OVERRIDE ? DAY_OVERRIDE - 1 : ((sinceStart % DATA_DAYS) + DATA_DAYS) % DATA_DAYS;
  return MISSION_START_MS + index * DAY_MS + (((realMs % DAY_MS) + DAY_MS) % DAY_MS);
}
const missionNow = () => fmtUtc(missionMs(sideNow()));
// 화면을 연 시점의 미션 시각 "YYYY-MM-DD HH:MM". 오늘 기록은 이 시각까지만 보여준다
const NOW = missionNow().slice(0, 16);

const STATUS = {
  "Normal": { label: "Normal", cls: "" },
  "Warning": { label: "Needs attention", cls: "warn" },
  "Critical": { label: "Critical", cls: "alert" },
};
// 이름을 풀어 쓰는 수면 항목. 나머지 항목은 CSV의 Biomarker 이름을 그대로 쓴다
const HEALTH_CHECKS = {
  "Self-reported sleep quality": { label: "How well you felt you slept", unit: "", detail: "Your self-reported sleep quality" },
  "TST": { label: "Time asleep", unit: " h", detail: "Total sleep time · TST" },
  "SL": { label: "Time to fall asleep", unit: " min", detail: "Sleep latency · SL" },
  "SE": { label: "Sleep efficiency", unit: "%", detail: "Time asleep compared with time in bed · SE" },
  "WASO": { label: "Awake during the night", unit: " min", detail: "Wake after sleep onset · WASO" },
};

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
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

// event.csv: 대원 A~D의 120일치 일정
const loadEvents = () => loadCsv(EVENTS_CSV);
// 한 대원의 바이오마커 기록
const loadCrewData = crew => loadCsv(crewCsv(crew));

// biomarkers.csv: 항목별 분류(Category), 측정 방법, 주기, 설명
async function loadBiomarkerInfo() {
  const rows = await loadCsv(BIOMARKERS_CSV);
  return Object.fromEntries(rows.map(r => [r.Biomarker, r]));
}

// 미션 시각까지 측정된 기록만 (과거 날짜는 전부, 오늘은 지금 시각까지)
const measured = b => b.timestamp <= NOW;
// 지금 미션 시각 기준 최근 24시간 기록
const DAY_AGO = fmtUtc(Date.parse(NOW.replace(" ", "T") + ":00Z") - DAY_MS).slice(0, 16);
const recent = records => records.filter(b => b.timestamp > DAY_AGO && measured(b));
// 이름이 같은 항목 중 가장 최근에 측정된 것
const latest = (records, name) =>
  records.filter(b => b.Biomarker === name && measured(b)).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] || null;
const checkLabel = name => (HEALTH_CHECKS[name] || { label: name }).label;

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

const longDate = (d, opts) => toDate(d).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

// 의사 화면은 ?crew=B 처럼 대원을 고른다.
// 우주인 화면은 온보딩에서 고른 대원이다 (?crew=B로 들어오면 그 대원을 이 브라우저에 기억한다)
function currentCrew() {
  const fromUrl = new URLSearchParams(location.search).get("crew");
  if (SIDE === "earth") return CREWS.includes(fromUrl) ? fromUrl : DEFAULT_CREW;
  if (CREWS.includes(fromUrl)) {
    try { localStorage.setItem(CREW_KEY, fromUrl); } catch {}
    return fromUrl;
  }
  try {
    const saved = localStorage.getItem(CREW_KEY);
    if (CREWS.includes(saved)) return saved;
  } catch {}
  return DEFAULT_CREW;
}

// 우주인 화면의 "Crew A" 같은 표시를 고른 대원으로 채운다 (스크립트가 본문 끝에 있어 바로 실행된다)
if (SIDE === "mars") {
  const crew = currentCrew();
  document.querySelectorAll("[data-crew-label]").forEach(node => {
    node.textContent = node.dataset.crewLabel === "initial" ? crew : `Crew ${crew}`;
  });
}
const crewQuery = crew => SIDE === "earth" ? `crew=${crew}` : "";
function pageUrl(page, params = {}) {
  if (DAY_OVERRIDE) params = { ...params, day: DAY_OVERRIDE };
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return page + (query ? "?" + query : "");
}

// 상단 바. active는 "calendar" | "instruction" | "profile"
function renderTopbar(active) {
  const crew = SIDE === "earth" ? currentCrew() : "";
  const link = (label, page, key) => {
    const a = el("a", "pill" + (key === active ? " active" : ""), label);
    a.href = pageUrl(page, { crew });
    return a;
  };
  // 역할을 바꾸면 반대쪽 같은 화면으로 이동한다
  const where = el("select", "pill");
  where.setAttribute("aria-label", "Workspace");
  where.append(new Option("SPACE / Astronaut", "mars"), new Option("EARTH / Doctor", "earth"));
  where.value = SIDE;
  where.addEventListener("change", () => {
    const page = location.pathname.split("/").pop() || "index.html";
    location.href = `../${where.value}/${page}${location.search}`;
  });
  // 실제 시각으로 1초마다 갱신. 화성 화면은 통신 간격만큼 늦다
  const clock = el("span", "clock");
  clock.title = SIDE === "mars" ? `Mars clock · ${LINK_DELAY_MS / 60000} min behind Earth` : "Earth clock";
  const tick = () => { clock.textContent = `UTC ${missionNow()}`; };
  tick();
  setInterval(tick, 1000);
  document.getElementById("topbar").replaceChildren(
    link("My Calendar", "index.html", "calendar"),
    link("Health Instruction", "instruction.html", "instruction"),
    el("span", "spacer"),
    clock,
    el("span", "clock", "SOL " + String(missionDay(NOW.slice(0, 10))).padStart(3, "0")),
    where,
    link("Profile", "profile.html", "profile"),
  );
}

// 브라우저 저장소. 같은 브라우저에서는 화성·지구 화면이 같은 기록을 본다
function readStore(key) {
  try { return JSON.parse(localStorage.getItem("dashboard." + key)) || []; }
  catch { return []; }
}
function writeStore(key, list) {
  try { localStorage.setItem("dashboard." + key, JSON.stringify(list)); } catch {}
}

// 대원별 1:1 대화. A 대원은 시안의 예시 대화로 시작한다.
// 예시 대화(12:13~12:30)가 미래 시각이 되지 않도록, 지금이 12:30 전이면 전날 대화로 둔다
const DEMO_DAY = NOW.slice(11) >= "12:30" ? NOW.slice(0, 10) : addDays(NOW.slice(0, 10), -1);
const DEMO_THREADS = {
  A: [
    { from: "crew", time: "12:13", note: "Delivered", attached: true, sleepQuestion: true },
    { from: "doctor", time: "12:25", note: "Example physician reply",
      text: "Thanks for sharing your record. I’ve received it. Please tell me how you’re feeling now." },
    { from: "crew", time: "12:30", note: "Delivered",
      text: "I’m still feeling tired. I’ve opened the saved sleep guidance." },
  ],
};
// 저장된 메시지는 보낸 쪽에서 LINK_DELAY_MS 뒤에 받는 쪽에 보인다
const ROLE = SIDE === "earth" ? "doctor" : "crew";
const arrived = m => !m.sentAt || Date.now() >= m.sentAt + LINK_DELAY_MS;
function deliveryNote(m) {
  if (arrived(m)) return m.sentAt ? "Delivered" : m.note;
  const min = Math.ceil((m.sentAt + LINK_DELAY_MS - Date.now()) / 60000);
  return `Sending · arrives in ${min} min`;
}
function loadThread(crew, tst) {
  const stored = readStore(`thread.${crew}`)
    .filter(m => m.from === ROLE || arrived(m))
    .map(m => ({ ...m, note: deliveryNote(m), stored: true }));
  return [...(DEMO_THREADS[crew] || []), ...stored].map(m => m.sleepQuestion ? {
    ...m,
    text: tst
      ? `I slept ${tst.Figure} hours last night and still feel tired. Could you check my sleep record?`
      : "I still feel tired. Could you check my sleep record?",
  } : m);
}
// 메시지 시각은 보낸 쪽 시계 기준 (UTC HH:MM)
function addMessage(crew, from, text) {
  const list = readStore(`thread.${crew}`);
  list.push({ from, text, sentAt: Date.now(), time: fmtUtc(sideNow()).slice(11, 16) });
  writeStore(`thread.${crew}`, list);
}

// 의사가 대원에게 보낸 안내. 우주인 화면의 Health Instruction에 나타난다
// 화성 화면에는 도착한 것만 보인다
const loadInstructions = crew => readStore(`instructions.${crew}`)
  .filter(n => SIDE === "earth" || arrived(n))
  .map(n => ({ ...n, note: deliveryNote(n) }));
function addInstruction(crew, title, body) {
  const list = readStore(`instructions.${crew}`);
  list.push({ title, body, sentAt: Date.now(), time: fmtUtc(sideNow()).slice(11, 16) });
  writeStore(`instructions.${crew}`, list);
}

// 하루 수면 기록 중 가장 심각한 항목. 심각도가 같으면 수면 시간(TST)이 먼저다
const SEVERITY = { "Normal": 0, "Warning": 1, "Critical": 2 };
function worstSleepCheck(records) {
  return ["TST", "SE", "WASO", "Self-reported sleep quality"]
    .map(name => records.find(b => b.Biomarker === name))
    .filter(b => b && b.Status !== "Normal")
    .sort((a, b) => SEVERITY[b.Status] - SEVERITY[a.Status])[0] || null;
}
const guideFor = (record, instructions) =>
  record && instructions.find(i => i.biomarker === record.Biomarker && i.Status === record.Status) || null;
