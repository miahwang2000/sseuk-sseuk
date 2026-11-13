// 선생님 진행 화면: 방 관리 + 라운드 진행(이 화면이 '서버' 역할) + 공개
import { ensureAuth, roomRef, get, set, update, remove, onValue, serverTimestamp, now, store, show, $, esc, shuffle, playerAt } from "./common.js";
import { loadChain, clearCache, renderFeed, playAnim } from "./reveal.js";

const GRACE = 3000; // 마감 뒤 학생들의 자동 제출이 도착할 여유 시간
const DEF = { mode: "guess", rounds: 6, draw: 80, peek: 5, onion: true, sync: false };
const SAMPLE = "사과\n고양이\n우주선\n눈사람\n피자\n공룡\n무지개\n로봇\n문어\n자전거";
const HINT = {
  guess: "앞 친구 그림을 잠깐 보고, 무엇인지 맞혀서 새로 그려요.",
  story: "앞 친구가 그린 장면을 보고, 다음 장면을 이어서 그려요."
};

let uid, code = null, st = null, players = {};
let done = {}, doneRound = -1, doneOff = null;
let offs = [], tickT = null, animStop = null, advancing = false;

const msg = (t) => { $("#lobbyMsg").textContent = t; };
const fill = (sel, vals, unit) => { $(sel).innerHTML = vals.map((v) => `<option value="${v}">${v}${unit}</option>`).join(""); };
const prompts = () => store.get("relayPrompts", SAMPLE).split("\n").map((s) => s.trim()).filter(Boolean);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- 설정 ---------- */
function readForm() {
  return {
    mode: document.querySelector("input[name=mode]:checked").value,
    rounds: +$("#rounds").value, draw: +$("#draw").value, peek: +$("#peek").value,
    onion: $("#onion").checked, sync: $("#sync").checked
  };
}
function writeForm(f) {
  document.querySelector(`input[name=mode][value=${f.mode === "story" ? "story" : "guess"}]`).checked = true;
  $("#rounds").value = f.rounds; $("#draw").value = f.draw; $("#peek").value = f.peek;
  $("#onion").checked = f.onion; $("#sync").checked = f.sync;
  modeUI();
}
function loadForm() {
  let f = DEF;
  try { f = { ...DEF, ...JSON.parse(store.get("relayHostCfg", "{}")) }; } catch {}
  writeForm(f);
}
function saveForm() { store.set("relayHostCfg", JSON.stringify(readForm())); modeUI(); }
function modeUI() {
  const story = readForm().mode === "story";
  $("#peekField").hidden = story;
  $("#onionField").hidden = !story;
  $("#modeHint").textContent = HINT[story ? "story" : "guess"];
  $("#promptCount").textContent = prompts().length;
  $("#promptLabel").textContent = story ? "이야기 주제" : "제시어";
}

/* ---------- 방 만들기 / 연결 ---------- */
async function createRoom() {
  $("#newRoom").disabled = true;
  try {
    const old = store.get("relayHostRoom");
    if (old) { try { await remove(roomRef(old)); } catch {} } // 지난번에 닫지 않은 방 정리
    let c = null;
    for (let i = 0; i < 20 && !c; i++) {
      const t = String(1000 + Math.floor(Math.random() * 9000));
      if (!(await get(roomRef(t, "hostUid"))).exists()) c = t;
    }
    if (!c) throw new Error("빈 방 번호를 찾지 못함");
    await set(roomRef(c), { hostUid: uid, createdAt: serverTimestamp(), state: { phase: "lobby" } });
    store.set("relayHostRoom", c);
    code = c;
    attach();
  } catch (e) {
    console.error(e);
    $("#homeMsg").textContent = "방을 만들지 못했어요. 인터넷 연결과 Firebase 규칙 게시 여부를 확인해 주세요.";
  } finally {
    $("#newRoom").disabled = false;
  }
}

