// 그리기 판: 투명 캔버스(학생 그림) + 그 뒤의 흐린 앞 장면(어니언 스킨)
export const W = 640, H = 480; // 고정 해상도: 저사양 기기 부담과 전송 용량을 함께 줄임
export const COLORS = ["#1E1E1E", "#8A8F98", "#E53935", "#FB8C00", "#FDD835", "#43A047",
  "#29B6F6", "#1E40AF", "#8E24AA", "#F48FB1", "#8D6E63", "#F5C9A6"];
export const SIZES = [4, 10, 22];

export class DrawPad {
  constructor(wrap) {
    this.wrap = wrap;
    this.onion = new Image();
    this.onion.className = "onion";
    this.onion.alt = "";
    this.onion.hidden = true;
    this.cv = document.createElement("canvas");
    this.cv.width = W; this.cv.height = H;
    wrap.append(this.onion, this.cv);
    this.ctx = this.cv.getContext("2d");
    this.strokes = []; this.cur = null; this.active = null;
    this.penSeen = false; this.locked = false;
    this.color = COLORS[0]; this.size = SIZES[1]; this.erase = false;
    this.cv.addEventListener("pointerdown", (e) => this.down(e));
    this.cv.addEventListener("pointermove", (e) => this.move(e));
    for (const t of ["pointerup", "pointercancel"]) this.cv.addEventListener(t, (e) => this.up(e));
  }

  pos(e) {
    const r = this.cv.getBoundingClientRect();
    return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
  }

  down(e) {
    if (this.locked) return;
    if (e.pointerType === "pen") this.penSeen = true;
    if (this.penSeen && e.pointerType === "touch") return; // 펜을 쓰기 시작하면 손바닥 터치 무시
    if (this.active !== null) return; // 두 번째 손가락 무시
    e.preventDefault();
    this.active = e.pointerId;
    try { this.cv.setPointerCapture(e.pointerId); } catch {}
    const s = { c: this.color, w: this.size, e: this.erase, p: [this.pos(e)] };
    this.strokes.push(s); this.cur = s;
    this.style(s); this.dot(s.p[0], s);
  }

  move(e) {
    if (e.pointerId !== this.active || !this.cur) return;
    e.preventDefault();
    const list = e.getCoalescedEvents?.();
    for (const ev of (list && list.length ? list : [e])) {
      const p = this.pos(ev), last = this.cur.p[this.cur.p.length - 1];
      this.cur.p.push(p);
      this.style(this.cur);
      const c = this.ctx;
      c.beginPath(); c.moveTo(last[0], last[1]); c.lineTo(p[0], p[1]); c.stroke();
    }
  }

  up(e) {
    if (e.pointerId !== this.active) return;
    this.active = null; this.cur = null;
  }

  style(s) {
    const c = this.ctx;
    c.globalCompositeOperation = s.e ? "destination-out" : "source-over"; // 지우개는 투명하게 뚫음
    c.strokeStyle = c.fillStyle = s.c;
    c.lineWidth = s.e ? s.w * 2 : s.w;
    c.lineCap = c.lineJoin = "round";
  }

  dot(p, s) {
    const c = this.ctx;
    c.beginPath(); c.arc(p[0], p[1], (s.e ? s.w * 2 : s.w) / 2, 0, Math.PI * 2); c.fill();
  }

  // 되돌리기는 이미지 스냅샷 대신 획 기록을 다시 그림 (메모리 절약)
  redraw() {
    const c = this.ctx;
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, W, H);
    for (const s of this.strokes) {
      this.style(s);
      if (s.p.length === 1) { this.dot(s.p[0], s); continue; }
      c.beginPath(); c.moveTo(s.p[0][0], s.p[0][1]);
      for (let i = 1; i < s.p.length; i++) c.lineTo(s.p[i][0], s.p[i][1]);
      c.stroke();
    }
  }

  undo() { this.strokes.pop(); this.redraw(); }
  clear() { this.strokes = []; this.cur = null; this.active = null; this.redraw(); }
  isEmpty() { return this.strokes.length === 0; }

  setOnion(src) {
    if (src) { this.onion.src = src; this.onion.hidden = false; }
    else { this.onion.removeAttribute("src"); this.onion.hidden = true; }
  }

  // 제출용: 흰 바탕에 합친 뒤 WebP로 압축 (WebP를 못 만드는 기기는 JPEG)
  export() {
    const o = document.createElement("canvas");
    o.width = W; o.height = H;
    const c = o.getContext("2d");
    c.fillStyle = "#fff"; c.fillRect(0, 0, W, H);
    c.drawImage(this.cv, 0, 0);
    let url = o.toDataURL("image/webp", 0.6);
    if (!url.startsWith("data:image/webp")) url = o.toDataURL("image/jpeg", 0.7);
    return url;
  }

  // 화면 크기에 맞춰 4:3 비율 유지
  fit() {
    const z = this.wrap.parentElement;
    const w = z.clientWidth, h = z.clientHeight;
    if (!w || !h) return;
    const k = Math.min(w / W, h / H);
    this.wrap.style.width = Math.floor(W * k) + "px";
    this.wrap.style.height = Math.floor(H * k) + "px";
  }
}
