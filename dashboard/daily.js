// 하루 기록 화면 (화성·지구 공용). 수면 수치는 A_dummy120.csv, 조치 안내는 instruction.csv,
// 활동은 event_dummy.csv에서 읽는다. ?date=YYYY-MM-DD 로 날짜를, 지구 화면은 ?crew=B 로 대원을 고른다.

const DATE = new URLSearchParams(location.search).get("date") || NOW.slice(0, 10);
const CREW = currentCrew();
const SLEEP_CHECKS = ["Self-reported sleep quality", "TST", "SE", "WASO"];
// 지구 화면은 의사가 대원 기록을 보는 문구로 바꾼다
const WHO = SIDE === "earth"
  ? { sleep: `Crew ${CREW}’s sleep`, slept: `Crew ${CREW} slept`, help: "Review the saved guidance and check in with the crew member." }
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
  const alert = tst.Status !== "정상";
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

function renderActivities(events) {
  const mine = events.filter(e => e.start_timestamp.startsWith(DATE) && e.Member.split(",").includes(CREW));
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

  const records = CREW === BIOMARKER_CREW ? biomarkers.filter(b => b.timestamp.startsWith(DATE)) : [];
  renderBanner(records.find(b => b.Biomarker === "TST"));
  renderChecks(records);
  renderNext(records, instructions);
  renderActivities(events);
}

init();
