// ver2 — Doctor conversation. 공유된 수면 기록은 A_dummy120.csv에서 읽고,
// 대화 내용은 연결할 데이터가 없어 시안의 예시 대화로 시작한다.

const TODAY = NOW.slice(0, 10);
const STORAGE_KEY = "dashboard.conversation.sent";

const DEMO_THREAD = [
  { from: "you", time: "12:13", text: "", note: "Delivered", attached: true },
  { from: "doctor", time: "12:25", note: "Example physician reply",
    text: "Thanks for sharing your record. I’ve received it. Please tell me how you’re feeling now." },
  { from: "you", time: "12:30", note: "Waiting to send",
    text: "I’m still feeling tired. I’ve opened the saved sleep guidance." },
];

// 보낸 메시지는 이 브라우저에만 저장된다
function loadSent() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveSent(sent) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sent)); } catch {}
}

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

function renderMessage(m) {
  const msg = el("div", "msg " + m.from);
  msg.append(
    el("div", "from", m.from === "you" ? "You" : "Ground doctor"),
    el("div", "", m.text),
    el("div", "meta", `${dayLabel(TODAY)} ${m.time} · ${m.note}`),
  );
  return m.attached ? [msg, el("div", "attached", `Attached: sleep check · ${dayLabel(TODAY)}`)] : [msg];
}

function renderThread(sent) {
  const d = toDate(TODAY);
  const date = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  document.getElementById("thread").replaceChildren(
    el("p", "notice", "Messages may take time to reach Earth. We’ll show you when they arrive."),
    el("p", "date", `${date} · Demo conversation`),
    ...[...DEMO_THREAD, ...sent].flatMap(renderMessage),
  );
}

async function init() {
  renderClock();

  let tst = null;
  try {
    const biomarkers = await loadCsv(BIOMARKER_CSV);
    tst = biomarkers.find(b => b.timestamp.startsWith(TODAY) && b.Biomarker === "TST") || null;
  } catch (err) {
    console.error(err);
  }
  renderShared(tst);
  DEMO_THREAD[0].text = tst
    ? `I slept ${tst.Figure} hours last night and still feel tired. Could you check my sleep record?`
    : "I still feel tired. Could you check my sleep record?";

  const sent = loadSent();
  renderThread(sent);

  const draft = document.getElementById("draft");
  document.getElementById("composer").addEventListener("submit", e => {
    e.preventDefault();
    const text = draft.value.trim();
    if (!text) return;
    sent.push({ from: "you", time: NOW.slice(11), text, note: "Waiting to send" });
    saveSent(sent);
    draft.value = "";
    renderThread(sent);
  });
}

init();
