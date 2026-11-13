// 학생 화면: 입장 → 대기 → (앞 그림 보기) → 그리기 → 제출 → 공개
import { ensureAuth, roomRef, get, set, onValue, serverTimestamp, now, store, show, $, safeImg, chainOf } from "./common.js";
import { DrawPad, COLORS, SIZES } from "./canvas.js";
import { loadChain, clearCache, renderFeed, playAnim } from "./reveal.js";

let uid, code, name, pad, st = null;
let offs = [], doneOff = null, roundT = null, animStop = null;
let myRound = -1, myChain = -1, submitted = false, peeking = false;

const msg = (t) => { $("#joinMsg").textContent = t; };

function goFullscreen() {
  try { document.documentElement.requestFullscreen?.()?.catch(() => {}); } catch {}
  try { navigator.wakeLock?.request("screen")?.catch(() => {}); } catch {} // 게임 중 화면 꺼짐 방지
}

// 실수로 누르는 것 방지: 한 번 더 눌러야 실행
function twoTap(btn, label, fn) {
  if (btn.dataset.armed) { clearTimeout(+btn.dataset.armed); btn.textContent = btn.dataset.label; delete btn.dataset.armed; fn(); return; }
  btn.dataset.label = btn.textContent;
  btn.textContent = label;
  btn.dataset.armed = setTimeout(() => { btn.textContent = btn.dataset.label; delete btn.dataset.armed; }, 2500);
}

function buildTools() {
  const t = $("#tools");
  t.innerHTML = `
    <div class="swatches">${COLORS.map((c, i) => `<button class="sw${i === 0 ? " sel" : ""}" style="background:${c}" data-color="${c}" aria-label="색 ${i + 1}"></button>`).join("")}</div>
    <div class="sizes">${SIZES.map((s, i) => `<button class="size${i === 1 ? " sel" : ""}" data-size="${s}" aria-label="굵기 ${i + 1}"><i style="width:${Math.min(s + 2, 24)}px;height:${Math.min(s + 2, 24)}px"></i></button>`).join("")}</div>
    <div class="tool-row"><button class="btn tool" id="eraser">지우개</button><button class="btn" id="undo">되돌리기</button></div>
    <button class="btn" id="clearBtn">모두 지우기</button>
    <button class="btn primary submit" id="submitBtn">다 그렸어요</button>`;
  t.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.color) {
      pad.color = b.dataset.color; pad.erase = false;
      t.querySelectorAll(".sw").forEach((x) => x.classList.toggle("sel", x === b));
      $("#eraser").classList.remove("sel");
    } else if (b.dataset.size) {
      pad.size = +b.dataset.size;
      t.querySelectorAll(".size").forEach((x) => x.classList.toggle("sel", x === b));
    } else if (b.id === "eraser") {
      pad.erase = !pad.erase; b.classList.toggle("sel", pad.erase);
    } else if (b.id === "undo") pad.undo();
    else if (b.id === "clearBtn") twoTap(b, "정말 지울까요?", () => pad.clear());
    else if (b.id === "submitBtn") twoTap(b, "정말 낼까요?", () => submit(false));
  });
}

function resetTools() {
  pad.color = COLORS[0]; pad.size = SIZES[1]; pad.erase = false;
  document.querySelectorAll("#tools .sw").forEach((x, i) => x.classList.toggle("sel", i === 0));
  document.querySelectorAll("#tools .size").forEach((x, i) => x.classList.toggle("sel", i === 1));
  $("#eraser").classList.remove("sel");
}

