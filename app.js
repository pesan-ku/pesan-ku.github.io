/* =====================================================
 * KONFIGURASI — isi 2 nilai ini
 * ===================================================== */
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwVg-F9GXx9GIeiaHvr5OsdPeRbdV2HOs99_eD_Uxcb-WYDvkTqxA-T-VrKh2vxSWZFCw/exec';
const ONESIGNAL_APP_ID = '5bfaa819-83a3-47e7-9f0f-4f7c9467af1c';
/* ===================================================== */

const POLL_MS = 4000;
const MAX_FILE = 100 * 1024 * 1024;   // batas per file
const MAX_INLINE = 10 * 1024 * 1024;  // batas kirim sekali jalan (cadangan bila unggah per potongan gagal dimulai)
const SMALL_MAX = 3 * 1024 * 1024;    // file sekecil ini dikirim dalam 1 permintaan
const CHUNK = 3 * 1024 * 1024;        // ukuran potongan unggah (kelipatan 256 KB)
const MAX_FILES = 10;                 // jumlah file per pengiriman
const DL_CHUNK = 5 * 1024 * 1024;     // ukuran potongan unduh
const LS_SESSION = 'lsc_session';
const LS_SETTINGS = 'lsc_settings';
const BASE_PATH = location.pathname.replace(/[^/]*$/, '');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^(https?:|blob:)/i.test(u || '') ? u : '');
const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|avif)$/i, VID_EXT = /\.(mp4|webm|mov|m4v|3gp|ogv)$/i;

/* File di Drive yang tidak bisa dibagikan publik (file_url = "drive:ID") diambil lewat backend */
const driveCache = new Map(), driveMime = new Map();
function fetchDriveBlob(id, onProg) {
  if (!driveCache.has(id)) {
    const p = (async () => {
      // 1) cek cache permanen di perangkat -> pembukaan ulang instan
      const key = location.origin + BASE_PATH + '_f/' + encodeURIComponent(id);
      let c = null;
      try {
        c = await caches.open('lsc-files');
        const hit = await c.match(key);
        if (hit) { const b = await hit.blob(); driveMime.set(id, b.type); return URL.createObjectURL(b); }
      } catch (e) { c = null; }
      // 2) belum ada -> ambil dari server lalu simpan ke cache
      const parts = [];
      let off = 0, size = 0, mime = 'application/octet-stream';
      do {
        const r = await api('getFile', { file_id: id, offset: off, length: DL_CHUNK });
        size = r.size || 0; mime = r.mime || mime;
        const bin = atob(r.data), arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        parts.push(arr); off += arr.length;
        if (onProg) onProg(off, size);
        if (!arr.length) break;
      } while (off < size);
      const blob = new Blob(parts, { type: mime });
      driveMime.set(id, mime);
      if (c && blob.size < 30 * 1024 * 1024) c.put(key, new Response(blob, { headers: { 'Content-Type': mime } })).catch(() => {});
      return URL.createObjectURL(blob);
    })();
    p.catch(() => driveCache.delete(id));
    driveCache.set(id, p);
  }
  return driveCache.get(id);
}
function hydrateDrive(root) {
  root.querySelectorAll('[data-drive]').forEach((el) => {
    if (el.dataset.loading) return;
    el.dataset.loading = '1';
    fetchDriveBlob(el.dataset.drive).then((u) => {
      el.src = u;
      if (el.tagName === 'IMG') { el.dataset.lightbox = u; el.classList.remove('animate-pulse'); }
    }).catch(() => { delete el.dataset.loading; el.classList.remove('animate-pulse'); el.alt = 'Gagal memuat file'; });
  });
}
const IMG_MAX = 1280, IMG_Q = 0.72, IMG_IN_MAX = 30 * 1024 * 1024;
async function compressImage(f) {
  if (!f.type.startsWith('image/') || /gif|svg/.test(f.type)) return f;
  try {
    let bmp;
    try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(f); }
    const sc = Math.min(1, IMG_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', IMG_Q));
    if (!blob || (sc === 1 && blob.size >= f.size)) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) { return f; }
}
function saveUrl(u, name) {
  const a = document.createElement('a');
  a.href = u; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove();
}
function dlProgress(name) {
  let el = null;
  return {
    cb: (o, s) => {
      if (s <= DL_CHUNK) return;
      if (!el) { el = document.createElement('div'); el.className = 'toast pointer-events-auto text-sm text-white rounded-xl px-4 py-3 shadow-lg bg-gray-900'; $('toasts').appendChild(el); }
      el.textContent = 'Mengunduh ' + name + ' ' + Math.round(o / s * 100) + '%';
    },
    done: () => { if (el) el.remove(); }
  };
}
async function downloadDrive(id, name) {
  const pg = dlProgress(name);
  try { saveUrl(await fetchDriveBlob(id, pg.cb), name); } finally { pg.done(); }
}
async function doDownload(did, url, name) {
  if (did) return downloadDrive(did, name);
  try {
    const r = await fetch(url); if (!r.ok) throw new Error('x');
    const u = URL.createObjectURL(await r.blob());
    saveUrl(u, name); setTimeout(() => URL.revokeObjectURL(u), 10000);
  } catch (e) { window.open(url, '_blank', 'noopener'); }
}
function openLightbox(src, name) {
  $('lbImg').src = src; $('lbImg').alt = name || '';
  $('lbDl').dataset.name = name || 'gambar';
  $('lightbox').classList.remove('hidden'); $('lightbox').classList.add('flex');
}
async function fileAction(btn) {
  const d = btn.dataset, did = d.did || '', url = d.url || '', name = d.name || 'file';
  if (d.act === 'dl') return doDownload(did, url, name);
  if (d.kind === 'image') return openLightbox(did ? await fetchDriveBlob(did) : url, name);
  const w = window.open('', '_blank'); // dibuka sinkron agar tidak diblokir pop-up blocker
  try {
    if (!did) {
      const id = (url.match(/[?&]id=([^&]+)/) || [])[1];
      const target = id ? 'https://drive.google.com/file/d/' + id + '/view' : url;
      if (w) w.location.href = target; else toast('Izinkan pop-up untuk melihat file.', 'error');
      return;
    }
    const pg = dlProgress(name);
    let u; try { u = await fetchDriveBlob(did, pg.cb); } finally { pg.done(); }
    const mime = driveMime.get(did) || '';
    if (!/^(image|video|audio|text)\/|application\/pdf/.test(mime)) { if (w) w.close(); return saveUrl(u, name); }
    if (w) w.location.href = u; else toast('Izinkan pop-up untuk melihat file.', 'error');
  } catch (e) { if (w) w.close(); throw e; }
}

const state = {
  session: null, settings: { site_name: 'Live Support Chat', logo_url: '' },
  peer: null, users: [], usersSig: '', msgs: [], sig: '', lastDay: '',
  file: null, pending: [], timer: null, polling: false, mode: 'login',
  installEvt: null, os: null, lastPushId: ''
};
const isAdmin = () => state.session && state.session.role === 'admin';

/* ---------- Util ---------- */
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast pointer-events-auto text-sm text-white rounded-xl px-4 py-3 shadow-lg ' + (type === 'error' ? 'bg-red-600' : 'bg-gray-900');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function avatar(name) {
  const colors = ['#00A884', '#128C7E', '#5E5CE6', '#E4572E', '#C77DFF', '#1E88E5', '#F59E0B'];
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ch = esc((String(name)[0] || '?').toUpperCase());
  return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="' + colors[h % colors.length] + '"/><text x="32" y="43" font-size="30" font-family="Arial" fill="#fff" text-anchor="middle">' + ch + '</text></svg>');
}
const timeStr = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
function dayLabel(ts) {
  const d = new Date(ts), n = new Date();
  const k = (x) => x.toDateString();
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (k(d) === k(n)) return 'Hari Ini';
  if (k(d) === k(y)) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}
function listTime(ts) {
  if (!ts) return '';
  const l = dayLabel(ts);
  if (l === 'Hari Ini') return timeStr(ts);
  if (l === 'Kemarin') return 'Kemarin';
  return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('Gagal membaca file.'));
    r.readAsDataURL(file);
  });
}

/* ---------- API ---------- */
async function api(action, payload, auth) {
  const body = Object.assign({ action }, payload || {});
  if (auth !== false && state.session) { body.user_id = state.session.user_id; body.session_token = state.session.session_token; }
  let res;
  try {
    res = await fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  } catch (e) { throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.'); }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('Respons server tidak valid.');
  if (!data.ok) {
    if (data.code === 'AUTH' && auth !== false) forceLogout('Sesi berakhir. Silakan masuk kembali.');
    throw new Error(data.error || 'Terjadi kesalahan.');
  }
  return data;
}

/* ---------- Pengaturan tampilan ---------- */
function applySettings() {
  const s = state.settings;
  document.title = s.site_name;
  document.querySelectorAll('[data-site-name]').forEach((e) => { e.textContent = s.site_name; });
  document.querySelectorAll('img[data-logo]').forEach((i) => setLogo(i, s.logo_url));
  if (!isAdmin() && state.session) setChatHeader();
}
function setLogo(img, url) {
  img.onerror = () => { img.onerror = null; img.src = 'icon-192.png'; };
  img.src = safeUrl(url) || 'icon-192.png';
}
async function loadSettings() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null');
    if (cached) { state.settings = cached; applySettings(); }
  } catch (e) {}
  try {
    const r = await api('getSettings', {}, false);
    state.settings = r.settings;
    localStorage.setItem(LS_SETTINGS, JSON.stringify(r.settings));
    applySettings();
  } catch (e) {}
}

