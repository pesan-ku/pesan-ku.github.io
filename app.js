/* =====================================================
 * KONFIGURASI — isi 2 nilai ini
 * ===================================================== */
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwVg-F9GXx9GIeiaHvr5OsdPeRbdV2HOs99_eD_Uxcb-WYDvkTqxA-T-VrKh2vxSWZFCw/exec';
const ONESIGNAL_APP_ID = '5bfaa819-83a3-47e7-9f0f-4f7c9467af1c';
/* ===================================================== */

const POLL_MS = 4000;
const MAX_FILE = 10 * 1024 * 1024;
const LS_SESSION = 'lsc_session';
const LS_SETTINGS = 'lsc_settings';
const BASE_PATH = location.pathname.replace(/[^/]*$/, '');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^(https?:|blob:)/i.test(u || '') ? u : '');
const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|avif)$/i, VID_EXT = /\.(mp4|webm|mov|m4v|3gp|ogv)$/i;

/* File di Drive yang tidak bisa dibagikan publik (file_url = "drive:ID") diambil lewat backend */
const driveCache = new Map(), driveMime = new Map();
function fetchDriveBlob(id) {
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
      const r = await api('getFile', { file_id: id });
      const bin = atob(r.data), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const mime = r.mime || 'application/octet-stream', blob = new Blob([arr], { type: mime });
      driveMime.set(id, mime);
      if (c) c.put(key, new Response(blob, { headers: { 'Content-Type': mime } })).catch(() => {});
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
async function downloadDrive(id, name) { saveUrl(await fetchDriveBlob(id), name); }
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
    const u = await fetchDriveBlob(did), mime = driveMime.get(did) || '';
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
  state.msgs = []; state.sig = ''; state.lastDay = ''; state.pending = [];
  $('msgs').innerHTML = '';
  clearAttach();
}
const peerKey = () => (isAdmin() ? (state.peer && state.peer.user_id) : 'me');
async function loadMessages(forceScroll) {
  const key = peerKey();
  const r = await api('getMessages', { peer_id: isAdmin() && state.peer ? state.peer.user_id : '' });
  if (key !== peerKey()) return; // pengguna sudah pindah percakapan
  const sig = r.messages.map((m) => m.msg_id + (m.is_read ? '1' : '0')).join(',');
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
  el.innerHTML = bubble(m);
  box.appendChild(el);
  hydrateDrive(el);
}
function bubble(m) {
  const mine = isMine(m), name = esc(m.file_name), raw = String(m.file_url || '');
  const did = raw.indexOf('drive:') === 0 ? raw.slice(6) : '';
  const url = did ? '' : esc(safeUrl(raw));
  let kind = m.file_type;
  if (did && kind === 'document') kind = IMG_EXT.test(m.file_name || '') ? 'image' : VID_EXT.test(m.file_name || '') ? 'video' : 'document';
  m = Object.assign({}, m, { file_type: kind });
  let media = '';
  if (did && kind === 'image') media = '<img data-drive="' + esc(did) + '" alt="' + name + '" class="animate-pulse bg-black/10 rounded-lg min-w-[160px] min-h-[120px] max-h-64 max-w-full object-cover cursor-pointer mb-1">';
  else if (did && kind === 'video') media = '<video controls preload="metadata" playsinline data-drive="' + esc(did) + '" class="rounded-lg w-full max-w-[280px] min-h-[120px] mb-1 bg-black"></video>';
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
async function send() {
  const text = $('msgInput').value.trim(), file = state.file;
  if (!text && !file) return;
  if (isAdmin() && !state.peer) return;
  if (state.busy) { toast('Tunggu, gambar sedang diproses.'); return; }
  const kind = !file ? 'text' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
  const tmp = { msg_id: 'tmp' + Date.now() + Math.random().toString(36).slice(2, 6), sender_id: isAdmin() ? 'admin' : state.session.user_id, text, file_type: kind, file_name: file ? file.name : '', file_url: file && kind === 'image' ? URL.createObjectURL(file) : '', timestamp: Date.now(), is_read: false, pending: true };
  const key = peerKey();
  let sent = null;
  state.pending.push(tmp);
  appendEl(tmp); scrollBottom();
  $('msgInput').value = ''; autosize(); clearAttach();
  toggleEmoji(false);
  try {
    const payload = { text, peer_id: isAdmin() ? state.peer.user_id : '' };
    if (file) payload.file = { name: file.name, mime: file.type || 'application/octet-stream', data: await toBase64(file) };
    const r = await api('sendMessage', payload);
    sent = r.message;
  } catch (e) {
    toast(file ? 'Upload gagal: ' + e.message : 'Pesan gagal terkirim: ' + e.message, 'error');
    if (text && !$('msgInput').value) { $('msgInput').value = text; autosize(); }
  } finally {
    state.pending = state.pending.filter((p) => p !== tmp);
    const el = $('msgs').querySelector('[data-id="' + tmp.msg_id + '"]'); if (el) el.remove();
    if (tmp.file_url) setTimeout(() => URL.revokeObjectURL(tmp.file_url), 3000);
    if (key === peerKey()) {
      if (sent) {
        // pengirim memakai salinan lokal -> tidak perlu mengunduh ulang filenya
        if (file && /^drive:/.test(sent.file_url)) {
          const id = sent.file_url.slice(6);
          driveCache.set(id, Promise.resolve(URL.createObjectURL(file))); driveMime.set(id, file.type || '');
        }
        if (!$('msgs').querySelector('[data-id="' + sent.msg_id + '"]')) { state.msgs.push(sent); appendEl(sent); scrollBottom(); }
      } else { try { state.sig = ''; await loadMessages(true); } catch (e) {} }
    }
  }
}
function autosize() {
  const t = $('msgInput'); t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 112) + 'px';
}

