/* ============================================================
   QC OPR — Cloudflare Worker (API + D1)
   ออนไลน์/ซิงก์ข้ามอุปกรณ์ — เปิดใช้เมื่อพร้อม deploy
   ตั้ง CONFIG.API_BASE (หรือช่อง "API Base URL" ในหน้าตั้งค่า) = URL ของ Worker นี้

   Endpoints:
     GET    /api/init           -> { machines, records, plans, valves, targets }
     POST   /api/records        -> upsert 1 record (body = record object)
     DELETE /api/records/:id    -> ลบ record
     POST   /api/plans          -> upsert 1 แผนงาน (body = plan object)
     DELETE /api/plans/:id      -> ลบแผนงาน
     POST   /api/valves         -> upsert 1 valve (body = valve object; route/stages เก็บเป็น JSON)
     DELETE /api/valves/:id     -> ลบ valve
     POST   /api/targets        -> upsert KV ตัวเลข { "mcproc.M1-01": 12345, ... }

   หมายเหตุ: ตาราง targets เก็บค่าเป็น INTEGER เท่านั้น (numeric-only)
   เพื่อให้สอดคล้องกับแพทเทิร์น cross-device KV sync — client encode ชื่อ
   process เป็นเลข (FNV-1a) ก่อนส่งมา แล้วถอดกลับฝั่ง client เอง.
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
        const [machines, records, plans, valves, targets] = await Promise.all([
          env.DB.prepare('SELECT id, line, process FROM machines ORDER BY id').all(),
          env.DB.prepare('SELECT * FROM records ORDER BY ts DESC LIMIT 5000').all(),
          env.DB.prepare('SELECT * FROM plans ORDER BY due_date').all(),
          env.DB.prepare('SELECT * FROM valves ORDER BY valve_no').all(),
          env.DB.prepare('SELECT key, value FROM targets').all(),
        ]);
        const t = {};
        for (const row of targets.results) t[row.key] = row.value;
        return json({
          machines: machines.results,
          records: (records.results || []).map(rowToRecord),
          plans: (plans.results || []).map(rowToPlan),
          valves: (valves.results || []).map(rowToValve),
          targets: t,
        });
      }

      if (pathname === '/api/valves' && request.method === 'POST') {
        const v = await request.json();
        if (!v || !v.id) return json({ error: 'missing id' }, 400);
        await env.DB.prepare(
          `INSERT INTO valves (id,valve_no,product,route,stages,due_date,note,ts)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             valve_no=excluded.valve_no, product=excluded.product, route=excluded.route,
             stages=excluded.stages, due_date=excluded.due_date, note=excluded.note, ts=excluded.ts`
        ).bind(
          v.id, v.valveNo, v.product || '', JSON.stringify(v.route || []),
          JSON.stringify(v.stages || {}), v.dueDate || '', v.note || '', int(v.ts) || Date.now()
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
          `INSERT INTO plans (id,lot,product,target_qty,due_date,line,process,start_date,note,ts)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             lot=excluded.lot, product=excluded.product, target_qty=excluded.target_qty,
             due_date=excluded.due_date, line=excluded.line, process=excluded.process,
             start_date=excluded.start_date, note=excluded.note, ts=excluded.ts`
        ).bind(
          p.id, p.lot, p.product || '', int(p.targetQty), p.dueDate, p.line || '',
          p.process || '', p.startDate || '', p.note || '', int(p.ts) || Date.now()
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
          `INSERT INTO records (id,date,shift,machine_id,machine_name,line,process,lot,opr,ng,pass,operator,note,ts)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             date=excluded.date, shift=excluded.shift, machine_id=excluded.machine_id,
             machine_name=excluded.machine_name, line=excluded.line, process=excluded.process,
             lot=excluded.lot, opr=excluded.opr, ng=excluded.ng, pass=excluded.pass,
             operator=excluded.operator, note=excluded.note, ts=excluded.ts`
        ).bind(
          r.id, r.date, r.shift, r.machineId, r.machineName, r.line, r.process, r.lot || '',
          int(r.opr), int(r.ng), int(r.pass), r.operator || '', r.note || '', int(r.ts) || Date.now()
        ).run();
        // อัปเดต/เพิ่มเครื่องอัตโนมัติจาก record (กันกรณีเครื่องใหม่)
        await env.DB.prepare(
          'INSERT INTO machines (id,line,process,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET line=excluded.line, process=excluded.process, updated_at=excluded.updated_at'
        ).bind(r.machineId, r.line || '', r.process || '', Date.now()).run();
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
          if (!Number.isFinite(value)) continue; // numeric-only — string ถูกทิ้ง (ตามแพทเทิร์น)
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
function rowToRecord(r) {
  return {
    id: r.id, date: r.date, shift: r.shift, machineId: r.machine_id, machineName: r.machine_name,
    line: r.line, process: r.process, lot: r.lot, opr: r.opr, ng: r.ng, pass: r.pass,
    operator: r.operator, note: r.note, ts: r.ts,
  };
}
function rowToPlan(p) {
  return {
    id: p.id, lot: p.lot, product: p.product, targetQty: p.target_qty, dueDate: p.due_date,
    line: p.line, process: p.process, startDate: p.start_date, note: p.note, ts: p.ts,
  };
}
function rowToValve(v) {
  return {
    id: v.id, valveNo: v.valve_no, product: v.product,
    route: safeParse(v.route, []), stages: safeParse(v.stages, {}),
    dueDate: v.due_date, note: v.note, ts: v.ts,
  };
}
function safeParse(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
