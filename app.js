// PrintCal – offline photo calendar maker. All data stays in this browser profile (IndexedDB).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Pro (Microsoft Store add-on via Digital Goods API) ----------
const FREE_PHOTOS = 3;
const FREE_EVENTS = 12;
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'printcal_pro';
const PRO_IDS = [PRO_SKU];
let STORE_URL = 'https://apps.microsoft.com/detail/9MWSF3JMP1GJ';
let proAvailable = false; // Pro limits apply only when the Store actually sells the add-on
let proSku = PRO_SKU;
let isPro = false;
try { isPro = localStorage.getItem('printcal-pro') === '1'; } catch (_) {}
const unlocked = () => isPro || !proAvailable;

async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}
function setPro(v) {
  isPro = v;
  try { localStorage.setItem('printcal-pro', v ? '1' : '0'); } catch (_) {}
  const b = $('proBtn');
  b.textContent = v ? '★ Pro' : '★ Get Pro';
  b.classList.toggle('is-pro', v);
  b.hidden = !proAvailable && !v;
  document.body.classList.toggle('unlocked', unlocked());
  if (typeof renderAll === 'function') renderAll();
}
async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    proAvailable = details.length > 0;
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    setPro(owned);
    return owned;
  } catch (_) { return isPro; }
}
function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }
async function openPro(reason) {
  proMessage(reason || '');
  const svc = await billing();
  if (!svc) {
    $('buyBtn').textContent = 'Get PrintCal on Microsoft Store';
    $('restoreBtn').hidden = true;
  } else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}
async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); }
    catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkPro()) { proMessage('Thank you! Pro is unlocked. ★'); setTimeout(() => $('proDialog').close(), 1500); }
}
function needsPro(reason) {
  if (unlocked()) return false;
  openPro(reason);
  return true;
}