async function join() {
  const c = $("#code").value.replace(/\D/g, "");
  const n = $("#name").value.trim().slice(0, 12);
  if (c.length !== 4) return msg("방 번호 4자리를 입력해 주세요.");
  if (!n) return msg("이름을 입력해 주세요.");
  goFullscreen();
  $("#joinBtn").disabled = true;
  msg("");
  try {
    const s = (await get(roomRef(c, "state"))).val();
    if (!s) return msg("그런 방이 없어요. 방 번호를 다시 확인해 주세요.");
    if (s.phase === "lobby") {
      await set(roomRef(c, `players/${uid}`), { name: n, joinedAt: serverTimestamp() });
    } else if (!(s.order || []).includes(uid)) {
      return msg("이미 게임이 시작됐어요. 다음 판에 함께해요.");
    }
    store.set("studentName", n);
    store.set("relayRoom", c);
    code = c; name = n;
    enter();
  } catch (e) {
    console.error(e);
    msg("들어가지 못했어요. 잠시 뒤 다시 눌러 주세요.");
  } finally {
    $("#joinBtn").disabled = false;
  }
}

function enter() {
  offs.forEach((f) => f()); offs = [];
  $("#meName").textContent = name;
  offs.push(onValue(roomRef(code, "players"), (s) => {
    const p = s.val() || {};
    $("#lobbyCount").textContent = Object.keys(p).length;
    if (st?.phase === "lobby" && !p[uid]) leave("선생님이 방에서 내보냈어요. 다시 들어올 수 있어요.");
  }));
  offs.push(onValue(roomRef(code, "state"), (s) => onState(s.val())));
}

function leave(text) {
  offs.forEach((f) => f()); offs = [];
  stopRound(); stopAnim(); clearCache();
  st = null;
  store.del("relayRoom");
  $("#code").value = "";
  show("join");
  msg(text);
}

function onState(s) {
  st = s;
  if (!s) return leave("게임이 끝났어요. 함께해 줘서 고마워요!");
  if (s.phase === "lobby") { stopRound(); stopAnim(); clearCache(); show("lobby"); }
  else if (s.phase === "play") { stopAnim(); if (s.round !== myRound) startRound(); }
  else if (s.phase === "reveal") { stopRound(); showReveal(); }
}

function stopRound() {
  clearInterval(roundT); roundT = null;
  doneOff?.(); doneOff = null;
  myRound = -1; peeking = false;
  $("#prevView").hidden = true;
}
function stopAnim() { animStop?.(); animStop = null; }

async function startRound() {
  stopRound();
  const s = st, idx = (s.order || []).indexOf(uid);
  if (idx < 0) return show("watch");
  const r = s.round, n = s.order.length, cfg = s.cfg, story = cfg.mode === "story";
  myRound = r; myChain = chainOf(idx, r, n); submitted = false;
  pad.clear(); pad.locked = false; pad.setOnion(null); resetTools();
  $("#waitMsg").textContent = "준비하고 있어요…";
  show("wait");

  doneOff = onValue(roomRef(code, `done/${r}`), (snap) => {
    const d = snap.val() || {};
    $("#waitCount").textContent = `${Object.keys(d).length} / ${n}명이 냈어요`;
    if (d[uid] && !submitted) { // 새로고침 뒤 다시 들어왔는데 이미 낸 라운드
      submitted = true; pad.locked = true;
      $("#waitMsg").textContent = "그림을 냈어요!";
      show("wait");
    }
  });

  let prompt = "", prev = "";
  try {
    const [p, l] = await Promise.all([get(roomRef(code, `chains/${myChain}/prompt`)), get(roomRef(code, `latest/${myChain}`))]);
    prompt = p.val() || "";
    const lr = l.val(); // 이 사슬에서 가장 최근에 그려진 라운드 (앞 친구가 못 냈으면 그 전 그림)
    if (r > 0 && lr !== null) prev = safeImg((await get(roomRef(code, `steps/${myChain}/${lr}/img`))).val());
  } catch (e) { console.warn(e); }
  if (r !== myRound || submitted) return; // 기다리는 사이 라운드가 넘어갔거나 이미 낸 경우

  $("#roundChip").textContent = `${r + 1} / ${cfg.rounds}`;
  if (story) $("#topic").textContent = r === 0 ? `첫 장면: ${prompt}` : `이야기: ${prompt}`;
  else $("#topic").textContent = prev ? "본 그림이 무엇인지 맞혀서 그려요" : `제시어: ${prompt}`;
  $("#prevBtn").hidden = !(story && prev);
  $("#prevImg").src = prev || "";
  pad.setOnion(story && cfg.onion ? prev : null);

  if (!story && prev && now() < s.peekEnd) { peeking = true; $("#peekImg").src = prev; show("peek"); }
  else { show("draw"); pad.fit(); }
  roundT = setInterval(tick, 200);
  tick();
}

