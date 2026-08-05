/* ⚡ iGadget Wheel — клиент */
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready(); tg.expand();
  try { tg.setHeaderColor('#060D09'); tg.setBackgroundColor('#060D09'); } catch (e) {}
}

const rotor   = document.getElementById('rotor');
const canvas  = document.getElementById('wheel');
const ctx     = canvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');
const modal   = document.getElementById('winModal');

let prizes = [], images = {};
let rotation = 0, spinning = false, bulbPhase = 0;

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

/* ---------- размеры canvas ---------- */
let SIZE = 0;
const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
function resize() {
  SIZE = Math.min(window.innerWidth - 44, 360);
  canvas.style.width = SIZE + 'px';
  canvas.style.height = SIZE + 'px';
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawWheel();
}
window.addEventListener('resize', resize);

/* ---------- отрисовка колеса ---------- */
function drawWheel() {
  if (!SIZE) return;
  const S = SIZE, cx = S / 2, cy = S / 2, R = S / 2 - 4;
  ctx.clearRect(0, 0, S, S);
  const n = prizes.length;

  const base = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, R);
  base.addColorStop(0, '#0E2415'); base.addColorStop(1, '#071409');
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = base; ctx.fill();

  if (!n) {
    ctx.fillStyle = '#7FA98C';
    ctx.font = '600 15px -apple-system, Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Призы скоро появятся…', cx, cy);
    return;
  }

  const seg = Math.PI * 2 / n;
  const innerGap = S * .085;

  // сегменты
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * seg;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R - 3, a0, a0 + seg); ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, innerGap, cx, cy, R);
    if (i % 2 === 0) { g.addColorStop(0, '#123222'); g.addColorStop(1, '#0B1F12'); }
    else             { g.addColorStop(0, '#0E2818'); g.addColorStop(1, '#07170D'); }
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(61,255,146,.18)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // картинки/эмодзи призов
  const rPos = R * .62;
  const imgR = Math.max(14, Math.min(R * .17, rPos * Math.sin(seg / 2) * .85));
  for (let i = 0; i < n; i++) {
    const p = prizes[i];
    const mid = -Math.PI / 2 + i * seg + seg / 2;
    const x = cx + Math.cos(mid) * rPos, y = cy + Math.sin(mid) * rPos;
    const img = images[p.id];
    if (img && img.complete && img.naturalWidth) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, imgR + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#0A1A10'; ctx.fill(); ctx.clip();
      const k = Math.max((imgR * 2) / img.width, (imgR * 2) / img.height);
      ctx.drawImage(img, x - img.width * k / 2, y - img.height * k / 2, img.width * k, img.height * k);
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, imgR + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(61,255,146,.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, imgR + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(61,255,146,.25)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, imgR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,26,16,.9)'; ctx.fill();
      ctx.strokeStyle = 'rgba(61,255,146,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = `${imgR * 1.15}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji || '🎁', x, y + 1);
    }
  }

  // внешний обод
  ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
  ctx.strokeStyle = '#1E4D30'; ctx.lineWidth = 6; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(61,255,146,.5)'; ctx.lineWidth = 1.5; ctx.stroke();

  // мигающие лампочки
  const bulbs = Math.max(12, Math.min(24, n * 3));
  for (let b = 0; b < bulbs; b++) {
    const a = (Math.PI * 2 / bulbs) * b - Math.PI / 2;
    const bx = cx + Math.cos(a) * (R - 1), by = cy + Math.sin(a) * (R - 1);
    const on = (b + bulbPhase) % 2 === 0;
    ctx.beginPath(); ctx.arc(bx, by, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#B8FFD5' : '#1F5A36';
    if (on) { ctx.shadowColor = '#3DFF92'; ctx.shadowBlur = 8; }
    ctx.fill(); ctx.shadowBlur = 0;
  }

  // центр под кнопкой
  ctx.beginPath(); ctx.arc(cx, cy, innerGap, 0, Math.PI * 2);
  ctx.fillStyle = '#081309'; ctx.fill();
  ctx.strokeStyle = 'rgba(61,255,146,.35)'; ctx.lineWidth = 1; ctx.stroke();
}
setInterval(() => { bulbPhase = 1 - bulbPhase; drawWheel(); }, 850);

