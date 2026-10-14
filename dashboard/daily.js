// ver2 — Daily records. 수면 수치는 A_dummy120.csv, 조치 안내는 instruction.csv,
// 활동은 event_dummy.csv에서 읽는다. ?date=YYYY-MM-DD 로 다른 날짜를 볼 수 있다.

const DATE = new URLSearchParams(location.search).get("date") || NOW.slice(0, 10);
const SLEEP_CHECKS = ["Self-reported sleep quality", "TST", "SE", "WASO"];
const SEVERITY = { "정상": 0, "경고": 1, "위험": 2 };

function renderBanner(tst) {
  const tag = document.getElementById("banner-tag");
  const title = document.getElementById("banner-title");
  const sub = document.getElementById("banner-sub");
  if (!tst) {
    tag.className = "tag ok";
    tag.textContent = "No sleep record";
    title.textContent = "There is no sleep measurement for this day.";
    return;
  }
  const alert = tst.Status !== "정상";
  tag.className = "tag" + (alert ? "" : " ok");
  tag.textContent = alert ? "Your sleep needs attention" : "Your sleep looks normal";
  document.getElementById("banner-measured").textContent =
    `${tst.Figure} hours last night · Measured ${dayLabel(DATE)} ${tst.timestamp.slice(11, 16)}`;
  title.textContent = `You slept ${tst.Figure} hours last night.`;
  sub.textContent = alert
    ? "A shorter night can affect readiness. Review your saved guidance and ask your doctor for help."
    : "Your sleep time is within the normal range.";
}

function renderChecks(records) {
  const rows = SLEEP_CHECKS.map(name => records.find(b => b.Biomarker === name)).filter(Boolean).map(b => {
    const check = HEALTH_CHECKS[b.Biomarker], status = STATUS[b.Status];
    const what = el("div", "what", check.label);
    what.append(el("small", "", `${dayLabel(DATE)} ${b.timestamp.slice(11, 16)} · ${check.detail}`));
    const row = el("div", "check");
    row.append(what, el("div", "value", b.Figure + check.unit), el("div", "status " + status.cls, status.label));
    return row;
  });
  document.getElementById("checks").replaceChildren(
    ...(rows.length ? rows : [el("p", "sub", "No measurements for this day.")]));
}

// 가장 심각한 수면 항목의 안내문을 보여준다. 심각도가 같으면 수면 시간(TST)이 먼저다
function renderNext(records, instructions) {
  const worst = ["TST", "SE", "WASO", "Self-reported sleep quality"].map(name => records.find(b => b.Biomarker === name))
    .filter(b => b && b.Status !== "정상")
    .sort((a, b) => SEVERITY[b.Status] - SEVERITY[a.Status])[0];
  const guide = worst && instructions.find(i => i.biomarker === worst.Biomarker && i.Status === worst.Status);
  document.getElementById("next").textContent = guide ? guide.Instruction : "No action is needed for your sleep today.";
}

function renderActivities(events) {
  const mine = events.filter(e => e.start_timestamp.startsWith(DATE) && e.Member.split(",").includes(BIOMARKER_CREW));
  document.getElementById("activities").replaceChildren(...(mine.length
    ? mine.map(e => el("li", "", `${e.start_timestamp.slice(11, 16)} ${e.activity_summary}`))
    : [el("li", "", "No mission records")]));
}

async function init() {
  renderTopbar("calendar");
  document.getElementById("date").textContent =
    `${longDate(DATE, { weekday: "long", month: "long", day: "numeric" })} · ${dayLabel(DATE)}`;

  let biomarkers, instructions, events;
  try {
    [biomarkers, instructions, events] =
      await Promise.all([loadCsv(BIOMARKER_CSV), loadCsv(INSTRUCTION_CSV), loadCsv(EVENTS_CSV)]);
  } catch (err) {
    document.getElementById("banner-title").textContent = `Could not load data (${err.message}).`;
    return;
  }

  const records = biomarkers.filter(b => b.timestamp.startsWith(DATE));
  renderBanner(records.find(b => b.Biomarker === "TST"));
  renderChecks(records);
  renderNext(records, instructions);
  renderActivities(events);
}

init();