function tick() {
  const s = st;
  if (!s || s.phase !== "play" || s.round !== myRound) return;
  const t = now();
  if (peeking && t >= s.peekEnd) {
    peeking = false;
    $("#peekImg").removeAttribute("src"); // 다 본 그림은 다시 볼 수 없게 지움
    if (!submitted) { show("draw"); pad.fit(); }
  }
  const left = Math.max(0, Math.ceil(((peeking ? s.peekEnd : s.deadline) - t) / 1000));
  document.querySelectorAll(".timer").forEach((el) => {
    el.textContent = left;
    el.classList.toggle("hurry", !peeking && !submitted && left <= 10);
  });
  if (!submitted && t >= s.deadline - 400) submit(true); // 마감 직전 자동 제출
}

async function submit(auto) {
  if (submitted || myRound < 0) return;
  submitted = true; pad.locked = true; peeking = false;
  const r = myRound, c = myChain, img = pad.export(), empty = pad.isEmpty();
  $("#waitMsg").textContent = auto ? "시간이 다 되어서 그림을 냈어요!" : "그림을 냈어요!";
  show("wait");
  try { await set(roomRef(code, `steps/${c}/${r}`), { uid, name, img, empty }); }
  catch (e) { console.warn("그림 저장 거절(이미 냈거나 라운드가 바뀜)", e); }
  try { await set(roomRef(code, `done/${r}/${uid}`), true); }
  catch (e) { console.warn(e); }
}

async function showReveal() {
  const s = st;
  if (!s.cfg?.sync) { stopAnim(); return show("tv"); } // 데이터 절약: 학생 기기는 그림을 받지 않음
  show("reveal");
  const rv = s.reveal || { c: 0, s: 0, view: "feed" };
  let data;
  try { data = await loadChain(code, rv.c); } catch (e) { console.warn(e); return; }
  if (st !== s) return; // 그 사이 더 새로운 상태가 도착
  stopAnim();
  const feed = $("#sFeed");
  if (rv.view === "anim") animStop = playAnim(feed, data, rv.c, s.hidden || {});
  else {
    const story = s.cfg.mode === "story";
    renderFeed(feed, data, rv.c, rv.s, { toon: story, story, hidden: s.hidden || {} });
    feed.scrollTop = feed.scrollHeight;
  }
}

async function boot() {
  pad = new DrawPad($("#pad"));
  buildTools();
  addEventListener("resize", () => pad.fit());
  $("#name").value = store.get("studentName", "");
  $("#code").value = store.get("relayRoom", "");
  $("#code").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
  $("#joinBtn").addEventListener("click", join);
  for (const sel of ["#code", "#name"]) $(sel).addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  $("#prevBtn").addEventListener("click", () => { $("#prevView").hidden = false; });
  $("#prevView").addEventListener("click", () => { $("#prevView").hidden = true; });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("gesturestart", (e) => e.preventDefault()); // iPad 핀치 확대 방지

  $("#joinBtn").disabled = true;
  try {
    uid = (await ensureAuth()).uid;
    $("#joinBtn").disabled = false;
  } catch (e) {
    console.error(e);
    msg("연결하지 못했어요. 인터넷을 확인하고 새로고침해 주세요.");
  }
}

boot();