/* ---------- Auth ---------- */
function setMode(m) {
  state.mode = m;
  const reg = m === 'register';
  $('tabLogin').className = 'py-2 rounded-full ' + (reg ? 'text-gray-500' : 'bg-white shadow-sm text-wa');
  $('tabRegister').className = 'py-2 rounded-full ' + (reg ? 'bg-white shadow-sm text-wa' : 'text-gray-500');
  $('inPass2').classList.toggle('hidden', !reg);
  $('inPass2').required = reg;
  $('inPass').autocomplete = reg ? 'new-password' : 'current-password';
  $('authBtn').textContent = reg ? 'Daftar & Masuk' : 'Masuk';
  $('authErr').classList.add('hidden');
}
async function onAuthSubmit(e) {
  e.preventDefault();
  const u = $('inUser').value.trim(), p = $('inPass').value;
  const err = (t) => { $('authErr').textContent = t; $('authErr').classList.remove('hidden'); };
  $('authErr').classList.add('hidden');
  if (state.mode === 'register' && p !== $('inPass2').value) return err('Password dan ulangi password tidak sama.');
  const btn = $('authBtn'), label = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spin spin-w"></span>';
  try {
    const hash = await sha256(p);
    if (state.mode === 'register') await api('register', { username: u, password_hash: hash }, false);
    const r = await api('login', { username: u, password_hash: hash }, false);
    state.session = { user_id: r.user_id, username: r.username, role: r.role, session_token: r.session_token };
    localStorage.setItem(LS_SESSION, JSON.stringify(state.session));
    $('inPass').value = ''; $('inPass2').value = '';
    enterApp();
  } catch (ex) { err(ex.message); }
  finally { btn.disabled = false; btn.textContent = label; }
}
function forceLogout(msg) {
  stopPolling();
  try { finishCall('ended'); hideIncoming(false); } catch (e) {}
  state.uploads.forEach((u) => { u.cancelled = true; try { if (u.xhr) u.xhr.abort(); } catch (e) {} });
  state.uploads = [];
  localStorage.removeItem(LS_SESSION);
  state.session = null; state.peer = null; state.users = []; state.usersSig = ''; state.lastPushId = '';
  resetChat();
  $('mainView').classList.add('hidden');
  $('authView').classList.remove('hidden');
  if (msg) toast(msg, 'error');
}
async function logout() {
  try {
    const pid = state.os && state.os.User.PushSubscription.id;
    if (pid) await api('saveOneSignalId', { onesignal_id: pid, remove: true });
  } catch (e) {}
  try { await api('logout'); } catch (e) {}
  forceLogout();
}

