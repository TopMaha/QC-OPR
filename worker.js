/* ============================================================
   QC OPR — Cloudflare Worker (API + D1) · v0.4
   ออนไลน์/ซิงก์ข้ามอุปกรณ์ — เปิดใช้เมื่อพร้อม deploy
   ตั้ง CONFIG.API_BASE (หรือช่อง "API Base URL" ในหน้าตั้งค่า) = URL ของ Worker นี้

   Endpoints:
     GET    /api/init              -> { employees, valves, plans, records, targets }
     POST   /api/employees         -> upsert 1 พนักงาน (body = {code,name})
     DELETE /api/employees/:code   -> ลบพนักงาน
     POST   /api/valves            -> upsert 1 valve (route/stages เก็บเป็น JSON)
     DELETE /api/valves/:id        -> ลบ valve
     POST   /api/plans             -> upsert 1 แถวแผนงาน (valveNo,lot,qty,sellDate)
     DELETE /api/plans/:id         -> ลบแถวแผนงาน
     POST   /api/records           -> upsert 1 record (valveNo,process,...)
     DELETE /api/records/:id       -> ลบ record
     POST   /api/targets           -> upsert KV ตัวเลข { "key": 12345, ... }
   ============================================================ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (pathname === '/api/init' && request.method === 'GET') {
        const [employees, valves, plans, records, targets] = await Promise.all([
          env.DB.prepare('SELECT code, name FROM employees ORDER BY code').all(),
          env.DB.prepare('SELECT * FROM valves ORDER BY valve_no').all(),
          env.DB.prepare('SELECT * FROM plans ORDER BY sell_date').all(),
          env.DB.prepare('SELECT * FROM records ORDER BY ts DESC LIMIT 5000').all(),
          env.DB.prepare('SELECT key, value FROM targets').all(),
        ]);
        const t = {};
        for (const row of targets.results) t[row.key] = row.value;
        return json({
          employees: employees.results,
          valves: (valves.results || []).map(rowToValve),
          plans: (plans.results || []).map(rowToPlan),
          records: (records.results || []).map(rowToRecord),
          targets: t,
        });
      }

      if (pathname === '/api/employees' && request.method === 'POST') {
        const e = await request.json();
        if (!e || !e.code) return json({ error: 'missing code' }, 400);
        await env.DB.prepare(
          `INSERT INTO employees (code,name,updated_at) VALUES (?,?,?)
           ON CONFLICT(code) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`
        ).bind(String(e.code), e.name || '', Date.now()).run();
        return json({ ok: true, code: e.code });
      }

      if (pathname.startsWith('/api/employees/') && request.method === 'DELETE') {
        const code = decodeURIComponent(pathname.slice('/api/employees/'.length));
        await env.DB.prepare('DELETE FROM employees WHERE code=?').bind(code).run();
        return json({ ok: true });
      }

      if (pathname === '/api/valves' && request.method === 'POST') {
        const v = await request.json();
        if (!v || !v.id) return json({ error: 'missing id' }, 400);
        await env.DB.prepare(
          `INSERT INTO valves (id,valve_no,customer,product,route,stages,ts)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             valve_no=excluded.valve_no, customer=excluded.customer, product=excluded.product,
             route=excluded.route, stages=excluded.stages, ts=excluded.ts`
        ).bind(
          v.id, v.valveNo, v.customer || '', v.product || '',
          JSON.stringify(v.route || []), JSON.stringify(v.stages || {}), int(v.ts) || Date.now()
        ).run();
        return json({ ok: true, id: v.id });
      }

      if (pathname.startsWith('/api/valves/') && request.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/valves/'.length));
        await env.DB.prepare('DELETE FROM valves WHERE id=?').bind(id).run();
        return json({ ok: true });
      }

      if (pathname === '/api/plans' && request.method === 'POST') {
        const p = await request.json();
        if (!p || !p.id) return json({ error: 'missing id' }, 400);
        await env.DB.prepare(
          `INSERT INTO plans (id,valve_no,lot,qty,sell_date,ts)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             valve_no=excluded.valve_no, lot=excluded.lot, qty=excluded.qty,
             sell_date=excluded.sell_date, ts=excluded.ts`
        ).bind(
          p.id, p.valveNo, p.lot || '', int(p.qty), p.sellDate || '', int(p.ts) || Date.now()
        ).run();
        return json({ ok: true, id: p.id });
      }

      if (pathname.startsWith('/api/plans/') && request.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/plans/'.length));
        await env.DB.prepare('DELETE FROM plans WHERE id=?').bind(id).run();
        return json({ ok: true });
      }

      if (pathname === '/api/records' && request.method === 'POST') {
        const r = await request.json();
        if (!r || !r.id) return json({ error: 'missing id' }, 400);
        await env.DB.prepare(
          `INSERT INTO records (id,date,shift,valve_no,process,lot,opr,ng,pass,operator,note,ts)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             date=excluded.date, shift=excluded.shift, valve_no=excluded.valve_no,
             process=excluded.process, lot=excluded.lot, opr=excluded.opr, ng=excluded.ng,
             pass=excluded.pass, operator=excluded.operator, note=excluded.note, ts=excluded.ts`
        ).bind(
          r.id, r.date, r.shift, r.valveNo, r.process || '', r.lot || '',
          int(r.opr), int(r.ng), int(r.pass), r.operator || '', r.note || '', int(r.ts) || Date.now()
        ).run();
        return json({ ok: true, id: r.id });
      }

      if (pathname.startsWith('/api/records/') && request.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/records/'.length));
        await env.DB.prepare('DELETE FROM records WHERE id=?').bind(id).run();
        return json({ ok: true });
      }

      if (pathname === '/api/targets' && request.method === 'POST') {
        const body = await request.json();
        if (!body || typeof body !== 'object') return json({ error: 'bad body' }, 400);
        const now = Date.now();
        const stmts = [];
        let updated = 0;
        for (const [key, raw] of Object.entries(body)) {
          const value = Number(raw);
          if (!Number.isFinite(value)) continue; // numeric-only
          stmts.push(
            env.DB.prepare(
              'INSERT INTO targets (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
            ).bind(key, Math.trunc(value), now)
          );
          updated++;
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true, updated });
      }

      // เสิร์ฟ PWA จาก Worker ด้วย (ถ้าตั้ง [assets] ใน wrangler.toml)
      if (!pathname.startsWith('/api/') && env.ASSETS) return env.ASSETS.fetch(request);

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};

const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
function rowToValve(v) {
  return {
    id: v.id, valveNo: v.valve_no, customer: v.customer, product: v.product,
    route: safeParse(v.route, []), stages: safeParse(v.stages, {}), ts: v.ts,
  };
}
function rowToPlan(p) {
  return { id: p.id, valveNo: p.valve_no, lot: p.lot, qty: p.qty, sellDate: p.sell_date, ts: p.ts };
}
function rowToRecord(r) {
  return {
    id: r.id, date: r.date, shift: r.shift, valveNo: r.valve_no, process: r.process,
    lot: r.lot, opr: r.opr, ng: r.ng, pass: r.pass, operator: r.operator, note: r.note, ts: r.ts,
  };
}
function safeParse(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
