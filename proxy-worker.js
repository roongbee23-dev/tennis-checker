// ============================================================
// crystal-proxy worker (เวอร์ชันใหม่ รองรับหลายสนาม)
// วางแทนโค้ดเดิมทั้งหมดใน Worker "crystal-proxy" แล้วกด Deploy
// - แบบเดิม (Crystal): POST {date, stadiumId, locId}  → ทำงานเหมือนเดิมทุกอย่าง
//   (แอปเดิม + GitHub Actions แจ้งเตือน ใช้ต่อได้ ไม่ต้องแก้อะไร)
// - แบบใหม่ (Ace of Clubs): POST {provider:"ace"} → คืน {courts, bookings}
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ดึงค่า array/object literal ออกจาก HTML แบบนับวงเล็บ (กันข้อมูลมี ]} ซ้อนใน string)
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
    cf: { cacheTtl: 120, cacheEverything: true }, // แคช 2 นาที ลดโหลดเว็บต้นทาง
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
    // ส่งเฉพาะที่จำเป็น: r=court id, s=start, e=end (ตัดข้อมูลเก่ากว่าวันนี้ทิ้ง)
    bookings: bookings
      .filter(b => (b.start || '') >= today)
      .map(b => ({ r: Number(b.resourceId), s: b.start, e: b.end })),
    fetchedAt: new Date().toISOString(),
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    let body = {};
    try { body = await request.json(); } catch {}

    // ---- สนามใหม่: Ace of Clubs ----
    if (body.provider === 'ace') return handleAce();

    // ---- แบบเดิม: Crystal Sports (ห้ามแก้ เพื่อให้ระบบแจ้งเตือนเดิมทำงานต่อ) ----
    const r = await fetch('https://crystalsports-booking.kegroup.co.th/api_helper.php?action=getAvailableStadiums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: body.date, stadiumId: String(body.stadiumId), locId: body.locId }),
    });
    return new Response(await r.text(), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
    });
  },
};
