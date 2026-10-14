// 화면들이 같이 쓰는 데이터 경로, CSV 읽기, 날짜 계산.

const EVENTS_CSV = "../data/event_dummy.csv";
const BIOMARKER_CSV = "../data/A_dummy120.csv";
const INSTRUCTION_CSV = "../data/instruction.csv";
const BIOMARKER_CREW = "A"; // 생체 데이터는 A 대원 것만 있다

// 디자인 시안의 "지금" (UTC 2026-01-04 12:30, SOL 004)
const MISSION_START = "2026-01-01";
const NOW = "2026-01-04 12:30";

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

// 상단 바. active는 "calendar" | "instruction" | "profile"
function renderTopbar(active) {
  const link = (label, href, key) => {
    const a = el("a", "pill" + (key === active ? " active" : ""), label);
    a.href = href;
    return a;
  };
  const where = el("select", "pill");
  where.setAttribute("aria-label", "Location and role");
  where.append(new Option("SPACE / Astronaut"));
  document.getElementById("topbar").replaceChildren(
    link("My calendar", "index.html", "calendar"),
    link("Health Instruction", "instruction.html", "instruction"),
    el("span", "spacer"),
    el("span", "clock", `UTC ${NOW}`),
    el("span", "clock", "SOL " + String(missionDay(NOW.slice(0, 10))).padStart(3, "0")),
    where,
    link("My profile", "profile.html", "profile"),
  );
}