/* ---------- Masuk ke aplikasi ---------- */
function enterApp() {
  $('authView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  $('msgInput').value = ''; autosize();
  $('btnSettingsU').classList.add('hidden');
  $('btnLogoutU').classList.toggle('hidden', isAdmin());
  $('btnLogoutU').classList.toggle('flex', !isAdmin());
  state.peer = null;
  resetChat();
  layout();
  applySettings();
  setChatHeader();
  if (isAdmin()) renderUsers();
  startPolling();
  syncPush();
  checkNotifBanner();
  handleDeepLink();
}
function layout() {
  const admin = isAdmin(), open = !admin || !!state.peer;
  $('sidebar').className = admin ? 'w-full md:w-96 shrink-0 flex-col border-r border-gray-200 bg-white ' + (state.peer ? 'hidden md:flex' : 'flex') : 'hidden';
  $('chatPane').className = 'flex-1 min-w-0 h-full flex-col ' + (open ? 'flex' : 'hidden md:flex');
  $('emptyState').className = (admin && !state.peer ? 'flex' : 'hidden') + ' flex-1 chat-bg items-center justify-center text-center p-8';
  $('chatWrap').classList.toggle('hidden', admin && !state.peer);
  $('btnBack').classList.toggle('hidden', !admin);
  $('btnBack').classList.toggle('md:hidden', admin);
}
function setChatHeader() {
  if (isAdmin()) {
    if (!state.peer) return;
    $('chatTitle').textContent = state.peer.username;
    $('chatSub').textContent = 'Pengguna';
    $('chatAvatar').src = avatar(state.peer.username);
  } else {
    $('chatTitle').textContent = state.settings.site_name;
    $('chatSub').textContent = 'Layanan Pelanggan';
    setLogo($('chatAvatar'), state.settings.logo_url);
  }
}

/* ---------- Daftar user (admin) ---------- */
async function loadUsers() {
  const r = await api('getUsers');
  handleCallPoll(r.call);
  const sig = JSON.stringify(r.users);
  state.users = r.users;
  if (sig !== state.usersSig) { state.usersSig = sig; renderUsers(); }
}
function renderUsers() {
  const q = $('searchUser').value.trim().toLowerCase();
  const list = state.users.filter((u) => u.username.toLowerCase().includes(q));
  if (!list.length) {
    $('userList').innerHTML = '<p class="text-center text-sm text-gray-500 p-8">' + (state.users.length ? 'Pengguna tidak ditemukan.' : 'Belum ada pengguna terdaftar.') + '</p>';
    return;
  }
  $('userList').innerHTML = list.map((u) =>
    '<button data-uid="' + esc(u.user_id) + '" class="w-full flex items-center gap-3 px-3 py-3 text-left border-b border-gray-100 hover:bg-gray-50 ' + (state.peer && state.peer.user_id === u.user_id ? 'bg-gray-100' : '') + '">' +
    '<img src="' + avatar(u.username) + '" alt="" class="w-12 h-12 rounded-full shrink-0">' +
    '<div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><span class="font-semibold truncate">' + esc(u.username) + '</span><span class="text-xs shrink-0 ' + (u.unread ? 'text-wa-light font-semibold' : 'text-gray-500') + '">' + listTime(u.last_time) + '</span></div>' +
    '<div class="flex items-center justify-between gap-2"><span class="text-sm text-gray-500 truncate">' + (esc(u.last_text) || 'Belum ada pesan') + '</span>' +
    (u.unread ? '<span class="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-wa-light text-white text-xs font-semibold flex items-center justify-center">' + u.unread + '</span>' : '') + '</div></div></button>'
  ).join('');
}
function openChat(uid, fromPop) {
  const u = state.users.find((x) => x.user_id === uid);
  if (!u) return;
  state.peer = { user_id: u.user_id, username: u.username };
  u.unread = 0; state.usersSig = '';
  resetChat(); layout(); setChatHeader(); renderUsers();
  if (!fromPop) history.pushState({ chat: uid }, '');
  loadMessages(true).catch((e) => toast(e.message, 'error'));
  $('msgInput').focus({ preventScroll: true });
}
function closeChat() {
  state.peer = null; resetChat(); layout(); renderUsers();
}

/* ---------- Pesan ---------- */
function resetChat() {
  if ($('emojiPanel')) toggleEmoji(false);
  state.msgs = []; state.sig = ''; state.lastDay = '';
  state.pending = state.uploads.filter((u) => u.key === peerKey()).map((u) => u.msg);
  $('msgs').innerHTML = '';
  clearAttach();
  if (state.session) state.pending.forEach(appendEl);
}
const peerKey = () => (isAdmin() ? (state.peer && state.peer.user_id) : 'me');
async function loadMessages(forceScroll) {
  const key = peerKey();
  const r = await api('getMessages', { peer_id: isAdmin() && state.peer ? state.peer.user_id : '' });
  handleCallPoll(r.call);
  if (key !== peerKey()) return; // pengguna sudah pindah percakapan
  const sig = r.messages.map((m) => m.msg_id + (m.is_read ? '1' : '0') + (m.file_type === 'call' ? m.file_name : '')).join(',');
  if (sig === state.sig) return;
  state.sig = sig;
  syncDom(r.messages, forceScroll);
}
function isMine(m) {
  return isAdmin() ? (state.peer && m.sender_id !== state.peer.user_id) : m.sender_id === state.session.user_id;
}
function syncDom(msgs, forceScroll) {
  const box = $('msgs');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const have = new Set(Array.from(box.querySelectorAll('[data-id]')).map((e) => e.dataset.id));
  box.querySelectorAll('[data-pending]').forEach((e) => e.remove());
  let added = false, lastMine = false;
  msgs.forEach((m) => {
    if (have.has(m.msg_id)) {
      if (m.file_type === 'call') { const ce = box.querySelector('[data-id="' + m.msg_id + '"]'), h = bubble(m); if (ce && ce.dataset.ch !== h) { ce.dataset.ch = h; ce.innerHTML = h; } }
      const t = box.querySelector('[data-id="' + m.msg_id + '"] .tick');
      if (t) t.className = 'tick ' + (m.is_read ? 'text-[#53bdeb]' : 'text-gray-400');
      return;
    }
    appendEl(m); added = true; lastMine = isMine(m);
  });
  state.msgs = msgs;
  state.pending.forEach((p) => appendEl(p));
  $('emptyMsgs') && $('emptyMsgs').remove();
  if (!box.children.length) box.innerHTML = '<p id="emptyMsgs" class="text-center text-sm text-gray-500 bg-white/70 rounded-xl px-4 py-3 mx-auto w-fit">Belum ada pesan. Mulai percakapan di bawah.</p>';
  if (forceScroll || (added && (near || lastMine))) scrollBottom(forceScroll ? 'auto' : 'smooth');
}
function scrollBottom(b) { const box = $('msgs'); box.scrollTo({ top: box.scrollHeight, behavior: b || 'smooth' }); }
function appendEl(m) {
  const box = $('msgs');
  const em = $('emptyMsgs'); if (em) em.remove();
  const day = dayLabel(m.timestamp);
  if (day !== state.lastDay) {
    state.lastDay = day;
    const sep = document.createElement('div');
    sep.className = 'flex justify-center py-1' + (m.pending ? '' : '');
    if (m.pending) sep.dataset.pending = '1';
    sep.innerHTML = '<span class="bg-white/90 text-gray-600 text-xs rounded-full px-3 py-1 shadow-sm">' + esc(day) + '</span>';
    box.appendChild(sep);
  }
  const el = document.createElement('div');
  el.dataset.id = m.msg_id;
  if (m.pending) el.dataset.pending = '1';
  el.className = 'flex ' + (isMine(m) ? 'justify-end' : 'justify-start');
  const bh = bubble(m);
  el.innerHTML = bh;
  if (m.file_type === 'call') el.dataset.ch = bh;
  if (m.up) el.dataset.ust = upSig(m.up);
  box.appendChild(el);
  hydrateDrive(el);
}
function bubble(m) {
  if (m.up) return uploadBubble(m);
  if (m.file_type === 'call') return callBubble(m);
  const mine = isMine(m), name = esc(m.file_name), raw = String(m.file_url || '');
  const did = raw.indexOf('drive:') === 0 ? raw.slice(6) : '';
  const url = did ? '' : esc(safeUrl(raw));
  let kind = m.file_type;
  if (did && kind === 'document') kind = IMG_EXT.test(m.file_name || '') ? 'image' : VID_EXT.test(m.file_name || '') ? 'video' : 'document';
  m = Object.assign({}, m, { file_type: kind });
  let media = '';
  if (did && kind === 'image') media = '<img data-drive="' + esc(did) + '" alt="' + name + '" class="animate-pulse bg-black/10 rounded-lg min-w-[160px] min-h-[120px] max-h-64 max-w-full object-cover cursor-pointer mb-1">';
  else if (did && kind === 'video') media = '<div class="flex items-center gap-3 bg-black/10 rounded-lg p-3 mb-1 min-w-[200px]"><span class="text-2xl">🎥</span><span class="truncate flex-1 text-sm font-medium">' + name + '</span></div>';
  else if (did) media = '<div class="flex items-center gap-3 bg-black/10 rounded-lg p-3 mb-1 min-w-[200px]"><span class="text-2xl">📄</span><span class="truncate flex-1 text-sm font-medium">' + name + '</span></div>';
  else if (m.file_type === 'image' && url) media = '<img src="' + url + '" alt="' + name + '" loading="lazy" data-lightbox="' + url + '" class="rounded-lg max-h-64 max-w-full object-cover cursor-pointer mb-1">';
  else if (m.file_type === 'video' && url) media = '<video controls preload="metadata" playsinline class="rounded-lg w-full max-w-[280px] mb-1 bg-black"><source src="' + url + '"></video>';
  else if (m.file_type === 'video' || m.file_type === 'image') media = '<div class="flex items-center gap-2 bg-black/10 rounded-lg p-3 mb-1 text-sm"><span>' + (m.file_type === 'image' ? '🖼️' : '🎥') + '</span><span class="truncate">' + name + '</span></div>';
  else if (m.file_type === 'document') media = '<div class="flex items-center gap-3 bg-black/10 rounded-lg p-3 mb-1 min-w-[200px]"><span class="text-2xl">📄</span><span class="truncate flex-1 text-sm font-medium">' + name + '</span></div>';
  if (!m.pending && (did || url) && kind !== 'text') {
    const b = (act, label) => '<button type="button" data-act="' + act + '" data-did="' + esc(did) + '" data-url="' + url + '" data-kind="' + esc(kind) + '" data-name="' + name + '" class="flex-1 text-xs font-semibold text-wa bg-black/5 hover:bg-black/10 rounded-lg py-1.5 px-3">' + label + '</button>';
    media += '<div class="flex gap-2 mb-1">' + b('view', '👁️ Lihat') + b('dl', '⬇️ Unduh') + '</div>';
  }
  const text = m.text ? '<div class="whitespace-pre-wrap break-words msg-text leading-snug">' + esc(m.text) + '</div>' : '';
  let status = '';
  if (mine) status = m.pending ? (m.file_type !== 'text' ? '<span class="spin"></span>' : '<span>🕓</span>') : '<span class="tick ' + (m.is_read ? 'text-[#53bdeb]' : 'text-gray-400') + '">✓✓</span>';
  return '<div class="flex flex-col max-w-[85%] md:max-w-[65%] min-w-[84px] px-2.5 py-1.5 shadow-sm text-wa-ink rounded-2xl ' + (mine ? 'bg-wa-bubble rounded-tr-none' : 'bg-white rounded-tl-none') + '">' +
    media + text + '<div class="self-end flex items-center gap-1 text-[11px] text-gray-500 mt-0.5">' + timeStr(m.timestamp) + status + '</div></div>';
}

/* ---------- Kirim ---------- */
state.files = []; state.uploads = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kindOf = (f) => (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'document');

async function send() {
  const text = $('msgInput').value.trim(), files = state.files.slice();
  if (!text && !files.length) return;
  if (isAdmin() && !state.peer) return;
  if (files.some((f) => f.processing)) { toast('Tunggu, gambar sedang diproses.'); return; }
  const peer_id = isAdmin() ? state.peer.user_id : '', key = peerKey();
  $('msgInput').value = ''; autosize(); clearAttach(true);
  toggleEmoji(false);
  if (!files.length) return sendText(text, peer_id, key);
  files.forEach((it, i) => queueUpload(it, i === 0 ? text : '', peer_id, key)); // teks menjadi keterangan file pertama
  runUploads();
}
async function sendText(text, peer_id, key) {
  const tmp = { msg_id: 'tmp' + Date.now() + Math.random().toString(36).slice(2, 6), sender_id: isAdmin() ? 'admin' : state.session.user_id, text, file_type: 'text', file_name: '', file_url: '', timestamp: Date.now(), is_read: false, pending: true };
  let sent = null;
  state.pending.push(tmp);
  appendEl(tmp); scrollBottom();
  try {
    sent = (await api('sendMessage', { text, peer_id })).message;
  } catch (e) {
    toast('Pesan gagal terkirim: ' + e.message, 'error');
    if (!$('msgInput').value) { $('msgInput').value = text; autosize(); }
  } finally {
    state.pending = state.pending.filter((p) => p !== tmp);
    const el = $('msgs').querySelector('[data-id="' + tmp.msg_id + '"]'); if (el) el.remove();
    if (key === peerKey()) {
      if (sent) { if (!$('msgs').querySelector('[data-id="' + sent.msg_id + '"]')) { state.msgs.push(sent); appendEl(sent); scrollBottom(); } }
      else { try { state.sig = ''; await loadMessages(true); } catch (e) {} }
    }
  }
}
function autosize() {
  const t = $('msgInput'); t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 112) + 'px';
}

/* ---------- Unggahan banyak file, besar, dengan progres ala WhatsApp ---------- */
function apiX(action, payload, hooks) { // XMLHttpRequest agar progres unggah bisa dibaca
  hooks = hooks || {};
  return new Promise((resolve, reject) => {
    if (!state.session) return reject(new Error('Sesi berakhir.'));
    const body = Object.assign({ action }, payload, { user_id: state.session.user_id, session_token: state.session.session_token });
    const x = new XMLHttpRequest();
    const fail = (msg, extra) => reject(Object.assign(new Error(msg), extra));
    x.open('POST', GAS_WEB_APP_URL);
    x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    x.timeout = 180000;
    if (hooks.xhr) hooks.xhr(x);
    if (hooks.progress) x.upload.onprogress = (e) => { if (e.lengthComputable) hooks.progress(e.loaded / e.total); };
    x.onload = () => {
      let d = null; try { d = JSON.parse(x.responseText); } catch (e) {}
      if (!d) return fail('Respons server tidak valid.', { net: true });
      if (!d.ok) { if (d.code === 'AUTH') forceLogout('Sesi berakhir. Silakan masuk kembali.'); return fail(d.error || 'Terjadi kesalahan.', { server: true }); }
      resolve(d);
    };
    x.onerror = () => fail('Tidak dapat terhubung ke server. Periksa koneksi internet.', { net: true });
    x.ontimeout = () => fail('Waktu habis. Periksa koneksi internet.', { net: true });
    x.onabort = () => fail('Dibatalkan', { aborted: true });
    x.send(JSON.stringify(body));
  });
}
const abortErr = () => Object.assign(new Error('Dibatalkan'), { aborted: true });

