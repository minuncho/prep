// 하루 기록 화면 (화성·지구 공용). 수면 수치는 A_data.csv, 조치 안내는 instruction.csv,
// 활동은 event.csv에서 읽는다. ?date=YYYY-MM-DD 로 날짜를, 지구 화면은 ?crew=B 로 대원을 고른다.

// 날짜를 안 주면 가장 최근 수면 기록이 있는 날 (오늘 07:00 측정 전이면 어제)
let DATE = new URLSearchParams(location.search).get("date");
const CREW = currentCrew();
const SLEEP_CHECKS = ["Self-reported sleep quality", "TST", "SE", "WASO"];
// 지구 화면은 의사가 대원 기록을 보는 문구로 바꾼다
const WHO = SIDE === "earth"
  ? { sleep: `Crew ${CREW}’s sleep`, slept: `Crew ${CREW} slept`, help: `Review the saved guidance and check in with Crew ${CREW}.` }
  : { sleep: "Your sleep", slept: "You slept", help: "Review your saved guidance and ask your doctor for help." };

function renderBanner(tst) {
  const tag = document.getElementById("banner-tag");
  const title = document.getElementById("banner-title");
  const sub = document.getElementById("banner-sub");
  if (!tst) {
    tag.className = "tag ok";
    tag.textContent = "Awaiting health data";
    title.textContent = "No sleep measurement was supplied for this day.";
    return;
  }
  const alert = tst.Status !== "Normal";
  tag.className = "tag" + (alert ? "" : " ok");
  tag.textContent = `${WHO.sleep} ${alert ? "needs attention" : "looks normal"}`;
  document.getElementById("banner-measured").textContent =
    `${tst.Figure} hours last night · Measured ${dayLabel(DATE)} ${tst.timestamp.slice(11, 16)}`;
  title.textContent = `${WHO.slept} ${tst.Figure} hours last night.`;
  sub.textContent = alert
    ? `A shorter night can affect readiness. ${WHO.help}`
    : "Sleep time is within the normal range.";
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

function renderNext(records, instructions) {
  const guide = guideFor(worstSleepCheck(records), instructions);
  document.getElementById("next").textContent = guide ? guide.Instruction : "No action is needed for sleep today.";
  const link = document.getElementById("next-link");
  link.href = pageUrl("conversation.html", { crew: SIDE === "earth" ? CREW : "" });
  link.textContent = SIDE === "earth" ? `Message Crew ${CREW}` : "Message my doctor";
}

// 수면 외 항목 (biomarkers.csv의 분류별로)
function renderOtherChecks(records, info) {
  const others = records.filter(b => !SLEEP_CHECKS.includes(b.Biomarker));
  const groups = {};
  for (const b of others) (groups[(info[b.Biomarker] || {}).Category || "Other"] ||= []).push(b);
  const box = document.getElementById("other-checks");
  if (!others.length) {
    box.replaceChildren(el("p", "sub", "No other measurements for this day yet."));
    return;
  }
  box.replaceChildren(...Object.entries(groups).map(([category, list]) => {
    const group = el("div", "check-group");
    group.append(el("h3", "", category));
    for (const b of list) {
      const status = STATUS[b.Status];
      const row = el("div", "check");
      const what = el("div", "what", checkLabel(b.Biomarker));
      what.append(el("small", "", `${dayLabel(DATE)} ${b.timestamp.slice(11, 16)}` +
        (info[b.Biomarker] ? ` · ${info[b.Biomarker].Method} · ${info[b.Biomarker].Period}` : "")));
      if (info[b.Biomarker]) what.title = info[b.Biomarker].biomarker_summary;
      row.append(what, el("div", "value", b.Figure), el("div", "status " + status.cls, status.label));
      group.append(row);
    }
    return group;
  }));
}

function renderActivities(events) {
  const mine = events.filter(e => e.start_timestamp.startsWith(DATE) && e.Crew.split(",").includes(CREW));
  document.getElementById("activities").replaceChildren(...(mine.length
    ? mine.map(e => el("li", "", `${e.start_timestamp.slice(11, 16)} ${e.activity_summary}`))
    : [el("li", "", "No mission records")]));
}

async function init() {
  renderTopbar("calendar");
  if (SIDE === "earth") {
    document.getElementById("title").textContent = `Crew ${CREW} — Daily records`;
    document.getElementById("checks-title").textContent = "Crew health checks";
    document.getElementById("activities-title").textContent = "Crew activities";
  }

  let biomarkers, instructions, events, info;
  try {
    [biomarkers, instructions, events, info] =
      await Promise.all([loadCsv(BIOMARKER_CSV), loadCsv(INSTRUCTION_CSV), loadEvents(), loadBiomarkerInfo()]);
  } catch (err) {
    document.getElementById("banner-title").textContent = `Could not load data (${err.message}).`;
    return;
  }

  const own = CREW === BIOMARKER_CREW ? biomarkers : [];
  DATE ||= (latest(own, "TST") || { timestamp: NOW }).timestamp.slice(0, 10);
  document.getElementById("date").textContent =
    `${longDate(DATE, { weekday: "long", month: "long", day: "numeric" })} · ${dayLabel(DATE)}`;
  const records = own.filter(b => b.timestamp.startsWith(DATE) && measured(b));
  renderBanner(records.find(b => b.Biomarker === "TST"));
  renderChecks(records);
  renderNext(records, instructions);
  renderActivities(events);
  renderOtherChecks(records, info);
}

init();
