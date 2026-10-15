// 지구 — 대원과의 대화. 왼쪽에서 대원을 고르고, 대화는 화성 화면과 같은 저장소를 쓴다.

const TODAY = NOW.slice(0, 10);
const CREW = currentCrew();

// 대원 메시지는 왼쪽, 내(의사) 메시지는 오른쪽 말풍선
function renderMessage(m) {
  const mine = m.from === "doctor";
  const msg = el("div", "msg " + (mine ? "mine bubble-mine" : "theirs plain"));
  msg.append(
    el("div", "from", mine ? "You — Ground doctor" : `Crew member ${CREW}`),
    el("div", "", m.text),
    el("div", "meta", `${dayLabel(TODAY)} ${m.time} · ${m.note}`),
  );
  return m.attached ? [msg, el("div", "attached", `Attached: sleep check · ${dayLabel(TODAY)}`)] : [msg];
}

function renderCrewList(tst) {
  document.getElementById("crew-list").replaceChildren(...CREWS.map(crew => {
    const thread = loadThread(crew, crew === BIOMARKER_CREW ? tst : null);
    const last = thread[thread.length - 1];
    const item = el("a", "tile crew-item" + (crew === CREW ? " selected" : ""));
    item.href = pageUrl("conversation.html", { crew });
    item.append(
      el("div", "name", `Crew ${crew}`),
      el("div", "muted", last ? last.text : "No messages yet"),
      el("div", "note", last ? `${last.time} UTC · Latest message` : "Open 1:1 conversation"),
    );
    return item;
  }));
}

function renderThread(tst) {
  const date = longDate(TODAY, { weekday: "long", month: "long", day: "numeric" });
  const thread = loadThread(CREW, tst);
  document.getElementById("thread").replaceChildren(
    el("p", "notice", "Messages may take time to reach the crew. We’ll show you when they arrive."),
    el("p", "date", `${date} · ${thread.length ? "Demo conversation" : "No messages yet"}`),
    ...thread.flatMap(renderMessage),
  );
}

async function init() {
  renderTopbar("calendar");
  document.getElementById("title").textContent = `A conversation with Crew ${CREW}.`;
  document.getElementById("avatar").textContent = CREW;
  document.getElementById("who").textContent = `Crew member ${CREW}`;
  document.getElementById("team").textContent = `Crew ${CREW} · 1:1 conversation`;
  const draft = document.getElementById("draft");
  draft.placeholder = `Write a message to Crew ${CREW}...`;

  let tst = null;
  try {
    const biomarkers = await loadCsv(BIOMARKER_CSV);
    tst = biomarkers.find(b => b.timestamp.startsWith(TODAY) && b.Biomarker === "TST") || null;
  } catch (err) {
    console.error(err);
  }
  const crewTst = CREW === BIOMARKER_CREW ? tst : null;
  renderCrewList(tst);
  renderThread(crewTst);

  document.getElementById("composer").addEventListener("submit", e => {
    e.preventDefault();
    const text = draft.value.trim();
    if (!text) return;
    addMessage(CREW, "doctor", text);
    draft.value = "";
    renderCrewList(tst);
    renderThread(crewTst);
  });
}

init();