function queueUpload(it, text, peer_id, key) {
  const msg = { msg_id: 'tmp' + Date.now() + Math.random().toString(36).slice(2, 6), sender_id: isAdmin() ? 'admin' : state.session.user_id, text, file_type: it.kind, file_name: it.file.name, file_url: '', timestamp: Date.now(), is_read: false, pending: true };
  const up = { id: msg.msg_id, it, text, peer_id, key, status: 'queued', phase: '', loaded: 0, total: it.file.size, offset: 0, upload_id: null, xhr: null, cancelled: false, msg };
  msg.up = up;
  state.uploads.push(up);
  if (key === peerKey()) { state.pending.push(msg); appendEl(msg); scrollBottom(); }
}
async function runUploads() {
  if (uploadRunning) return;
  uploadRunning = true;
  try {
    let up;
    while ((up = state.uploads.find((u) => u.status === 'queued'))) await doUpload(up);
  } finally { uploadRunning = false; }
}
let uploadRunning = false;

async function doUpload(up) {
  const f = up.it.file;
  up.status = 'uploading'; up.phase = ''; up.loaded = up.offset || 0; paintUpload(up);
  try {
    let sent;
    if (f.size <= SMALL_MAX) sent = await uploadInline(up);
    else {
      try { sent = await uploadChunked(up); }
      catch (e) { if (e.initFailed && f.size <= MAX_INLINE && !up.cancelled) sent = await uploadInline(up); else throw e; }
    }
    finishUpload(up, sent);
  } catch (e) {
    if (up.cancelled || e.aborted) return;
    if (/Unggahan tidak ditemukan/.test(e.message)) { // kemungkinan pesan sudah terkirim sebelumnya
      dropUpload(up); toast('Memeriksa pesan terkirim…'); state.sig = ''; tick(); return;
    }
    up.status = 'failed'; up.error = e.message; paintUpload(up);
    toast('Gagal mengirim ' + f.name + ': ' + e.message, 'error');
  }
}
function setProg(up, loaded, force) {
  up.loaded = Math.max(0, Math.min(up.total, loaded));
  const now = Date.now();
  if (force || now - (up.lp || 0) > 120) { up.lp = now; paintUpload(up); }
}
async function uploadInline(up) {
  const f = up.it.file;
  const data = await toBase64(f);
  if (up.cancelled) throw abortErr();
  const r = await apiX('sendMessage', { text: up.text, peer_id: up.peer_id, file: { name: f.name, mime: f.type || 'application/octet-stream', data } }, {
    xhr: (x) => { up.xhr = x; },
    progress: (p) => { if (p >= 1) up.phase = 'finish'; setProg(up, p * f.size * 0.98, p >= 1); }
  });
  return r.message;
}
async function uploadChunked(up) {
  const f = up.it.file, size = f.size;
  if (!up.upload_id) {
    try {
      const init = await apiX('uploadInit', { name: f.name, mime: f.type || 'application/octet-stream', size }, { xhr: (x) => { up.xhr = x; } });
      up.upload_id = init.upload_id; up.offset = 0;
    } catch (e) { e.initFailed = true; throw e; }
  }
  while (up.offset < size) {
    if (up.cancelled) throw abortErr();
    const off = up.offset, end = Math.min(off + CHUNK, size);
    const data = await toBase64(f.slice(off, end));
    let r, tries = 0;
    for (;;) {
      try {
        r = await apiX('uploadChunk', { upload_id: up.upload_id, offset: off, data }, { xhr: (x) => { up.xhr = x; }, progress: (p) => setProg(up, off + p * (end - off) * 0.95) });
        break;
      } catch (e) {
        if (up.cancelled || e.aborted || !e.net || ++tries >= 3) { if (/Sesi unggah/.test(e.message)) { up.upload_id = null; up.offset = 0; } throw e; }
        await sleep(1200 * tries);
      }
    }
    up.offset = r.done ? size : Math.min(size, Math.max(off, r.next || end));
    setProg(up, up.offset, true);
  }
  up.phase = 'finish'; paintUpload(up);
  const r = await apiX('sendMessage', { text: up.text, peer_id: up.peer_id, upload_id: up.upload_id }, { xhr: (x) => { up.xhr = x; } });
  return r.message;
}
function finishUpload(up, sent) {
  up.status = 'done';
  const f = up.it.file;
  dropUpload(up);
  if (up.key !== peerKey()) return; // sedang membuka percakapan lain; pesan muncul lewat polling
  if (/^drive:/.test(sent.file_url)) { // pengirim memakai salinan lokal -> tidak perlu mengunduh ulang
    const id = sent.file_url.slice(6);
    driveCache.set(id, Promise.resolve(URL.createObjectURL(f))); driveMime.set(id, f.type || '');
  }
  if (!$('msgs').querySelector('[data-id="' + sent.msg_id + '"]')) { state.msgs.push(sent); appendEl(sent); scrollBottom(); }
}
function dropUpload(up) {
  state.uploads = state.uploads.filter((u) => u !== up);
  state.pending = state.pending.filter((p) => p !== up.msg);
  const el = $('msgs').querySelector('[data-id="' + up.id + '"]'); if (el) el.remove();
  if (up.it.thumb) { const t = up.it.thumb; setTimeout(() => URL.revokeObjectURL(t), 3000); }
}
function upAction(act, id) {
  const up = state.uploads.find((u) => u.id === id);
  if (!up) return;
  if (act === 'retry') {
    if (up.status !== 'failed') return;
    up.status = 'queued'; up.error = ''; up.loaded = up.offset || 0; paintUpload(up); runUploads();
    return;
  }
  up.cancelled = true;
  try { if (up.xhr) up.xhr.abort(); } catch (e) {}
  dropUpload(up);
}

