// ver2 — Health Instruction. 지금까지 측정된 오늘 기록(A_dummy120.csv) 중 정상이 아닌 항목에
// instruction.csv의 안내문을 붙여 보여준다.

const TODAY = NOW.slice(0, 10);
const state = { items: [], kind: "", query: "" };

function buildItems(biomarkers, instructions) {
  const records = biomarkers.filter(b => b.timestamp.startsWith(TODAY) && b.timestamp <= NOW);

  const guidance = records.filter(b => b.Status !== "정상").flatMap(b => {
    const guide = instructions.find(i => i.biomarker === b.Biomarker && i.Status === b.Status);
    if (!guide) return [];
    const label = (HEALTH_CHECKS[b.Biomarker] || { label: b.Biomarker }).label;
    const status = STATUS[b.Status];
    return [{
      kind: "Care guidance",
      name: `${label} · ${status.label}`,
      cls: status.cls,
      body: guide.Instruction,
      source: `${dayLabel(TODAY)} ${b.timestamp.slice(11, 16)} · Based on instruction.csv`,
    }];
  });

  const tst = records.find(b => b.Biomarker === "TST");
  const se = records.find(b => b.Biomarker === "SE");
  const health = tst ? [{
    kind: "My health",
    name: `Your sleep check on ${longDate(TODAY, { month: "long", day: "numeric" })} →`,
    href: "daily.html",
    body: `Time asleep: ${tst.Figure} hours` + (se ? ` · Sleep efficiency: ${se.Figure}%` : ""),
    source: `${dayLabel(TODAY)} ${tst.timestamp.slice(11, 16)} · A_dummy120.csv`,
  }] : [];

  const notes = [{
    kind: "Doctor’s notes",
    name: "Your doctor’s notes will appear here →",
    href: "conversation.html",
    body: "Prior consultations and diagnoses are saved here when you add them.",
    source: "No physician notes supplied",
  }];

  return [...guidance, ...health, ...notes];
}

function render() {
  const q = state.query.toLowerCase();
  const shown = state.items.filter(i =>
    (!state.kind || i.kind === state.kind) &&
    (!q || `${i.kind} ${i.name} ${i.body}`.toLowerCase().includes(q)));

  document.getElementById("items").replaceChildren(...(shown.length ? shown.map(i => {
    const item = el(i.href ? "a" : "div", "item");
    if (i.href) item.href = i.href;
    item.append(
      el("div", "kind", i.kind),
      el("div", "name " + (i.cls || ""), i.name),
      el("div", "body", i.body),
      el("div", "source", i.source),
    );
    return item;
  }) : [el("p", "none", "Nothing matches your search.")]));
}

async function init() {
  renderTopbar("instruction");

  try {
    const [biomarkers, instructions] = await Promise.all([loadCsv(BIOMARKER_CSV), loadCsv(INSTRUCTION_CSV)]);
    state.items = buildItems(biomarkers, instructions);
  } catch (err) {
    document.getElementById("items").replaceChildren(el("p", "none", `Could not load data (${err.message}).`));
    return;
  }

  const query = document.getElementById("query");
  const search = () => { state.query = query.value.trim(); render(); };
  query.addEventListener("input", search);
  document.getElementById("search").addEventListener("submit", e => { e.preventDefault(); search(); });

  const tabs = document.querySelectorAll("#tabs button");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      state.kind = tab.dataset.kind;
      tabs.forEach(t => t.classList.toggle("active", t === tab));
      render();
    });
  }

  render();
}

init();
