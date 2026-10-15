// 지구 — 대원별 건강 안내. 최근 안내는 의사가 저장한 것, 없으면 instruction.csv의 예시 안내를 보여준다.
// 여기서 저장한 안내는 화성(우주인) Health Instruction 화면의 Doctor's notes에 나타난다.

const TODAY = NOW.slice(0, 10);
const CREW = currentCrew();

function renderStatus(records) {
  const tst = records.find(b => b.Biomarker === "TST");
  const se = records.find(b => b.Biomarker === "SE");
  const list = document.getElementById("status");
  if (!tst) {
    list.replaceChildren(el("li", "", "Awaiting health data"), el("li", "", "No measurements supplied"));
    return;
  }
  const status = STATUS[tst.Status];
  list.replaceChildren(
    el("li", status.cls, tst.Status === "정상" ? "Sleep looks normal" : `! ${status.label} sleep alert`),
    el("li", "", `Sleep duration: ${tst.Figure} h`),
    ...(se ? [el("li", "", `Sleep efficiency: ${se.Figure}%`)] : []),
    el("li", "faint", `${dayLabel(TODAY)} ${tst.timestamp.slice(11, 16)} UTC`),
  );
}

function renderRecent(records, instructions) {
  document.getElementById("recent-title").textContent = `Recent instruction for Crew ${CREW}`;
  const saved = loadInstructions(CREW);
  const last = saved[saved.length - 1];
  const box = document.getElementById("recent");
  if (last) {
    box.replaceChildren(
      el("p", "faint", `${last.title} · Saved UTC ${last.time}`),
      el("p", "body", last.body),
      el("p", "faint", last.note === "Delivered" ? "Delivered to the crew member" : last.note),
    );
    return;
  }
  const guide = guideFor(worstSleepCheck(records), instructions);
  box.replaceChildren(...(guide ? [
    el("p", "faint", "Sleep recovery · Example instruction"),
    el("p", "body", guide.Instruction),
    el("p", "faint", "Example content based on instruction.csv"),
  ] : [el("p", "body", "No instruction has been shared with this crew member yet.")]));
}

async function init() {
  renderTopbar("instruction");
  document.getElementById("crew-initial").textContent = CREW;
  document.getElementById("crew-name").textContent = `Crew member ${CREW}`;
  document.getElementById("for").textContent = `For Crew ${CREW}`;
  document.getElementById("note-body").placeholder = `Write care steps or follow-up instructions for Crew ${CREW}...`;
  document.getElementById("note-save").textContent = `Save & share with Crew ${CREW}`;
  document.getElementById("records-link").href = pageUrl("daily.html", { crew: CREW });
  for (const tab of document.querySelectorAll("#crew-tabs a")) {
    tab.href = pageUrl("instruction.html", { crew: tab.dataset.crew });
    tab.classList.toggle("active", tab.dataset.crew === CREW);
  }

  let records = [], instructions = [];
  try {
    const [biomarkers, guides] = await Promise.all([loadCsv(BIOMARKER_CSV), loadCsv(INSTRUCTION_CSV)]);
    records = CREW === BIOMARKER_CREW ? biomarkers.filter(b => b.timestamp.startsWith(TODAY) && b.timestamp <= NOW) : [];
    instructions = guides;
  } catch (err) {
    console.error(err);
  }
  renderStatus(records);
  renderRecent(records, instructions);

  const title = document.getElementById("note-title");
  const body = document.getElementById("note-body");
  document.getElementById("note-form").addEventListener("submit", e => {
    e.preventDefault();
    addInstruction(CREW, title.value.trim(), body.value.trim());
    title.value = body.value = "";
    document.getElementById("note-result").textContent = `Sent to Crew ${CREW} · arrives in ${LINK_DELAY_MS / 60000} min`;
    renderRecent(records, instructions);
  });
}

init();