/* Tampilan gelembung unggahan: cincin progres + tombol batal / coba lagi */
const RING_C = 125.66;
const upIndet = (up) => up.status === 'queued' || (up.status === 'uploading' && (up.phase === 'finish' || up.loaded >= up.total));
const upSig = (up) => up.status + (upIndet(up) ? 'i' : 'd');
const upFrac = (up) => (upIndet(up) ? 0.28 : Math.min(1, up.loaded / (up.total || 1)));
function upLabel(up, long) {
  if (up.status === 'queued') return 'Menunggu…';
  if (up.status === 'failed') return 'Gagal terkirim';
  if (upIndet(up)) return 'Menyelesaikan…';
  const pct = Math.round(upFrac(up) * 100) + '%';
  return long ? fmtSize(up.loaded) + ' / ' + fmtSize(up.total) + ' · ' + pct : pct;
}
function ringHtml(up) {
  const failed = up.status === 'failed', indet = upIndet(up);
  const off = failed ? 0 : (RING_C * (1 - upFrac(up))).toFixed(1);
  const svg = '<svg class="w-full h-full -rotate-90" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="3"/>' +
    '<circle data-up-arc cx="24" cy="24" r="20" fill="none" stroke="' + (failed ? '#f87171' : '#fff') + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + off + '"/></svg>';
  const btn = failed
    ? '<button type="button" data-up-act="retry" data-up-id="' + esc(up.id) + '" aria-label="Coba lagi" class="relative z-10 text-xl leading-none">↻</button>'
    : '<button type="button" data-up-act="cancel" data-up-id="' + esc(up.id) + '" aria-label="Batalkan" class="relative z-10 text-lg leading-none">✕</button>';
  const del = failed ? '<button type="button" data-up-act="cancel" data-up-id="' + esc(up.id) + '" aria-label="Hapus" class="w-8 h-8 rounded-full bg-black/55 text-white text-sm shrink-0">✕</button>' : '';
  return '<div class="flex items-center gap-2 shrink-0"><div class="relative w-12 h-12 rounded-full bg-black/55 text-white flex items-center justify-center"><div class="absolute inset-0' + (indet ? ' animate-spin' : '') + '">' + svg + '</div>' + btn + '</div>' + del + '</div>';
}
function uploadBubble(m) {
  const up = m.up, name = esc(m.file_name), kind = m.file_type;
  const chip = '<span data-up-txt class="absolute left-1.5 bottom-1.5 bg-black/55 text-white text-[11px] rounded-full px-2 py-0.5">' + upLabel(up) + '</span>';
  let media;
  if (kind === 'image' && up.it.thumb) media = '<div class="relative rounded-lg overflow-hidden mb-1 w-fit max-w-full"><img src="' + up.it.thumb + '" alt="" class="max-h-64 max-w-full object-cover brightness-75"><div class="absolute inset-0 flex items-center justify-center">' + ringHtml(up) + '</div>' + chip + '</div>';
  else if (kind === 'video') media = '<div class="relative rounded-lg overflow-hidden mb-1 bg-gray-800 w-[240px] max-w-full h-36 flex items-center justify-center"><span class="absolute top-2 left-2 right-2 text-xs text-white truncate">🎥 ' + name + '</span>' + ringHtml(up) + chip + '</div>';
  else media = '<div class="flex items-center gap-3 bg-black/10 rounded-lg p-3 mb-1 min-w-[230px]">' + ringHtml(up) + '<div class="min-w-0 flex-1"><div class="truncate text-sm font-medium">' + (kind === 'image' ? '🖼️ ' : '📄 ') + name + '</div><div data-up-txt class="text-xs text-gray-500">' + upLabel(up, true) + '</div><div class="h-1 bg-black/10 rounded-full mt-1.5 overflow-hidden"><div data-up-bar class="h-full bg-wa-light" style="width:' + Math.round(upFrac(up) * 100) + '%"></div></div></div></div>';
  const text = m.text ? '<div class="whitespace-pre-wrap break-words msg-text leading-snug">' + esc(m.text) + '</div>' : '';
  return '<div class="flex flex-col max-w-[85%] md:max-w-[65%] min-w-[84px] px-2.5 py-1.5 shadow-sm text-wa-ink rounded-2xl bg-wa-bubble rounded-tr-none">' +
    media + text + '<div class="self-end flex items-center gap-1 text-[11px] text-gray-500 mt-0.5">' + timeStr(m.timestamp) + '<span>🕓</span></div></div>';
}
function paintUpload(up) {
  const el = $('msgs').querySelector('[data-id="' + up.id + '"]');
  if (!el) return;
  const sig = upSig(up);
  if (el.dataset.ust !== sig) { el.innerHTML = bubble(up.msg); el.dataset.ust = sig; return; }
  const arc = el.querySelector('[data-up-arc]'); if (arc) arc.setAttribute('stroke-dashoffset', (RING_C * (1 - upFrac(up))).toFixed(1));
  const t = el.querySelector('[data-up-txt]'); if (t) t.textContent = upLabel(up, !t.classList.contains('absolute'));
  const b = el.querySelector('[data-up-bar]'); if (b) b.style.width = Math.round(upFrac(up) * 100) + '%';
}

/* ---------- Lampiran (bisa lebih dari satu) ---------- */
async function pickFiles(list) {
  const arr = Array.from(list || []);
  for (const f0 of arr) {
    if (state.files.length >= MAX_FILES) { toast('Maksimal ' + MAX_FILES + ' file sekali kirim.', 'error'); break; }
    const isImg = f0.type.startsWith('image/');
    if (!f0.size) { toast(f0.name + ' kosong.', 'error'); continue; }
    if (isImg ? f0.size > IMG_IN_MAX : f0.size > MAX_FILE) { toast(f0.name + ' terlalu besar (maks. ' + (isImg ? '30' : '100') + ' MB).', 'error'); continue; }
    const it = { id: 'f' + Date.now() + Math.random().toString(36).slice(2, 6), file: f0, kind: kindOf(f0), thumb: '', processing: isImg };
    state.files.push(it); renderAttach();
    if (isImg) {
      compressImage(f0).then((f) => {
        if (!state.files.includes(it)) return; // sudah dihapus / dibatalkan
        if (f.size > MAX_FILE) { state.files = state.files.filter((x) => x !== it); toast(f0.name + ' terlalu besar (maks. 100 MB).', 'error'); renderAttach(); return; }
        it.file = f; it.processing = false; it.thumb = URL.createObjectURL(f); renderAttach();
      });
    }
  }
}
function renderAttach() {
  const list = state.files;
  $('attachBar').classList.toggle('hidden', !list.length);
  $('attachList').innerHTML = list.map((it) => {
    let inner;
    if (it.processing) inner = '<span class="spin"></span>';
    else if (it.kind === 'image' && it.thumb) inner = '<img class="w-full h-full object-cover" src="' + it.thumb + '" alt="">';
    else if (it.kind === 'video') inner = '<div class="text-center leading-tight"><div class="text-2xl">🎥</div><div class="text-[10px] text-gray-500">' + fmtSize(it.file.size) + '</div></div>';
    else inner = '<div class="text-center leading-tight px-1"><div class="text-2xl">📄</div><div class="text-[10px] text-gray-500 truncate">' + esc((it.file.name.split('.').pop() || '').slice(0, 5).toUpperCase()) + '</div></div>';
    return '<div class="relative w-16 h-16 shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center" title="' + esc(it.file.name) + '">' + inner +
      '<button type="button" data-rm="' + esc(it.id) + '" aria-label="Hapus lampiran" class="absolute top-0 right-0 w-5 h-5 bg-black/60 text-white text-[11px] rounded-bl-lg leading-none">✕</button></div>';
  }).join('');
  const total = list.reduce((s, it) => s + it.file.size, 0);
  $('attachInfo').textContent = list.length ? list.length + ' file · ' + fmtSize(total) + (list.some((i) => i.processing) ? ' · memproses…' : '') : '';
}
function clearAttach(moved) {
  if (!moved) state.files.forEach((it) => { if (it.thumb) URL.revokeObjectURL(it.thumb); });
  state.files = [];
  $('fileMedia').value = ''; $('fileDoc').value = '';
  renderAttach();
  $('attachMenu').classList.add('hidden');
}