function attach() {
  $("#bigCode").textContent = code;
  $("#addr").textContent = new URL("./", location.href).href;
  offs.push(onValue(roomRef(code, "players"), (s) => { players = s.val() || {}; renderRoster(); }));
  offs.push(onValue(roomRef(code, "state"), (s) => { st = s.val(); if (st) onState(); }));
  tickT = setInterval(tick, 250);
}

function detach() {
  offs.forEach((f) => f()); offs = [];
  watchDone(-1); stopAnim();
  clearInterval(tickT); tickT = null;
  st = null; code = null; players = {};
  clearCache();
  store.del("relayHostRoom");
}

function onState() {
  if (st.phase === "lobby") { watchDone(-1); stopAnim(); show("lobby"); }
  else if (st.phase === "play") {
    watchDone(st.round);
    $("#hRound").textContent = `라운드 ${st.round + 1} / ${st.cfg.rounds}`;
    show("play");
    renderRoster();
  } else if (st.phase === "reveal") { watchDone(-1); show("reveal"); renderReveal(); }
}

// 현재 라운드의 제출 현황만 구독 (그림 자체는 받지 않음 → 데이터 절약)
function watchDone(r) {
  if (r === doneRound) return;
  doneOff?.(); doneOff = null; done = {}; doneRound = r;
  if (r >= 0) doneOff = onValue(roomRef(code, `done/${r}`), (s) => { done = s.val() || {}; renderRoster(); });
}

function renderRoster() {
  const ids = Object.keys(players);
  $("#pCount").textContent = ids.length;
  $("#lobbyRoster").innerHTML = ids.length
    ? ids.map((id) => `<span class="pchip">${esc(players[id].name)}<button data-kick="${id}" aria-label="${esc(players[id].name)} 내보내기">✕</button></span>`).join("")
    : `<p class="hint">학생들이 방 번호를 입력하면 여기에 이름이 나와요.</p>`;
  if (st?.phase === "play") {
    const o = st.order, n = o.filter((id) => done[id]).length;
    $("#hProg").textContent = `${n} / ${o.length}명 냈어요`;
    $("#playRoster").innerHTML = o.map((id) =>
      `<span class="pchip${done[id] ? " done" : ""}">${done[id] ? "✓ " : ""}${esc(players[id]?.name || "?")}</span>`).join("");
  }
}

/* ---------- 게임 진행 ---------- */
function roundState(r, cfg) {
  const peek = cfg.mode === "guess" && r > 0 ? cfg.peek * 1000 : 0;
  const t = now() + 1500; // 학생 기기가 앞 그림을 받아올 준비 시간
  return { round: r, peekEnd: t + peek, deadline: t + peek + cfg.draw * 1000 };
}

async function startGame() {
  saveForm();
  const ids = Object.keys(players), N = ids.length, f = readForm(), words = prompts();
  if (N < 2) return msg("2명 이상 들어와야 시작할 수 있어요.");
  if (!words.length) return msg("제시어를 먼저 입력해 주세요.");
  const R = Math.min(f.rounds, N); // 라운드가 인원보다 많으면 같은 사슬을 두 번 그리게 됨
  const order = shuffle(ids), pool = shuffle(words);
  const chains = {}, slots = {};
  for (let c = 0; c < N; c++) {
    chains[c] = { prompt: pool[c % pool.length] };
    slots[c] = {};
    for (let r = 0; r < R; r++) slots[c][r] = order[playerAt(c, r, N)]; // 보안 규칙이 '자기 칸'인지 확인할 때 씀
  }
  const cfg = { ...f, rounds: R };
  clearCache();
  msg("");
  $("#startBtn").disabled = true;
  try {
    await update(roomRef(code), {
      chains, slots, steps: null, done: null, latest: null,
      state: { phase: "play", order, cfg, ...roundState(0, cfg) }
    });
  } catch (e) {
    console.error(e);
    msg("시작하지 못했어요. 다시 눌러 주세요.");
  } finally {
    $("#startBtn").disabled = false;
  }
}

