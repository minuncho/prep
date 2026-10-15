// 화성(우주인)·지구(의사) 화면이 같이 쓰는 데이터 경로, CSV 읽기, 날짜 계산, 저장소.

// 데이터 경로는 이 파일(dashboard/common.js) 위치를 기준으로 잡는다
const DATA_DIR = new URL("../data/", document.currentScript.src);
const EVENTS_CSV = new URL("event_dummy.csv", DATA_DIR).href;
const BIOMARKER_CSV = new URL("A_dummy120.csv", DATA_DIR).href;
const INSTRUCTION_CSV = new URL("instruction.csv", DATA_DIR).href;

// 지금 보는 화면이 어느 쪽인지. 지구 쪽은 의사가 대원 A~D를 골라 본다
const SIDE = location.pathname.includes("/earth/") ? "earth" : "mars";
const CREWS = ["A", "B", "C", "D"];
const BIOMARKER_CREW = "A"; // 생체 데이터는 A 대원 것만 있다

// 데이터 기준 "오늘" (DAY 004). 더미 데이터가 2026년 1~4월이라 화면의 기록은 이 날짜를 기준으로 보여준다
const MISSION_START = "2026-01-01";
const NOW = "2026-01-04 12:30";

// 지구↔화성 통신 간격. 메시지·안내는 이만큼 늦게 도착하고, 화성 시계는 이만큼 늦게 간다 (space-sim과 같은 방식)
const LINK_DELAY_MS = 20 * 60000;
const CLOCK_LAG_MS = SIDE === "mars" ? LINK_DELAY_MS : 0;
const sideNow = () => Date.now() - CLOCK_LAG_MS;
// ms → "YYYY-MM-DD HH:MM:SS" (UTC)
const fmtUtc = ms => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

const STATUS = {
  "정상": { label: "Normal", cls: "" },
  "경고": { label: "Needs attention", cls: "warn" },
  "위험": { label: "Critical", cls: "alert" },
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

// 의사 화면은 ?crew=B 처럼 대원을 고른다. 우주인 화면은 늘 A 대원이다
function currentCrew() {
  const crew = SIDE === "earth" && new URLSearchParams(location.search).get("crew");
  return CREWS.includes(crew) ? crew : BIOMARKER_CREW;
}
const crewQuery = crew => SIDE === "earth" ? `crew=${crew}` : "";
function pageUrl(page, params = {}) {
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
    location.href = `../${where.value}/${page}`;
  });
  // 실제 시각으로 1초마다 갱신. 화성 화면은 통신 간격만큼 늦다
  const clock = el("span", "clock");
  clock.title = SIDE === "mars" ? `Mars clock · ${LINK_DELAY_MS / 60000} min behind Earth` : "Earth clock";
  const tick = () => { clock.textContent = `UTC ${fmtUtc(sideNow())}`; };
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

// 대원별 1:1 대화. A 대원은 시안의 예시 대화로 시작한다
const DEMO_THREADS = {
  A: [
    { from: "crew", time: "12:13", note: "Delivered", attached: true, sleepQuestion: true },
    { from: "doctor", time: "12:25", note: "Example physician reply",
      text: "Thanks for sharing your record. I’ve received it. Please tell me how you’re feeling now." },
    { from: "crew", time: "12:30", note: "Waiting to send",
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
const SEVERITY = { "정상": 0, "경고": 1, "위험": 2 };
function worstSleepCheck(records) {
  return ["TST", "SE", "WASO", "Self-reported sleep quality"]
    .map(name => records.find(b => b.Biomarker === name))
    .filter(b => b && b.Status !== "정상")
    .sort((a, b) => SEVERITY[b.Status] - SEVERITY[a.Status])[0] || null;
}
const guideFor = (record, instructions) =>
  record && instructions.find(i => i.biomarker === record.Biomarker && i.Status === record.Status) || null;
