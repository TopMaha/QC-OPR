-- QC OPR — D1 schema
-- รัน: wrangler d1 execute qc-opr --remote --file=./schema.sql
--   (ทดสอบในเครื่อง: --local แทน --remote)

CREATE TABLE IF NOT EXISTS machines (
  id          TEXT PRIMARY KEY,
  line        TEXT,
  process     TEXT,
  updated_at  INTEGER
);

CREATE TABLE IF NOT EXISTS records (
  id            TEXT PRIMARY KEY,
  date          TEXT,            -- YYYY-MM-DD (shift date)
  shift         TEXT,            -- 'day' | 'night'
  machine_id    TEXT,
  machine_name  TEXT,
  line          TEXT,
  process       TEXT,
  lot           TEXT,
  opr           INTEGER,         -- ยอดผลิต
  ng            INTEGER,         -- ของเสีย
  pass          INTEGER,         -- ผ่าน (= opr - ng)
  operator      TEXT,
  note          TEXT,
  ts            INTEGER          -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_records_date    ON records(date);
CREATE INDEX IF NOT EXISTS idx_records_machine ON records(machine_id);
CREATE INDEX IF NOT EXISTS idx_records_ts      ON records(ts);

-- plans: แผนงานต่อ Lot + กำหนดส่ง (ใช้คำนวณความคืบหน้า/ความด่วน เทียบกับยอด OPR ของ Lot)
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY,
  lot         TEXT,            -- ผูกกับ records.lot
  product     TEXT,
  target_qty  INTEGER,         -- เป้าหมาย (ชิ้น)
  due_date    TEXT,            -- กำหนดส่ง YYYY-MM-DD
  line        TEXT,
  process     TEXT,
  start_date  TEXT,
  note        TEXT,
  ts          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_plans_lot ON plans(lot);
CREATE INDEX IF NOT EXISTS idx_plans_due ON plans(due_date);

-- valves: ติดตามแต่ละ Valve No ผ่านกระบวนการ (route) + สถานะแต่ละขั้น (stages)
CREATE TABLE IF NOT EXISTS valves (
  id        TEXT PRIMARY KEY,
  valve_no  TEXT,
  product   TEXT,
  route     TEXT,             -- JSON array ลำดับกระบวนการ เช่น ["กลึง","เจาะ","QC"]
  stages    TEXT,             -- JSON object สถานะแต่ละขั้น {"กลึง":"done","เจาะ":"wip"}
  due_date  TEXT,
  note      TEXT,
  ts        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_valves_no ON valves(valve_no);

-- targets: KV ช่องซิงก์ข้ามอุปกรณ์ — เก็บ "ตัวเลขเท่านั้น" (numeric-only)
-- client encode ชื่อ process เป็นเลข (FNV-1a) แล้วเก็บใต้ key เช่น mcproc.M1-01
CREATE TABLE IF NOT EXISTS targets (
  key         TEXT PRIMARY KEY,
  value       INTEGER,
  updated_at  INTEGER
);