function tick() {
  if (!st || st.phase !== "play") return;
  const left = Math.max(0, Math.ceil((st.deadline - now()) / 1000));
  const t = $("#hTimer");
  t.textContent = left;
  t.classList.toggle("hurry", left > 0 && left <= 10);
  const n = st.order.filter((id) => done[id]).length;
  if (!advancing && (n >= st.order.length || now() > st.deadline + GRACE)) advance();
}

async function advance() {
  advancing = true;
  try {
    const r = st.round, N = st.order.length, cfg = st.cfg, upd = {};
    // 낸 학생의 사슬만 '가장 최근 그림'을 갱신 → 못 낸 칸은 다음 친구가 그 전 그림을 보게 됨
    for (let c = 0; c < N; c++) if (done[st.order[playerAt(c, r, N)]]) upd[`latest/${c}`] = r;
    if (r + 1 < cfg.rounds) {
      const ns = roundState(r + 1, cfg);
      upd["state/round"] = ns.round; upd["state/peekEnd"] = ns.peekEnd; upd["state/deadline"] = ns.deadline;
    } else {
      upd["state/phase"] = "reveal";
      upd["state/reveal"] = { c: 0, s: 0, view: defView() };
      upd["state/hidden"] = null;
    }
    await update(roomRef(code), upd);
  } catch (e) {
    console.error(e);
  } finally {
    advancing = false;
  }
}

/* ---------- 공개 ---------- */
const defView = () => (st?.cfg?.mode === "story" ? "toon" : "feed");
function stopAnim() { animStop?.(); animStop = null; }

