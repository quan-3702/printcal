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
const blank = () => ({ year: defaultYear(), start: 0, paper: 'letter', layout: 'photo', weekStart: 0, locale: 'en-US', font: 'sans', color: COLORS[0], holidays: 'US', lunar: false, events: [], photos: {}, photoPos: {}, collage: {}, make: 'calendar', card: { occ: 'christmas', greet: 'Merry Christmas', custom: '', msg: 'Wishing you joy, peace and love this holiday season', sign: 'Love, The Carter Family', year: true, theme: 'holly', lay: 'left' }, tags: { to: '', from: '' } });
function upgrade(c) { // older saved calendars
  const o = Object.assign(blank(), c);
  if (c && c.holidays == null) o.holidays = c.usHolidays === false ? 'none' : 'US';
  if (!o.photoPos) o.photoPos = {};
  if (!o.collage) o.collage = {};
  o.card = Object.assign(blank().card, c && c.card); o.tags = Object.assign(blank().tags, c && c.tags);
  delete o.usHolidays;
  return o;
}
let cal = blank();
let cur = 0; // month shown
// a month page can hold 1–4 photos; the first is stored under the month number, the others as "month.frame"
const fkey = (m, j) => (j ? `${m}.${j}` : String(m));
const nFrames = (m) => Math.max(1, Math.min(4, cal.collage[m] || 1));
const photoCount = () => { let n = 0; for (let m = 0; m < 12; m++) for (let j = 0; j < nFrames(m); j++) if (cal.photos[fkey(m, j)]) n++; return n; };
let curFrame = 0;

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
// ---------- lunar calendar (Vietnamese / Chinese), after Ho Ngoc Duc's public algorithm ----------
const INT = Math.floor;
function jdFromDate(dd, mm, yy) {
  const a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}
function newMoon(k) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = Math.PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return Jd1 + C1 - deltat;
}
function sunLongitude(jdn) {
  const T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = Math.PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  return L - Math.PI * 2 * INT(L / (Math.PI * 2));
}
const sunLong = (dayNumber, tz) => INT(sunLongitude(dayNumber - 0.5 - tz / 24) / Math.PI * 6);
const newMoonDay = (k, tz) => INT(newMoon(k) + 0.5 + tz / 24);
function lunarMonth11(yy, tz) {
  const off = jdFromDate(31, 12, yy) - 2415021, k = INT(off / 29.530588853);
  let nm = newMoonDay(k, tz);
  if (sunLong(nm, tz) >= 9) nm = newMoonDay(k - 1, tz);
  return nm;
}
function leapMonthOffset(a11, tz) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last, i = 1, arc = sunLong(newMoonDay(k + i, tz), tz);
  do { last = arc; i++; arc = sunLong(newMoonDay(k + i, tz), tz); } while (arc !== last && i < 14);
  return i - 1;
}
const lunarCache = new Map();
// Solar date (month 1-12) -> [lunar day, lunar month, lunar year, leap 0/1]
function toLunar(dd, mm, yy, tz) {
  const key = `${yy}-${mm}-${dd}-${tz}`;
  if (lunarCache.has(key)) return lunarCache.get(key);
  const dayNumber = jdFromDate(dd, mm, yy), k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = newMoonDay(k + 1, tz);
  if (monthStart > dayNumber) monthStart = newMoonDay(k, tz);
  let a11 = lunarMonth11(yy, tz), b11 = a11, lunarYear;
  if (a11 >= monthStart) { lunarYear = yy; a11 = lunarMonth11(yy - 1, tz); } else { lunarYear = yy + 1; b11 = lunarMonth11(yy + 1, tz); }
  const lunarDay = dayNumber - monthStart + 1, diff = INT((monthStart - a11) / 29);
  let leap = 0, lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const lmd = leapMonthOffset(a11, tz);
    if (diff >= lmd) { lunarMonth = diff + 10; if (diff === lmd) leap = 1; }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  const r = [lunarDay, lunarMonth, lunarYear, leap];
  lunarCache.set(key, r);
  return r;
}

