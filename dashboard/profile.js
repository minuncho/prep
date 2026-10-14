// ver2 — My profile. 개인정보 데이터가 없어 시안 문구 그대로이고, 임무 날짜만 계산한다.

renderTopbar("profile");
document.getElementById("mission-start").textContent =
  longDate(MISSION_START, { month: "long", day: "numeric", year: "numeric" });
document.getElementById("mission-time").textContent = dayLabel(NOW.slice(0, 10));
