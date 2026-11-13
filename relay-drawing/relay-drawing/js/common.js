// 공통: Firebase 연결 + 작은 도우미 함수들 (학생/선생님 화면이 함께 사용)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, get, set, update, remove, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAeYNZgBOV6iOvOBPhjZkOegZ9f6dYUKso",
  authDomain: "relay-drawing-69995.firebaseapp.com",
  databaseURL: "https://relay-drawing-69995-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "relay-drawing-69995",
  storageBucket: "relay-drawing-69995.firebasestorage.app",
  messagingSenderId: "218795830138",
  appId: "1:218795830138:web:749c8d855f8e9c3e4844c3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
export { get, set, update, remove, onValue, serverTimestamp };

export function ensureAuth() {
  return new Promise((resolve, reject) => {
    // 기기에 남은 익명 계정을 먼저 복원 → 새로고침해도 같은 학생으로 인식됨
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) { stop(); resolve(user); }
      else signInAnonymously(auth).catch((e) => { stop(); reject(e); });
    });
  });
}

// 기기마다 시계가 달라서 Firebase 서버 시각 기준으로 타이머를 맞춤
let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
export const now = () => Date.now() + offset;

export const roomRef = (code, path = "") => ref(db, path ? `rooms/${code}/${path}` : `rooms/${code}`);

// 시크릿 모드/구형 기기에서 localStorage가 예외를 던질 수 있어 항상 감쌈
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

export const $ = (s, r = document) => r.querySelector(s);
export function show(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("on", el.id === id));
}
export function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// 그림은 항상 data URL만 허용 (외부 주소가 섞여 들어오는 것 방지)
export const safeImg = (v) => (typeof v === "string" && v.startsWith("data:image/") ? v : "");

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 학생 i는 라운드 r에 사슬 (i + r) mod N을 받음 → 라운드 수 ≤ 인원이면 같은 사슬을 두 번 만나지 않음
export const chainOf = (idx, r, n) => (idx + r) % n;
export const playerAt = (c, r, n) => (((c - r) % n) + n) % n;