/* ---------- Lampiran ---------- */
async function pickFile(f0) {
  if (!f0) return;
  const isImg = f0.type.startsWith('image/');
  if (isImg ? f0.size > IMG_IN_MAX : f0.size > MAX_FILE) { toast('Ukuran file terlalu besar (maks. ' + (isImg ? '30' : '10') + ' MB).', 'error'); return; }
  let f = f0;
  if (isImg) {
    const my = state.pickId = (state.pickId || 0) + 1;
    state.busy = true;
    $('attachName').textContent = f0.name; $('attachSize').textContent = 'Mengompres gambar…';
    $('attachThumb').innerHTML = '<span class="spin"></span>';
    $('attachBar').classList.remove('hidden');
    f = await compressImage(f0);
    if (my !== state.pickId) return; // dibatalkan saat proses
    state.busy = false;
  }
  if (f.size > MAX_FILE) { toast('Ukuran file maksimal 10 MB.', 'error'); clearAttach(); return; }
  state.file = f;
  $('attachName').textContent = f.name; $('attachSize').textContent = fmtSize(f.size);
  const th = $('attachThumb');
  th.innerHTML = f.type.startsWith('image/') ? '<img class="w-full h-full object-cover" src="' + URL.createObjectURL(f) + '" alt="">' : (f.type.startsWith('video/') ? '🎥' : '📄');
  $('attachBar').classList.remove('hidden');
}
function clearAttach() {
  state.pickId = (state.pickId || 0) + 1; state.busy = false;
  state.file = null; $('fileMedia').value = ''; $('fileDoc').value = '';
  $('attachBar').classList.add('hidden'); $('attachThumb').innerHTML = '';
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
  $('fileMedia').onchange = (e) => pickFile(e.target.files[0]);
  $('fileDoc').onchange = (e) => pickFile(e.target.files[0]);
  $('attachCancel').onclick = clearAttach;
  $('btnSend').addEventListener('pointerdown', (e) => e.preventDefault());
  $('btnSend').onclick = send;
  $('msgInput').addEventListener('input', autosize);
  $('msgInput').addEventListener('keydown', (e) => {
    const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && desktop) { e.preventDefault(); send(); }
  });
  $('msgs').addEventListener('click', (e) => {
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
  loadPrefs(); applyPrefs(); bind(); bindPrefs(); initInstall(); initPush(); setMode('login');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: BASE_PATH }).catch(() => {});
  loadSettings();
  try { state.session = JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch (e) { state.session = null; }
  if (state.session && state.session.session_token) enterApp();
  else $('authView').classList.remove('hidden');
})();