/* ---------- Tampilan (ukuran huruf, tema, wallpaper) ---------- */
const LS_PREFS = 'lsc_prefs', LS_WALL = 'lsc_wall';
const FONTS = { s: 13, m: 15, l: 18, xl: 21 };
const FONT_LABEL = { s: 'Kecil', m: 'Sedang', l: 'Besar', xl: 'Sangat besar' };
const THEMES = { light: '☀️ Terang', dark: '🌙 Gelap', auto: '🌓 Otomatis' };
const WALLS = [
  { id: 'default', name: 'Bawaan' }, { id: 'w1', c: '#EFEAE2', name: 'Krem' }, { id: 'w2', c: '#D9E7DC', name: 'Hijau' },
  { id: 'w3', c: '#D6E4F0', name: 'Biru' }, { id: 'w4', c: '#F3DDE4', name: 'Merah muda' }, { id: 'w5', c: '#E6E0F3', name: 'Ungu' },
  { id: 'w6', c: '#E5E7EB', name: 'Abu-abu' }, { id: 'w7', c: '#1F2C34', name: 'Gelap' }, { id: 'w8', c: '#0B141A', name: 'Hitam' }
];
const prefs = { font: 'm', theme: 'light', wall: 'default' };
function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(LS_PREFS) || 'null'); if (p) { if (FONTS[p.font]) prefs.font = p.font; if (THEMES[p.theme]) prefs.theme = p.theme; if (p.wall) prefs.wall = p.wall; } } catch (e) {}
}
function savePrefs() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) {} }
function getWall() { try { return localStorage.getItem(LS_WALL) || ''; } catch (e) { return ''; } }
const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
function applyWall(el) {
  if (!el) return;
  el.style.backgroundImage = ''; el.style.backgroundColor = ''; el.style.backgroundSize = ''; el.style.backgroundPosition = '';
  if (prefs.wall === 'custom') {
    const d = getWall();
    if (d) { el.style.backgroundImage = 'url("' + d + '")'; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; return; }
  }
  const w = WALLS.find((x) => x.id === prefs.wall);
  if (w && w.c) { el.style.backgroundImage = 'none'; el.style.backgroundColor = w.c; }
}
function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = isDark() ? 'dark' : 'light';
  root.style.setProperty('--msg-fs', FONTS[prefs.font] + 'px');
  applyWall($('msgs')); applyWall($('prefPreview'));
}
function renderPrefUI() {
  const on = 'bg-wa-light text-white', off = 'bg-gray-100';
  $('prefFont').innerHTML = Object.keys(FONTS).map((k) =>
    '<button type="button" data-font="' + k + '" class="rounded-xl py-2 px-1 flex flex-col items-center justify-center ' + (prefs.font === k ? on : off) + '"><span class="font-semibold leading-none" style="font-size:' + (FONTS[k] + 2) + 'px">Aa</span><span class="text-[10px] mt-1">' + FONT_LABEL[k] + '</span></button>').join('');
  $('prefTheme').innerHTML = Object.keys(THEMES).map((k) =>
    '<button type="button" data-theme="' + k + '" class="rounded-xl py-2.5 text-sm font-medium ' + (prefs.theme === k ? on : off) + '">' + THEMES[k] + '</button>').join('');
  const custom = getWall();
  const ring = (id) => (prefs.wall === id ? ' ring-2 ring-wa-light ring-offset-2' : ' border border-gray-300');
  let html = WALLS.map((w) =>
    '<button type="button" data-wall="' + w.id + '" title="' + w.name + '" aria-label="' + w.name + '" class="aspect-square rounded-xl overflow-hidden' + (w.c ? '' : ' chat-bg') + ring(w.id) + '"' + (w.c ? ' style="background:' + w.c + '"' : '') + '></button>').join('');
  if (custom) html += '<button type="button" data-wall="custom" title="Gambar saya" aria-label="Gambar saya" class="aspect-square rounded-xl overflow-hidden' + ring('custom') + '" style="background:url(\'' + custom + '\') center/cover"></button>';
  html += '<button type="button" data-wall="upload" title="Unggah gambar" aria-label="Unggah gambar" class="aspect-square rounded-xl border-2 border-dashed border-gray-300 text-2xl text-gray-500 flex items-center justify-center">＋</button>';
  $('prefWall').innerHTML = html;
  $('wallDel').classList.toggle('hidden', !custom);
}
function openPref() { renderPrefUI(); applyPrefs(); $('prefModal').classList.remove('hidden'); $('prefModal').classList.add('flex'); }
function closePref() { $('prefModal').classList.add('hidden'); $('prefModal').classList.remove('flex'); }
async function setCustomWall(f) {
  if (!f || !f.type.startsWith('image/')) { toast('Pilih file gambar.', 'error'); return; }
  try {
    let bmp;
    try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(f); }
    const sc = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    localStorage.setItem(LS_WALL, cv.toDataURL('image/jpeg', 0.7));
    prefs.wall = 'custom'; savePrefs(); applyPrefs(); renderPrefUI();
  } catch (e) { toast('Gagal memakai gambar. Coba gambar lain.', 'error'); }
}
function bindPrefs() {
  const open = () => openPref();
  $('btnAppearance').onclick = open; $('btnAppearanceA').onclick = open;
  $('prefClose').onclick = closePref; $('prefDone').onclick = closePref;
  $('prefModal').addEventListener('click', (e) => { if (e.target.id === 'prefModal') closePref(); });
  $('prefFont').addEventListener('click', (e) => { const b = e.target.closest('[data-font]'); if (b) { prefs.font = b.dataset.font; savePrefs(); applyPrefs(); renderPrefUI(); } });
  $('prefTheme').addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (b) { prefs.theme = b.dataset.theme; savePrefs(); applyPrefs(); renderPrefUI(); } });
  $('prefWall').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wall]'); if (!b) return;
    if (b.dataset.wall === 'upload') { $('fileWall').click(); return; }
    prefs.wall = b.dataset.wall; savePrefs(); applyPrefs(); renderPrefUI();
  });
  $('fileWall').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; setCustomWall(f); };
  $('wallDel').onclick = () => { try { localStorage.removeItem(LS_WALL); } catch (e) {} if (prefs.wall === 'custom') prefs.wall = 'default'; savePrefs(); applyPrefs(); renderPrefUI(); };
  $('prefReset').onclick = () => { try { localStorage.removeItem(LS_WALL); } catch (e) {} prefs.font = 'm'; prefs.theme = 'light'; prefs.wall = 'default'; savePrefs(); applyPrefs(); renderPrefUI(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs.theme === 'auto') applyPrefs(); });
}

/* ---------- Emotikon ---------- */
const LS_RECENT = 'lsc_recent_emoji';
const EMOJI = {
  '😀': '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕',
  '👍': '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 🫶 ✍️ 🤳 👀 🧠',
  '❤️': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💤 🔥 ✨ ⭐ 🌟 🎉 🎊',
  '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🐴 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳 🌸 🌹 🌻 🌴 🍀',
  '🍔': '🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥑 🍅 🌽 🥕 🍞 🧀 🍳 🍔 🍟 🍕 🌭 🌮 🍜 🍣 🍦 🍩 🍪 🎂 🍫 ☕ 🍵 🥤 🍺',
  '⚽': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🏸 🎮 🎯 🎵 🎶 🎤 🎧 📱 💻 📷 🎁 🏆 🚗 🏍️ ✈️ 🚀 🏠 💡 📌 📎 ✅ ❌ ⚠️ ❓ ❗'
};
let emojiCat = '😀';
function getRecent() { try { return JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); } catch (e) { return []; } }
function addRecent(e) {
  try { localStorage.setItem(LS_RECENT, JSON.stringify([e].concat(getRecent().filter((x) => x !== e)).slice(0, 24))); } catch (x) {}
}
function renderEmoji() {
  const cats = ['🕘'].concat(Object.keys(EMOJI));
  $('emojiTabs').innerHTML = cats.map((c) =>
    '<button type="button" data-cat="' + c + '" class="shrink-0 w-10 h-10 text-xl rounded-lg ' + (c === emojiCat ? 'bg-gray-100 border-b-2 border-wa-light' : 'hover:bg-gray-50') + '">' + c + '</button>').join('');
  const list = emojiCat === '🕘' ? getRecent() : EMOJI[emojiCat].split(' ');
  $('emojiGrid').innerHTML = list.length
    ? list.map((e) => '<button type="button" data-e="' + e + '" class="h-10 text-2xl rounded-lg hover:bg-gray-100 flex items-center justify-center">' + e + '</button>').join('')
    : '<p class="col-span-full text-center text-sm text-gray-500 py-6">Belum ada emotikon terbaru.</p>';
}
function toggleEmoji(force) {
  const open = typeof force === 'boolean' ? force : $('emojiPanel').classList.contains('hidden');
  if (open) { $('attachMenu').classList.add('hidden'); renderEmoji(); }
  $('emojiPanel').classList.toggle('hidden', !open);
  $('btnEmoji').setAttribute('aria-expanded', String(open));
  $('btnEmoji').textContent = open ? '⌨️' : '😊';
}
function insertEmoji(e) {
  const t = $('msgInput'), s = t.selectionStart == null ? t.value.length : t.selectionStart, en = t.selectionEnd == null ? s : t.selectionEnd;
  t.value = t.value.slice(0, s) + e + t.value.slice(en);
  const p = s + e.length; t.setSelectionRange(p, p);
  autosize(); addRecent(e);
}

/* ---------- Refresh manual ---------- */
async function refreshChat() {
  const b = $('btnRefresh');
  if (!state.session || b.dataset.busy) return;
  b.dataset.busy = '1';
  const ic = b.querySelector('svg'); ic.classList.add('animate-spin');
  const t0 = Date.now();
  try {
    if (isAdmin()) await loadUsers();
    if (!isAdmin() || state.peer) { state.sig = ''; await loadMessages(true); }
    loadSettings();
    toast('Pesan diperbarui.');
  } catch (e) { toast(e.message, 'error'); }
  finally {
    setTimeout(() => { ic.classList.remove('animate-spin'); delete b.dataset.busy; }, Math.max(0, 600 - (Date.now() - t0)));
  }
}

/* ---------- Panggilan suara & video (ZEGOCLOUD UIKit Prebuilt) ---------- */
const CALL_RING_MS = 45000;
const callState = { cur: null, incoming: null, handled: new Set(), deep: null };
let ringCtx = null, ringTimer = null;
const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/* Nada dering (Web Audio API, tanpa file audio) */
function unlockAudio() {
  try { ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)(); if (ringCtx.state === 'suspended') ringCtx.resume(); } catch (e) {}
}
function ringOnce() {
  if (!ringCtx) return;
  const t = ringCtx.currentTime;
  [440, 480].forEach((f) => {
    const o = ringCtx.createOscillator(), g = ringCtx.createGain();
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ringCtx.destination);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.06); g.gain.setValueAtTime(0.12, t + 0.7); g.gain.linearRampToValueAtTime(0, t + 0.8);
    o.start(t); o.stop(t + 0.85);
  });
  if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
}
function startRing() { stopRing(); unlockAudio(); ringOnce(); ringTimer = setInterval(ringOnce, 2600); }
function stopRing() { if (ringTimer) clearInterval(ringTimer); ringTimer = null; if (navigator.vibrate) navigator.vibrate(0); }

/* Memulai panggilan keluar */
async function startCall(kind) {
  if (!state.session || (isAdmin() && !state.peer)) return;
  if (callState.cur || callState.incoming) { toast('Selesaikan panggilan yang sedang berlangsung.', 'error'); return; }
  if (!window.ZegoUIKitPrebuilt) { toast('Modul panggilan belum termuat. Periksa koneksi lalu muat ulang halaman.', 'error'); return; }
  unlockAudio();
  const btns = [$('btnCallAudio'), $('btnCallVideo')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    const r = await api('startCall', { kind, peer_id: isAdmin() ? state.peer.user_id : '' });
    enterCall({ room: r.room_id, kind, token: r.token, appId: r.app_id, name: isAdmin() ? state.peer.username : state.settings.site_name, dir: 'out' });
    state.sig = '';
  } catch (e) { toast(e.message, 'error'); }
  finally { btns.forEach((b) => { b.disabled = false; }); }
}

