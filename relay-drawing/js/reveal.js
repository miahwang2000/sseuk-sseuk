// 공개 화면: 사슬 하나를 제시어 → 그림 순서로 보여줌 (선생님/학생 공용)
import { roomRef, get, safeImg } from "./common.js";

const cache = new Map();

export async function loadChain(code, c) {
  if (cache.has(c)) return cache.get(c);
  const [p, s] = await Promise.all([get(roomRef(code, `chains/${c}/prompt`)), get(roomRef(code, `steps/${c}`))]);
  // 숫자 키는 RTDB가 배열로 돌려주기도 해서 entries로 통일하고 빈칸은 버림
  const steps = Object.entries(s.val() || {})
    .filter(([, v]) => v)
    .map(([r, v]) => ({ r: +r, name: v.name || "", img: safeImg(v.img), empty: !!v.empty }))
    .sort((a, b) => a.r - b.r);
  const data = { prompt: p.val() || "", steps };
  cache.set(c, data);
  return data;
}
export function clearCache() { cache.clear(); }

function figure(s, c, hidden, host, pop) {
  const k = `${c}_${s.r}`, hid = !!hidden[k];
  const f = document.createElement("figure");
  f.className = "step" + (pop ? " pop" : "");
  const cap = document.createElement("figcaption");
  cap.textContent = s.name + (s.empty ? " (빈 그림)" : "");
  f.append(cap);
  if (hid) {
    const d = document.createElement("div");
    d.className = "hidden-img";
    d.textContent = "선생님이 가린 그림이에요";
    f.append(d);
  } else {
    const im = new Image();
    im.decoding = "async";
    im.alt = `${s.name}의 그림`;
    im.src = s.img;
    f.append(im);
  }
  if (host) {
    const b = document.createElement("button");
    b.className = "btn small hide-btn";
    b.dataset.k = k;
    b.textContent = hid ? "다시 보이기" : "가리기";
    f.append(b);
  }
  return f;
}

// shown = 공개된 그림 수 (0이면 제시어만). 같은 사슬에서 한 장씩 늘어날 때는 새 그림만 덧붙여 저사양 기기 부담을 줄임
export function renderFeed(el, data, c, shown, { toon = false, story = false, hidden = {}, host = false } = {}) {
  const sig = Object.keys(hidden).filter((k) => k.startsWith(c + "_")).sort().join(",");
  const list = data.steps.slice(0, Math.max(0, shown));
  const same = el.dataset.c === String(c) && el.dataset.sig === sig && el.dataset.toon === String(toon);
  const prev = same ? +el.dataset.shown : -1;

  if (same && list.length >= prev) {
    list.slice(prev).forEach((s) => el.append(figure(s, c, hidden, host, true)));
  } else {
    el.replaceChildren();
    el.classList.toggle("toon", toon);
    const card = document.createElement("div");
    card.className = "prompt-card";
    const small = document.createElement("small");
    small.textContent = story ? "이야기 주제" : "제시어";
    card.append(small, document.createTextNode(data.prompt));
    el.append(card);
    list.forEach((s) => el.append(figure(s, c, hidden, host, false)));
  }
  Object.assign(el.dataset, { c: String(c), sig, toon: String(toon), shown: String(list.length) });
}

// 애니메이션: 모든 장면을 미리 겹쳐 두고 보이는 것만 바꿈 (매번 이미지 디코딩하지 않도록)
export function playAnim(el, data, c, hidden, fps = 3) {
  el.dataset.c = "";
  el.classList.remove("toon");
  el.replaceChildren();
  const frames = data.steps.filter((s) => !hidden[`${c}_${s.r}`] && s.img);
  if (!frames.length) {
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = "보여줄 그림이 없어요";
    el.append(p);
    return () => {};
  }
  const wrap = document.createElement("div");
  wrap.className = "anim-wrap";
  const box = document.createElement("div");
  box.className = "anim";
  const imgs = frames.map((f) => { const im = new Image(); im.src = f.img; im.alt = ""; box.append(im); return im; });
  const cap = document.createElement("p");
  cap.className = "anim-cap";
  wrap.append(box, cap);
  el.append(wrap);
  let i = 0;
  const step = () => {
    const k = i % frames.length;
    imgs.forEach((im, j) => im.classList.toggle("on", j === k));
    cap.textContent = `${frames[k].name} (${k + 1}/${frames.length})`;
    i++;
  };
  step();
  const t = setInterval(step, 1000 / fps);
  return () => clearInterval(t);
}
