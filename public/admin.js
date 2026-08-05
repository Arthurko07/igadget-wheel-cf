/* ⚙️ iGadget Admin */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let prizes = [], editingId = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function headers() {
  const h = {};
  if (tg?.initData) h['X-Init-Data'] = tg.initData;
  const pwd = localStorage.getItem('ig_admin_pwd');
  if (pwd) h['X-Admin-Password'] = pwd;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (res.status === 403) { openPwd(); throw new Error('no-access'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

/* ---------- список призов ---------- */
async function loadPrizes() {
  prizes = await api('/api/admin/prizes');
  renderCards();
}

function renderCards() {
  const box = document.getElementById('prizeCards');
  box.innerHTML = '';
  if (!prizes.length) box.innerHTML = '<div class="muted empty">Пока нет призов — добавьте первый 👆</div>';
  prizes.forEach(p => {
    const el = document.createElement('div');
    el.className = 'card' + (p.active ? '' : ' card--off');
    el.innerHTML = `
      <div class="card__thumb">${p.image ? `<img src="${p.image}">` : `<span>${esc(p.emoji || '🎁')}</span>`}</div>
      <div class="card__info">
        <div class="card__name">${esc(p.name)}</div>
        <div class="card__meta">⚖️ вес: ${p.weight} • 📦 ${p.stock ? 'осталось ' + p.stock : '∞'}</div>
      </div>
      <label class="switch"><input type="checkbox" data-id="${p.id}" ${p.active ? 'checked' : ''}/><span></span></label>
      <div class="card__btns">
        <button class="icon-btn" data-act="edit" data-id="${p.id}">✏️</button>
        <button class="icon-btn" data-act="del" data-id="${p.id}">🗑️</button>
      </div>`;
    box.appendChild(el);
  });
}

document.getElementById('prizeCards').addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'del') {
    // двойной тап вместо confirm (в Telegram WebView confirm не работает)
    if (btn.dataset.armed) {
      try { await api('/api/admin/prizes/' + id, { method: 'DELETE' }); loadPrizes(); }
      catch (err) { if (err.message !== 'no-access') alert(err.message); }
    } else {
      btn.dataset.armed = '1'; btn.textContent = '❗';
      setTimeout(() => { btn.textContent = '🗑️'; delete btn.dataset.armed; }, 2000);
    }
  } else {
    openForm(prizes.find(p => p.id === id));
  }
});

document.getElementById('prizeCards').addEventListener('change', async e => {
  if (!e.target.matches('.switch input')) return;
  const fd = new FormData();
  fd.append('active', e.target.checked);
  try {
    await api('/api/admin/prizes/' + e.target.dataset.id, { method: 'PUT', body: fd });
    loadPrizes();
  } catch (err) { if (err.message !== 'no-access') alert(err.message); }
});

/* ---------- форма ---------- */
const formModal = document.getElementById('formModal');
const form = document.getElementById('prizeForm');
const fileInput = document.getElementById('fileInput');
const drop = document.getElementById('drop');
const preview = document.getElementById('preview');
const dropHint = document.getElementById('dropHint');

document.getElementById('addBtn').onclick = () => openForm(null);
document.getElementById('cancelBtn').onclick = closeForm;
formModal.addEventListener('click', e => { if (e.target === formModal) closeForm(); });

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop--over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drop--over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('drop--over');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => fileInput.files[0] && setFile(fileInput.files[0]));

function setFile(f) {
  const dt = new DataTransfer(); dt.items.add(f);
  fileInput.files = dt.files;
  preview.src = URL.createObjectURL(f);
  preview.classList.remove('hidden');
  dropHint.classList.add('hidden');
}

function openForm(p) {
  editingId = p?.id || null;
  document.getElementById('formTitle').textContent = p ? 'Редактировать приз' : 'Новый приз';
  form.reset();
  form.weight.value = p ? p.weight : 10;
  form.stock.value  = p ? p.stock : 0;
  form.active.checked = p ? !!p.active : true;
  if (p) { form.name.value = p.name; form.emoji.value = p.emoji || ''; }
  if (p?.image) { preview.src = p.image; preview.classList.remove('hidden'); dropHint.classList.add('hidden'); }
  else { preview.classList.add('hidden'); dropHint.classList.remove('hidden'); }
  fileInput.value = '';
  formModal.classList.add('modal--open');
}
function closeForm() { formModal.classList.remove('modal--open'); }

form.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(form);
  fd.set('active', form.active.checked ? 'true' : 'false');
  try {
    if (editingId) await api('/api/admin/prizes/' + editingId, { method: 'PUT', body: fd });
    else           await api('/api/admin/prizes', { method: 'POST', body: fd });
    closeForm();
    loadPrizes();
  } catch (err) { if (err.message !== 'no-access') alert(err.message); }
});

/* ---------- статистика ---------- */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('tab--active'));
  t.classList.add('tab--active');
  document.getElementById('tab-prizes').classList.toggle('hidden', t.dataset.tab !== 'prizes');
  document.getElementById('tab-stats').classList.toggle('hidden', t.dataset.tab !== 'stats');
  if (t.dataset.tab === 'stats') loadStats();
}));

async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('statGrid').innerHTML =
      `<div class="stat"><b>${s.totalSpins}</b><span>всего вращений</span></div>` +
      Object.entries(s.byPrize).map(([name, cnt]) =>
        `<div class="stat"><b>${cnt}</b><span>${esc(name)}</span></div>`).join('');
    document.getElementById('recentList').innerHTML = s.recent.length
      ? s.recent.map(w =>
          `<div class="recent"><span>@${esc(w.username)}</span><b>${esc(w.prizeName)}</b>
           <time>${new Date(w.at).toLocaleString('ru-RU')}</time></div>`).join('')
      : '<div class="muted empty">Пока пусто</div>';
  } catch {}
}

/* ---------- пароль (для входа из браузера) ---------- */
function openPwd() { document.getElementById('pwdModal').classList.add('modal--open'); }
document.getElementById('pwdOk').onclick = async () => {
  localStorage.setItem('ig_admin_pwd', document.getElementById('pwdInput').value);
  document.getElementById('pwdModal').classList.remove('modal--open');
  try { await loadPrizes(); } catch {}
};
document.getElementById('pwdInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pwdOk').click();
});

loadPrizes().catch(() => {});
