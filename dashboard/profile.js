// 프로필 화면 (화성·지구 공용). 개인정보 데이터가 없어 시안 문구 그대로이고, 임무 날짜만 계산한다.

renderTopbar("profile");
const fill = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
fill("mission-start", longDate(MISSION_START, { month: "long", day: "numeric", year: "numeric" }));
fill("mission-time", dayLabel(NOW.slice(0, 10)));
fill("mission-sol", "SOL " + String(missionDay(NOW.slice(0, 10))).padStart(3, "0"));
