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

// อ่านข้อมูลที่ GitHub Actions ดึงไว้ (data/ace.json อัปเดตทุก 30 นาที)
async function handleAceFromRepo() {
  const r = await fetch('https://raw.githubusercontent.com/roongbee23-dev/tennis-checker/main/data/ace.json', {
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!r.ok) return json({ error: 'no_data', status: r.status }, 502);
  const data = await r.json();
  return json(data);
}

async function handleAce(debug) {
  const res = await fetch('https://aceofclubsbkk.com/booking/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Referer': 'https://aceofclubsbkk.com/',
    },
  });
  const html = await res.text();
  if (debug) {
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const out = {};
    // 1) ดู redirect ตรงๆ
    const r1 = await fetch('https://aceofclubsbkk.com/booking/', { headers: { 'User-Agent': UA }, redirect: 'manual' });
    out.direct = { status: r1.status, location: r1.headers.get('location') };
    // 2) เก็บ cookie จากหน้าแรกก่อน แล้วค่อยเรียก booking
    const r2 = await fetch('https://aceofclubsbkk.com/', { headers: { 'User-Agent': UA } });
    let cookies = [];
    if (r2.headers.getSetCookie) cookies = r2.headers.getSetCookie().map(c => c.split(';')[0]);
    else if (r2.headers.get('set-cookie')) cookies = [r2.headers.get('set-cookie').split(';')[0]];
    await r2.text();
    out.homeCookies = cookies;
    const r3 = await fetch('https://aceofclubsbkk.com/booking/', {
      headers: { 'User-Agent': UA, 'Cookie': cookies.join('; '), 'Referer': 'https://aceofclubsbkk.com/' },
      redirect: 'manual',
    });
    out.withCookie = { status: r3.status, location: r3.headers.get('location') };
    if (r3.status === 200) {
      const h3 = await r3.text();
      const tm = h3.match(/<title>([^<]*)<\/title>/i);
      out.withCookie.len = h3.length;
      out.withCookie.hasVars = h3.includes('blockedEvents');
      out.withCookie.title = tm ? tm[1].slice(0, 60) : null;
    }
    return json(out);
  }
  if (!res.ok) return json({ error: 'fetch_failed', status: res.status }, 502);

  const rawBookings = extractLiteral(html, 'blockedEvents');
  const rawResources = extractLiteral(html, 'aceResources');
  if (!rawBookings || !rawResources) return json({ error: 'parse_failed', htmlLen: html.length, status: res.status }, 502);

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
      let body = {};
      try { body = await request.json(); } catch {}
      if (body.debug) return handleAce(true);
      return handleAceFromRepo();
    }
    return serveHtml();
  },
};
