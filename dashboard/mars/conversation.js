// 화성 — 의사와의 대화. 공유된 수면 기록은 A_dummy120.csv에서 읽는다.
// 대화는 브라우저 저장소에 대원별로 저장되어 지구(의사) 화면과 같이 쓰고, 상대에게는 LINK_DELAY_MS 뒤에 보인다.

const TODAY = NOW.slice(0, 10);
const CREW = BIOMARKER_CREW;

function renderShared(tst) {
  const when = document.getElementById("shared-when");
  const value = document.getElementById("shared-value");
  if (!tst) {
    when.textContent = dayLabel(TODAY);
    value.className = "muted";
    value.textContent = "No measurement";
    return;
  }
  const status = STATUS[tst.Status];
  when.textContent = `${dayLabel(TODAY)} · ${tst.timestamp.slice(11, 16)}`;
  value.className = status.cls || "muted";
  value.textContent = `${tst.Figure} hours · ${status.label}`;
}

// 내 메시지는 오른쪽, 의사 메시지는 왼쪽 말풍선
function renderMessage(m) {
  const mine = m.from === "crew";
  const msg = el("div", "msg " + (mine ? "mine" : "theirs"));
  msg.append(
    el("div", "from", mine ? "You" : "Ground doctor"),
    el("div", "", m.text),
    el("div", "meta", `${m.stored ? "UTC" : dayLabel(TODAY)} ${m.time} · ${m.note}`),
  );
  return m.attached ? [msg, el("div", "attached", `Attached: sleep check · ${dayLabel(TODAY)}`)] : [msg];
}

function renderThread(tst) {
  const date = longDate(TODAY, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("thread").replaceChildren(
    el("p", "notice", "Messages may take time to reach Earth. We’ll show you when they arrive."),
    el("p", "date", `${date} · Demo conversation`),
    ...loadThread(CREW, tst).flatMap(renderMessage),
  );
}

async function init() {
  renderTopbar("calendar");

  let tst = null;
  try {
    const biomarkers = await loadCsv(BIOMARKER_CSV);
    tst = biomarkers.find(b => b.timestamp.startsWith(TODAY) && b.Biomarker === "TST") || null;
  } catch (err) {
    console.error(err);
  }
  renderShared(tst);
  renderThread(tst);
  // 지구에서 보낸 메시지가 도착하면 보이도록 주기적으로 다시 그린다
  setInterval(() => renderThread(tst), 15000);

  const draft = document.getElementById("draft");
  document.getElementById("composer").addEventListener("submit", e => {
    e.preventDefault();
    const text = draft.value.trim();
    if (!text) return;
    addMessage(CREW, "crew", text);
    draft.value = "";
    renderThread(tst);
  });
}

init();
