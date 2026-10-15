// 화성 — Health Instruction. 지금까지 측정된 오늘 기록(A_dummy120.csv) 중 정상이 아닌 항목에
// instruction.csv의 안내문을 붙여 보여준다.

const TODAY = NOW.slice(0, 10);
const state = { items: [], kind: "", query: "" };

function buildItems(biomarkers, instructions, info) {
  const records = recent(biomarkers);

  const guidance = records.filter(b => b.Status !== "정상").flatMap(b => {
    const guide = instructions.find(i => i.biomarker === b.Biomarker && i.Status === b.Status);
    if (!guide) return [];
    const label = checkLabel(b.Biomarker);
    const status = STATUS[b.Status];
    return [{
      kind: "Care guidance",
      name: `${label} · ${status.label}`,
      cls: status.cls,
      body: guide.Instruction,
      about: info[b.Biomarker] ? info[b.Biomarker].biomarker_summary : "",
      source: `${dayLabel(b.timestamp.slice(0, 10))} ${b.timestamp.slice(11, 16)} · ${b.Figure} · ` +
        (info[b.Biomarker] ? `${info[b.Biomarker].Category} · ` : "") + "Based on instruction.csv",
    }];
  });

  const tst = latest(biomarkers, "TST");
  const se = latest(biomarkers, "SE");
  const health = tst ? [{
    kind: "My health",
    name: `Your sleep check on ${longDate(tst.timestamp.slice(0, 10), { month: "long", day: "numeric" })} →`,
    href: "daily.html",
    body: `Time asleep: ${tst.Figure} hours` + (se ? ` · Sleep efficiency: ${se.Figure}%` : ""),
    source: `${dayLabel(tst.timestamp.slice(0, 10))} ${tst.timestamp.slice(11, 16)} · A_dummy120.csv`,
  }] : [];

  // 의사가 지구 화면에서 저장한 안내
  const saved = loadInstructions(BIOMARKER_CREW).reverse().map(n => ({
    kind: "Doctor’s notes",
    name: n.title,
    body: n.body,
    source: `UTC ${n.time} · Shared by your ground doctor`,
  }));
  const notes = saved.length ? saved : [{
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
    (!q || `${i.kind} ${i.name} ${i.body} ${i.about || ""}`.toLowerCase().includes(q)));

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
    const [biomarkers, instructions, info] =
      await Promise.all([loadCsv(BIOMARKER_CSV), loadCsv(INSTRUCTION_CSV), loadBiomarkerInfo()]);
    state.items = buildItems(biomarkers, instructions, info);
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