/* Masuk ke ruang panggilan aktif */
function enterCall(c) {
  const isVideo = c.kind === 'video';
  const cur = callState.cur = { room: c.room, kind: c.kind, name: c.name, dir: c.dir, zp: null, closed: false, joined: false, watching: false, watch: null, ringTimeout: null };
  $('callModal').classList.remove('hidden');
  $('callWait').textContent = c.dir === 'out' ? 'Memanggil ' + c.name + '…' : 'Menyambungkan…';
  $('callWait').classList.remove('hidden');
  try {
    const myName = isAdmin() ? state.settings.site_name : state.session.username;
    const kit = ZegoUIKitPrebuilt.generateKitTokenForProduction(c.appId, c.token, c.room, state.session.user_id, myName);
    const zp = ZegoUIKitPrebuilt.create(kit);
    cur.zp = zp;
    zp.joinRoom({
      container: $('callRoot'),
      scenario: { mode: ZegoUIKitPrebuilt.OneONoneCall },
      turnOnCameraWhenJoining: isVideo,
      turnOnMicrophoneWhenJoining: true,
      showMyCameraToggleButton: isVideo,
      showMyMicrophoneToggleButton: true,
      showAudioVideoSettingsButton: false,
      showScreenSharingButton: false,
      showTextChat: false,
      showUserList: false,
      showPreJoinView: false,
      showLayoutButton: false,
      showLeavingView: false,
      showRoomTimer: true,
      onUserJoin: () => { cur.joined = true; $('callWait').classList.add('hidden'); },
      onLeaveRoom: () => finishCall('ended'),
      onUserLeave: () => finishCall('ended')
    });
  } catch (e) {
    toast('Gagal memulai panggilan: ' + (e && e.message ? e.message : e), 'error');
    finishCall('missed');
    return;
  }
  if (c.dir === 'out') cur.ringTimeout = setTimeout(() => { if (!cur.joined && !cur.closed) { toast('Panggilan tidak dijawab.', 'error'); finishCall('missed'); } }, CALL_RING_MS);
  cur.watch = setInterval(watchCall, 3000);
}

/* Pantau status di server (ditolak / diakhiri pihak lain) */
async function watchCall() {
  const cur = callState.cur;
  if (!cur || cur.closed || cur.watching) return;
  cur.watching = true;
  try {
    const r = await api('getCall', { room_id: cur.room });
    if (cur.closed || !r.call) return;
    const st = r.call.status;
    if (st === 'answered') $('callWait').classList.add('hidden');
    else if (st === 'rejected') { toast('Panggilan ditolak.', 'error'); finishCall('ended'); }
    else if (st === 'missed' || st === 'ended') finishCall('ended');
  } catch (e) { /* abaikan gangguan jaringan sesaat */ }
  finally { cur.watching = false; }
}

/* Akhiri panggilan: matikan kamera/mikrofon, tutup layar, catat di server */
function finishCall(status) {
  const cur = callState.cur;
  if (!cur || cur.closed) return;
  cur.closed = true;
  clearInterval(cur.watch); clearTimeout(cur.ringTimeout);
  try { if (cur.zp) cur.zp.destroy(); } catch (e) {}
  $('callRoot').innerHTML = '';
  $('callModal').classList.add('hidden');
  $('callWait').classList.add('hidden');
  callState.cur = null;
  api('endCall', { room_id: cur.room, status }).catch(() => {}).finally(() => { state.sig = ''; tick(); });
}

/* Layar panggilan masuk */
function showIncoming(c) {
  if (callState.cur || callState.incoming || callState.handled.has(c.room_id)) return;
  callState.incoming = c;
  if (isAdmin()) $('incAvatar').src = avatar(c.caller_name); else setLogo($('incAvatar'), state.settings.logo_url);
  $('incName').textContent = c.caller_name;
  $('incLabel').textContent = c.kind === 'video' ? 'Panggilan Video Masuk...' : 'Panggilan Suara Masuk...';
  $('incomingCall').classList.remove('hidden'); $('incomingCall').classList.add('flex');
  startRing();
  c.timer = setTimeout(() => hideIncoming(true), CALL_RING_MS + 3000);
}
function hideIncoming(markHandled) {
  const c = callState.incoming;
  stopRing();
  $('incomingCall').classList.add('hidden'); $('incomingCall').classList.remove('flex');
  if (!c) return;
  clearTimeout(c.timer);
  if (markHandled) callState.handled.add(c.room_id);
  callState.incoming = null;
}
async function acceptCall() {
  const inc = callState.incoming;
  if (!inc) return;
  if (!window.ZegoUIKitPrebuilt) { toast('Modul panggilan belum termuat. Muat ulang halaman.', 'error'); return; }
  $('incAccept').disabled = true;
  try {
    const r = await api('joinCall', { room_id: inc.room_id });
    hideIncoming(true);
    enterCall({ room: inc.room_id, kind: r.kind || inc.kind, token: r.token, appId: r.app_id, name: inc.caller_name, dir: 'in' });
  } catch (e) { toast(e.message, 'error'); hideIncoming(true); }
  finally { $('incAccept').disabled = false; }
}
function rejectCall() {
  const inc = callState.incoming;
  if (!inc) return;
  hideIncoming(true);
  api('endCall', { room_id: inc.room_id, status: 'rejected' }).catch(() => {}).finally(() => { state.sig = ''; tick(); });
}
/* Dipanggil dari hasil polling (getMessages / getUsers) */
function handleCallPoll(c) {
  if (c && c.room_id) showIncoming(c);
  else if (callState.incoming) hideIncoming(true); // penelepon membatalkan / waktu habis
}
/* Dibuka dari ketukan notifikasi OneSignal: ?incoming_call=ROOM&call_type=video&caller_name=NAMA */
function readDeepLink() {
  const q = new URLSearchParams(location.search), room = q.get('incoming_call');
  if (!room) return;
  callState.deep = { room };
  history.replaceState(null, '', location.pathname + location.hash);
}
async function handleDeepLink() {
  const d = callState.deep;
  if (!d || !state.session) return;
  callState.deep = null;
  try {
    const c = (await api('getCall', { room_id: d.room })).call;
    if (c && c.incoming && c.status === 'ringing' && c.fresh) showIncoming({ room_id: c.room_id, kind: c.kind, caller_id: c.caller_id, caller_name: c.caller_name });
    else toast('Panggilan sudah berakhir.');
  } catch (e) {}
}
/* Kartu riwayat panggilan di chat */
function callBubble(m) {
  const mine = isMine(m), p = String(m.file_name || '').split('|');
  const video = p[0] === 'video', st = p[1] || 'ringing', dur = Number(p[3]) || 0;
  let label, bad = false;
  if (st === 'ended') label = dur > 0 ? 'Panggilan selesai · ' + fmtDur(dur) : 'Panggilan selesai';
  else if (st === 'answered') label = Date.now() - Date.parse(m.timestamp) > 3 * 3600 * 1000 ? 'Panggilan selesai' : 'Sedang berlangsung';
  else if (st === 'rejected') { label = 'Ditolak'; bad = true; }
  else if (st === 'missed') { label = mine ? 'Tidak dijawab' : 'Tidak terjawab'; bad = true; }
  else label = mine ? 'Memanggil…' : 'Panggilan masuk…';
  return '<div class="flex flex-col max-w-[85%] md:max-w-[65%] min-w-[210px] px-2.5 py-1.5 shadow-sm text-wa-ink rounded-2xl ' + (mine ? 'bg-wa-bubble rounded-tr-none' : 'bg-white rounded-tl-none') + '">' +
    '<div class="flex items-center gap-3 py-1"><span class="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 ' + (bad ? 'bg-red-100' : 'bg-black/10') + '">' + (video ? '📹' : '📞') + '</span>' +
    '<div class="min-w-0"><div class="font-semibold msg-text leading-snug">' + (video ? 'Panggilan video' : 'Panggilan suara') + '</div><div class="text-sm ' + (bad ? 'text-red-600' : 'text-gray-500') + '">' + label + '</div></div></div>' +
    '<div class="self-end text-[11px] text-gray-500 mt-0.5">' + timeStr(m.timestamp) + '</div></div>';
}

/* ---------- Polling ---------- */
function startPolling() { stopPolling(); tick(); state.timer = setInterval(tick, POLL_MS); }
function stopPolling() { if (state.timer) clearInterval(state.timer); state.timer = null; }
async function tick() {
  if (!state.session || document.hidden || state.polling) return;
  state.polling = true;
  try {
    if (isAdmin()) await loadUsers();
    if (!isAdmin() || state.peer) await loadMessages(state.sig === '' && !state.msgs.length);
  } catch (e) { /* diam: jaringan sementara putus */ }
  finally { state.polling = false; }
}