// ---------- data ----------
const COLORS = ['#9f1239', '#1d4ed8', '#166534', '#b45309', '#6d28d9', '#0f766e', '#374151'];
const defaultYear = () => { const d = new Date(); return d.getFullYear() + (d.getMonth() >= 8 ? 1 : 0); };
const blank = () => ({ year: defaultYear(), paper: 'letter', layout: 'photo', weekStart: 0, locale: 'en-US', font: 'sans', color: COLORS[0], usHolidays: true, events: [], photos: {} });
let cal = blank();
let cur = 0; // month shown
const photoCount = () => Object.keys(cal.photos).filter((k) => cal.photos[k]).length;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('printcal', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(k) { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbSet(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
let saveTimer = 0;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => dbSet('cal', cal).catch(() => toast('Could not save – your disk may be full')), 300); }

// ---------- dates ----------
const monthName = (m, style) => new Intl.DateTimeFormat(cal.locale, { month: style || 'long' }).format(new Date(2024, m, 1));
const weekdayName = (wd) => new Intl.DateTimeFormat(cal.locale, { weekday: 'short' }).format(new Date(2024, 0, 7 + wd)); // 7 Jan 2024 is a Sunday
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
function nth(y, m, wd, n) { // n-th weekday of a month; n = -1 for the last one
  if (n > 0) { const first = new Date(y, m, 1).getDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; }
  const last = daysIn(y, m); return last - ((new Date(y, m, last).getDay() - wd + 7) % 7);
}
function usHolidays(y) {
  const h = {};
  const add = (m, d, t) => { h[`${m}-${d}`] = t; };
  add(0, 1, "New Year's Day"); add(0, nth(y, 0, 1, 3), 'Martin Luther King Jr. Day'); add(1, 14, "Valentine's Day"); add(1, nth(y, 1, 1, 3), "Presidents' Day");
  add(4, nth(y, 4, 0, 2), "Mother's Day"); add(4, nth(y, 4, 1, -1), 'Memorial Day'); add(5, nth(y, 5, 0, 3), "Father's Day"); add(5, 19, 'Juneteenth');
  add(6, 4, 'Independence Day'); add(8, nth(y, 8, 1, 1), 'Labor Day'); add(9, nth(y, 9, 1, 2), 'Columbus Day'); add(9, 31, 'Halloween');
  add(10, 11, 'Veterans Day'); add(10, nth(y, 10, 4, 4), 'Thanksgiving'); add(11, 25, 'Christmas Day');
  return h;
}
const ICON = { b: '🎂 ', a: '♥ ', o: '' };

// ---------- drawing ----------
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)).trimEnd() + '…' : s);
function pageSize(landscape) {
  const [w, h] = cal.paper === 'a4' ? [595, 842] : [612, 792];
  return landscape ? [h, w] : [w, h];
}
function gridSvg(m, x, y, w, h) {
  const Y = cal.year, ws = cal.weekStart, first = (new Date(Y, m, 1).getDay() - ws + 7) % 7, n = daysIn(Y, m);
  const rows = Math.ceil((first + n) / 7), headH = 20, cw = w / 7, ch = (h - headH) / rows;
  const hol = cal.usHolidays ? usHolidays(Y) : {};
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${headH}" fill="${cal.color}"/>`;
  for (let i = 0; i < 7; i++) s += `<text x="${x + cw * i + cw / 2}" y="${y + 14}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${esc(cap(weekdayName((i + ws) % 7)).toUpperCase())}</text>`;
  const maxLines = Math.max(1, Math.floor((ch - 20) / 9.5)), maxChars = Math.floor(cw / 4.1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < 7; c++) {
    const d = r * 7 + c - first + 1, cx = x + c * cw, cy = y + headH + r * ch;
    const inMonth = d >= 1 && d <= n;
    s += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="${inMonth ? '#fff' : '#f3f4f6'}" stroke="#9ca3af" stroke-width=".6"/>`;
    if (!inMonth) continue;
    const wd = (c + ws) % 7, holiday = hol[`${m}-${d}`];
    const red = wd === 0 || holiday;
    s += `<text x="${cx + 5}" y="${cy + 15}" font-size="13" font-weight="700" fill="${red ? cal.color : '#111827'}">${d}</text>`;
    const lines = [];
    if (holiday) lines.push([holiday, cal.color]);
    cal.events.filter((e) => e.m === m && e.d === d).forEach((e) => lines.push([ICON[e.t] + e.text, '#111827']));
    lines.slice(0, maxLines).forEach((l, i) => {
      const more = i === maxLines - 1 && lines.length > maxLines;
      s += `<text x="${cx + 4}" y="${cy + 27 + i * 9.5}" font-size="7.6" fill="${l[1]}">${esc(more ? `+${lines.length - i} more` : clip(l[0], maxChars))}</text>`;
    });
  }
  return s + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#6b7280" stroke-width="1"/>`;
}
function landscapePic(m, x, y, w, h) { // placeholder shown (and printed) when a month has no photo
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${cal.color}"/><text x="${x + w / 2}" y="${y + h / 2 + 22}" text-anchor="middle" font-size="64" font-weight="700" fill="#fff" opacity=".92">${esc(cap(monthName(m)))}</text>`;
}
const fontFamily = () => (cal.font === 'serif' ? 'Georgia, Cambria, serif' : 'Segoe UI, system-ui, sans-serif');
function monthSvg(m, forScreen) {
  const land = cal.layout === 'grid', [W, H] = pageSize(land), M = 30;
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  if (land) {
    body += `<text x="${M}" y="${M + 34}" font-size="40" font-weight="700" fill="${cal.color}">${esc(cap(monthName(m)))}</text><text x="${W - M}" y="${M + 34}" text-anchor="end" font-size="40" font-weight="300" fill="#6b7280">${cal.year}</text>`;
    body += gridSvg(m, M, M + 52, W - 2 * M, H - 2 * M - 52);
  } else {
    const ph = Math.round(H * 0.44);
    const photo = cal.photos[m];
    if (photo) body += `<clipPath id="pc${m}"><rect x="${M}" y="${M}" width="${W - 2 * M}" height="${ph}"/></clipPath><image href="${photo}" x="${M}" y="${M}" width="${W - 2 * M}" height="${ph}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pc${m})"/>`;
    else body += landscapePic(m, M, M, W - 2 * M, ph) + (forScreen ? `<text x="${W / 2}" y="${M + ph - 24}" text-anchor="middle" font-size="13" fill="#fff" opacity=".9">Add a photo for this month with the button on the left</text>` : '');
    const ty = M + ph + 40;
    body += `<text x="${M}" y="${ty}" font-size="32" font-weight="700" fill="${cal.color}">${esc(cap(monthName(m)))}</text><text x="${W - M}" y="${ty}" text-anchor="end" font-size="32" font-weight="300" fill="#6b7280">${cal.year}</text>`;
    body += gridSvg(m, M, ty + 14, W - 2 * M, H - M - ty - 14);
  }
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${fontFamily()}">${body}</svg>` };
}
function yearSvg() {
  const [W, H] = pageSize(false), M = 34, Y = cal.year, ws = cal.weekStart;
  const hol = cal.usHolidays ? usHolidays(Y) : {};
  let body = `<rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="${M + 40}" text-anchor="middle" font-size="46" font-weight="700" fill="${cal.color}">${Y}</text>`;
  const top = M + 62, bw = (W - 2 * M) / 3, bh = (H - top - M) / 4;
  for (let m = 0; m < 12; m++) {
    const x = M + (m % 3) * bw + 8, y = top + Math.floor(m / 3) * bh + 6, cw = (bw - 16) / 7;
    body += `<text x="${x}" y="${y + 13}" font-size="14" font-weight="700" fill="${cal.color}">${esc(cap(monthName(m)))}</text>`;
    for (let i = 0; i < 7; i++) body += `<text x="${x + cw * i + cw / 2}" y="${y + 30}" text-anchor="middle" font-size="7.5" fill="#6b7280">${esc(cap(weekdayName((i + ws) % 7)).slice(0, 2))}</text>`;
    const first = (new Date(Y, m, 1).getDay() - ws + 7) % 7;
    for (let d = 1; d <= daysIn(Y, m); d++) {
      const k = first + d - 1, cx = x + (k % 7) * cw + cw / 2, cy = y + 45 + Math.floor(k / 7) * 15.5;
      const mark = cal.events.some((e) => e.m === m && e.d === d), red = hol[`${m}-${d}`] || (k % 7 + ws) % 7 === 0;
      if (mark) body += `<circle cx="${cx}" cy="${cy - 3.6}" r="8" fill="${cal.color}"/>`;
      body += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="10" font-weight="${mark ? 700 : 400}" fill="${mark ? '#fff' : red ? cal.color : '#111827'}">${d}</text>`;
    }
  }
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${fontFamily()}">${body}</svg>` };
}

// ---------- UI ----------
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000); }
function renderPage() { $('page').innerHTML = monthSvg(cur, true).svg; }
function renderMonths() {
  const el = $('months');
  el.textContent = '';
  for (let m = 0; m < 12; m++) {
    const b = document.createElement('button');
    b.textContent = cap(monthName(m, 'short')).replace('.', '');
    b.className = (m === cur ? 'on' : '') + (cal.photos[m] ? ' has' : '');
    b.onclick = () => { cur = m; renderAll(); };
    el.append(b);
  }
}
function renderEvents() {
  const ul = $('events');
  ul.textContent = '';
  [...cal.events].sort((a, b) => a.m - b.m || a.d - b.d).forEach((e) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="when">${esc(cap(monthName(e.m, 'short')).replace('.', ''))} ${e.d}</span><span class="txt">${esc(ICON[e.t] + e.text)}</span>`;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'Remove';
    x.onclick = () => { cal.events = cal.events.filter((q) => q !== e); renderAll(); save(); };
    li.append(x);
    ul.append(li);
  });
  const n = cal.events.length;
  $('countLine').textContent = n ? `${n} ${n === 1 ? 'entry' : 'entries'}` + (unlocked() ? '' : ` · free version holds ${FREE_EVENTS}`) : 'Nothing added yet. Birthdays and events appear in the calendar every year.';
}
function renderControls() {
  $('year').value = cal.year; $('paper').value = cal.paper; $('layout').value = cal.layout; $('weekStart').value = cal.weekStart; $('locale').value = cal.locale; $('font').value = cal.font; $('usHolidays').checked = cal.usHolidays;
  $('headline').textContent = `${cal.year} calendar`;
  const sw = $('swatches');
  sw.textContent = '';
  COLORS.forEach((c) => { const b = document.createElement('button'); b.style.background = c; b.title = 'Color'; b.className = c === cal.color ? 'on' : ''; b.onclick = () => { cal.color = c; renderAll(); save(); }; sw.append(b); });
  const em = $('evMonth'), keep = em.value === '' ? String(cur) : em.value;
  em.innerHTML = Array.from({ length: 12 }, (_, m) => `<option value="${m}">${esc(cap(monthName(m)))}</option>`).join('');
  em.value = keep;
  const has = !!cal.photos[cur], photoLayout = cal.layout === 'photo';
  $('photoHead').textContent = `Photo for ${cap(monthName(cur))}`;
  $('photoBtn').textContent = has ? 'Change photo' : 'Add a photo';
  $('photoBtn').disabled = !photoLayout;
  $('photoDel').hidden = !has;
  $('photoHint').textContent = !photoLayout ? 'This page style has no photo.' : unlocked() ? 'Each month can have its own photo.' : `Free version: ${photoCount()} of ${FREE_PHOTOS} photos used.`;
}
function renderAll() { renderControls(); renderMonths(); renderEvents(); renderPage(); }

function pickFile(accept, cb) { const i = $('fileIn'); i.accept = accept; i.value = ''; i.onchange = () => { if (i.files[0]) cb(i.files[0]); }; i.click(); }
function shrinkPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture'); rej(new Error('bad image')); };
    img.src = url;
  });
}
function addEvent(m, d, t, text) {
  if (cal.events.length >= FREE_EVENTS && needsPro(`The free version holds ${FREE_EVENTS} birthdays and events. Unlock Pro to add as many as you like.`)) return false;
  cal.events.push({ m, d, t, text });
  return true;
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); toast(`Saved ${name} to your Downloads folder`); }
function printPages(pages) {
  const landscape = pages[0].w > pages[0].h;
  $('pageRule').textContent = `@page { size: ${cal.paper === 'a4' ? 'A4' : 'letter'} ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
  $('printArea').innerHTML = pages.map((p) => p.svg.replace(/ width="[\d.]+" height="[\d.]+"/, ' preserveAspectRatio="xMidYMid meet"')).join('');
  window.print();
}
async function savePicture() {
  const p = monthSvg(cur, false), img = new Image(), url = URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'), k = 3;
  c.width = p.w * k; c.height = p.h * k;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => download(b, `calendar-${cal.year}-${String(cur + 1).padStart(2, '0')}.png`), 'image/png');
}
function samplePhoto(m) { // a simple drawn landscape, so the sample works without any files
  const c = document.createElement('canvas'); c.width = 1200; c.height = 760;
  const x = c.getContext('2d'), sky = [['#93c5fd', '#e0f2fe'], ['#a5b4fc', '#e0e7ff'], ['#7dd3fc', '#ecfeff'], ['#86efac', '#f0fdf4'], ['#67e8f9', '#fef9c3'], ['#38bdf8', '#fef3c7'], ['#0ea5e9', '#fde68a'], ['#38bdf8', '#fed7aa'], ['#fdba74', '#fef3c7'], ['#fb923c', '#fde68a'], ['#94a3b8', '#e2e8f0'], ['#60a5fa', '#f1f5f9']][m];
  const g = x.createLinearGradient(0, 0, 0, 760); g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]); x.fillStyle = g; x.fillRect(0, 0, 1200, 760);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(220 + m * 60, 170, 70, 0, 7); x.fill();
  const hill = (col, y0, amp, ph) => { x.fillStyle = col; x.beginPath(); x.moveTo(0, 760); for (let i = 0; i <= 1200; i += 20) x.lineTo(i, y0 + Math.sin(i / 190 + ph) * amp + Math.sin(i / 70 + ph * 2) * amp * 0.25); x.lineTo(1200, 760); x.fill(); };
  const cold = m <= 1 || m === 11, fall = m >= 8 && m <= 10;
  hill(cold ? '#cbd5e1' : fall ? '#d97706' : '#4ade80', 470, 70, m); hill(cold ? '#e2e8f0' : fall ? '#b45309' : '#22c55e', 560, 50, m * 2 + 1); hill(cold ? '#f8fafc' : fall ? '#92400e' : '#15803d', 650, 36, m * 3 + 2);
  return c.toDataURL('image/jpeg', 0.85);
}
function loadSample() {
  cal = blank();
  [[0, 14, 'b', 'Grandpa Walter'], [1, 3, 'b', 'Emma'], [2, 21, 'a', 'John & Mary'], [4, 9, 'b', 'Mary'], [5, 18, 'b', 'Noah'], [6, 12, 'o', 'Family reunion'], [7, 2, 'b', 'Sophie'], [8, 27, 'b', 'David'], [9, 16, 'b', 'Grandma Rose'], [10, 8, 'b', 'Ava'], [11, 24, 'o', 'Dinner at our house']].forEach((e) => cal.events.push({ m: e[0], d: e[1], t: e[2], text: e[3] }));
  for (let m = 0; m < 12; m++) cal.photos[m] = samplePhoto(m);
  cur = 0;
}
function kinleafBirthdays(d) {
  const out = [];
  Object.values((d.tree || {}).people || {}).forEach((p) => {
    if (p.deceased || !p.birth) return;
    const s = String(p.birth).trim();
    if (/^\d{4}$/.test(s)) return; // a year alone has no day
    const t = new Date(/^\d{1,2}\s+[A-Za-z]/.test(s) || /[A-Za-z]/.test(s) ? s : s.replace(/-/g, '/'));
    if (isNaN(t)) return;
    out.push({ m: t.getMonth(), d: t.getDate(), t: 'b', text: [p.first, p.last].filter(Boolean).join(' ').slice(0, 40) });
  });
  return out;
}