// ---------- public holidays and special days ----------
function easter(y) { // Gregorian computus -> [month 0-11, day]
  const a = y % 19, b = INT(y / 100), c = y % 100, d = INT(b / 4), e = b % 4, f = INT((b + 8) / 25), g = INT((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = INT(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = INT((a + 11 * h + 22 * l) / 451);
  const mon = INT((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [mon - 1, day];
}
const HOLIDAY_SETS = [['none', 'No holidays'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['VN', 'Vietnam (with lunar holidays)']];
const holCache = new Map();
function holidays(country, y) {
  const key = country + y;
  if (holCache.has(key)) return holCache.get(key);
  const h = {};
  const add = (m, d, t) => { const k = `${m}-${d}`; h[k] = h[k] ? h[k] + ' · ' + t : t; };
  const [em, ed] = easter(y);
  const fromEaster = (n, t) => { const dt = new Date(y, em, ed + n); add(dt.getMonth(), dt.getDate(), t); };
  if (country === 'US') {
    add(0, 1, "New Year's Day"); add(0, nth(y, 0, 1, 3), 'Martin Luther King Jr. Day'); add(1, 14, "Valentine's Day"); add(1, nth(y, 1, 1, 3), "Presidents' Day");
    fromEaster(0, 'Easter'); add(4, nth(y, 4, 0, 2), "Mother's Day"); add(4, nth(y, 4, 1, -1), 'Memorial Day'); add(5, nth(y, 5, 0, 3), "Father's Day"); add(5, 19, 'Juneteenth');
    add(6, 4, 'Independence Day'); add(8, nth(y, 8, 1, 1), 'Labor Day'); add(9, nth(y, 9, 1, 2), 'Columbus Day'); add(9, 31, 'Halloween');
    add(10, 11, 'Veterans Day'); add(10, nth(y, 10, 4, 4), 'Thanksgiving'); add(11, 25, 'Christmas Day');
  } else if (country === 'GB') {
    add(0, 1, "New Year's Day"); add(1, 14, "Valentine's Day"); fromEaster(-21, "Mother's Day"); fromEaster(-2, 'Good Friday'); fromEaster(0, 'Easter Sunday'); fromEaster(1, 'Easter Monday');
    add(4, nth(y, 4, 1, 1), 'Early May bank holiday'); add(4, nth(y, 4, 1, -1), 'Spring bank holiday'); add(5, nth(y, 5, 0, 3), "Father's Day"); add(7, nth(y, 7, 1, -1), 'Summer bank holiday');
    add(9, 31, 'Halloween'); add(10, 5, 'Bonfire Night'); add(10, nth(y, 10, 0, 2), 'Remembrance Sunday'); add(11, 25, 'Christmas Day'); add(11, 26, 'Boxing Day');
  } else if (country === 'CA') {
    add(0, 1, "New Year's Day"); add(1, 14, "Valentine's Day"); add(1, nth(y, 1, 1, 3), 'Family Day'); fromEaster(-2, 'Good Friday'); fromEaster(0, 'Easter Sunday');
    add(4, nth(y, 4, 0, 2), "Mother's Day"); { const d25 = new Date(y, 4, 24); add(4, 24 - ((d25.getDay() + 6) % 7), 'Victoria Day'); } add(5, nth(y, 5, 0, 3), "Father's Day");
    add(6, 1, 'Canada Day'); add(7, nth(y, 7, 1, 1), 'Civic Holiday'); add(8, nth(y, 8, 1, 1), 'Labour Day'); add(8, 30, 'Truth and Reconciliation Day'); add(9, nth(y, 9, 1, 2), 'Thanksgiving');
    add(9, 31, 'Halloween'); add(10, 11, 'Remembrance Day'); add(11, 25, 'Christmas Day'); add(11, 26, 'Boxing Day');
  } else if (country === 'AU') {
    add(0, 1, "New Year's Day"); add(0, 26, 'Australia Day'); add(1, 14, "Valentine's Day"); fromEaster(-2, 'Good Friday'); fromEaster(-1, 'Easter Saturday'); fromEaster(0, 'Easter Sunday'); fromEaster(1, 'Easter Monday');
    add(3, 25, 'Anzac Day'); add(4, nth(y, 4, 0, 2), "Mother's Day"); add(5, nth(y, 5, 1, 2), "King's Birthday"); add(8, nth(y, 8, 0, 1), "Father's Day"); add(9, 31, 'Halloween');
    add(11, 25, 'Christmas Day'); add(11, 26, 'Boxing Day');
  } else if (country === 'DE') {
    add(0, 1, 'Neujahr'); add(1, 14, 'Valentinstag'); fromEaster(-48, 'Rosenmontag'); fromEaster(-2, 'Karfreitag'); fromEaster(0, 'Ostersonntag'); fromEaster(1, 'Ostermontag');
    add(4, 1, 'Tag der Arbeit'); add(4, nth(y, 4, 0, 2), 'Muttertag'); fromEaster(39, 'Christi Himmelfahrt'); fromEaster(49, 'Pfingstsonntag'); fromEaster(50, 'Pfingstmontag');
    add(9, 3, 'Tag der Deutschen Einheit'); add(9, 31, 'Halloween'); add(11, 6, 'Nikolaus'); add(11, 24, 'Heiligabend'); add(11, 25, '1. Weihnachtstag'); add(11, 26, '2. Weihnachtstag'); add(11, 31, 'Silvester');
  } else if (country === 'FR') {
    add(0, 1, "Jour de l'An"); add(0, 6, 'Épiphanie'); add(1, 14, 'Saint-Valentin'); fromEaster(0, 'Pâques'); fromEaster(1, 'Lundi de Pâques'); add(4, 1, 'Fête du Travail'); add(4, 8, 'Victoire 1945');
    fromEaster(39, 'Ascension'); fromEaster(49, 'Pentecôte'); fromEaster(50, 'Lundi de Pentecôte');
    { let d = nth(y, 4, 0, -1); const p = new Date(y, em, ed + 49); if (p.getMonth() === 4 && p.getDate() === d) { const n = new Date(y, 4, d + 7); add(n.getMonth(), n.getDate(), 'Fête des mères'); } else add(4, d, 'Fête des mères'); }
    add(5, nth(y, 5, 0, 3), 'Fête des pères'); add(6, 14, 'Fête nationale'); add(7, 15, 'Assomption'); add(10, 1, 'Toussaint'); add(10, 11, 'Armistice 1918'); add(11, 25, 'Noël');
  } else if (country === 'ES') {
    add(0, 1, 'Año Nuevo'); add(0, 6, 'Reyes Magos'); add(1, 14, 'San Valentín'); fromEaster(-3, 'Jueves Santo'); fromEaster(-2, 'Viernes Santo'); fromEaster(0, 'Pascua');
    add(4, 1, 'Día del Trabajo'); add(4, nth(y, 4, 0, 1), 'Día de la Madre'); add(2, 19, 'Día del Padre'); add(7, 15, 'Asunción'); add(9, 12, 'Fiesta Nacional');
    add(10, 1, 'Todos los Santos'); add(11, 6, 'Día de la Constitución'); add(11, 8, 'Inmaculada Concepción'); add(11, 24, 'Nochebuena'); add(11, 25, 'Navidad'); add(11, 31, 'Nochevieja');
  } else if (country === 'VN') {
    add(0, 1, 'Tết Dương lịch'); add(1, 14, 'Valentine'); add(2, 8, 'Quốc tế Phụ nữ'); add(3, 30, 'Giải phóng miền Nam'); add(4, 1, 'Quốc tế Lao động'); add(5, 1, 'Quốc tế Thiếu nhi');
    add(8, 2, 'Quốc khánh'); add(9, 20, 'Phụ nữ Việt Nam'); add(10, 20, 'Nhà giáo Việt Nam'); add(11, 22, 'Quân đội Nhân dân'); add(11, 24, 'Giáng sinh');
    const L = { '1-1': 'Mùng 1 Tết', '2-1': 'Mùng 2 Tết', '3-1': 'Mùng 3 Tết', '15-1': 'Rằm tháng Giêng', '10-3': 'Giỗ Tổ Hùng Vương', '15-4': 'Lễ Phật đản', '5-5': 'Tết Đoan Ngọ', '15-7': 'Lễ Vu Lan', '15-8': 'Tết Trung thu', '23-12': 'Ông Công Ông Táo' };
    for (let m = 0; m < 12; m++) for (let d = 1; d <= daysIn(y, m); d++) {
      const [ld, lm, , leap] = toLunar(d, m + 1, y, 7);
      if (leap) continue;
      const t = L[`${ld}-${lm}`];
      if (t) add(m, d, t);
      if (lm === 12) { const nx = new Date(y, m, d + 1), [nd] = toLunar(nx.getDate(), nx.getMonth() + 1, nx.getFullYear(), 7); if (nd === 1) add(m, d, 'Giao thừa'); }
    }
  }
  holCache.set(key, h);
  return h;
}

// The 12 pages can start in any month (e.g. a school year from September).
const slot = (i) => { const k = cal.start + i; return { y: cal.year + INT(k / 12), m: k % 12 }; };
const slotOf = (m) => (m - cal.start + 12) % 12;
const lunarTz = () => (cal.holidays === 'VN' || cal.locale === 'vi' ? 7 : 8);
const spanTitle = () => (cal.start ? `${cal.year}–${cal.year + 1}` : String(cal.year));
const ICON = { b: '🎂 ', a: '♥ ', o: '' };

// ---------- drawing ----------
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)).trimEnd() + '…' : s);
const PAPER = { letter: ['letter', [612, 792]], a4: ['A4', [595, 842]], a3: ['A3', [595, 842]], a5: ['A5', [595, 842]], tabloid: ['11in 17in', [612, 947]] };
function pageSize(landscape) {
  const [w, h] = (PAPER[cal.paper] || PAPER.letter)[1];
  return landscape ? [h, w] : [w, h];
}
function gridSvg(Y, m, x, y, w, h) {
  const ws = cal.weekStart, first = (new Date(Y, m, 1).getDay() - ws + 7) % 7, n = daysIn(Y, m);
  const rows = Math.ceil((first + n) / 7), headH = 20, cw = w / 7, ch = (h - headH) / rows;
  const hol = holidays(cal.holidays, Y), tz = lunarTz();
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
    if (cal.lunar) {
      const [ld, lm, , leap] = toLunar(d, m + 1, Y, tz);
      const first1 = ld === 1;
      s += `<text x="${cx + cw - 4}" y="${cy + 12}" text-anchor="end" font-size="${first1 ? 7.4 : 7}" font-weight="${first1 ? 700 : 400}" fill="${first1 ? cal.color : '#6b7280'}">${first1 ? `${ld}/${lm}${leap ? '*' : ''}` : ld}</text>`;
    }
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
function photoBox(m, x, y, w, h) {
  const p = cal.photoPos[m] || {}, ar = p.ar || 1.5, z = p.z || 1;
  let dw, dh;
  if (ar > w / h) { dh = h; dw = h * ar; } else { dw = w; dh = w / ar; }
  dw *= z; dh *= z;
  const px = p.x == null ? 0.5 : p.x, py = p.y == null ? 0.5 : p.y;
  return { x: x - (dw - w) * px, y: y - (dh - h) * py, w: dw, h: dh, fx: x, fy: y, fw: w, fh: h };
}
function frames(n, x, y, w, h) {
  const g = 6, hw = (w - g) / 2, hh = (h - g) / 2;
  if (n === 2) return [[x, y, hw, h], [x + hw + g, y, hw, h]];
  if (n === 3) { const bw = Math.round((w - g) * 0.6), sw = w - g - bw; return [[x, y, bw, h], [x + bw + g, y, sw, hh], [x + bw + g, y + hh + g, sw, hh]]; }
  if (n === 4) return [[x, y, hw, hh], [x + hw + g, y, hw, hh], [x, y + hh + g, hw, hh], [x + hw + g, y + hh + g, hw, hh]];
  return [[x, y, w, h]];
}
function photosSvg(m, x, y, w, h, forScreen, uid) {
  uid = uid || '';
  const n = nFrames(m);
  if (n === 1 && !cal.photos[fkey(m, 0)]) return landscapePic(m, x, y, w, h) + (forScreen ? `<rect class="photoAdd" data-j="0" x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" style="cursor:pointer"/><text x="${x + w / 2}" y="${y + h - 24}" text-anchor="middle" font-size="13" fill="#fff" opacity=".9" pointer-events="none">Click here or use the button on the left to add a photo</text>` : '');
  let s = '';
  frames(n, x, y, w, h).forEach(([fx, fy, fw, fh], j) => {
    const k = fkey(m, j), photo = cal.photos[k];
    if (photo) {
      const b = photoBox(k, fx, fy, fw, fh);
      s += `<clipPath id="pc${m}_${j}${uid}"><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}"/></clipPath><image href="${photo}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none" clip-path="url(#pc${m}_${j}${uid})"/>`;
      if (forScreen) s += `<rect class="photoHit" data-k="${k}" data-j="${j}" x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="transparent" style="cursor:move"/>`;
    } else {
      s += `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="${cal.color}" opacity=".16"/>`;
      if (forScreen) s += `<rect class="photoAdd" data-j="${j}" x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="transparent" stroke="${cal.color}" stroke-dasharray="6 5" style="cursor:pointer"/><text x="${fx + fw / 2}" y="${fy + fh / 2 + 5}" text-anchor="middle" font-size="14" fill="${cal.color}" pointer-events="none">+ Add a photo</text>`;
    }
    if (forScreen && n > 1 && j === curFrame) s += `<rect x="${fx + 1.5}" y="${fy + 1.5}" width="${fw - 3}" height="${fh - 3}" fill="none" stroke="#2563eb" stroke-width="3" pointer-events="none"/>`;
  });
  return s;
}
function landscapePic(m, x, y, w, h) { // placeholder shown (and printed) when a month has no photo
  if (m === 'card') { const t = theme(); return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${t.soft}" opacity=".25"/>` + decorations(x, y, w, h, h / 300) + `<text x="${x + w / 2}" y="${y + h / 2 + 6}" text-anchor="middle" font-size="${h / 18}" fill="${t.ink}" opacity=".75">Your photo here</text>`; }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${cal.color}"/><text x="${x + w / 2}" y="${y + h / 2 + 22}" text-anchor="middle" font-size="64" font-weight="700" fill="#fff" opacity=".92">${esc(cap(monthName(m)))}</text>`;
}
const fontFamily = () => (cal.font === 'serif' ? 'Georgia, Cambria, serif' : 'Segoe UI, system-ui, sans-serif');
function monthSvg(i, forScreen) {
  const { y: Y, m } = slot(i), land = cal.layout === 'grid', [W, H] = pageSize(land), M = 30;
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  if (land) {
    body += `<text x="${M}" y="${M + 34}" font-size="40" font-weight="700" fill="${cal.color}">${esc(cap(monthName(m)))}</text><text x="${W - M}" y="${M + 34}" text-anchor="end" font-size="40" font-weight="300" fill="#6b7280">${Y}</text>`;
    body += gridSvg(Y, m, M, M + 52, W - 2 * M, H - 2 * M - 52);
  } else {
    const ph = Math.round(H * 0.44);
    body += photosSvg(m, M, M, W - 2 * M, ph, forScreen);
    const ty = M + ph + 40;
    body += `<text x="${M}" y="${ty}" font-size="32" font-weight="700" fill="${cal.color}">${esc(cap(monthName(m)))}</text><text x="${W - M}" y="${ty}" text-anchor="end" font-size="32" font-weight="300" fill="#6b7280">${Y}</text>`;
    body += gridSvg(Y, m, M, ty + 14, W - 2 * M, H - M - ty - 14);
  }
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${fontFamily()}">${body}</svg>` };
}
function yearSvg() {
  const [W, H] = pageSize(false), M = 34, ws = cal.weekStart;
  let body = `<rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="${M + 40}" text-anchor="middle" font-size="46" font-weight="700" fill="${cal.color}">${spanTitle()}</text>`;
  const top = M + 62, bw = (W - 2 * M) / 3, bh = (H - top - M) / 4;
  for (let i = 0; i < 12; i++) {
    const { y: Y, m } = slot(i), hol = holidays(cal.holidays, Y);
    const x = M + (i % 3) * bw + 8, y = top + Math.floor(i / 3) * bh + 6, cw = (bw - 16) / 7;
    body += `<text x="${x}" y="${y + 13}" font-size="14" font-weight="700" fill="${cal.color}">${esc(cap(monthName(m)))}${cal.start ? ` <tspan font-weight="400" fill="#6b7280" font-size="11">${Y}</tspan>` : ''}</text>`;
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


// ---------- holiday photo cards and gift tags ----------
const nextClass = () => { const d = new Date(); return d.getFullYear() + (d.getMonth() >= 6 ? 1 : 0); };
const OCCASIONS = {
  christmas: { name: 'Christmas & holidays', greets: ['Merry Christmas', 'Happy Holidays', "Season's Greetings", 'Happy New Year', 'Merry Christmas & Happy New Year', 'Happy Hanukkah', 'Joyeux Noël', 'Feliz Navidad', 'Frohe Weihnachten', 'Buon Natale', 'Chúc mừng Giáng sinh', 'Chúc mừng năm mới'], msg: 'Wishing you joy, peace and love this holiday season', themes: ['holly', 'snow', 'evergreen', 'gold', 'kraft', 'night'] },
  birthday: { name: 'Birthday', greets: ['Happy Birthday', 'Happy 1st Birthday', 'Happy Birthday, Mom', 'Happy Birthday, Dad', 'Happy Birthday, Grandma', 'Happy Birthday, Grandpa', 'Feliz Cumpleaños', 'Joyeux Anniversaire', 'Chúc mừng sinh nhật'], msg: 'Wishing you a wonderful day and a year full of happy moments', themes: ['balloons', 'confetti', 'pastel', 'bnight'] },
  thanks: { name: 'Thank you', greets: ['Thank You', 'Thank You So Much', 'With Gratitude', 'Thanks a Bunch', 'Gracias', 'Merci', 'Cảm ơn'], msg: 'Thank you for your kindness – it meant so much to us', themes: ['greenery', 'kthanks', 'navy'] },
  wedding: { name: 'Wedding & anniversary', greets: ['Save the Date', 'Just Married', "We're Engaged!", 'Thank You', 'Happy Anniversary'], msg: 'Saturday, June 12 · Invitation to follow', themes: ['ivory', 'blush', 'eucalyptus', 'wgold'] },
  baby: { name: 'New baby', greets: ["It's a Boy!", "It's a Girl!", 'Welcome, Little One', 'Hello, World', 'Baby Shower', 'Thank You'], msg: 'Born March 3 · 7 lb 2 oz · 20 in', themes: ['babyblue', 'babypink', 'sage'] },
  grad: { name: 'Graduation', greets: () => ['Congratulations, Graduate!', `Class of ${nextClass()}`, 'Congrats, Grad!', 'So Proud of You', 'Graduation Party'], msg: 'Join us to celebrate on Saturday, June 5 at 4 pm', themes: ['gnavy', 'gblack', 'gmaroon'] },
  tet: { name: 'Lunar New Year (Tết)', greets: ['Happy Lunar New Year', 'Chúc Mừng Năm Mới', 'An Khang Thịnh Vượng', 'Vạn Sự Như Ý', '新年快乐', 'Gong Xi Fa Cai'], msg: 'Wishing you health, happiness and good fortune in the new year', themes: ['tetred', 'mai', 'peach', 'tetgold'] },
  valentine: { name: "Valentine's Day", greets: ["Happy Valentine's Day", 'Be Mine', 'Love You', 'XOXO', 'You & Me'], msg: 'You make every day brighter', themes: ['hearts', 'rose', 'lkraft'] },
  parents: { name: "Mother's & Father's Day", greets: ["Happy Mother's Day", "Happy Father's Day", 'Best Mom Ever', 'Best Dad Ever', 'Love You, Mom', 'Love You, Dad'], msg: 'Thank you for everything you do', themes: ['floral', 'mclassic', 'mgold'] },
  party: { name: 'Party invitation', greets: ["You're Invited!", 'Join the Party', "Let's Celebrate", 'Come Party With Us'], msg: 'Saturday, May 8 at 3 pm · 12 Oak Street · RSVP to Anna', themes: ['confetti', 'balloons', 'bnight'] },
};
const occ = () => OCCASIONS[cal.card.occ] || OCCASIONS.christmas;
const occGreets = (o) => (typeof (o || occ()).greets === 'function' ? (o || occ()).greets() : (o || occ()).greets);
const GREETINGS = OCCASIONS.christmas.greets;
const THEMES = {
  holly: { name: 'Holly', bg: '#fbf7f0', ink: '#7f1d1d', soft: '#166534', deco: 'holly', script: true },
  snow: { name: 'Snowflakes', bg: '#eaf2fb', ink: '#1e3a8a', soft: '#3b82f6', deco: 'snow', script: false },
  evergreen: { name: 'Evergreen', bg: '#14532d', ink: '#fef3c7', soft: '#facc15', deco: 'trees', script: true, pro: true },
  gold: { name: 'Gold & white', bg: '#fffdf7', ink: '#854d0e', soft: '#ca8a04', deco: 'stars', script: true, pro: true },
  kraft: { name: 'Kraft paper', bg: '#d6b48a', ink: '#3f2a14', soft: '#7c2d12', deco: 'trees', script: true, pro: true },
  night: { name: 'Silent night', bg: '#0f172a', ink: '#f8fafc', soft: '#fde68a', deco: 'stars', script: false, pro: true },
  balloons: { name: 'Balloons', bg: '#fff7ed', ink: '#1e3a8a', soft: '#f97316', deco: 'balloons', script: false },
  confetti: { name: 'Confetti', bg: '#ffffff', ink: '#7c3aed', soft: '#ec4899', deco: 'confetti', script: false },
  pastel: { name: 'Pastel', bg: '#fdf4ff', ink: '#6b21a8', soft: '#e879f9', deco: 'dots', script: true, pro: true },
  bnight: { name: 'Party night', bg: '#111827', ink: '#fde68a', soft: '#f472b6', deco: 'confetti', script: false, pro: true },
  greenery: { name: 'Greenery', bg: '#f7faf5', ink: '#14532d', soft: '#4d7c0f', deco: 'leaves', script: true },
  kthanks: { name: 'Kraft', bg: '#d6b48a', ink: '#3f2a14', soft: '#365314', deco: 'leaves', script: true },
  navy: { name: 'Navy & gold', bg: '#172554', ink: '#fef3c7', soft: '#fbbf24', deco: 'dots', script: true, pro: true },
  ivory: { name: 'Ivory', bg: '#fffdf7', ink: '#57534e', soft: '#a8a29e', deco: 'leaves', script: true },
  blush: { name: 'Blush', bg: '#fdf2f2', ink: '#9f1239', soft: '#f9a8d4', deco: 'flowers', script: true },
  eucalyptus: { name: 'Eucalyptus', bg: '#f1f5f0', ink: '#365314', soft: '#84a98c', deco: 'leaves', script: true, pro: true },
  wgold: { name: 'Black & gold', bg: '#1c1917', ink: '#fde68a', soft: '#d4a017', deco: 'stars', script: true, pro: true },
  babyblue: { name: 'Baby blue', bg: '#eff6ff', ink: '#1e40af', soft: '#93c5fd', deco: 'dots', script: false },
  babypink: { name: 'Baby pink', bg: '#fdf2f8', ink: '#be185d', soft: '#f9a8d4', deco: 'hearts', script: false },
  sage: { name: 'Sage', bg: '#f0f5ee', ink: '#3f6212', soft: '#a3b18a', deco: 'stars', script: true, pro: true },
  gnavy: { name: 'Navy', bg: '#1e3a8a', ink: '#ffffff', soft: '#fbbf24', deco: 'caps', script: false },
  gblack: { name: 'Black & gold', bg: '#111827', ink: '#fde68a', soft: '#d4a017', deco: 'caps', script: false },
  gmaroon: { name: 'Maroon', bg: '#7f1d1d', ink: '#ffffff', soft: '#fcd34d', deco: 'confetti', script: false, pro: true },
  tetred: { name: 'Red & gold', bg: '#b91c1c', ink: '#fde68a', soft: '#facc15', deco: 'lanterns', script: false },
  mai: { name: 'Apricot blossom (hoa mai)', bg: '#fffbeb', ink: '#b91c1c', soft: '#eab308', deco: 'blossom', script: false },
  peach: { name: 'Peach blossom (hoa đào)', bg: '#fdf2f8', ink: '#9d174d', soft: '#ec4899', deco: 'blossom', script: false, pro: true },
  tetgold: { name: 'Lucky gold', bg: '#7f1d1d', ink: '#fef3c7', soft: '#fbbf24', deco: 'lanterns', script: false, pro: true },
  hearts: { name: 'Hearts', bg: '#fff1f2', ink: '#be123c', soft: '#fb7185', deco: 'hearts', script: true },
  rose: { name: 'Red rose', bg: '#881337', ink: '#fff1f2', soft: '#fda4af', deco: 'hearts', script: true },
  lkraft: { name: 'Kraft love', bg: '#d6b48a', ink: '#7f1d1d', soft: '#be123c', deco: 'hearts', script: true, pro: true },
  floral: { name: 'Flowers', bg: '#fff7f5', ink: '#9d174d', soft: '#f472b6', deco: 'flowers', script: true },
  mclassic: { name: 'Classic blue', bg: '#f8fafc', ink: '#1e3a8a', soft: '#60a5fa', deco: 'leaves', script: false },
  mgold: { name: 'Golden', bg: '#fffbeb', ink: '#92400e', soft: '#f59e0b', deco: 'flowers', script: true, pro: true },
};
const theme = () => THEMES[occ().themes.includes(cal.card.theme) ? cal.card.theme : occ().themes[0]];
const scriptFont = "'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', Georgia, cursive";
function snowflake(x, y, r, c, o) {
  let s = `<g transform="translate(${x},${y})" stroke="${c}" stroke-width="${Math.max(1, r / 9)}" stroke-linecap="round" opacity="${o}">`;
  for (let k = 0; k < 6; k++) s += `<g transform="rotate(${k * 60})"><line x1="0" y1="0" x2="0" y2="${-r}"/><line x1="0" y1="${-r * 0.55}" x2="${r * 0.25}" y2="${-r * 0.78}"/><line x1="0" y1="${-r * 0.55}" x2="${-r * 0.25}" y2="${-r * 0.78}"/></g>`;
  return s + '</g>';
}
function holly(x, y, r, rot) {
  const leaf = (a) => `<path transform="rotate(${a})" d="M0,0 C${r * 0.3},${-r * 0.25} ${r * 0.75},${-r * 0.3} ${r * 1.1},0 C${r * 0.75},${r * 0.3} ${r * 0.3},${r * 0.25} 0,0Z" fill="#166534"/>`;
  return `<g transform="translate(${x},${y}) rotate(${rot})">${leaf(-25)}${leaf(205)}<circle cx="${-r * 0.08}" cy="${-r * 0.12}" r="${r * 0.17}" fill="#b91c1c"/><circle cx="${r * 0.16}" cy="${-r * 0.02}" r="${r * 0.17}" fill="#dc2626"/><circle cx="${-r * 0.02}" cy="${r * 0.18}" r="${r * 0.17}" fill="#991b1b"/></g>`;
}
function star(x, y, r, c, o) {
  let d = '';
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; d += (k ? 'L' : 'M') + (x + rr * Math.cos(a)).toFixed(1) + ',' + (y + rr * Math.sin(a)).toFixed(1); }
  return `<path d="${d}Z" fill="${c}" opacity="${o}"/>`;
}
function tree(x, y, h, c, o) {
  const w = h * 0.62;
  return `<g opacity="${o}" fill="${c}"><path d="M${x},${y - h} L${x + w * 0.38},${y - h * 0.55} L${x - w * 0.38},${y - h * 0.55}Z"/><path d="M${x},${y - h * 0.75} L${x + w * 0.5},${y - h * 0.25} L${x - w * 0.5},${y - h * 0.25}Z"/><path d="M${x},${y - h * 0.5} L${x + w * 0.62},${y - h * 0.06} L${x - w * 0.62},${y - h * 0.06}Z"/><rect x="${x - h * 0.05}" y="${y - h * 0.07}" width="${h * 0.1}" height="${h * 0.12}"/></g>`;
}
// decorations scattered over an area, always in the same places (seeded)
function decorations(x, y, w, h, scale) {
  const t = theme(); let s = '', seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const ry = () => (rnd() < 0.55 ? y + rnd() * h * 0.2 : y + h * 0.8 + rnd() * h * 0.18); // keep the middle free for the words
  const edge = () => (rnd() < 0.6 ? [x + rnd() * w, y + rnd() * h * 0.17] : [rnd() < 0.5 ? x + rnd() * w * 0.09 : x + w * 0.91 + rnd() * w * 0.09, y + rnd() * h]); // only the top band and the side edges, away from all the words
  if (t.deco === 'holly') { s += holly(x + w - 26 * scale, y + 26 * scale, 26 * scale, 20) + holly(x + 24 * scale, y + h - 22 * scale, 20 * scale, 200); }
  else if (t.deco === 'snow') { for (let k = 0; k < 9; k++) s += snowflake(x + rnd() * w, ry(), (6 + rnd() * 10) * scale, t.soft, 0.18 + rnd() * 0.25); }
  else if (t.deco === 'stars') { for (let k = 0; k < 10; k++) s += star(x + rnd() * w, ry(), (3 + rnd() * 6) * scale, t.soft, 0.35 + rnd() * 0.5); }
  else if (t.deco === 'trees') { for (let k = 0; k < 4; k++) s += tree(x + w * (0.12 + k * 0.25), y + h - 6 * scale, (16 + (k % 2) * 8) * scale, t.soft, 0.55); }
  else if (t.deco === 'hearts') { for (let k = 0; k < 9; k++) { const [hx, hy] = edge(); s += heart(hx, hy, (4 + rnd() * 6) * scale, k % 3 ? t.soft : t.ink, 0.3 + rnd() * 0.4); } }
  else if (t.deco === 'confetti') { const cols = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', t.soft]; for (let k = 0; k < 22; k++) { const [cx, cy] = edge(), c = cols[k % cols.length], r = (2 + rnd() * 3) * scale; s += k % 2 ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${c}" opacity=".85"/>` : `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${(r * 2.6).toFixed(1)}" height="${(r * 1.1).toFixed(1)}" fill="${c}" opacity=".85" transform="rotate(${Math.round(rnd() * 180)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`; } }
  else if (t.deco === 'balloons') { const cols = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981']; s += balloon(x + w - 30 * scale, y + 20 * scale, 11 * scale, cols[0]) + balloon(x + w - 50 * scale, y + 27 * scale, 9 * scale, cols[1]) + balloon(x + w - 13 * scale, y + 31 * scale, 8 * scale, cols[2]) + balloon(x + 18 * scale, y + h - 48 * scale, 9 * scale, cols[3]); }
  else if (t.deco === 'dots') { for (let k = 0; k < 16; k++) { const [dx, dy] = edge(); s += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${((2 + rnd() * 4) * scale).toFixed(1)}" fill="${t.soft}" opacity="${(0.3 + rnd() * 0.4).toFixed(2)}"/>`; } }
  else if (t.deco === 'flowers') { s += flower(x + w - 26 * scale, y + 26 * scale, 14 * scale, t.soft) + flower(x + w - 50 * scale, y + 16 * scale, 8 * scale, t.soft) + flower(x + 24 * scale, y + h - 24 * scale, 11 * scale, t.soft); }
  else if (t.deco === 'leaves') { s += sprig(x + w - 4 * scale, y + 4 * scale, 52 * scale, 45, t.soft) + sprig(x + w - 4 * scale, y + 4 * scale, 34 * scale, 75, t.soft) + sprig(x + 4 * scale, y + h - 4 * scale, 44 * scale, 225, t.soft); }
  else if (t.deco === 'blossom') { s += branch(x + w, y, 70 * scale, t.soft, t.deco === 'blossom' && t.bg === '#fdf2f8' ? '#f9a8d4' : '#facc15') + branch(x, y + h, 50 * scale, t.soft, t.bg === '#fdf2f8' ? '#f9a8d4' : '#facc15', true); }
  else if (t.deco === 'lanterns') { s += lantern(x + w - 22 * scale, y, 12 * scale, t.soft) + lantern(x + w - 48 * scale, y, 8 * scale, t.soft) + lantern(x + 18 * scale, y, 9 * scale, t.soft); }
  else if (t.deco === 'caps') { s += gradCap(x + w - 32 * scale, y + 26 * scale, 18 * scale, t.soft, -12) + gradCap(x + 26 * scale, y + h - 26 * scale, 13 * scale, t.soft, 14); for (let k = 0; k < 6; k++) { const [sx, sy] = edge(); s += star(sx, sy, (2 + rnd() * 3) * scale, t.soft, 0.5); } }
  return s;
}
function heart(x, y, r, c, o) { return `<path transform="translate(${x.toFixed(1)},${y.toFixed(1)})" d="M0,${(r * 0.35).toFixed(1)} C${(-r * 1.2).toFixed(1)},${(-r * 0.4).toFixed(1)} ${(-r * 0.5).toFixed(1)},${(-r * 1.2).toFixed(1)} 0,${(-r * 0.45).toFixed(1)} C${(r * 0.5).toFixed(1)},${(-r * 1.2).toFixed(1)} ${(r * 1.2).toFixed(1)},${(-r * 0.4).toFixed(1)} 0,${(r * 0.35).toFixed(1)}Z" fill="${c}" opacity="${o}"/>`; }
function balloon(x, y, r, c) { return `<path d="M${x},${y + r * 1.25} q${-r * 0.4},${r * 0.8} ${r * 0.1},${r * 1.7}" stroke="#94a3b8" stroke-width="${r * 0.07}" fill="none"/><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.22}" fill="${c}"/><path d="M${x - r * 0.18},${y + r * 1.32} L${x + r * 0.18},${y + r * 1.32} L${x},${y + r * 1.15}Z" fill="${c}"/><ellipse cx="${x - r * 0.35}" cy="${y - r * 0.45}" rx="${r * 0.2}" ry="${r * 0.32}" fill="#fff" opacity=".45"/>`; }
function flower(x, y, r, c) { let s = `<g transform="translate(${x},${y})">`; for (let k = 0; k < 5; k++) { const a = k * 72 * Math.PI / 180; s += `<circle cx="${(Math.cos(a) * r * 0.55).toFixed(1)}" cy="${(Math.sin(a) * r * 0.55).toFixed(1)}" r="${(r * 0.45).toFixed(1)}" fill="${c}" opacity=".8"/>`; } return s + `<circle r="${(r * 0.28).toFixed(1)}" fill="#fde68a"/></g>`; }
function sprig(x, y, len, rot, c) { let s = `<g transform="translate(${x},${y}) rotate(${rot})"><path d="M0,0 Q${len * 0.1},${len * 0.5} 0,${len}" stroke="${c}" stroke-width="${len * 0.025}" fill="none"/>`; for (let k = 1; k <= 5; k++) { const yy = len * k / 6, side = k % 2 ? 1 : -1; s += `<ellipse cx="${side * len * 0.12}" cy="${yy}" rx="${len * 0.11}" ry="${len * 0.05}" transform="rotate(${side * 35} ${side * len * 0.12} ${yy})" fill="${c}" opacity=".8"/>`; } return s + '</g>'; }
function branch(x, y, len, c, petal, flip) { const dx = flip ? 1 : -1, dy = flip ? -1 : 1; let s = `<path d="M${x},${y} q${dx * len * 0.5},${dy * len * 0.1} ${dx * len},${dy * len * 0.55}" stroke="#78350f" stroke-width="${len * 0.035}" fill="none" stroke-linecap="round"/>`; for (let k = 1; k <= 4; k++) { const f = k / 4.5; s += flower(x + dx * len * f, y + dy * len * (0.05 + f * f * 0.5), len * (0.1 + (k % 2) * 0.04), petal); } return s; }
function lantern(x, y, r, c) { const top = y + r * 1.2; return `<line x1="${x}" y1="${y}" x2="${x}" y2="${top}" stroke="${c}" stroke-width="${r * 0.08}"/><rect x="${x - r * 0.45}" y="${top}" width="${r * 0.9}" height="${r * 0.22}" fill="${c}"/><ellipse cx="${x}" cy="${top + r * 1.15}" rx="${r}" ry="${r * 0.95}" fill="#dc2626" stroke="${c}" stroke-width="${r * 0.08}"/><path d="M${x},${top + r * 0.22} V${top + r * 2.1}" stroke="${c}" stroke-width="${r * 0.05}" opacity=".7"/><rect x="${x - r * 0.45}" y="${top + r * 2.05}" width="${r * 0.9}" height="${r * 0.22}" fill="${c}"/><path d="M${x},${top + r * 2.27} v${r * 0.8}" stroke="${c}" stroke-width="${r * 0.18}"/>`; }
function gradCap(x, y, r, c, rot) { return `<g transform="translate(${x},${y}) rotate(${rot})"><path d="M${-r},0 L0,${-r * 0.45} L${r},0 L0,${r * 0.45}Z" fill="${c}"/><path d="M${-r * 0.55},${r * 0.22} v${r * 0.45} q${r * 0.55},${r * 0.35} ${r * 1.1},0 v${-r * 0.45}" fill="${c}" opacity=".85"/><path d="M0,0 L${r * 0.85},${r * 0.15} v${r * 0.6}" stroke="${c}" stroke-width="${r * 0.07}" fill="none"/><circle cx="${r * 0.85}" cy="${r * 0.8}" r="${r * 0.09}" fill="${c}"/></g>`; }
function fitFont(text, maxW, base, ratio) { return Math.min(base, maxW / Math.max(1, String(text).length * ratio)); }
const greetingText = () => (cal.card.greet === 'custom' ? cal.card.custom : cal.card.greet) || '';
function cardSvg(x, y, w, h, forScreen, uid) {
  const t = theme(), c = cal.card, sc = h / 360;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${t.bg}"/>`;
  const greet = greetingText(), gf = t.script ? scriptFont : 'Georgia, serif';
  const lines = (txt, cx, ty, maxW, fs, fill, weight, family, style) => {
    // wrap into at most 3 lines
    const words = String(txt || '').split(/\s+/).filter(Boolean), out = []; let cur = '';
    const cw = fs * 0.5;
    words.forEach((wd) => { if ((cur + ' ' + wd).trim().length * cw > maxW && cur) { out.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); });
    if (cur) out.push(cur);
    return out.slice(0, 3).map((ln, i) => `<text x="${cx}" y="${ty + i * fs * 1.3}" text-anchor="middle" font-size="${fs}" font-weight="${weight || 400}" font-family="${family || 'Georgia, serif'}" ${style ? `font-style="${style}"` : ''} fill="${fill}">${esc(ln)}</text>`).join('');
  };
  if (c.lay === 'full') {
    s += photosSvg('card', x, y, w, h, forScreen, uid);
    const bh = h * 0.34, by = y + h - bh;
    s += `<rect x="${x}" y="${by}" width="${w}" height="${bh}" fill="${t.bg}" opacity=".9"/><clipPath id="dc${uid}"><rect x="${x}" y="${by}" width="${w}" height="${bh}"/></clipPath><g clip-path="url(#dc${uid})">${decorations(x, by, w, bh, sc * 0.8)}</g>`;
    const fs = fitFont(greet, w * 0.86, 40 * sc, t.script ? 0.5 : 0.52);
    s += `<text x="${x + w / 2}" y="${by + bh * 0.45}" text-anchor="middle" font-size="${fs}" font-family="${gf}" font-weight="${t.script ? 400 : 700}" fill="${t.ink}">${esc(greet)}</text>`;
    const sub = [c.sign, c.year ? cardYear() : ''].filter(Boolean).join(' · ');
    s += `<text x="${x + w / 2}" y="${by + bh * 0.78}" text-anchor="middle" font-size="${13 * sc}" font-family="Georgia, serif" fill="${t.ink}">${esc(sub)}</text>`;
  } else {
    const pw = w * 0.56;
    s += photosSvg('card', x, y, pw, h, forScreen, uid);
    const tx = x + pw, tw = w - pw, cx = tx + tw / 2;
    s += `<clipPath id="dc${uid}"><rect x="${tx}" y="${y}" width="${tw}" height="${h}"/></clipPath><g clip-path="url(#dc${uid})">${decorations(tx, y, tw, h, sc)}</g>`;
    const fs = fitFont(greet, tw * 0.86 * 2.2, 34 * sc, t.script ? 0.5 : 0.52);
    // greeting on up to two lines
    const gw = greet.split(' '), half = Math.ceil(gw.length / 2);
    const g1 = greet.length * fs * 0.5 > tw * 0.86 && gw.length > 1 ? [gw.slice(0, half).join(' '), gw.slice(half).join(' ')] : [greet];
    const gfs = Math.min(fs, ...g1.map((g) => (tw * 0.86) / Math.max(1, g.length * 0.5)));
    const top = y + h * 0.3 - (g1.length - 1) * gfs * 0.6;
    g1.forEach((g, i) => { s += `<text x="${cx}" y="${top + i * gfs * 1.15}" text-anchor="middle" font-size="${gfs}" font-family="${gf}" font-weight="${t.script ? 400 : 700}" fill="${t.ink}">${esc(g)}</text>`; });
    s += `<line x1="${cx - tw * 0.18}" y1="${y + h * 0.47}" x2="${cx + tw * 0.18}" y2="${y + h * 0.47}" stroke="${t.soft}" stroke-width="${1.2 * sc}"/>`;
    s += lines(c.msg, cx, y + h * 0.58, tw * 0.8, 12.5 * sc, t.ink, 400, 'Georgia, serif', 'italic');
    s += `<text x="${cx}" y="${y + h * 0.84}" text-anchor="middle" font-size="${fitFont(c.sign, tw * 0.86, 15 * sc, 0.5)}" font-family="${t.script ? scriptFont : 'Georgia, serif'}" fill="${t.ink}">${esc(c.sign)}</text>`;
    if (c.year) s += `<text x="${cx}" y="${y + h * 0.92}" text-anchor="middle" font-size="${10 * sc}" letter-spacing="${2 * sc}" font-family="Georgia, serif" fill="${t.soft}">${cardYear()}</text>`;
  }
  return s;
}
const cardYear = () => String(new Date().getFullYear());
function cutBox(x, y, w, h) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#9ca3af" stroke-width=".6" stroke-dasharray="4 3"/>`; }
function cardPageSvg(forScreen) {
  const [W, H] = pageSize(false), cw = 504, ch = 360, gap = 24, y0 = (H - ch * 2 - gap) / 2, x0 = (W - cw) / 2;
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let k = 0; k < 2; k++) { const yy = y0 + k * (ch + gap); body += cardSvg(x0, yy, cw, ch, forScreen && k === 0, 'c' + k) + cutBox(x0, yy, cw, ch); }
  body += `<text x="${W / 2}" y="${H - 10}" text-anchor="middle" font-size="7" fill="#9ca3af">Two 7 × 5 in cards – cut along the dotted lines</text>`;
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${fontFamily()}">${body}</svg>` };
}
const tagNames = () => String(cal.tags.to || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const tagPages = () => Math.max(1, Math.ceil(tagNames().length / 8));
function tagSvg(x, y, w, h, name) {
  const t = theme(), sc = h / 162, n = 22 * sc;
  const d = `M${x + n},${y} L${x + w},${y} L${x + w},${y + h} L${x + n},${y + h} L${x},${y + h - n} L${x},${y + n} Z`;
  let s = `<path d="${d}" fill="${t.bg}" stroke="#9ca3af" stroke-width=".6" stroke-dasharray="4 3"/>`;
  s += `<clipPath id="tg${Math.round(x)}_${Math.round(y)}"><path d="${d}"/></clipPath><g clip-path="url(#tg${Math.round(x)}_${Math.round(y)})">${decorations(x + w * 0.55, y, w * 0.45, h, sc * 0.8)}</g>`;
  s += `<circle cx="${x + 20 * sc}" cy="${y + h / 2}" r="${6 * sc}" fill="#fff" stroke="${t.soft}" stroke-width="${1.2 * sc}"/>`;
  const lx = x + 42 * sc, f = t.script ? scriptFont : 'Georgia, serif';
  s += `<text x="${lx}" y="${y + 52 * sc}" font-size="${12 * sc}" font-family="Georgia, serif" fill="${t.soft}">To:</text>`;
  if (name) s += `<text x="${lx + 26 * sc}" y="${y + 54 * sc}" font-size="${fitFont(name, w - 90 * sc, 24 * sc, 0.5)}" font-family="${f}" fill="${t.ink}">${esc(name)}</text>`;
  else s += `<line x1="${lx + 26 * sc}" y1="${y + 55 * sc}" x2="${x + w - 20 * sc}" y2="${y + 55 * sc}" stroke="${t.soft}" stroke-width=".8" opacity=".6"/>`;
  s += `<text x="${lx}" y="${y + 102 * sc}" font-size="${12 * sc}" font-family="Georgia, serif" fill="${t.soft}">From:</text>`;
  if (cal.tags.from) s += `<text x="${lx + 38 * sc}" y="${y + 104 * sc}" font-size="${fitFont(cal.tags.from, w - 100 * sc, 18 * sc, 0.5)}" font-family="${f}" fill="${t.ink}">${esc(cal.tags.from)}</text>`;
  else s += `<line x1="${lx + 38 * sc}" y1="${y + 105 * sc}" x2="${x + w - 20 * sc}" y2="${y + 105 * sc}" stroke="${t.soft}" stroke-width=".8" opacity=".6"/>`;
  s += `<text x="${lx}" y="${y + h - 18 * sc}" font-size="${11 * sc}" font-family="${f}" fill="${t.ink}" opacity=".85">${esc(greetingText())}</text>`;
  return s;
}
function tagPageSvg(pg) {
  const [W, H] = pageSize(false), tw = 252, th = 162, gx = 24, gy = 20, x0 = (W - tw * 2 - gx) / 2, y0 = (H - th * 4 - gy * 3) / 2;
  const names = tagNames();
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let k = 0; k < 8; k++) body += tagSvg(x0 + (k % 2) * (tw + gx), y0 + Math.floor(k / 2) * (th + gy), tw, th, names[pg * 8 + k] || '');
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${fontFamily()}">${body}</svg>` };
}
let tagPage = 0;
const isCal = () => (cal.make || 'calendar') === 'calendar';
const photoKey = () => (cal.make === 'card' ? 'card' : slot(cur).m);
function currentPage(forScreen) {
  if (cal.make === 'card') return cardPageSvg(forScreen);
  if (cal.make === 'tags') return tagPageSvg(Math.min(tagPage, tagPages() - 1));
  return monthSvg(cur, forScreen);
}
function allPages() {
  if (cal.make === 'card') return [cardPageSvg(false)];
  if (cal.make === 'tags') return Array.from({ length: tagPages() }, (_, i) => tagPageSvg(i));
  return Array.from({ length: 12 }, (_, i) => monthSvg(i, false));
}

// ---------- UI ----------
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000); }
function renderPage() { $('page').innerHTML = currentPage(true).svg; if (cal.make !== 'tags') ensureAR(photoKey()); }
function renderMonths() {
  const el = $('months');
  el.textContent = '';
  for (let i = 0; i < 12; i++) {
    const { y, m } = slot(i), b = document.createElement('button');
    b.textContent = cap(monthName(m, 'short')).replace('.', '');
    b.title = `${cap(monthName(m))} ${y}`;
    b.className = (i === cur ? 'on' : '') + (Array.from({ length: nFrames(m) }, (_, j) => cal.photos[fkey(m, j)]).some(Boolean) ? ' has' : '');
    b.onclick = () => { cur = i; curFrame = 0; $('evMonth').value = ''; renderAll(); };
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
  $('year').value = cal.year; $('paper').value = cal.paper; $('layout').value = cal.layout; $('weekStart').value = cal.weekStart; $('locale').value = cal.locale; $('font').value = cal.font;
  $('holidays').value = cal.holidays; $('lunar').checked = cal.lunar;
  const sm = $('startMonth'); sm.innerHTML = Array.from({ length: 12 }, (_, m) => `<option value="${m}">${esc(cap(monthName(m)))}</option>`).join(''); sm.value = cal.start;
  $('headline').textContent = `${spanTitle()} calendar`;
  const sw = $('swatches');
  sw.textContent = '';
  COLORS.forEach((c) => { const b = document.createElement('button'); b.style.background = c; b.title = 'Color'; b.className = c === cal.color ? 'on' : ''; b.onclick = () => { cal.color = c; renderAll(); save(); }; sw.append(b); });
  const em = $('evMonth'), keep = em.value === '' ? String(slot(cur).m) : em.value;
  em.innerHTML = Array.from({ length: 12 }, (_, m) => `<option value="${m}">${esc(cap(monthName(m)))}</option>`).join('');
  em.value = keep;
  renderMake();
  const pm = photoKey(), n = nFrames(pm);
  if (curFrame >= n) curFrame = 0;
  const key = fkey(pm, curFrame), has = !!cal.photos[key], photoLayout = cal.make === 'card' || cal.layout === 'photo';
  const what = cal.make === 'card' ? 'your card' : cap(monthName(pm));
  $('photoHead').textContent = n > 1 ? `Photos for ${what}` : `Photo for ${what}`;
  $('collage').value = String(n); $('collageRow').hidden = !photoLayout;
  $('zoomRow').hidden = !has || !photoLayout;
  $('photoZoom').value = (cal.photoPos[key] || {}).z || 1;
  $('photoBtn').textContent = (has ? 'Change photo' : 'Add a photo') + (n > 1 ? ` ${curFrame + 1}` : '');
  $('photoBtn').disabled = !photoLayout;
  $('photoDel').hidden = !has;
  $('photoHint').textContent = !photoLayout ? 'This page style has no photo.' : (n > 1 ? `Click a frame on the page to choose it (photo ${curFrame + 1} of ${n} is selected). ` : '') + (has ? 'Drag the photo to move it, and use Zoom to fill the frame.' : cal.make === 'card' ? 'A family photo works best.' : unlocked() ? 'Each month can have its own photos.' : `Free version: ${photoCount()} of ${FREE_PHOTOS} photos used.`);
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
      res({ url: c.toDataURL('image/jpeg', 0.86), ar: img.width / img.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture'); rej(new Error('bad image')); };
    img.src = url;
  });
}
function ensureAR(m) { // older photos: measure their shape once
  for (let j = 0; j < nFrames(m); j++) {
    const k = fkey(m, j);
    if (!cal.photos[k] || (cal.photoPos[k] && cal.photoPos[k].ar)) continue;
    const img = new Image();
    img.onload = () => { cal.photoPos[k] = Object.assign({}, cal.photoPos[k], { ar: img.width / img.height }); renderPage(); save(); };
    img.src = cal.photos[k];
  }
}
function addEvent(m, d, t, text) {
  if (cal.events.length >= FREE_EVENTS && needsPro(`The free version holds ${FREE_EVENTS} birthdays and events. Unlock Pro to add as many as you like.`)) return false;
  cal.events.push({ m, d, t, text });
  return true;
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); toast(`Saved ${name} to your Downloads folder`); }
function printPages(pages) {
  const landscape = pages[0].w > pages[0].h;
  $('pageRule').textContent = `@page { size: ${(PAPER[cal.paper] || PAPER.letter)[0]} ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
  $('printArea').innerHTML = pages.map((p) => p.svg.replace(/ width="[\d.]+" height="[\d.]+"/, ' preserveAspectRatio="xMidYMid meet"')).join('');
  window.print();
}
async function savePhotoPrint() { // one card as a 5 × 7 in JPEG at 300 dpi, ready for a photo shop or an online print service
  if (!themeOk()) return;
  if (needsPro('Saving cards for a photo shop (5 × 7 in prints) is part of Pro. You can still print them at home for free.')) return;
  const W = 504, H = 360, svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${fontFamily()}">${cardSvg(0, 0, W, H, false, 'pp')}</svg>`;
  const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = 2100; c.height = 1500;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => { download(b, `${cal.card.occ || 'holiday'}-card-5x7.jpg`); toast('Saved a 5 × 7 in photo (2100 × 1500 px). Upload it to Walmart, CVS, Walgreens or any photo shop and order 5 × 7 prints.'); }, 'image/jpeg', 0.95);
}
async function savePicture() {
  if (!themeOk()) return;
  const p = currentPage(false), img = new Image(), url = URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'), k = 3;
  c.width = p.w * k; c.height = p.h * k;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => download(b, cal.make === 'card' ? `${cal.card.occ || 'holiday'}-card.png` : cal.make === 'tags' ? `gift-tags-${tagPage + 1}.png` : `calendar-${slot(cur).y}-${String(slot(cur).m + 1).padStart(2, '0')}.png`), 'image/png');
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
  for (let m = 0; m < 12; m++) { cal.photos[m] = samplePhoto(m); cal.photoPos[m] = { ar: 1200 / 760 }; }
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
$('holidays').innerHTML = HOLIDAY_SETS.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('');
$('holidays').onchange = (e) => { cal.holidays = e.target.value; if (cal.holidays === 'VN' && cal.locale === 'en-US') { cal.locale = 'vi'; cal.weekStart = 1; cal.lunar = true; toast('Lịch Việt Nam: tiếng Việt, tuần bắt đầu thứ Hai, có ngày âm lịch'); } renderAll(); save(); };
$('lunar').onchange = (e) => { cal.lunar = e.target.checked; renderAll(); save(); };
$('startMonth').onchange = (e) => { const old = slot(cur).m; cal.start = Number(e.target.value); cur = slotOf(old); renderAll(); save(); };
$('photoZoom').addEventListener('input', (e) => { const k = fkey(photoKey(), curFrame); cal.photoPos[k] = Object.assign({}, cal.photoPos[k], { z: Number(e.target.value) }); renderPage(); save(); });
$('collage').onchange = (e) => { cal.collage[photoKey()] = Number(e.target.value); curFrame = 0; renderAll(); save(); };
// drag the photo inside its frame; click a frame to choose it; click an empty frame to add a photo
let drag = null;
$('page').addEventListener('pointerdown', (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains('photoAdd')) { curFrame = Number(t.dataset.j) || 0; renderAll(); $('photoBtn').click(); return; }
  if (!t || !t.classList || !t.classList.contains('photoHit')) return;
  const svg = $('page').querySelector('svg'), k = t.dataset.k;
  const b = photoBox(k, +t.getAttribute('x'), +t.getAttribute('y'), +t.getAttribute('width'), +t.getAttribute('height'));
  const sc = svg.getScreenCTM().a, p = cal.photoPos[k] || {};
  drag = { k, j: Number(t.dataset.j) || 0, sc, sx: e.clientX, sy: e.clientY, ox: b.w - b.fw, oy: b.h - b.fh, px: p.x == null ? 0.5 : p.x, py: p.y == null ? 0.5 : p.y, moved: false };
  t.setPointerCapture(e.pointerId); e.preventDefault();
});
$('page').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = (e.clientX - drag.sx) / drag.sc, dy = (e.clientY - drag.sy) / drag.sc, cl = (v) => Math.max(0, Math.min(1, v));
  if (!drag.moved && Math.hypot(dx, dy) < 2) return;
  drag.moved = true;
  cal.photoPos[drag.k] = Object.assign({}, cal.photoPos[drag.k], { x: drag.ox > 0.5 ? cl(drag.px - dx / drag.ox) : 0.5, y: drag.oy > 0.5 ? cl(drag.py - dy / drag.oy) : 0.5 });
  const keep = drag; renderPage(); drag = keep;
  const hit = $('page').querySelector(`.photoHit[data-k="${drag.k}"]`); if (hit) try { hit.setPointerCapture(e.pointerId); } catch (_) {}
});
const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.j !== curFrame) { curFrame = d.j; renderAll(); }
  if (d.moved) save();
};
$('page').addEventListener('pointerup', endDrag); $('page').addEventListener('pointercancel', endDrag);
$('page').addEventListener('wheel', (e) => {
  const t = e.target;
  if (!t || !t.classList || !t.classList.contains('photoHit')) return;
  e.preventDefault();
  const k = t.dataset.k, p = cal.photoPos[k] || {}, z = Math.max(1, Math.min(3, (p.z || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
  curFrame = Number(t.dataset.j) || 0;
  cal.photoPos[k] = Object.assign({}, p, { z }); $('photoZoom').value = z; renderPage(); save();
}, { passive: false });
$('year').addEventListener('change', () => { const y = parseInt($('year').value, 10); if (y >= 1900 && y <= 2200) cal.year = y; renderAll(); save(); });
$('prev').onclick = () => { if (cal.make === 'tags') { tagPage = (tagPage + tagPages() - 1) % tagPages(); renderAll(); return; } cur = (cur + 11) % 12; curFrame = 0; $('evMonth').value = ''; renderAll(); };
$('next').onclick = () => { if (cal.make === 'tags') { tagPage = (tagPage + 1) % tagPages(); renderAll(); return; } cur = (cur + 1) % 12; curFrame = 0; $('evMonth').value = ''; renderAll(); };
$('photoBtn').onclick = () => {
  const k = fkey(photoKey(), curFrame);
  if (!cal.photos[k] && cal.make !== 'card' && photoCount() >= FREE_PHOTOS && needsPro(`The free version holds ${FREE_PHOTOS} photos. Unlock Pro to give every month its own photos.`)) return;
  pickFile('image/*', async (f) => { const r = await shrinkPhoto(f); cal.photos[k] = r.url; cal.photoPos[k] = { ar: r.ar }; renderAll(); save(); });
};
$('photoDel').onclick = () => { const k = fkey(photoKey(), curFrame); delete cal.photos[k]; delete cal.photoPos[k]; renderAll(); save(); };
$('evAdd').onclick = () => {
  const m = Number($('evMonth').value), d = parseInt($('evDay').value, 10), text = $('evText').value.trim();
  if (!(d >= 1 && d <= daysIn(2024, m))) { $('evDay').focus(); toast('Type the day of the month, for example 14'); return; }
  if (!text) { $('evText').focus(); return; }
  if (!addEvent(m, d, $('evType').value, text)) return;
  $('evText').value = ''; $('evDay').value = '';
  cur = slotOf(m); renderAll(); save();
  $('evDay').focus();
};
$('evText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('evAdd').click(); });
$('printOne').onclick = () => { if (!themeOk()) return; printPages([currentPage(false)]); };
$('printAll').onclick = () => { if (!themeOk()) return; printPages(allPages()); };
$('imgBtn').onclick = savePicture;
$('photoPrintBtn').onclick = savePhotoPrint;
// ---------- save the whole calendar as one PDF ----------
const PAPER_MM = { letter: [215.9, 279.4], a4: [210, 297], a3: [297, 420], a5: [148, 210], tabloid: [279.4, 431.8] };
function jpegPdf(pages) { // pages: [{ jpeg: Uint8Array, px: [w, h], mm: [w, h] }]
  const enc = (s) => new TextEncoder().encode(s), parts = [], offs = [];
  let len = 0;
  const add = (b) => { const u = typeof b === 'string' ? enc(b) : b; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add(`<< /Type /Pages /Count ${n} /Kids [${kids}] >>`));
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, im = pg + 1, ct = pg + 2, W = p.mm[0] * 72 / 25.4, H = p.mm[1] * 72 / 25.4;
    obj(pg, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
    obj(im, () => { add(`<< /Type /XObject /Subtype /Image /Width ${p.px[0]} /Height ${p.px[1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); add(p.jpeg); add('\nendstream'); });
    const c = `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(ct, () => add(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`));
  });
  const xref = len, total = 3 + n * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let k = 1; k < total; k++) x += String(offs[k]).padStart(10, '0') + ' 00000 n \n';
  add(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let p2 = 0; for (const u of parts) { out.set(u, p2); p2 += u.length; } return out;
}
function svgToJpeg(page, pxPerMm) {
  const land = page.w > page.h, mm = PAPER_MM[cal.paper] || PAPER_MM.letter, [wMm, hMm] = land ? [mm[1], mm[0]] : mm;
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(new Blob([page.svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = Math.round(wMm * pxPerMm); c.height = Math.round(hMm * pxPerMm);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      // keep the page's shape on paper (A3/A5 use the A4 shape, which is the same)
      const k = Math.min(c.width / page.w, c.height / page.h), dw = page.w * k, dh = page.h * k;
      x.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      URL.revokeObjectURL(url);
      c.toBlob(async (b) => b ? res({ jpeg: new Uint8Array(await b.arrayBuffer()), px: [c.width, c.height], mm: [wMm, hMm] }) : rej(new Error('jpeg')), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('A page could not be drawn.')); };
    img.src = url;
  });
}
let pdfBusy = false;
async function savePdf() {
  if (pdfBusy) return;
  if (needsPro('Saving as a PDF is part of Pro.')) return;
  if (!themeOk()) return;
  pdfBusy = true;
  try {
    const pages = allPages();
    if (isCal()) pages.push(yearSvg()); // the year planner as the last page
    const mm = PAPER_MM[cal.paper] || PAPER_MM.letter, px = Math.min(11.8, 4200 / Math.max(...mm)); // about 300 dpi, less for very large paper
    const out = [];
    for (let i = 0; i < pages.length; i++) { toast(`Making the PDF… page ${i + 1} of ${pages.length}`); out.push(await svgToJpeg(pages[i], px)); }
    download(new Blob([jpegPdf(out)], { type: 'application/pdf' }), cal.make === 'card' ? 'holiday-cards.pdf' : cal.make === 'tags' ? 'gift-tags.pdf' : `calendar-${spanTitle()}.pdf`);
  } catch (e) { toast('The PDF could not be made: ' + e.message); }
  pdfBusy = false;
}
$('pdfBtn').onclick = savePdf;

// ---------- cards & tags controls ----------
function themeOk() { const t = theme(); const free = occ().themes.filter((k) => !THEMES[k].pro).map((k) => THEMES[k].name).join(' and '); return isCal() || !t.pro || !needsPro(`The ${t.name} design is part of Pro. ${free} ${free.includes(' and ') ? 'are' : 'is'} free.`); }
function renderMake() {
  const mk = cal.make || 'calendar';
  $('makeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === mk));
  $('calOnly').hidden = mk !== 'calendar'; $('evBox').hidden = mk !== 'calendar';
  $('cardBox').hidden = mk === 'calendar'; $('cardOnly').hidden = mk !== 'card'; $('tagOnly').hidden = mk !== 'tags';
  $('photoBox').hidden = mk === 'tags';
  $('months').hidden = mk !== 'calendar';
  $('prev').hidden = $('next').hidden = mk === 'card' || (mk === 'tags' && tagPages() < 2);
  $('printAll').textContent = mk === 'calendar' ? '🖨 Print all 12 months' : mk === 'card' ? '🖨 Print cards' : '🖨 Print all tags';
  $('printOne').hidden = mk !== 'calendar';
  if (mk !== 'calendar') $('headline').textContent = mk === 'card' ? `${occ().name} photo card` : `Gift tags${tagPages() > 1 ? ` – sheet ${Math.min(tagPage, tagPages() - 1) + 1} of ${tagPages()}` : ''}`;
  const c = cal.card;
  $('cOcc').value = OCCASIONS[c.occ] ? c.occ : 'christmas';
  const gl = occGreets();
  $('cGreet').innerHTML = gl.map((g) => `<option>${esc(g)}</option>`).join('') + '<option value="custom">My own words…</option>';
  $('cGreet').value = gl.includes(c.greet) ? c.greet : 'custom';
  $('cCustomRow').hidden = $('cGreet').value !== 'custom';
  if (document.activeElement !== $('cCustom')) $('cCustom').value = c.custom || '';
  if (document.activeElement !== $('cMsg')) $('cMsg').value = c.msg || '';
  if (document.activeElement !== $('cSign')) $('cSign').value = c.sign || '';
  $('cYear').checked = !!c.year; $('cLay').value = c.lay;
  $('cTheme').innerHTML = occ().themes.map((k) => [k, THEMES[k]]).map(([k, t]) => `<option value="${k}">${esc(t.name)}${t.pro && !unlocked() ? ' (Pro)' : ''}</option>`).join('');
  $('cTheme').value = occ().themes.includes(c.theme) ? c.theme : occ().themes[0];
  $('paper2').value = cal.paper === 'a4' ? 'a4' : 'letter';
  if (document.activeElement !== $('tTo')) $('tTo').value = cal.tags.to || '';
  if (document.activeElement !== $('tFrom')) $('tFrom').value = cal.tags.from || '';
  const n = tagNames().length;
  $('tCount').textContent = n ? `${n} tag${n > 1 ? 's' : ''} on ${tagPages()} sheet${tagPages() > 1 ? 's' : ''} (8 per sheet).` : 'Leave it empty to print blank tags you write on by hand.';
}
$('cOcc').innerHTML = Object.entries(OCCASIONS).map(([k, o]) => `<option value="${k}">${esc(o.name)}</option>`).join('');
const DEFAULT_MSGS = Object.values(OCCASIONS).map((o) => o.msg);
$('cOcc').onchange = (e) => cardSet(() => {
  const c = cal.card, was = occ(); c.occ = e.target.value; const o = occ();
  if (c.greet === 'custom' ? !c.custom : occGreets(was).includes(c.greet)) c.greet = occGreets(o)[0];
  if (!c.msg || DEFAULT_MSGS.includes(c.msg)) c.msg = o.msg;
  c.theme = o.themes[0];
});
$('makeSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => { cal.make = b.dataset.v; curFrame = 0; tagPage = 0; renderAll(); save(); }));
const cardSet = (fn) => { fn(); renderControls(); renderPage(); save(); };
$('cGreet').onchange = (e) => cardSet(() => { cal.card.greet = e.target.value; });
$('cCustom').addEventListener('input', (e) => cardSet(() => { cal.card.custom = e.target.value; }));
$('cMsg').addEventListener('input', (e) => cardSet(() => { cal.card.msg = e.target.value; }));
$('cSign').addEventListener('input', (e) => cardSet(() => { cal.card.sign = e.target.value; }));
$('cYear').onchange = (e) => cardSet(() => { cal.card.year = e.target.checked; });
$('cLay').onchange = (e) => cardSet(() => { cal.card.lay = e.target.value; });
$('paper2').onchange = (e) => { cal.paper = e.target.value; renderAll(); save(); };
$('cTheme').onchange = (e) => cardSet(() => { cal.card.theme = e.target.value; if (THEMES[cal.card.theme].pro && !unlocked()) toast('This design is part of Pro – you can try it here; printing it needs Pro.'); });
$('tTo').addEventListener('input', (e) => cardSet(() => { cal.tags.to = e.target.value; if (tagPage >= tagPages()) tagPage = tagPages() - 1; }));
$('tFrom').addEventListener('input', (e) => cardSet(() => { cal.tags.from = e.target.value; }));


$('moreBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('click', () => { $('menu').hidden = true; });
$('yearBtn').onclick = () => { if (!needsPro('The one-page year planner is part of Pro.')) printPages([yearSvg()]); };
$('backupBtn').onclick = () => download(new Blob([JSON.stringify({ app: 'printcal', v: 1, cal })], { type: 'application/json' }), `calendar-${spanTitle()}.printcal.json`);
$('restoreFileBtn').onclick = () => pickFile('.json,application/json', async (f) => {
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'printcal' || !d.cal || !Array.isArray(d.cal.events)) throw new Error('not a backup');
    if (!confirm('Replace the calendar on screen with the one from this backup file?')) return;
    cal = upgrade(d.cal); cur = 0; renderAll(); save(); toast('Backup opened');
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
  try { const c = await dbGet('cal'); if (c && Array.isArray(c.events)) cal = upgrade(c); } catch (_) {}
  { const now = new Date(); cur = 0; for (let i = 0; i < 12; i++) { const s = slot(i); if (s.y === now.getFullYear() && s.m === now.getMonth()) cur = i; } }
  setPro(isPro);
  renderAll();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  checkPro();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