/* ---------- Pengaturan admin ---------- */
function openSettings() {
  $('setName').value = state.settings.site_name; $('setLogo').value = state.settings.logo_url || '';
  updatePreview();
  $('settingsModal').classList.remove('hidden'); $('settingsModal').classList.add('flex');
}
function closeSettings() { $('settingsModal').classList.add('hidden'); $('settingsModal').classList.remove('flex'); }
function updatePreview() {
  $('prevName').textContent = $('setName').value.trim() || 'Nama website';
  setLogo($('prevLogo'), $('setLogo').value.trim());
}
async function saveSettings() {
  const btn = $('setSave'), label = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spin spin-w"></span> Menyimpan';
  try {
    const r = await api('updateSettings', { site_name: $('setName').value.trim(), logo_url: $('setLogo').value.trim() });
    state.settings = r.settings; localStorage.setItem(LS_SETTINGS, JSON.stringify(r.settings));
    applySettings(); closeSettings(); toast('Pengaturan berhasil disimpan.');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- Push notification (OneSignal v16) ---------- */
function initPush() {
  if (!ONESIGNAL_APP_ID || ONESIGNAL_APP_ID.indexOf('ISI_') === 0) return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function (OneSignal) {
    try {
      await OneSignal.init({ appId: ONESIGNAL_APP_ID, serviceWorkerPath: 'sw.js', serviceWorkerParam: { scope: BASE_PATH }, allowLocalhostAsSecureOrigin: true, notifyButton: { enable: false } });
      state.os = OneSignal;
      OneSignal.User.PushSubscription.addEventListener('change', () => syncPush());
      syncPush(); checkNotifBanner();
    } catch (e) { console.warn('OneSignal gagal diinisialisasi', e); }
  });
}
async function syncPush() {
  const os = state.os;
  if (!os || !state.session) return;
  const sub = os.User.PushSubscription;
  // izin browser sudah "granted" tetapi langganan belum aktif -> aktifkan
  if ('Notification' in window && Notification.permission === 'granted' && !sub.optedIn && !state.optTried) {
    state.optTried = true;
    try { await sub.optIn(); } catch (e) {}
  }
  if (sub.id && sub.optedIn && sub.id !== state.lastPushId) {
    try { await api('saveOneSignalId', { onesignal_id: sub.id }); state.lastPushId = sub.id; } catch (e) {}
  }
}
function checkNotifBanner() {
  if (state.os && state.session && 'Notification' in window && Notification.permission === 'denied' && !sessionStorage.getItem('lsc_nd')) {
    sessionStorage.setItem('lsc_nd', '1');
    toast('Notifikasi diblokir browser. Klik ikon gembok di address bar → Notifikasi → Izinkan, lalu muat ulang.', 'error');
  }
  const show = !!(state.os && state.session && 'Notification' in window && Notification.permission === 'default' && !sessionStorage.getItem('lsc_nb'));
  $('notifBanner').classList.toggle('hidden', !show);
  $('notifBanner').classList.toggle('flex', show);
}
async function enableNotif() {
  try { await state.os.Notifications.requestPermission(); await state.os.User.PushSubscription.optIn(); await syncPush(); } catch (e) { toast('Notifikasi tidak dapat diaktifkan.', 'error'); }
  $('notifBanner').classList.add('hidden'); $('notifBanner').classList.remove('flex');
}

/* ---------- Instal PWA ---------- */
function initInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) { $('installBox').classList.remove('hidden'); $('iosHint').classList.remove('hidden'); }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); state.installEvt = e;
    $('installBox').classList.remove('hidden'); $('installBtn').classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => $('installBox').classList.add('hidden'));
  $('installBtn').addEventListener('click', async () => {
    if (!state.installEvt) return;
    state.installEvt.prompt(); await state.installEvt.userChoice;
    state.installEvt = null; $('installBox').classList.add('hidden');
  });
}

/* ---------- Event & inisialisasi ---------- */
function bind() {
  $('tabLogin').onclick = () => setMode('login');
  $('tabRegister').onclick = () => setMode('register');
  $('authForm').addEventListener('submit', onAuthSubmit);
  $('btnLogoutA').onclick = logout; $('btnLogoutU').onclick = logout;
  $('btnSettings').onclick = openSettings; $('btnSettingsU').onclick = openSettings;
  $('setClose').onclick = closeSettings; $('setCancel').onclick = closeSettings; $('setSave').onclick = saveSettings;
  $('setName').addEventListener('input', updatePreview); $('setLogo').addEventListener('input', updatePreview);
  $('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeSettings(); });
  $('searchUser').addEventListener('input', renderUsers);
  $('userList').addEventListener('click', (e) => { const b = e.target.closest('[data-uid]'); if (b) openChat(b.dataset.uid); });
  $('btnBack').onclick = () => { if (history.state && history.state.chat) history.back(); else closeChat(); };
  window.addEventListener('popstate', () => { if (state.peer) closeChat(); });
  $('btnAttach').onclick = (e) => { e.stopPropagation(); toggleEmoji(false); $('attachMenu').classList.toggle('hidden'); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#attachMenu')) $('attachMenu').classList.add('hidden'); });
  $('pickMedia').onclick = () => { $('attachMenu').classList.add('hidden'); $('fileMedia').click(); };
  $('pickDoc').onclick = () => { $('attachMenu').classList.add('hidden'); $('fileDoc').click(); };
  $('fileMedia').onchange = (e) => { const fs = Array.from(e.target.files); e.target.value = ''; pickFiles(fs); };
  $('fileDoc').onchange = (e) => { const fs = Array.from(e.target.files); e.target.value = ''; pickFiles(fs); };
  $('attachCancel').onclick = () => clearAttach();
  $('attachList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const it = state.files.find((x) => x.id === b.dataset.rm);
    if (it && it.thumb) URL.revokeObjectURL(it.thumb);
    state.files = state.files.filter((x) => x !== it); renderAttach();
  });
  $('btnSend').addEventListener('pointerdown', (e) => e.preventDefault());
  $('btnSend').onclick = send;
  $('msgInput').addEventListener('input', autosize);
  $('msgInput').addEventListener('keydown', (e) => {
    const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && desktop) { e.preventDefault(); send(); }
  });
  $('msgs').addEventListener('click', (e) => {
    const ua = e.target.closest('[data-up-act]');
    if (ua) { upAction(ua.dataset.upAct, ua.dataset.upId); return; }
    const act = e.target.closest('[data-act]');
    if (act) { fileAction(act).catch((x) => toast('Gagal memuat file: ' + x.message, 'error')); return; }
    const img = e.target.closest('[data-lightbox]');
    if (img && img.dataset.lightbox) openLightbox(img.dataset.lightbox, img.alt);
  });
  const closeLb = () => { $('lightbox').classList.add('hidden'); $('lightbox').classList.remove('flex'); $('lbImg').src = ''; };
  $('lbClose').onclick = closeLb;
  $('lbDl').onclick = () => { const s = $('lbImg').getAttribute('src') || '', n = $('lbDl').dataset.name; if (s.indexOf('blob:') === 0) saveUrl(s, n); else doDownload('', s, n); };
  $('lightbox').addEventListener('click', (e) => { if (e.target.id !== 'lbImg' && !e.target.closest('#lbDl')) closeLb(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLb(); closeSettings(); closePref(); toggleEmoji(false); } });
  $('btnRefresh').onclick = refreshChat;
  $('btnCallAudio').onclick = () => startCall('audio');
  $('btnCallVideo').onclick = () => startCall('video');
  $('incAccept').onclick = acceptCall;
  $('incReject').onclick = rejectCall;
  document.addEventListener('pointerdown', unlockAudio, { once: true }); // izin audio untuk nada dering
  $('btnEmoji').addEventListener('pointerdown', (e) => e.preventDefault()); // fokus ketikan tidak hilang
  $('btnEmoji').onclick = (e) => { e.stopPropagation(); toggleEmoji(); };
  $('emojiPanel').addEventListener('pointerdown', (e) => e.preventDefault());
  $('emojiPanel').addEventListener('click', (e) => {
    e.stopPropagation(); // tombol tab dirender ulang -> jangan dianggap klik di luar panel
    const c = e.target.closest('[data-cat]'); if (c) { emojiCat = c.dataset.cat; renderEmoji(); return; }
    const m = e.target.closest('[data-e]'); if (m) insertEmoji(m.dataset.e);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#emojiPanel') && !e.target.closest('#btnEmoji')) toggleEmoji(false); });
  $('notifOn').onclick = enableNotif;
  $('notifOff').onclick = () => { sessionStorage.setItem('lsc_nb', '1'); checkNotifBanner(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

(function init() {
  readDeepLink();
  loadPrefs(); applyPrefs(); bind(); bindPrefs(); initInstall(); initPush(); setMode('login');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: BASE_PATH }).catch(() => {});
  loadSettings();
  try { state.session = JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch (e) { state.session = null; }
  if (state.session && state.session.session_token) enterApp();
  else $('authView').classList.remove('hidden');
})();