/* ---------- данные ---------- */
async function load() {
  try { prizes = await (await fetch('/api/prizes')).json(); } catch { prizes = []; }
  images = {};
  let pending = 0;
  prizes.forEach(p => {
    if (!p.image) return;
    pending++;
    const img = new Image();
    img.onload = () => { if (--pending === 0) drawWheel(); };
    img.src = p.image;
    images[p.id] = img;
  });
  drawWheel();
  renderPrizeList();
  loadMe();
}

function renderPrizeList() {
  const el = document.getElementById('prizeList');
  el.innerHTML = '';
  prizes.forEach(p => {
    const card = document.createElement('div');
    card.className = 'prize-card';
    card.innerHTML = `
      <div class="prize-card__thumb">
        ${p.image ? `<img src="${p.image}" alt="">` : `<span>${esc(p.emoji || '🎁')}</span>`}
      </div>
      <div class="prize-card__name">${esc(p.name)}</div>
      ${p.stock ? `<div class="prize-card__stock">осталось: ${p.stock}</div>` : ''}`;
    el.appendChild(card);
  });
}

function setSpins(left) {
  document.getElementById('spinsLeft').textContent = left ?? '—';
  if (left === 0) {
    spinBtn.disabled = true;
    spinBtn.querySelector('.spin-btn__label').textContent = 'ГОТОВО ✓';
  }
}

async function loadMe() {
  try {
    const res = await fetch('/api/me', { headers: { 'X-Init-Data': tg?.initData || '' } });
    const d = await res.json();
    if (d.left !== undefined) setSpins(d.left);
  } catch {}
}

/* ---------- звук тиков ---------- */
let audioCtx = null;
function tick() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = 1000;
    g.gain.setValueAtTime(.05, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .03);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + .04);
  } catch {}
}

/* ---------- спин ---------- */
spinBtn.addEventListener('click', async () => {
  if (spinning || spinBtn.disabled) return;
  if (!prizes.length) { alert('Призы скоро появятся 👀'); return; }
  tg?.HapticFeedback?.impactOccurred('medium');

  let data;
  try {
    const res = await fetch('/api/spin', {
      method: 'POST',
      headers: { 'X-Init-Data': tg?.initData || '' },
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.left === 0) setSpins(0);
      throw new Error(data.error || 'Ошибка сервера');
    }
  } catch (e) {
    tg?.HapticFeedback?.notificationOccurred('error');
    alert(e.message);
    return;
  }

  setSpins(data.left);
  startSpin(data.index, () => showWin(prizes[data.index]));
});

function startSpin(index, done) {
  spinning = true;
  const n = prizes.length, segDeg = 360 / n;
  const center = index * segDeg + segDeg / 2;
  const jitter = (Math.random() * .7 - .35) * segDeg;
  const turns = 6;
  const base = rotation + turns * 360;
  const target = base + ((360 - center - (base % 360) + 360) % 360) + jitter;

  const from = rotation, dur = 6200, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 4); // easeOutQuart
  let lastSeg = -1;

  function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    rotation = from + (target - from) * ease(t);
    rotor.style.transform = `rotate(${rotation}deg)`;
    const segNow = Math.floor((((360 - (rotation % 360)) % 360) / segDeg)) % n;
    if (segNow !== lastSeg) { lastSeg = segNow; tick(); }
    if (t < 1) requestAnimationFrame(frame);
    else {
      rotation = target % 360;
      rotor.style.transform = `rotate(${rotation}deg)`;
      spinning = false;
      done();
    }
  }
  requestAnimationFrame(frame);
}

/* ---------- модалка выигрыша ---------- */
function showWin(prize) {
  if (!prize) return;
  tg?.HapticFeedback?.notificationOccurred('success');
  document.getElementById('winName').textContent = prize.name;
  const img = document.getElementById('winImg');
  const emo = document.getElementById('winEmoji');
  if (prize.image) { img.src = prize.image; img.classList.remove('hidden'); emo.classList.add('hidden'); }
  else { img.classList.add('hidden'); emo.classList.remove('hidden'); emo.textContent = prize.emoji || '🎉'; }
  modal.classList.add('modal--open');
}
document.getElementById('winClose').onclick = () => modal.classList.remove('modal--open');
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('modal--open'); });

resize();
load();
