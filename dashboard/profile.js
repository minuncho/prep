// 프로필 화면 (화성·지구 공용). 개인정보 데이터가 없어 시안 문구 그대로이고, 임무 날짜만 계산한다.

renderTopbar("profile");
const fill = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
fill("mission-start", longDate(MISSION_START, { month: "long", day: "numeric", year: "numeric" }));
fill("mission-time", dayLabel(NOW.slice(0, 10)));
fill("mission-sol", "SOL " + String(missionDay(NOW.slice(0, 10))).padStart(3, "0"));

// 첫 진입 설정에서 입력한 값이 있으면 채운다
let saved = {};
try { saved = JSON.parse(localStorage.getItem(`dashboard.profile.${SIDE}`)) || {}; } catch {}
const put = (id, label, value) => { if (value) fill(id, label ? `${label}: ${value}` : value); };
put("p-name", "", saved.name);
put("p-email", "", saved.email);
put("p-history", "Medical history", saved.history);
put("p-allergies", "Allergies", saved.allergies);
put("p-medication", "Medication", saved.medication);
put("p-specialty", "Specialty", saved.specialty);
put("p-organization", "Organization", saved.organization);