// ---------- wiring ----------
const setOpt = (id, key, conv) => $(id).addEventListener('change', (e) => { cal[key] = conv ? conv(e.target.value) : e.target.value; renderAll(); save(); });
setOpt('paper', 'paper'); setOpt('layout', 'layout'); setOpt('weekStart', 'weekStart', Number); setOpt('locale', 'locale'); setOpt('font', 'font');
$('usHolidays').onchange = (e) => { cal.usHolidays = e.target.checked; renderAll(); save(); };
$('year').addEventListener('change', () => { const y = parseInt($('year').value, 10); if (y >= 1900 && y <= 2200) cal.year = y; renderAll(); save(); });
$('prev').onclick = () => { cur = (cur + 11) % 12; $('evMonth').value = ''; renderAll(); };
$('next').onclick = () => { cur = (cur + 1) % 12; $('evMonth').value = ''; renderAll(); };
$('photoBtn').onclick = () => {
  if (!cal.photos[cur] && photoCount() >= FREE_PHOTOS && needsPro(`The free version holds ${FREE_PHOTOS} photos. Unlock Pro to give every month its own photo.`)) return;
  pickFile('image/*', async (f) => { cal.photos[cur] = await shrinkPhoto(f); renderAll(); save(); });
};
$('photoDel').onclick = () => { delete cal.photos[cur]; renderAll(); save(); };
$('evAdd').onclick = () => {
  const m = Number($('evMonth').value), d = parseInt($('evDay').value, 10), text = $('evText').value.trim();
  if (!(d >= 1 && d <= daysIn(2024, m))) { $('evDay').focus(); toast('Type the day of the month, for example 14'); return; }
  if (!text) { $('evText').focus(); return; }
  if (!addEvent(m, d, $('evType').value, text)) return;
  $('evText').value = ''; $('evDay').value = '';
  cur = m; renderAll(); save();
  $('evDay').focus();
};
$('evText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('evAdd').click(); });
$('printOne').onclick = () => printPages([monthSvg(cur, false)]);
$('printAll').onclick = () => printPages(Array.from({ length: 12 }, (_, m) => monthSvg(m, false)));
$('imgBtn').onclick = savePicture;
$('moreBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('click', () => { $('menu').hidden = true; });
$('yearBtn').onclick = () => { if (!needsPro('The one-page year planner is part of Pro.')) printPages([yearSvg()]); };
$('backupBtn').onclick = () => download(new Blob([JSON.stringify({ app: 'printcal', v: 1, cal })], { type: 'application/json' }), `calendar-${cal.year}.printcal.json`);
$('restoreFileBtn').onclick = () => pickFile('.json,application/json', async (f) => {
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'printcal' || !d.cal || !Array.isArray(d.cal.events)) throw new Error('not a backup');
    if (!confirm('Replace the calendar on screen with the one from this backup file?')) return;
    cal = Object.assign(blank(), d.cal); cur = 0; renderAll(); save(); toast('Backup opened');
  } catch (_) { toast('That file is not a PrintCal backup'); }
});
$('kinBtn').onclick = () => pickFile('.json,application/json', async (f) => {
  let list = [];
  try { const d = JSON.parse(await f.text()); if (d.app !== 'kinleaf') throw new Error('x'); list = kinleafBirthdays(d); } catch (_) { toast('That file is not a Kinleaf backup'); return; }
  list = list.filter((b) => !cal.events.some((e) => e.m === b.m && e.d === b.d && e.text === b.text));
  if (!list.length) { toast('No new birthdays with a full date were found in that family tree'); return; }
  let added = 0;
  for (const b of list) { if (!addEvent(b.m, b.d, 'b', b.text)) break; added++; }
  renderAll(); save();
  if (added) toast(`Added ${added} birthday${added === 1 ? '' : 's'} from your family tree`);
});
$('sampleBtn').onclick = () => { if (!confirm('Replace the calendar on screen with the sample? Save a backup first if you want to keep it.')) return; loadSample(); renderAll(); save(); };
$('clearBtn').onclick = () => { if (!confirm('Remove all photos and events and start a new calendar? Save a backup first if you want to keep this one.')) return; cal = blank(); cur = 0; renderAll(); save(); };
$('proBtn').onclick = () => { if (!isPro) openPro(); };
$('buyBtn').onclick = buyPro;
$('restoreBtn').onclick = async () => { proMessage((await checkPro()) ? 'Pro restored. ★' : 'No Pro purchase found on this Microsoft account.'); };
$('closePro').onclick = () => $('proDialog').close();

(async () => {
  try { const c = await dbGet('cal'); if (c && Array.isArray(c.events)) cal = Object.assign(blank(), c); } catch (_) {}
  cur = cal.year === new Date().getFullYear() ? new Date().getMonth() : 0;
  setPro(isPro);
  renderAll();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  checkPro();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