async function renderReveal() {
  const s = st, rv = s.reveal || { c: 0, s: 0, view: defView() }, N = s.order.length, story = s.cfg.mode === "story";
  $("#chainList").innerHTML = Array.from({ length: N }, (_, c) =>
    `<button data-c="${c}" class="${c === rv.c ? "cur" : ""}">${c + 1}. ${esc(players[s.order[c]]?.name || "")}</button>`).join("");
  $("#viewSeg").hidden = !story;
  document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("cur", b.dataset.v === (rv.view === "anim" ? "anim" : "toon")));

  let data;
  try { data = await loadChain(code, rv.c); } catch (e) { console.error(e); return; }
  if (st !== s) return; // 기다리는 사이 상태가 바뀜
  stopAnim();
  const feed = $("#hFeed"), last = rv.c >= N - 1;
  if (rv.view === "anim") {
    animStop = playAnim(feed, data, rv.c, s.hidden || {});
    $("#rNext").textContent = last ? "마지막 사슬이에요" : "다음 사슬";
    $("#rNext").disabled = last;
  } else {
    renderFeed(feed, data, rv.c, rv.s, { toon: story, story, hidden: s.hidden || {}, host: true });
    feed.scrollTo({ top: feed.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    const end = rv.s >= data.steps.length;
    $("#rNext").textContent = !end ? "다음 그림" : last ? "마지막 사슬이에요" : "다음 사슬";
    $("#rNext").disabled = end && last;
  }
  if (!last) loadChain(code, rv.c + 1).catch(() => {}); // 다음 사슬 미리 받아두기
}

const setReveal = (p) => update(roomRef(code, "state/reveal"), p);

async function next() {
  const rv = st.reveal, data = await loadChain(code, rv.c);
  if (rv.view === "anim" || rv.s >= data.steps.length) {
    if (rv.c < st.order.length - 1) setReveal({ c: rv.c + 1, s: 0, view: defView() });
  } else setReveal({ s: rv.s + 1 });
}
async function prev() {
  const rv = st.reveal;
  if (rv.view !== "anim" && rv.s > 0) return setReveal({ s: rv.s - 1 });
  if (rv.c > 0) {
    const d = await loadChain(code, rv.c - 1);
    setReveal({ c: rv.c - 1, s: d.steps.length, view: defView() });
  }
}
async function showAll() {
  const rv = st.reveal, d = await loadChain(code, rv.c);
  setReveal({ s: d.steps.length, view: defView() });
}

async function playAgain() {
  clearCache();
  await update(roomRef(code), { state: { phase: "lobby" }, chains: null, slots: null, steps: null, done: null, latest: null });
}

async function closeRoom() {
  if (!confirm("게임을 끝내고 방을 닫을까요? 이번 판 그림은 모두 지워져요.")) return;
  const c = code;
  detach();
  try { await remove(roomRef(c)); } catch (e) { console.error(e); }
  show("home");
}

/* ---------- 이벤트 ---------- */
function bind() {
  $("#newRoom").addEventListener("click", createRoom);
  $("#startBtn").addEventListener("click", startGame);
  document.querySelectorAll(".panel input, .panel select").forEach((el) => el.addEventListener("change", saveForm));
  $("#lobbyRoster").addEventListener("click", (e) => {
    const id = e.target.closest("[data-kick]")?.dataset.kick;
    if (id) remove(roomRef(code, `players/${id}`));
  });
  $("#plus30").addEventListener("click", () => update(roomRef(code, "state"), { deadline: st.deadline + 30000 }));
  $("#skipBtn").addEventListener("click", () => { if (!advancing) advance(); });
  $("#rNext").addEventListener("click", next);
  $("#rPrev").addEventListener("click", prev);
  $("#rAll").addEventListener("click", showAll);
  $("#againBtn").addEventListener("click", playAgain);
  $("#closeBtn1").addEventListener("click", closeRoom);
  $("#closeBtn2").addEventListener("click", closeRoom);
  $("#chainList").addEventListener("click", (e) => {
    const c = e.target.closest("[data-c]")?.dataset.c;
    if (c !== undefined) setReveal({ c: +c, s: 0, view: defView() });
  });
  $("#viewSeg").addEventListener("click", (e) => {
    const v = e.target.closest("[data-v]")?.dataset.v;
    if (v) setReveal({ view: v });
  });
  $("#hFeed").addEventListener("click", (e) => {
    const k = e.target.closest(".hide-btn")?.dataset.k;
    if (k) update(roomRef(code, "state/hidden"), { [k]: st.hidden?.[k] ? null : true });
  });

  // 제시어 편집 창: TV에 제시어가 노출되지 않도록 평소엔 개수만 보여줌
  $("#editPrompts").addEventListener("click", () => {
    $("#promptText").value = prompts().join("\n");
    $("#promptModal").hidden = false;
    $("#promptText").focus();
  });
  $("#pmCancel").addEventListener("click", () => { $("#promptModal").hidden = true; });
  $("#pmSave").addEventListener("click", () => {
    store.set("relayPrompts", $("#promptText").value);
    $("#promptModal").hidden = true;
    modeUI();
  });

  // 공개 단계 키보드: → / 스페이스 다음, ← 이전
  document.addEventListener("keydown", (e) => {
    if (st?.phase !== "reveal" || !$("#promptModal").hidden || e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); if (!$("#rNext").disabled) next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  });
}

async function boot() {
  fill("#rounds", [2, 3, 4, 5, 6, 7, 8, 9, 10], "번");
  fill("#draw", [40, 60, 80, 100, 120, 150], "초");
  fill("#peek", [3, 5, 8, 10], "초");
  loadForm();
  bind();
  $("#newRoom").disabled = true;
  try {
    uid = (await ensureAuth()).uid;
  } catch (e) {
    console.error(e);
    $("#homeMsg").textContent = "Firebase에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.";
    return;
  }
  $("#newRoom").disabled = false;
  // 새로고침해도 진행 중이던 방으로 돌아옴 (이 화면이 진행을 맡고 있으므로 중요)
  const old = store.get("relayHostRoom");
  if (old) {
    try {
      if ((await get(roomRef(old, "hostUid"))).val() === uid) { code = old; return attach(); }
    } catch {}
    store.del("relayHostRoom");
  }
}

boot();
