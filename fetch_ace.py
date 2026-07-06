# ดึงตารางจอง Ace of Clubs -> data/ace.json (รันโดย GitHub Actions ทุก 30 นาที)
import json, os, re, sys, datetime, urllib.request

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
req = urllib.request.Request('https://aceofclubsbkk.com/booking/', headers={
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
})
html = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', errors='ignore')
print('fetched len=%d' % len(html))

def extract(name):
    m = re.search(r'var\s+' + name + r'\s*=\s*', html)
    if not m:
        return None
    i = m.end()
    open_c = html[i]
    close_c = ']' if open_c == '[' else '}'
    depth = 0; instr = None; esc = False
    for j in range(i, len(html)):
        ch = html[j]
        if esc: esc = False; continue
        if instr:
            if ch == '\\': esc = True
            elif ch == instr: instr = None
            continue
        if ch in '"\'':
            instr = ch
        elif ch == open_c:
            depth += 1
        elif ch == close_c:
            depth -= 1
            if depth == 0:
                return html[i:j+1]
    return None

raw_b = extract('blockedEvents')
raw_r = extract('aceResources')
if not raw_b or not raw_r:
    title = re.search(r'<title>([^<]*)</title>', html)
    print('PARSE FAILED. title=%s' % (title.group(1) if title else '?'))
    sys.exit(1)

bookings = json.loads(raw_b)
res = json.loads(raw_r)
today = datetime.date.today().isoformat()
out = {
    'courts': [{'id': c['id'], 'title': c['title'], 'price': c.get('price')} for c in res.get('court', [])],
    'bookings': [
        {'r': int(b['resourceId']), 's': b['start'], 'e': b['end']}
        for b in bookings if (b.get('start') or '') >= today
    ],
    'fetchedAt': datetime.datetime.utcnow().isoformat() + 'Z',
}
os.makedirs('data', exist_ok=True)
json.dump(out, open('data/ace.json', 'w'))
print('OK courts=%d bookings=%d' % (len(out['courts']), len(out['bookings'])))
