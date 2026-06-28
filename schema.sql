-- QC OPR — D1 schema (v0.4)
-- รัน: wrangler d1 execute qc-opr --remote --file=./schema.sql
--   (ทดสอบในเครื่อง: --local แทน --remote)

-- employees: รหัสพนักงานสำหรับ lock-in เข้าระบบ (+ ชื่อ อัตโนมัติเป็นผู้บันทึก)
CREATE TABLE IF NOT EXISTS employees (
  code        TEXT PRIMARY KEY,
  name        TEXT,
  updated_at  INTEGER
);

-- valves: ทะเบียน Valve No — ลูกค้า + สินค้า + route กระบวนการ (ต่อ valve) + สถานะแต่ละขั้น
CREATE TABLE IF NOT EXISTS valves (
  id        TEXT PRIMARY KEY,
  valve_no  TEXT,
  customer  TEXT,
  product   TEXT,
  route     TEXT,             -- JSON array ลำดับ process เช่น ["กลึง","เจาะ","QC"]
  stages    TEXT,             -- JSON object สถานะแต่ละขั้น {"กลึง":"done","เจาะ":"wip"}
  ts        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_valves_no   ON valves(valve_no);
CREATE INDEX IF NOT EXISTS idx_valves_cust ON valves(customer);

-- plans: แถวแผนงาน (นำเข้าจาก Excel) — Valve No + Lot + จำนวน + วันที่ขาย
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY,
  valve_no    TEXT,
  lot         TEXT,
  qty         INTEGER,        -- จำนวน (ชิ้น)
  sell_date   TEXT,           -- วันที่ขาย YYYY-MM-DD
  ts          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_plans_valve ON plans(valve_no);
CREATE INDEX IF NOT EXISTS idx_plans_sell  ON plans(sell_date);

-- records: บันทึกผลผลิต/QC ต่อ Valve No + Process (ไม่มีเครื่องจักรแล้ว)
CREATE TABLE IF NOT EXISTS records (
  id          TEXT PRIMARY KEY,
  date        TEXT,            -- YYYY-MM-DD (shift date)
  shift       TEXT,            -- 'day' | 'night'
  valve_no    TEXT,
  process     TEXT,
  lot         TEXT,
  opr         INTEGER,         -- ยอดผลิต
  ng          INTEGER,         -- ของเสีย
  pass        INTEGER,         -- ผ่าน (= opr - ng)
  operator    TEXT,            -- ชื่อผู้บันทึก (auto จาก login)
  note        TEXT,
  ts          INTEGER          -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_records_date  ON records(date);
CREATE INDEX IF NOT EXISTS idx_records_valve ON records(valve_no);
CREATE INDEX IF NOT EXISTS idx_records_ts    ON records(ts);

-- targets: KV ตัวเลข (สำรองไว้สำหรับซิงก์ค่าตั้งค่าข้ามอุปกรณ์ในอนาคต)
CREATE TABLE IF NOT EXISTS targets (
  key         TEXT PRIMARY KEY,
  value       INTEGER,
  updated_at  INTEGER
);
