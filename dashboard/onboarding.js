// 첫 진입 설정 (화성·지구 공용). 3단계 폼을 넘기고, 입력한 내용은 이 브라우저에 저장해 프로필 화면에서 쓴다.

const PROFILE_KEY = `dashboard.profile.${SIDE}`;
const steps = [...document.querySelectorAll(".step")];
const values = {};
let imported = null; // { name, rows }

function show(n) {
  steps.forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
  window.scrollTo(0, 0);
}

function collect(form) {
  for (const [k, v] of new FormData(form)) {
    if (k === "bring") (values.bring ||= new Set()).add(v);
    else values[k] = String(v).trim();
  }
}

function summaryRows() {
  const or = (v, fallback) => v || fallback;
  if (SIDE === "earth") {
    return [
      ["Professional profile & Earth location", [values.name, values.organization, values.location].filter(Boolean).join(" · ")],
      ["Assigned mission", `${or(values.mission, "Not selected")} · UTC / Sol reference`],
      ["Assigned crew", values.crews ? values.crews.map(c => `Crew ${c}`).join(", ") : "Load crew information to preview"],
      ["Records", values.bring && values.bring.size ? [...values.bring].join(", ") : "Nothing selected"],
    ];
  }
  return [
    ["Profile & health details", [values.name, values.crewId && `ID ${values.crewId}`].filter(Boolean).join(" · ")],
    ["Current location", [values.location, values.locationDetails].filter(Boolean).join(" · ")],
    ["Time reference", `UTC + ${or(values.sol, "mission-provided Sol reference")}`],
    ["Imported records", imported ? `${imported.rows} rows from ${imported.name}` : `${values.records || "Mission"} measurements for Crew ${currentCrew()}`],
  ];
}

function renderSummary() {
  document.getElementById("summary").replaceChildren(...summaryRows().map(([k, v]) => {
    const li = el("li", "", k);
    li.append(el("span", "arrow", "→"), el("span", "", v));
    return li;
  }));
}

// 파일은 행 수만 세서 보여준다 (실제 반영은 하지 않는다)
const file = document.getElementById("import-file");
file.addEventListener("change", async () => {
  const f = file.files[0];
  if (!f) return;
  const rows = parseCsv(await f.text()).length;
  imported = { name: f.name, rows };
  document.getElementById("import-result").textContent = `${f.name} · ${rows} rows ready to review`;
});

// 지구: 일정 데이터에 나오는 대원을 불러온다
const loadCrew = document.getElementById("load-crew");
if (loadCrew) {
  loadCrew.addEventListener("click", async () => {
    const events = await loadCsv(EVENTS_CSV);
    values.crews = [...new Set(events.flatMap(e => e.Crew.split(",")))].sort();
    document.getElementById("crew-loaded").replaceChildren(...values.crews.map(c =>
      el("li", "", `Crew ${c} · ${DATA_DAYS} days of measurements`)));
  });
}

for (const form of steps) {
  form.addEventListener("submit", e => {
    e.preventDefault();
    collect(form);
    const n = Number(form.dataset.step);
    if (n < steps.length) {
      if (n + 1 === steps.length) renderSummary();
      show(n + 1);
      return;
    }
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...values, bring: [...(values.bring || [])] }));
    } catch {}
    location.href = pageUrl("index.html");
  });
  const back = form.querySelector("[data-back]");
  if (back) back.addEventListener("click", () => show(Number(form.dataset.step) - 1));
}

// 우주인 요약에 쓸 기본 기록 수
loadCrewData(currentCrew()).then(rows => { values.records = rows.length; }).catch(() => {});
show(1);
