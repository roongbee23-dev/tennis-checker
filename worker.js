// Worker "app" — deploy อัตโนมัติจาก GitHub ผ่าน Workers Builds
// 1) GET /            → เสิร์ฟ index.html ล่าสุดจาก GitHub (แคช 1 นาที)
// 2) POST /api/ace    → ดึงตารางว่าง Ace of Clubs (แกะจากเว็บสนาม, แคช 2 นาที)

const HTML_SOURCE = 'https://raw.githubusercontent.com/roongbee23-dev/tennis-checker/main/index.html';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// ดึงค่า array/object literal ออกจาก HTML แบบนับวงเล็บ
function extractLiteral(html, varName) {
  const m = html.match(new RegExp('var\\s+' + varName + '\\s*=\\s*'));
  if (!m) return null;
  const i = m.index + m[0].length;
  const open = html[i];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) return null;
  let depth = 0, inStr = null, esc = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return html.slice(i, j + 1); }
  }
  return null;
}

async function handleAce() {
  const res = await fetch('https://aceofclubsbkk.com/booking/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
    },
    cf: { cacheTtl: 120, cacheEverything: true },
  });
  if (!res.ok) return json({ error: 'fetch_failed', status: res.status }, 502);
  const html = await res.text();

  const rawBookings = extractLiteral(html, 'blockedEvents');
  const rawResources = extractLiteral(html, 'aceResources');
  if (!rawBookings || !rawResources) return json({ error: 'parse_failed' }, 502);

  let bookings, resources;
  try {
    bookings = JSON.parse(rawBookings);
    resources = JSON.parse(rawResources);
  } catch (e) {
    return json({ error: 'json_failed', detail: String(e).slice(0, 200) }, 502);
  }

  const today = new Date().toISOString().slice(0, 10);
  return json({
    courts: (resources.court || []).map(c => ({ id: c.id, title: c.title, price: c.price })),
    bookings: bookings
      .filter(b => (b.start || '') >= today)
      .map(b => ({ r: Number(b.resourceId), s: b.start, e: b.end })),
    fetchedAt: new Date().toISOString(),
  });
}

async function serveHtml() {
  const res = await fetch(HTML_SOURCE, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!res.ok) {
    return new Response('โหลดหน้าเว็บไม่สำเร็จ ลองรีเฟรชอีกครั้ง', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(await res.text(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/api/ace') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return handleAce();
    }
    return serveHtml();
  },
};
