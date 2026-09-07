-- ไฟล์: supabase/card.sql
-- ============================================================================
-- JodFlow — บัตรเครดิตทั้งระบบในไฟล์เดียว   [card.sql]
--
-- วิธีใช้: Supabase → SQL Editor → ตรวจว่า Role เป็น postgres → วางทั้งไฟล์ → Run
-- ทุกคำสั่งเป็น if not exists / create or replace รันซ้ำได้ไม่เสียหาย
-- และไม่มีคำสั่งใดลบข้อมูลของร้าน
--
-- ไฟล์นี้รวมของเดิม 5 ไฟล์ไว้ด้วยกัน (card / card_statement / card_installment /
-- card_extra / card_interest) โดยเก็บเฉพาะ "เวอร์ชันสุดท้าย" ของแต่ละฟังก์ชัน
-- ฐานข้อมูลที่เคยรันไฟล์เก่าไปแล้วรันไฟล์นี้ทับได้เลย ผลลัพธ์เหมือนกัน
--
-- ต้องรันหลัง setup.sql และ fix.sql เสมอ เพราะทับฟังก์ชันชุดเดียวกับ fix.sql
-- และถ้ารัน columns.sql ใหม่เมื่อไร ต้องรันไฟล์นี้ซ้ำ เพราะ columns.sql จะตั้ง
-- constraint ของ transactions.method กลับเป็นชุดที่ไม่มี 'card'
--
-- ── แนวคิดหลักสี่ข้อ ────────────────────────────────────────────────────────
--
-- 1) บัตรเครดิตคือ "กระเป๋าเงินชนิดที่สี่" ต่อจาก cash / transfer / sub
--    ปลายทางของเงินเขียนเป็น 'card:<uuid>' แล้วเสียบเข้า apply_wallet_effect
--    ทำให้ post_transaction / edit_transaction / cancel_transaction รองรับบัตร
--    ทันที รวมถึงการย้อนยอดตอนแก้ไขและคืนยอดตอนยกเลิก
--
-- 2) บัตรเป็นหนี้ ไม่ใช่ทรัพย์สิน สาขา card จึงเก็บ outstanding - delta
--      รูดจ่าย (expense) delta = -1000 → outstanding เพิ่ม 1000
--      เงินคืน (income)  delta = +50   → outstanding ลด   50
--
-- 3) เก็บเฉพาะรอบบิลที่ "ปิดแล้ว" รอบที่กำลังเดินอยู่ไม่มีแถวในตาราง
--    เพราะยอดเปลี่ยนทุกครั้งที่รูด หน้าจอคำนวณสดจาก transactions เอา
--
-- 4) จ่ายบิลคือการย้ายเงิน ไม่ใช่รายจ่าย ค่าใช้จ่ายเกิดตอนรูดไปแล้ว
--    ถ้าบันทึกเป็นรายจ่ายอีกครั้งตอนจ่ายบิล ยอดจะถูกนับซ้ำสองเท่า
--    pay_card_statement จึงไม่ insert transactions แต่ขยับสองกระเป๋าพร้อมกัน
--
-- 5) บิลใบใหม่เก็บ "ทุกอย่างที่ยังไม่มีใบไหนครอบ" ไม่ใช่ "ของในช่วงวันที่ของรอบ"
--    รายการที่ลงย้อนหลัง งวดผ่อนที่ตกค้างจากรอบที่ข้ามไป และผลจากการเปลี่ยน
--    วันสรุปยอด จึงไม่หายและไม่ถูกเก็บซ้ำ (ดู close_card_statement ส่วนที่ 5)
--
-- ── อัปเดตล่าสุด ─────────────────────────────────────────────────────────────
-- • close_card_statement เปลี่ยนกฎการเก็บตามข้อ 5
-- • ส่วนที่ 12: ตารางขาการจ่ายบิล / paid_amount ของงวด / refund_source /
--   trigger กันลบรายจ่ายที่เป็นค่างวด
-- • งวดของสัญญาที่บันทึกย้อนหลังซึ่งตกในรอบที่ออกบิลไปแล้ว ถูกเติมเข้าบิลใบนั้น
--   ทันทีตอนสร้าง/แก้แผน (attach_installment_to_closed_statements) — ต้องรันไฟล์นี้ซ้ำ
-- • ส่วนที่ 14: ซ่อมย้อนหลังให้สัญญาที่มีอยู่ก่อนแพตช์นั้น (ตอนนั้นแก้ให้เฉพาะสัญญา
--   ที่สร้าง/แก้ใหม่) สัญญาเก่าจึงยังโชว์สองงวดของใบเดียวกันในบิลรอบเดียว
-- • ส่วนที่ 15: ยอดรูดที่ธนาคารเก็บในบิลใบที่ออกไปแล้ว ใส่เข้าใบนั้นได้
--   (transactions.card_statement_id + attach/detach + trigger ซิงค์ยอดบิล)
--   และบิลรอบถัดไปข้ามรายการที่ผูกใบแล้ว จึงไม่ถูกเก็บซ้ำ
-- • ส่วนที่ 16: จ่ายรายการรูดทีละรายการก่อนออกบิล (prepay_card_transaction /
--   undo_card_prepayment) บิลที่ออกมารับรู้ยอดที่จ่ายไว้แล้วเป็น paid_amount ตั้งแต่ต้น
-- (เปิดแท็บเดิมใน SQL Editor ลบของเก่า วางทั้งไฟล์ Run) ไม่มีการลบข้อมูล
-- ผลตรวจต้องได้ ตาราง 6/6 · คอลัมน์ 15/15 · ฟังก์ชัน 18/18 และส่วนที่ 14 เป็น 0 ทั้งสองแถว
-- ============================================================================


-- ###########################################################################
-- ##  1. ตาราง
-- ###########################################################################

-- ── บัตร ────────────────────────────────────────────────────────────────────

create table if not exists credit_cards (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  bank_name     text not null default '',
  name          text not null default '',
  -- เลขสี่ตัวท้าย ไว้แยกบัตรที่ธนาคารเดียวกัน — ห้ามเก็บเลขบัตรเต็ม
  last4         text,
  credit_limit  numeric(14,2) not null default 0,
  -- หนี้คงค้าง ค่าบวก = เป็นหนี้ ขยับผ่าน apply_wallet_effect เท่านั้น
  outstanding   numeric(14,2) not null default 0,
  closing_day   int not null default 25 check (closing_day between 1 and 31),
  due_day       int not null default 15 check (due_day between 1 and 31),
  cashback_rate numeric(5,2) not null default 0,
  note          text,
  enabled       boolean not null default true,
  deleted       boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists credit_cards_shop_idx
  on credit_cards (shop_id, sort_order, created_at);

-- ตั้งค่าหักบัญชีอัตโนมัติที่ผู้ใช้ผูกไว้กับธนาคาร
--
-- "หักบัญชีอัตโนมัติ" มีสองความหมายและต้องแยกให้ชัด
--   1) เงินถูกหักจริงจากบัญชี — เกิดที่ธนาคาร ผู้ใช้สมัครเอง JodFlow ทำแทนไม่ได้
--   2) แอปรู้ว่าถูกหักไปแล้ว — ทำได้ ให้ผู้ใช้บอกว่าผูกไว้แบบไหน แล้วแอปเตรียม
--      รายการจ่ายบิลไว้ให้ตรงกับที่ธนาคารจะหัก เหลือแค่กดยืนยัน
-- คอลัมน์พวกนี้เก็บแค่ข้อ 2 ไม่มีอะไรหักเงินเอง เพราะแอปไม่มีทางรู้ว่าธนาคาร
-- หักสำเร็จจริงหรือไม่ (เงินอาจไม่พอ บัตรอาจถูกระงับ)
alter table credit_cards add column if not exists autopay_mode text not null default 'off';
alter table credit_cards drop constraint if exists credit_cards_autopay_mode_check;
alter table credit_cards add  constraint credit_cards_autopay_mode_check
  check (autopay_mode in ('off', 'full', 'minimum', 'fixed'));

alter table credit_cards add column if not exists autopay_account_id uuid
  references transfer_accounts(id) on delete set null;
alter table credit_cards add column if not exists autopay_amount numeric(14,2) not null default 0;

-- ค่าธรรมเนียมรายปี (จัดการข้อมูล → บัตรเครดิต) — แอปเตือนเมื่อถึงเดือน ผู้ใช้กดบันทึกเป็นรายจ่ายเอง
alter table credit_cards add column if not exists annual_fee       numeric(14,2) not null default 0;
alter table credit_cards add column if not exists annual_fee_month int check (annual_fee_month between 1 and 12);

-- ── ใบแจ้งยอด (เก็บเฉพาะรอบที่ปิดแล้ว) ──────────────────────────────────────

create table if not exists card_statements (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references shops(id) on delete cascade,
  card_id        uuid not null references credit_cards(id) on delete cascade,
  -- 'YYYY-MM' ของเดือนที่ปิดรอบ — กันปิดซ้ำด้วย unique ข้างล่าง
  cycle          text not null,
  period_start   date not null,
  period_end     date not null,   -- วันสรุปยอด
  due_date       date not null,   -- วันครบกำหนดชำระ
  status         text not null default 'closed'
                 check (status in ('closed', 'partial', 'paid')),

  previous_balance numeric(14,2) not null default 0,  -- ยอดยกมาจากรอบก่อนที่จ่ายไม่หมด
  spend_amount     numeric(14,2) not null default 0,  -- ยอดรูดในรอบ
  credit_amount    numeric(14,2) not null default 0,  -- เงินคืน / คืนสินค้า ในรอบ
  amount           numeric(14,2) not null default 0,  -- ยอดที่ต้องชำระ
  minimum_amount   numeric(14,2) not null default 0,
  paid_amount      numeric(14,2) not null default 0,

  -- ยอดที่จ่ายไม่หมดถูกยกไปอยู่ในใบไหน — กันนับยอดค้างซ้ำตอนปิดรอบถัดไป
  carried_to     uuid references card_statements(id) on delete set null,

  paid_at             date,
  paid_method         text check (paid_method in ('cash', 'transfer')),
  transfer_account_id uuid references transfer_accounts(id) on delete set null,

  closed_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (card_id, cycle)
);

create index if not exists card_statements_shop_due_idx
  on card_statements (shop_id, status, due_date);
create index if not exists card_statements_card_idx
  on card_statements (card_id, period_end desc);

-- ── ผ่อนชำระ ────────────────────────────────────────────────────────────────
--
-- ตอนกดซื้อ **ไม่สร้างรายจ่ายก้อนเดียว** ธนาคารเรียกเก็บทีละงวด เงินไหลออกจริง
-- ทีละงวด ถ้าลงก้อนเดียวรายจ่ายเดือนที่ซื้อจะพองผิดปกติ และเดือนถัดไปจะดูเหมือน
-- ไม่มีภาระทั้งที่ยังผ่อนอยู่ ตอนสร้างจึงบันทึกแค่สัญญากับตารางงวด
--
-- ดอกเบี้ยคิดแบบคงที่จากเงินต้น (flat rate) ซึ่งเป็นแบบที่โปรผ่อนสินค้าในไทยใช้
--   ยอดผ่อนรวม = เงินต้น × (1 + อัตราต่อเดือน% ÷ 100 × จำนวนงวด)
--   ตัวอย่าง เงินต้น 100 ผ่อน 10 งวด 3%/เดือน → ดอกเบี้ย 30 รวม 130 งวดละ 13
--   principal_amount = ราคาสินค้า
--   total_amount     = ยอดที่ต้องผ่อนจริงรวมดอกเบี้ยแล้ว = ผลรวมของทุกงวด

create table if not exists card_installments (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references shops(id) on delete cascade,
  card_id        uuid not null references credit_cards(id) on delete cascade,
  name           text not null default '',
  vendor         text,
  category_id    uuid references categories(id) on delete set null,
  note           text,

  total_amount   numeric(14,2) not null,
  months         int not null check (months between 1 and 120),
  monthly_amount numeric(14,2) not null,
  interest_rate  numeric(5,2) not null default 0,   -- อัตราต่อเดือน

  purchase_date  date not null,
  first_cycle    text not null,        -- 'YYYY-MM' ของรอบแรกที่เรียกเก็บ
  status         text not null default 'active'
                 check (status in ('active', 'completed', 'cancelled')),

  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table card_installments add column if not exists principal_amount numeric(14,2);
-- แถวเดิมที่สร้างก่อนมีช่องดอกเบี้ยเป็นผ่อน 0% ทั้งหมด เงินต้นจึงเท่ากับยอดรวม
update card_installments set principal_amount = total_amount where principal_amount is null;
alter table card_installments alter column principal_amount set default 0;

create index if not exists card_installments_card_idx
  on card_installments (card_id, status, created_at);

-- หนึ่งแถวต่อหนึ่งงวด — โครงเดียวกับ recurring_items คู่กับ recurring_entries
--
-- งวดที่ "จ่ายแล้ว" ไม่เก็บสถานะซ้ำ อ่านจากใบแจ้งยอดที่ statement_id ชี้ไป
-- ถ้าเก็บสองที่ วันหนึ่งจะมีที่หนึ่งอัปเดตไม่ทันแล้วตัวเลขสองหน้าจะขัดกัน
create table if not exists card_installment_entries (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references shops(id) on delete cascade,
  installment_id uuid not null references card_installments(id) on delete cascade,
  seq            int not null,          -- งวดที่เท่าไร
  cycle          text not null,         -- รอบบิลที่งวดนี้จะเข้า
  due_date       date not null,         -- เก็บไว้เพื่อให้แสดงตารางได้โดยไม่ต้อง join
  amount         numeric(14,2) not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'billed', 'cancelled')),

  statement_id   uuid references card_statements(id) on delete set null,
  transaction_id uuid references transactions(id) on delete set null,
  billed_at      date,

  created_at     timestamptz not null default now(),
  unique (installment_id, seq)
);

create index if not exists card_installment_entries_cycle_idx
  on card_installment_entries (installment_id, cycle, status);

-- [payments-table-start]
-- ── ขาการจ่ายบิล ─────────────────────────────────────────────────────────────
-- บิลใบเดียวจ่ายได้หลายรอบจากคนละกระเป๋า ต้องจำทีละขา ตอนย้อนถึงคืนถูกกระเป๋า
-- ต้องอยู่ตรงนี้ ก่อนฟังก์ชันทุกตัว — undo_card_payment ประกาศตัวแปรชนิดตารางนี้
-- และ Postgres ตรวจชนิดตัวแปรตอนสร้างฟังก์ชัน ถ้าตารางอยู่ท้ายไฟล์จะ error 42704
create table if not exists card_statement_payments (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references shops(id) on delete cascade,
  statement_id        uuid not null references card_statements(id) on delete cascade,
  method              text not null check (method in ('cash', 'transfer')),
  transfer_account_id uuid references transfer_accounts(id) on delete set null,
  amount              numeric(14,2) not null check (amount > 0),
  paid_at             date not null,
  created_at          timestamptz not null default now()
);
create index if not exists card_statement_payments_stmt_idx
  on card_statement_payments (statement_id, created_at desc);

-- ขาที่จ่าย "ก่อนออกบิล" ให้รายการรูดทีละรายการ (ดูส่วนที่ 16) ยังไม่มีใบให้ผูก
-- statement_id จึงว่างได้ และต้องจำเองว่าเป็นของบัตรใบไหน จ่ายให้รายการไหน
alter table card_statement_payments alter column statement_id drop not null;
alter table card_statement_payments add column if not exists card_id uuid
  references credit_cards(id) on delete cascade;
alter table card_statement_payments add column if not exists transaction_id uuid
  references transactions(id) on delete set null;
-- ขาเก่าที่จ่ายผ่านบิล เติม card_id ให้จากใบที่ผูกอยู่ (รันซ้ำได้ แถวที่มีแล้วไม่แตะ)
update card_statement_payments p
   set card_id = s.card_id
  from card_statements s
 where p.card_id is null and s.id = p.statement_id;
create index if not exists card_statement_payments_open_idx
  on card_statement_payments (card_id) where statement_id is null;

-- ยอดที่จ่ายจริงของงวด แยกจากยอดตามตาราง (ดูส่วนที่ 12)
alter table card_installment_entries add column if not exists paid_amount numeric(14,2);
-- [payments-table-end]


-- ###########################################################################
-- ##  2. คอลัมน์และ constraint บนตารางเดิม
-- ###########################################################################

alter table transactions add column if not exists card_id uuid
  references credit_cards(id) on delete set null;
create index if not exists transactions_card_idx on transactions (card_id, date desc);

-- รู้ว่ารายจ่ายแถวนี้มาจากงวดผ่อนไหน — ใช้กรองในรายงานว่าอันไหนเป็นภาระผ่อน
alter table transactions add column if not exists installment_entry_id uuid
  references card_installment_entries(id) on delete set null;

-- ของเดิมอนุญาต cash / transfer / pending / other (ดู columns.sql)
alter table transactions drop constraint if exists transactions_method_check;
alter table transactions add  constraint transactions_method_check
  check (method in ('cash', 'transfer', 'pending', 'other', 'card'));

-- รายการประจำจ่ายผ่านบัตรได้ เช่นค่าเน็ต ค่าสตรีมมิง ที่ตัดบัตรทุกเดือน
alter table recurring_entries drop constraint if exists recurring_entries_paid_method_check;
alter table recurring_entries add  constraint recurring_entries_paid_method_check
  check (paid_method in ('cash', 'transfer', 'pending', 'card'));

alter table recurring_entries add column if not exists card_id uuid
  references credit_cards(id) on delete set null;

-- อัตราผ่อนชำระขั้นต่ำ เก็บเป็นค่าตั้งค่า ไม่ใช่ค่าคงที่ในโค้ด
-- เกณฑ์ ธปท. คือ 8% ถึงรอบบัญชีเดือน ธ.ค. 2569 แล้วเป็น 10% ตั้งแต่ ม.ค. 2570
alter table shop_settings add column if not exists card_min_rate numeric(5,2) not null default 8;


-- ###########################################################################
-- ##  3. ปลายทางของเงิน — เพิ่มสาขา card
-- ###########################################################################

create or replace function public.apply_wallet_effect(
  p_shop uuid, p_target text, p_delta numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v_kind text; v_id text;
begin
  if p_target is null or p_delta = 0 then return; end if;
  perform assert_can_edit(p_shop);

  v_kind := split_part(p_target, ':', 1);
  v_id   := nullif(split_part(p_target, ':', 2), '');

  -- ทุกสาขาต้องตรวจว่าแก้โดนแถวจริง — ปลายทางที่ไม่ใช่ของร้านนี้ (หรือถูกลบไปแล้ว)
  -- ถ้าปล่อยผ่านเงียบๆ รายการจะถูกบันทึกโดยไม่มีเงินขยับ = ยอดไม่ตรงโดยไม่มีใครรู้
  if v_kind = 'cash' then
    update wallet_state set cash = cash + p_delta, updated_at = now() where shop_id = p_shop;
    if not found then raise exception 'ไม่พบกระเป๋าเงินสดของร้านนี้'; end if;
  elsif v_kind = 'transfer' then
    update transfer_accounts set balance = balance + p_delta
     where id = v_id::uuid and shop_id = p_shop;
    if not found then raise exception 'ไม่พบบัญชีเงินโอนของร้านนี้'; end if;
  elsif v_kind = 'sub' then
    update sub_wallets set balance = balance + p_delta
     where id = v_id::uuid and shop_id = p_shop;
    if not found then raise exception 'ไม่พบกระเป๋าตังค์ย่อยของร้านนี้'; end if;
  elsif v_kind = 'card' then
    -- กลับเครื่องหมาย: บัตรเป็นหนี้ รูดแล้วหนี้เพิ่ม จ่ายบิลแล้วหนี้ลด
    update credit_cards set outstanding = outstanding - p_delta, updated_at = now()
     where id = v_id::uuid and shop_id = p_shop;
    if not found then raise exception 'ไม่พบบัตรเครดิตของร้านนี้'; end if;
  else
    raise exception 'ปลายทางไม่ถูกต้อง: %', p_target;
  end if;
end;
$$;


-- ###########################################################################
-- ##  4. บันทึก / แก้ไขรายการ — พก card_id ไปด้วย
-- ###########################################################################
-- คอลัมน์ที่ไม่อยู่ในรายชื่อของคำสั่ง insert จะถูกทิ้งเงียบๆ จึงต้องเพิ่มที่นี่ด้วย

create or replace function public.post_transaction(
  p_shop   uuid,
  p_tx     jsonb,
  p_target text default null,
  p_delta  numeric default 0,
  p_log    jsonb default null
) returns transactions language plpgsql security definer set search_path = public as $$
declare v_tx transactions; v_log jsonb;
begin
  perform assert_can_edit(p_shop);

  -- client ส่ง p_tx ผ่าน toRow() จึงเป็น snake_case (item_name, category_id, ...)
  -- รับ camelCase ไว้ด้วยเผื่อผู้เรียกเก่า
  insert into transactions (
    shop_id, date, type, amount, method, category_id, item_name, vendor,
    receipt_no, tax_status, due_date, tax_due_date, note, detail, other_income_type,
    transfer_account_id, card_id, recurring_entry_id, attachments,
    document_path, document_type, document_label, created_by
  ) values (
    p_shop,
    (p_tx->>'date')::date,
    p_tx->>'type',
    (p_tx->>'amount')::numeric,
    p_tx->>'method',
    nullif(coalesce(p_tx->>'category_id', p_tx->>'categoryId'), '')::uuid,
    coalesce(p_tx->>'item_name', p_tx->>'itemName', ''),
    p_tx->>'vendor',
    coalesce(p_tx->>'receipt_no', p_tx->>'receiptNo'),
    coalesce(p_tx->>'tax_status', p_tx->>'taxStatus'),
    nullif(coalesce(p_tx->>'due_date', p_tx->>'dueDate'), '')::date,
    nullif(coalesce(p_tx->>'tax_due_date', p_tx->>'taxDueDate'), '')::date,
    p_tx->>'note',
    p_tx->>'detail',
    coalesce(p_tx->>'other_income_type', p_tx->>'otherIncomeType'),
    nullif(coalesce(p_tx->>'transfer_account_id', p_tx->>'transferAccountId'), '')::uuid,
    nullif(coalesce(p_tx->>'card_id', p_tx->>'cardId'), '')::uuid,
    nullif(coalesce(p_tx->>'recurring_entry_id', p_tx->>'recurringEntryId'), '')::uuid,
    coalesce(p_tx->'attachments', '[]'::jsonb),
    coalesce(p_tx->>'document_path', p_tx->>'documentPath'),
    coalesce(p_tx->>'document_type', p_tx->>'documentType'),
    coalesce(p_tx->>'document_label', p_tx->>'documentLabel'),
    auth.uid()
  ) returning * into v_tx;

  perform apply_wallet_effect(p_shop, p_target, p_delta);

  -- ฝัง id ของรายการลงใน log ให้หน้าประวัติจับคู่ได้ว่า log นี้คือรายการไหน
  v_log := p_log;
  if v_log is not null then
    v_log := jsonb_set(
      v_log, '{newValue}',
      coalesce(v_log->'newValue', '{}'::jsonb) || jsonb_build_object('transactionId', v_tx.id)
    );
  end if;
  perform write_log(p_shop, v_log);
  return v_tx;
end;
$$;

create or replace function public.edit_transaction(
  p_tx_id          uuid,
  p_changes        jsonb,
  p_reverse_target text    default null,
  p_reverse_delta  numeric default 0,
  p_apply_target   text    default null,
  p_apply_delta    numeric default 0,
  p_log            jsonb   default null
) returns transactions language plpgsql security definer set search_path = public as $$
declare v_shop uuid; v_tx transactions;
begin
  select shop_id into v_shop from transactions where id = p_tx_id;
  if v_shop is null then raise exception 'ไม่พบรายการนี้'; end if;
  perform assert_can_edit(v_shop);

  update transactions set
    date                = case when p_changes ? 'date'                then (p_changes->>'date')::date                          else date                end,
    amount              = case when p_changes ? 'amount'              then (p_changes->>'amount')::numeric                     else amount              end,
    method              = case when p_changes ? 'method'              then p_changes->>'method'                                else method              end,
    item_name           = case when p_changes ? 'item_name'           then coalesce(p_changes->>'item_name', '')               else item_name           end,
    category_id         = case when p_changes ? 'category_id'         then nullif(p_changes->>'category_id', '')::uuid         else category_id         end,
    vendor              = case when p_changes ? 'vendor'              then p_changes->>'vendor'                                else vendor              end,
    receipt_no          = case when p_changes ? 'receipt_no'          then p_changes->>'receipt_no'                            else receipt_no          end,
    tax_status          = case when p_changes ? 'tax_status'          then p_changes->>'tax_status'                            else tax_status          end,
    due_date            = case when p_changes ? 'due_date'            then nullif(p_changes->>'due_date', '')::date            else due_date            end,
    tax_due_date        = case when p_changes ? 'tax_due_date'        then nullif(p_changes->>'tax_due_date', '')::date        else tax_due_date        end,
    note                = case when p_changes ? 'note'                then p_changes->>'note'                                  else note                end,
    detail              = case when p_changes ? 'detail'              then p_changes->>'detail'                                else detail              end,
    other_income_type   = case when p_changes ? 'other_income_type'   then p_changes->>'other_income_type'                     else other_income_type   end,
    transfer_account_id = case when p_changes ? 'transfer_account_id' then nullif(p_changes->>'transfer_account_id', '')::uuid else transfer_account_id end,
    card_id             = case when p_changes ? 'card_id'             then nullif(p_changes->>'card_id', '')::uuid             else card_id             end,
    attachments         = case when p_changes ? 'attachments'         then coalesce(p_changes->'attachments', '[]'::jsonb)     else attachments         end,
    document_path       = case when p_changes ? 'document_path'       then p_changes->>'document_path'                         else document_path       end,
    document_type       = case when p_changes ? 'document_type'       then p_changes->>'document_type'                         else document_type       end,
    document_label      = case when p_changes ? 'document_label'      then p_changes->>'document_label'                        else document_label      end,
    updated_at          = now()
  where id = p_tx_id
  returning * into v_tx;

  perform apply_wallet_effect(v_shop, p_reverse_target, p_reverse_delta);
  perform apply_wallet_effect(v_shop, p_apply_target, p_apply_delta);
  perform write_log(v_shop, p_log);
  return v_tx;
end;
$$;


-- ###########################################################################
-- ##  5. ปิดรอบบิล
-- ###########################################################################
-- ขอบเขตของรอบคำนวณที่ฝั่ง client (src/lib/cardCycle.js ซึ่งมีเทสต์แล้ว) แล้วส่งเข้ามา
-- จะได้ไม่ต้องเขียนเลขวันที่ซ้ำสองภาษาแล้วเพี้ยนคนละแบบ
--
-- ดึงงวดผ่อนที่ถึงกำหนดเข้าบิล **ก่อน** รวมยอดรูด งวดที่สร้างเป็น transaction แล้ว
-- จะถูกนับใน spend_amount เอง จึงไม่ต้องบวกยอดผ่อนแยกอีกชั้น ไม่มีทางนับซ้ำ

create or replace function public.close_card_statement(
  p_shop  uuid,
  p_card  uuid,
  p_cycle text,
  p_start date,
  p_end   date,
  p_due   date
) returns card_statements language plpgsql security definer set search_path = public as $$
declare
  v_st     card_statements;
  v_prev   numeric(14,2);
  v_spend  numeric(14,2);
  v_credit numeric(14,2);
  v_adv    numeric(14,2);
  v_amount numeric(14,2);
  v_rate   numeric(5,2);
  v_min    numeric(14,2);
  v_entry  record;
  v_tx     transactions;
  v_prepaid    numeric(14,2);
  v_prepaid_at date;
  v_last_leg   card_statement_payments;
begin
  perform assert_can_edit(p_shop);

  if not exists (select 1 from credit_cards where id = p_card and shop_id = p_shop) then
    raise exception 'ไม่พบบัตรเครดิตของร้านนี้';
  end if;

  -- ปิดไปแล้ว → คืนใบเดิม ไม่ทำอะไรซ้ำ (หน้าจอเรียกทุกครั้งที่เปิดแอป)
  select * into v_st from card_statements where card_id = p_card and cycle = p_cycle;
  if found then return v_st; end if;

  -- ยอดค้างจากใบก่อนหน้าที่ยังไม่ถูกยกไปไหน
  -- รวมใบที่จ่ายเกิน (amount - paid_amount ติดลบ) ด้วย เครดิตจะได้ไหลไปหักรอบถัดไป
  -- เทียบกับ p_end ไม่ใช่ p_start: ถ้าวันสรุปยอดถูกเปลี่ยนจนรอบใหม่เหลื่อมรอบเก่า
  -- ใบก่อนหน้าจะมี period_end หลัง p_start แล้วหลุดจากการยกยอดไปหนึ่งรอบเต็มๆ
  select coalesce(sum(amount - paid_amount), 0) into v_prev
    from card_statements
   where card_id = p_card and carried_to is null
     and (status <> 'paid' or amount - paid_amount < 0) and period_end < p_end;

  -- งวดผ่อนที่ถึงรอบนี้ → สร้างรายจ่ายหนึ่งแถวต่องวด แล้วเพิ่มหนี้เท่ายอดงวดเดียว
  --
  -- e.cycle <= p_cycle ไม่ใช่ = : งวดที่ตกค้างจากรอบก่อน (รอบที่ไม่ได้ถูกปิดเพราะ
  -- บันทึกสัญญาย้อนหลัง หรือวันสรุปยอดถูกเปลี่ยนจนรอบเก่าหาย) จะถูกกวาดมาเก็บใน
  -- บิลใบถัดไปเสมอ เหมือนที่ธนาคารทำ แทนที่จะค้างเป็น pending ตลอดไปโดยไม่มีใครเห็น
  for v_entry in
    select e.*, i.name, i.vendor, i.category_id, i.months
      from card_installment_entries e
      join card_installments i on i.id = e.installment_id
     where i.card_id = p_card and i.status = 'active'
       and e.cycle <= p_cycle and e.status = 'pending'
     order by e.cycle, e.seq
  loop
    insert into transactions (
      shop_id, date, type, amount, method, category_id, item_name, vendor,
      card_id, installment_entry_id, note, created_by
    ) values (
      p_shop, p_end, 'expense', v_entry.amount, 'card', v_entry.category_id,
      v_entry.name || ' (งวด ' || v_entry.seq || '/' || v_entry.months || ')',
      v_entry.vendor, p_card, v_entry.id,
      'งวดผ่อนที่เรียกเก็บอัตโนมัติ', auth.uid()
    ) returning * into v_tx;

    -- รูดจ่าย = delta ติดลบ สาขา card กลับเครื่องหมายเป็นหนี้เพิ่ม
    perform apply_wallet_effect(p_shop, 'card:' || p_card, -v_entry.amount);

    update card_installment_entries
       set status = 'billed', transaction_id = v_tx.id, billed_at = p_end
     where id = v_entry.id;
  end loop;

  -- ปิดสัญญาที่เรียกเก็บครบทุกงวดแล้ว
  update card_installments i
     set status = 'completed', updated_at = now()
   where i.card_id = p_card and i.status = 'active'
     and not exists (
       select 1 from card_installment_entries e
        where e.installment_id = i.id and e.status = 'pending'
     );

  -- ยอดรูดที่เข้าบิลใบนี้ = ทุกรายการถึงวันสรุปยอด ที่ยังไม่มีใบไหนครอบอยู่
  --
  -- ไม่ใช่ "รายการในช่วง p_start..p_end" เพราะช่วงวันที่ของรอบเชื่อไม่ได้เสมอไป
  --   • ลงรายการย้อนหลังเข้ารอบที่ปิดไปแล้ว → ต้องไปเก็บในบิลใบหน้า ไม่ใช่หายไปเฉยๆ
  --   • เปลี่ยนวันสรุปยอดของบัตร → รอบใหม่อาจเหลื่อมรอบเก่า (เก็บซ้ำ) หรือมีช่องว่าง (ไม่เก็บเลย)
  -- การถามว่า "มีใบไหนครอบวันนี้แล้วหรือยัง" แทนช่วงวันที่ ปิดทั้งสองรูได้ในกฎเดียว
  -- และตรงกับ getUncoveredTransactions ฝั่งหน้าจอ ที่ใช้คำนวณยอดรอบที่ยังเปิดอยู่
  select coalesce(sum(t.amount), 0) into v_spend
    from transactions t
   where t.card_id = p_card and t.shop_id = p_shop and t.type = 'expense'
     and t.date <= p_end
     and t.card_statement_id is null
     and not exists (
       select 1 from card_statements s
        where s.card_id = p_card and t.date between s.period_start and s.period_end
     );

  -- รายรับที่ปลายทางเป็นบัตร = เครดิตเงินคืน หรือเงินคืนสินค้า → ลดยอดที่ต้องชำระ
  select coalesce(sum(t.amount), 0) into v_credit
    from transactions t
   where t.card_id = p_card and t.shop_id = p_shop and t.type = 'income'
     and t.date <= p_end
     and t.card_statement_id is null
     and not exists (
       select 1 from card_statements s
        where s.card_id = p_card and t.date between s.period_start and s.period_end
     );

  -- เงินสดที่กดจากบัตรที่ยังไม่ถูกเรียกเก็บ ธนาคารเรียกเก็บเหมือนยอดรูด
  -- (ค่าธรรมเนียมเป็นรายจ่ายอยู่ใน v_spend แล้ว) ใช้ statement_id เป็นตัวบอกว่าเก็บไปแล้วหรือยัง
  select coalesce(sum(amount), 0) into v_adv
    from card_advances
   where card_id = p_card and shop_id = p_shop and statement_id is null and date <= p_end;

  v_amount := v_prev + v_spend + v_adv - v_credit;
  -- ติดลบ = เครดิตเหลือ (จ่ายเกินหรือเงินคืนมากกว่ายอดรูด) เก็บเป็นใบสถานะ paid ยอดติดลบ
  -- ไม่ปัดเป็นศูนย์ เพื่อให้รอบถัดไปดึงไปหักต่อ เครดิตจะได้ไม่หาย

  select coalesce(card_min_rate, 8) into v_rate from shop_settings where shop_id = p_shop;
  v_min := greatest(0, least(v_amount, round(v_amount * coalesce(v_rate, 8) / 100, 2)));

  insert into card_statements (
    shop_id, card_id, cycle, period_start, period_end, due_date,
    status, previous_balance, spend_amount, credit_amount, amount, minimum_amount, advance_amount
  ) values (
    p_shop, p_card, p_cycle, p_start, p_end, p_due,
    case when v_amount <= 0 then 'paid' else 'closed' end,
    v_prev, v_spend, v_credit, v_amount, v_min, v_adv
  ) returning * into v_st;

  -- ผูกงวดที่เพิ่งเข้าบิลกับใบนี้ เพื่อให้อ่านวันที่จ่ายจริงจากใบได้
  -- (รวมงวดตกค้างจากรอบก่อนที่เพิ่งถูกกวาดมาเก็บในใบนี้ด้วย — ดูเงื่อนไข e.cycle <= p_cycle ข้างบน)
  update card_installment_entries e
     set statement_id = v_st.id
    from card_installments i
   where e.installment_id = i.id and i.card_id = p_card
     and e.cycle <= p_cycle and e.status = 'billed' and e.statement_id is null;

  -- ผูกรายการกดเงินสดที่เพิ่งถูกเก็บกับใบ — หลังจากนี้ย้อนไม่ได้แล้ว
  update card_advances
     set statement_id = v_st.id
   where card_id = p_card and shop_id = p_shop and statement_id is null
     and date <= p_end;

  -- ใบเก่าที่ยอดถูกยกมาแล้ว ทำเครื่องหมายไว้ไม่ให้ถูกนับอีกรอบหน้า
  update card_statements
     set carried_to = v_st.id
   where card_id = p_card and carried_to is null
     and (status <> 'paid' or amount - paid_amount < 0)
     and period_end < p_end and id <> v_st.id;

  -- ยอดที่ผู้ใช้โอนจ่ายให้รายการทีละรายการไว้ก่อนออกบิล (ส่วนที่ 16) — ธนาคารแสดง
  -- เป็นบรรทัด "ยอดชำระ" ในใบนี้ ยอดที่ต้องชำระจึงเหลือเฉพาะส่วนที่ยังไม่ได้จ่าย
  -- ผูกขาเข้าใบ ให้ paid_amount นับรวม และ undo_card_payment ย้อนได้ทีละขาเหมือนขาปกติ
  -- เอาเฉพาะขาของรายการที่ใบนี้เก็บ (วันที่รูด <= วันสรุปยอด) ขาที่รายการถูกลบไปแล้ว
  -- ดูวันที่จ่ายแทน — เงินออกไปแล้วจริง ต้องกลายเป็นเครดิตในใบ ไม่ใช่หายไป
  update card_statement_payments p
     set statement_id = v_st.id
   where p.card_id = p_card and p.statement_id is null
     and coalesce((select t.date from transactions t where t.id = p.transaction_id), p.paid_at) <= p_end;

  select coalesce(sum(amount), 0), max(paid_at) into v_prepaid, v_prepaid_at
    from card_statement_payments where statement_id = v_st.id;
  if v_prepaid > 0 then
    select * into v_last_leg from card_statement_payments
     where statement_id = v_st.id order by paid_at desc, created_at desc limit 1;
    update card_statements
       set paid_amount = v_prepaid,
           status = case when v_prepaid >= amount then 'paid' else 'partial' end,
           paid_at = v_prepaid_at,
           paid_method = v_last_leg.method,
           transfer_account_id = v_last_leg.transfer_account_id
     where id = v_st.id
     returning * into v_st;
  end if;

  return v_st;
end;
$$;


-- ###########################################################################
-- ##  6. จ่ายบิล — ย้ายเงินสองขาในทรานแซกชันเดียว ไม่สร้าง transactions
-- ###########################################################################

-- เพิ่มพารามิเตอร์ p_transaction ทีหลัง — ต้องทิ้งรุ่นเก่า 6 พารามิเตอร์ก่อน
-- ไม่งั้นจะได้ฟังก์ชันชื่อเดียวกันสองตัว แล้ว PostgREST เลือกไม่ถูกว่าจะเรียกตัวไหน
drop function if exists public.pay_card_statement(uuid, text, uuid, numeric, date, jsonb);

create or replace function public.pay_card_statement(
  p_statement uuid,
  p_method    text,
  p_account   uuid,
  p_amount    numeric,
  p_date      date,
  p_log       jsonb default null,
  -- จ่ายบิลด้วยยอดของรายการเดียว = ส่ง id ของรายการนั้นมาด้วย ขาที่จ่ายจะจำไว้ว่า
  -- เป็นของรายการไหน หน้าจอจึงติ๊กถูกหน้าบรรทัดนั้นได้ ไม่ใช่รู้แค่ว่ายอดบิลลดลง
  p_transaction uuid default null
) returns card_statements language plpgsql security definer set search_path = public as $$
declare
  v_st     card_statements;
  v_src    text;
  v_remain numeric(14,2);
begin
  select * into v_st from card_statements where id = p_statement;
  if not found then raise exception 'ไม่พบใบแจ้งยอดนี้'; end if;
  perform assert_can_edit(v_st.shop_id);

  if v_st.status = 'paid' then raise exception 'ใบแจ้งยอดนี้จ่ายครบแล้ว'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่าศูนย์'; end if;

  -- จ่ายเกินยอดได้ (แบบ Wallet Story 16.0) ส่วนที่เกินทำให้ outstanding ติดลบ = เครดิตในบัตร
  -- และ amount - paid_amount ของใบนี้ติดลบ close_card_statement จะยกไปหักบิลรอบถัดไปเอง
  v_remain := v_st.amount - v_st.paid_amount;

  if p_method = 'transfer' and p_account is null then
    raise exception 'ต้องเลือกบัญชีเงินโอนที่จะจ่าย';
  end if;
  if p_method not in ('cash', 'transfer') then
    raise exception 'วิธีจ่ายบิลไม่ถูกต้อง: %', p_method;
  end if;

  -- ขาที่ 1 เงินออกจากกระเป๋าที่เลือก
  v_src := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_st.shop_id, v_src, -p_amount);

  -- ขาที่ 2 หนี้บัตรลดลง (สาขา card กลับเครื่องหมายให้เอง) — ผลรวมสองขาเป็นศูนย์
  perform apply_wallet_effect(v_st.shop_id, 'card:' || v_st.card_id, p_amount);

  -- จำแต่ละ "ขา" ที่จ่ายไว้ทีละครั้ง เพราะบิลใบเดียวจ่ายได้หลายรอบจากคนละกระเป๋า
  -- ตอนย้อนต้องคืนเข้ากระเป๋าที่ตัดมาจริงทีละขา ไม่ใช่กระเป๋าสุดท้ายทั้งก้อน
  insert into card_statement_payments
         (shop_id, statement_id, card_id, method, transfer_account_id, amount, paid_at, transaction_id)
  values (v_st.shop_id, p_statement, v_st.card_id, p_method,
          case when p_method = 'transfer' then p_account end, p_amount, p_date, p_transaction);

  update card_statements
     set paid_amount = paid_amount + p_amount,
         status = case when paid_amount + p_amount >= amount then 'paid' else 'partial' end,
         paid_at = p_date,
         paid_method = p_method,
         transfer_account_id = p_account
   where id = p_statement
   returning * into v_st;

  perform write_log(v_st.shop_id, p_log);
  return v_st;
end;
$$;

-- ย้อนการจ่ายบิล — คืนเงินกลับกระเป๋าต้นทางทีละขา และหนี้บัตรกลับมาเท่าเดิม
create or replace function public.undo_card_payment(
  p_statement uuid,
  p_amount    numeric,
  p_log       jsonb default null
) returns card_statements language plpgsql security definer set search_path = public as $$
declare
  v_st   card_statements;
  v_leg  card_statement_payments;
  v_left numeric(14,2);
  v_take numeric(14,2);
begin
  select * into v_st from card_statements where id = p_statement;
  if not found then raise exception 'ไม่พบใบแจ้งยอดนี้'; end if;
  perform assert_can_edit(v_st.shop_id);

  if v_st.paid_amount <= 0 then raise exception 'ใบแจ้งยอดนี้ยังไม่ได้จ่าย'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_st.paid_amount then
    raise exception 'จำนวนเงินที่ย้อนไม่ถูกต้อง';
  end if;
  -- ยอดค้างของใบนี้ถูกยกไปอยู่ใน previous_balance ของใบถัดไปแล้ว ถ้าย้อนตรงนี้
  -- ยอดจะโผล่สองใบพร้อมกันและใบถัดไปไม่รู้เรื่อง ต้องย้อนที่ใบล่าสุดแทน
  if v_st.carried_to is not null then
    raise exception 'ใบนี้ถูกยกยอดไปรวมในบิลรอบถัดไปแล้ว ย้อนการจ่ายไม่ได้ — ให้ย้อนที่บิลใบล่าสุดแทน';
  end if;

  -- ย้อนทีละขา ขาล่าสุดก่อน คืนเข้ากระเป๋าที่ขานั้นตัดมาจริง
  -- (บัญชีที่ถูกลบไปแล้ว refund_source จะเลี่ยงไปคืนเข้าเงินสดให้)
  v_left := p_amount;
  for v_leg in
    select * from card_statement_payments
     where statement_id = p_statement
     order by created_at desc, id desc
  loop
    exit when v_left <= 0;
    v_take := least(v_leg.amount, v_left);
    perform apply_wallet_effect(v_st.shop_id,
      refund_source(v_st.shop_id, v_leg.method, v_leg.transfer_account_id), v_take);
    if v_take >= v_leg.amount then
      delete from card_statement_payments where id = v_leg.id;
    else
      update card_statement_payments set amount = amount - v_take where id = v_leg.id;
    end if;
    v_left := v_left - v_take;
  end loop;

  -- ส่วนที่จ่ายไว้ก่อนจะมีตารางขา (ใบเก่า) — คืนตามวิธีจ่ายล่าสุดที่ใบจำไว้
  if v_left > 0 then
    if v_st.paid_method is null then raise exception 'ไม่รู้ว่าจ่ายจากกระเป๋าไหน ย้อนให้ไม่ได้'; end if;
    perform apply_wallet_effect(v_st.shop_id,
      refund_source(v_st.shop_id, v_st.paid_method, v_st.transfer_account_id), v_left);
  end if;

  perform apply_wallet_effect(v_st.shop_id, 'card:' || v_st.card_id, -p_amount);

  update card_statements
     set paid_amount = paid_amount - p_amount,
         -- ใบเครดิต (ยอดติดลบ) ถือว่า paid มาตั้งแต่เกิด ห้ามเปิดกลับเป็น closed
         status = case when amount <= 0 then 'paid'
                       when paid_amount - p_amount <= 0 then 'closed' else 'partial' end,
         paid_at = case when paid_amount - p_amount <= 0 then null else paid_at end,
         paid_method = case when paid_amount - p_amount <= 0 then null else paid_method end,
         transfer_account_id = case when paid_amount - p_amount <= 0 then null else transfer_account_id end
   where id = p_statement
   returning * into v_st;

  perform write_log(v_st.shop_id, p_log);
  return v_st;
end;
$$;


-- ###########################################################################
-- ##  7. ผ่อนชำระ
-- ###########################################################################
-- p_entries เป็น jsonb array ของ { seq, cycle, due_date, amount } ที่ client คำนวณมา
-- (ใช้ src/lib/cardCycle.js ตัวเดียวกับที่อื่น จะได้ไม่เขียนสูตรซ้ำสองภาษา
--  แล้วปัดเศษคนละแบบ) เศษที่หารไม่ลงตัวไปรวมงวดสุดท้าย ผลรวมทุกงวดจึงเท่ากับ
--  total_amount พอดีเสมอ

create or replace function public.create_card_installment(
  p_shop    uuid,
  p_card    uuid,
  p_data    jsonb,
  p_entries jsonb,
  p_log     jsonb default null
) returns card_installments language plpgsql security definer set search_path = public as $$
declare v_ins card_installments; v_e jsonb;
begin
  perform assert_can_edit(p_shop);
  if not exists (select 1 from credit_cards where id = p_card and shop_id = p_shop) then
    raise exception 'ไม่พบบัตรเครดิตของร้านนี้';
  end if;
  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'ต้องมีอย่างน้อยหนึ่งงวด';
  end if;

  insert into card_installments (
    shop_id, card_id, name, vendor, category_id, note,
    principal_amount, total_amount, months, monthly_amount, interest_rate,
    purchase_date, first_cycle, created_by
  ) values (
    p_shop, p_card,
    coalesce(p_data->>'name', ''),
    p_data->>'vendor',
    nullif(p_data->>'category_id', '')::uuid,
    p_data->>'note',
    coalesce((p_data->>'principal_amount')::numeric, (p_data->>'total_amount')::numeric),
    (p_data->>'total_amount')::numeric,
    (p_data->>'months')::int,
    (p_data->>'monthly_amount')::numeric,
    coalesce((p_data->>'interest_rate')::numeric, 0),
    (p_data->>'purchase_date')::date,
    p_data->>'first_cycle',
    auth.uid()
  ) returning * into v_ins;

  for v_e in select * from jsonb_array_elements(p_entries) loop
    insert into card_installment_entries (shop_id, installment_id, seq, cycle, due_date, amount)
    values (
      p_shop, v_ins.id,
      (v_e->>'seq')::int,
      v_e->>'cycle',
      (v_e->>'due_date')::date,
      (v_e->>'amount')::numeric
    );
  end loop;

  -- ยังไม่แตะ outstanding และยังไม่สร้าง transactions โดยเจตนา
  perform write_log(p_shop, p_log);
  return v_ins;
end;
$$;

-- ปิดยอดคงเหลือก่อนกำหนด — รวมงวดที่เหลือเป็นรายการเดียวเข้ารอบที่เปิดอยู่
create or replace function public.settle_card_installment(
  p_installment uuid,
  p_date        date,
  p_fee         numeric default 0,
  p_log         jsonb default null
) returns card_installments language plpgsql security definer set search_path = public as $$
declare v_ins card_installments; v_left numeric(14,2); v_tx transactions; v_n int;
begin
  select * into v_ins from card_installments where id = p_installment;
  if not found then raise exception 'ไม่พบรายการผ่อนนี้'; end if;
  perform assert_can_edit(v_ins.shop_id);
  if v_ins.status <> 'active' then raise exception 'รายการผ่อนนี้ปิดไปแล้ว'; end if;

  select coalesce(sum(amount), 0), count(*) into v_left, v_n
    from card_installment_entries
   where installment_id = p_installment and status = 'pending';
  if v_n = 0 then raise exception 'ไม่มีงวดที่เหลือให้ปิด'; end if;

  insert into transactions (
    shop_id, date, type, amount, method, category_id, item_name, vendor,
    card_id, note, created_by
  ) values (
    v_ins.shop_id, p_date, 'expense', v_left + coalesce(p_fee, 0), 'card',
    v_ins.category_id,
    v_ins.name || ' (ปิดยอดคงเหลือ ' || v_n || ' งวด)',
    v_ins.vendor, v_ins.card_id, 'ปิดยอดผ่อนก่อนกำหนด', auth.uid()
  ) returning * into v_tx;

  perform apply_wallet_effect(v_ins.shop_id, 'card:' || v_ins.card_id, -(v_left + coalesce(p_fee, 0)));

  update card_installment_entries
     set status = 'billed', transaction_id = v_tx.id, billed_at = p_date
   where installment_id = p_installment and status = 'pending';

  update card_installments set status = 'completed', updated_at = now()
   where id = p_installment returning * into v_ins;

  perform write_log(v_ins.shop_id, p_log);
  return v_ins;
end;
$$;

-- ยกเลิกงวดที่เหลือ (เช่น คืนสินค้ากลางคัน)
-- งวดที่เรียกเก็บไปแล้วยังอยู่ เพราะเกิดขึ้นจริง ส่วนเงินที่ได้คืนให้บันทึกเป็น
-- รายรับที่ปลายทางเป็นบัตรแยกต่างหาก
create or replace function public.cancel_card_installment(
  p_installment uuid,
  p_log         jsonb default null
) returns card_installments language plpgsql security definer set search_path = public as $$
declare v_ins card_installments;
begin
  select * into v_ins from card_installments where id = p_installment;
  if not found then raise exception 'ไม่พบรายการผ่อนนี้'; end if;
  perform assert_can_edit(v_ins.shop_id);

  update card_installment_entries set status = 'cancelled'
   where installment_id = p_installment and status = 'pending';

  update card_installments set status = 'cancelled', updated_at = now()
   where id = p_installment returning * into v_ins;

  perform write_log(v_ins.shop_id, p_log);
  return v_ins;
end;
$$;


-- ###########################################################################
-- ##  8. เลิกผูกหักบัญชีตอนบัญชีเงินโอนถูกลบ
-- ###########################################################################
-- on delete set null จัดการ autopay_account_id ให้แล้ว แต่ต้องปิดโหมดด้วย
-- ไม่งั้นจะค้างเป็น "หักจากบัญชีที่ไม่มีอยู่" ซึ่งหน้าจอจะบอกว่าพร้อมหักทั้งที่หักไม่ได้

create or replace function public.reset_orphan_autopay() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update credit_cards
     set autopay_mode = 'off', updated_at = now()
   where autopay_account_id is null and autopay_mode <> 'off';
  return null;
end;
$$;

drop trigger if exists transfer_accounts_autopay_cleanup on transfer_accounts;
create trigger transfer_accounts_autopay_cleanup
  after delete on transfer_accounts
  for each statement execute function reset_orphan_autopay();


-- ###########################################################################
-- ##  9. ล้างข้อมูลร้าน — ต้องลบตารางบัตรด้วย
-- ###########################################################################
-- ลบ transactions ก่อน แล้ว card_id / installment_entry_id จึงไม่มีอะไรอ้างถึง
-- carried_to อ้างถึงกันเองในตาราง จึงต้องตัดการอ้างอิงก่อนลบ

create or replace function public.clear_shop_data(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(p_shop) then
    raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่ล้างข้อมูลได้' using errcode = '42501';
  end if;

  -- ล้างทั้งร้านลบรายจ่ายที่ผูกกับงวดผ่อนด้วย ต้องบอก trigger กันลบว่าตั้งใจ
  perform set_config('jodflow.installment_rpc', '1', true);

  delete from tax_invoices             where shop_id = p_shop;
  delete from pending_payments         where shop_id = p_shop;
  delete from pending_incomes          where shop_id = p_shop;
  delete from transactions             where shop_id = p_shop;
  delete from card_advances            where shop_id = p_shop;
  delete from card_installment_entries where shop_id = p_shop;
  delete from card_installments        where shop_id = p_shop;
  delete from recurring_entries        where shop_id = p_shop;
  delete from recurring_items          where shop_id = p_shop;
  delete from loans                    where shop_id = p_shop;
  delete from sub_wallets              where shop_id = p_shop;
  delete from transfer_accounts        where shop_id = p_shop;
  update card_statements set carried_to = null where shop_id = p_shop;
  delete from card_statements          where shop_id = p_shop;
  delete from credit_cards             where shop_id = p_shop;
  delete from calendar_notes           where shop_id = p_shop;
  delete from activity_logs            where shop_id = p_shop;
  delete from quick_items              where shop_id = p_shop;
  delete from vendors                  where shop_id = p_shop;
  delete from categories               where shop_id = p_shop;

  update wallet_state set cash = 0, updated_at = now() where shop_id = p_shop;
  insert into categories (shop_id, name, type)
  values (p_shop, 'อื่นๆ', 'expense'), (p_shop, 'อื่นๆ', 'income');
end;
$$;


-- ###########################################################################
-- ##  9b. จัดการข้อมูล — กดเงินสด / จ่ายเกิน / ค่าธรรมเนียมรายปี
-- ###########################################################################
-- เพิ่มตามแบบ Wallet Story (16.0 จ่ายเกินเป็นเครดิต, 16.4 กดเงินสดพร้อมค่าธรรมเนียม)
--
--   กดเงินสด   = ย้ายเงินจากบัตรเข้ากระเป๋า ไม่ใช่รายจ่าย (หนี้บัตรเพิ่ม เงินสดเพิ่ม)
--                ค่าธรรมเนียมเท่านั้นที่เป็นรายจ่ายจริง (หมวด "ค่าธรรมเนียมบัตร") เข้ารายงาน
--                ทั้งสองส่วนเข้าบิลรอบที่กด (close_card_statement รวม card_advances ให้)
--   จ่ายเกิน   = pay_card_statement ไม่ raise แล้ว ส่วนเกินทำให้ outstanding ติดลบ (เครดิต)
--                และ close_card_statement ยกเครดิตไปหักบิลรอบถัดไป ไม่ปัดเป็นศูนย์
--   ค่าธรรมเนียมรายปี = คอลัมน์บน credit_cards ให้การ์ดเตือน ผู้ใช้กดบันทึกเป็นรายจ่ายเอง

create table if not exists card_advances (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references shops(id) on delete cascade,
  card_id            uuid not null references credit_cards(id) on delete cascade,
  date               date not null default current_date,
  amount             numeric(14,2) not null check (amount > 0),
  fee                numeric(14,2) not null default 0 check (fee >= 0),
  target             text not null,               -- 'cash' | 'transfer:<uuid>' ปลายทางที่เงินเข้า
  fee_transaction_id uuid references transactions(id) on delete set null,
  statement_id       uuid references card_statements(id) on delete set null,  -- ใบที่เรียกเก็บแล้ว
  note               text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now()
);
create index if not exists card_advances_card_idx on card_advances (card_id, date);
create index if not exists card_advances_shop_idx on card_advances (shop_id, statement_id);

alter table card_statements add column if not exists advance_amount numeric(14,2) not null default 0;

create or replace function public.card_cash_advance(
  p_shop   uuid,
  p_card   uuid,
  p_amount numeric,
  p_fee    numeric,
  p_target text,
  p_date   date,
  p_note   text  default null,
  p_log    jsonb default null
) returns card_advances language plpgsql security definer set search_path = public as $$
declare
  v_card credit_cards;
  v_adv  card_advances;
  v_cat  uuid;
  v_tx   transactions;
  v_fee  numeric(14,2) := coalesce(p_fee, 0);
begin
  perform assert_can_edit(p_shop);

  select * into v_card from credit_cards where id = p_card and shop_id = p_shop and deleted = false;
  if not found then raise exception 'ไม่พบบัตรเครดิตของร้านนี้'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่าศูนย์'; end if;
  if v_fee < 0 then raise exception 'ค่าธรรมเนียมต้องไม่ติดลบ'; end if;
  if p_target is null or split_part(p_target, ':', 1) not in ('cash', 'transfer') then
    raise exception 'ปลายทางเงินต้องเป็นเงินสดหรือบัญชีเงินโอน';
  end if;
  -- รอบที่ปิดแล้วออกใบแจ้งยอดไปแล้ว ถ้ายอมให้ย้อนวันเข้าไป ยอดบิลจะไม่ตรงกับที่ปิดไว้
  if exists (
    select 1 from card_statements
     where card_id = p_card and p_date between period_start and period_end
  ) then
    raise exception 'รอบบิลของวันที่ % ปิดไปแล้ว เลือกวันที่ในรอบที่ยังเปิดอยู่', to_char(p_date, 'DD/MM/YYYY');
  end if;

  -- ขาที่ 1 หนี้บัตรเพิ่มเท่าเงินที่กด (สาขา card กลับเครื่องหมาย)  ขาที่ 2 เงินเข้าปลายทาง
  perform apply_wallet_effect(p_shop, 'card:' || p_card, -p_amount);
  perform apply_wallet_effect(p_shop, p_target, p_amount);

  -- ค่าธรรมเนียมเป็นรายจ่ายจริงบนบัตร → เข้ารายงานและเข้าบิลรอบนี้เองผ่าน transactions
  if v_fee > 0 then
    select id into v_cat from categories
     where shop_id = p_shop and type = 'expense' and name = 'ค่าธรรมเนียมบัตร' and deleted = false
     order by created_at limit 1;
    if v_cat is null then
      insert into categories (shop_id, name, type) values (p_shop, 'ค่าธรรมเนียมบัตร', 'expense')
      returning id into v_cat;
    end if;

    insert into transactions (
      shop_id, date, type, amount, method, category_id, item_name, card_id, note, created_by
    ) values (
      p_shop, p_date, 'expense', v_fee, 'card', v_cat,
      'ค่าธรรมเนียมกดเงินสด — ' || v_card.bank_name || ' ' || v_card.name,
      p_card, p_note, auth.uid()
    ) returning * into v_tx;
    perform apply_wallet_effect(p_shop, 'card:' || p_card, -v_fee);
  end if;

  insert into card_advances (shop_id, card_id, date, amount, fee, target, fee_transaction_id, note, created_by)
  values (p_shop, p_card, p_date, p_amount, v_fee, p_target, v_tx.id, p_note, auth.uid())
  returning * into v_adv;

  perform write_log(p_shop, p_log);
  return v_adv;
end;
$$;

-- ย้อนได้เฉพาะรายการที่ยังไม่เข้าบิลที่ปิดแล้ว
create or replace function public.undo_card_advance(
  p_advance uuid,
  p_log     jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_adv card_advances;
begin
  select * into v_adv from card_advances where id = p_advance;
  if not found then raise exception 'ไม่พบรายการกดเงินสดนี้'; end if;
  perform assert_can_edit(v_adv.shop_id);

  if v_adv.statement_id is not null or exists (
    select 1 from card_statements
     where card_id = v_adv.card_id and v_adv.date between period_start and period_end
  ) then
    raise exception 'รายการนี้เข้าบิลที่ปิดแล้ว ย้อนไม่ได้ — ถ้าผิดให้บันทึกเงินคืนเข้าบัตรแทน';
  end if;

  perform apply_wallet_effect(v_adv.shop_id, 'card:' || v_adv.card_id, v_adv.amount);
  perform apply_wallet_effect(v_adv.shop_id, v_adv.target, -v_adv.amount);

  if v_adv.fee_transaction_id is not null then
    perform apply_wallet_effect(v_adv.shop_id, 'card:' || v_adv.card_id, v_adv.fee);
    delete from transactions where id = v_adv.fee_transaction_id;
  end if;

  delete from card_advances where id = p_advance;
  perform write_log(v_adv.shop_id, p_log);
end;
$$;


-- ###########################################################################
-- ##  10. RLS + Realtime
-- ###########################################################################
-- ลืม RLS = query คืนค่าว่างเปล่าโดยไม่มี error
-- ลืม realtime = เครื่องอื่นไม่เห็นยอดบัตรขยับ

do $$
declare t text;
begin
  foreach t in array array[
    'credit_cards', 'card_statements', 'card_installments', 'card_installment_entries',
    'card_advances'
  ] loop
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_member(shop_id))', t || '_select', t);

    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (can_edit(shop_id))', t || '_insert', t);

    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update using (can_edit(shop_id)) with check (can_edit(shop_id))',
      t || '_update', t);

    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (can_edit(shop_id))', t || '_delete', t);

    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- สั่งให้ API โหลด schema ใหม่ทันที (กันอาการฟังก์ชัน 404 จาก cache ค้าง)
notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  ตรวจผลการติดตั้ง — ต้องได้ครบทุกบรรทัด
-- ###########################################################################

select 'ตารางบัตร' as "รายการ", count(*)::text || ' / 6' as "ผล"
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('credit_cards','card_statements','card_installments','card_installment_entries','card_advances',
                      'card_statement_payments')
union all
select 'คอลัมน์ที่เติมเพิ่ม', count(*)::text || ' / 15'
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name='transactions'      and column_name in ('card_id','installment_entry_id','card_statement_id'))
     or (table_name='card_statement_payments' and column_name in ('card_id','transaction_id'))
     or (table_name='credit_cards'      and column_name in ('autopay_mode','autopay_account_id','autopay_amount','annual_fee','annual_fee_month'))
     or (table_name='card_statements'   and column_name = 'advance_amount')
     or (table_name='card_installments' and column_name = 'principal_amount')
     or (table_name='card_installment_entries' and column_name = 'paid_amount')
     or (table_name='recurring_entries' and column_name = 'card_id')
     or (table_name='shop_settings'     and column_name = 'card_min_rate'))
union all
select 'ฟังก์ชัน RPC ของบัตร', count(*)::text || ' / 19'
  from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('close_card_statement','pay_card_statement','undo_card_payment',
     'create_card_installment','settle_card_installment','cancel_card_installment',
     'card_cash_advance','undo_card_advance',
     'pay_installment_entry','undo_installment_entry','delete_card_installment','refund_source',
     'attach_installment_to_closed_statements',
     'attach_transaction_to_statement','detach_transaction_from_statement','apply_statement_delta',
     'prepay_card_transaction','undo_card_prepayment', 'undo_card_payment_leg')
union all
select 'รับ method = card แล้ว',
       case when exists (
         select 1 from pg_constraint
          where conname = 'transactions_method_check'
            and pg_get_constraintdef(oid) like '%''card''%'
       ) then '✅' else '❌ ยังไม่รับ' end
union all
select 'จ่ายบิลเฉพาะรายการ (จำได้ว่าเป็นของบรรทัดไหน)',
       case when exists (
         select 1 from information_schema.parameters p
          join information_schema.routines r on r.specific_name = p.specific_name
          where r.routine_schema = 'public' and r.routine_name = 'pay_card_statement'
            and p.parameter_name = 'p_transaction'
       ) then '✅' else '❌ ยังไม่มี — รันไฟล์นี้ซ้ำอีกรอบ' end
union all
select 'RLS เปิดครบ',
       case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relrowsecurity
                     and c.relname in ('credit_cards','card_statements','card_installments','card_installment_entries','card_advances')
                 ) = 5 then '✅' else '❌ ยังไม่ครบ' end;


-- ###########################################################################
-- ##  จ่ายค่างวดผ่อนทีละงวด
-- ###########################################################################

-- ── คอลัมน์และสถานะใหม่ ─────────────────────────────────────────────────

alter table card_installment_entries add column if not exists paid_at             timestamptz;
alter table card_installment_entries add column if not exists paid_method         text;
alter table card_installment_entries add column if not exists transfer_account_id uuid
  references transfer_accounts(id) on delete set null;

-- ต้องมี 'prepaid' อยู่ในลิสต์ตั้งแต่ครั้งแรกที่ตั้ง เพราะฐานข้อมูลที่เคยรันไฟล์นี้ไปแล้ว
-- มีงวดสถานะ prepaid อยู่จริง ถ้าลิสต์แรกไม่มี การรันซ้ำจะล้มที่บรรทัดนี้
-- (ERROR 23514 check constraint ... violated by some row) แล้วทั้งไฟล์ถูก rollback
alter table card_installment_entries drop constraint if exists card_installment_entries_status_check;
alter table card_installment_entries add  constraint card_installment_entries_status_check
  check (status in ('pending', 'billed', 'paid', 'prepaid', 'cancelled'));

-- ── 2. จ่ายค่างวด ──────────────────────────────────────────────────────────

create or replace function public.pay_installment_entry(
  p_entry   uuid,
  p_method  text,
  p_account uuid,
  p_amount  numeric,
  p_paid_at timestamptz,
  p_log     jsonb default null
) returns card_installment_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry card_installment_entries;
  v_ins   card_installments;
  v_tx    transactions;
  v_src   text;
  v_date  date;
begin
  select * into v_entry from card_installment_entries where id = p_entry;
  if not found then raise exception 'ไม่พบงวดผ่อนนี้'; end if;
  perform assert_can_edit(v_entry.shop_id);

  if v_entry.status = 'paid' then raise exception 'งวดนี้จ่ายไปแล้ว'; end if;
  if v_entry.status = 'prepaid' then raise exception 'งวดนี้จ่ายมาก่อนเริ่มใช้แอปแล้ว จ่ายซ้ำไม่ได้'; end if;
  if v_entry.status = 'cancelled' then raise exception 'งวดนี้ถูกยกเลิกไปแล้ว'; end if;
  if v_entry.status = 'billed' then
    raise exception 'งวดนี้ถูกเรียกเก็บเข้าบิลรอบ % ไปแล้ว ให้จ่ายผ่านบิลบัตรแทน', v_entry.cycle;
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่าศูนย์'; end if;
  if p_method not in ('cash', 'transfer') then
    raise exception 'วิธีจ่ายไม่ถูกต้อง: %', p_method;
  end if;
  if p_method = 'transfer' and p_account is null then
    raise exception 'ต้องเลือกบัญชีที่จะตัดเงิน';
  end if;

  select * into v_ins from card_installments where id = v_entry.installment_id;
  if not found then raise exception 'ไม่พบสัญญาผ่อนของงวดนี้'; end if;

  v_date := (coalesce(p_paid_at, now()) at time zone 'Asia/Bangkok')::date;

  -- สร้างรายจ่ายจริง เพื่อให้ยอดไปโผล่ในรายงานและประวัติเหมือนรายจ่ายอื่น
  -- ไม่ผูก card_id เพราะงวดนี้ไม่ได้ผ่านบัตร เงินออกจากบัญชีตรงๆ
  insert into transactions (
    shop_id, date, type, amount, method, transfer_account_id, category_id,
    item_name, vendor, installment_entry_id, note, created_by
  ) values (
    v_entry.shop_id, v_date, 'expense', p_amount, p_method,
    case when p_method = 'transfer' then p_account else null end,
    v_ins.category_id,
    v_ins.name || ' (งวด ' || v_entry.seq || '/' || v_ins.months || ')',
    v_ins.vendor, v_entry.id, 'จ่ายค่างวดผ่อนจากบัญชี', auth.uid()
  ) returning * into v_tx;

  -- เงินออกจากกระเป๋าที่เลือก — ไม่แตะหนี้บัตร เพราะงวดนี้ยังไม่เคยเป็นหนี้บัตร
  v_src := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_entry.shop_id, v_src, -p_amount);

  -- ยอดที่จ่ายจริงเก็บแยกใน paid_amount — ยอดตามตาราง (amount) ต้องคงเดิม
  -- ไม่งั้นจ่ายไม่เต็มงวดครั้งเดียว ผลรวมทุกงวดจะไม่เท่ายอดสัญญาอีกเลย
  update card_installment_entries
     set status = 'paid',
         paid_amount = p_amount,
         paid_at = coalesce(p_paid_at, now()),
         paid_method = p_method,
         transfer_account_id = p_account,
         transaction_id = v_tx.id
   where id = p_entry
   returning * into v_entry;

  perform write_log(v_entry.shop_id, p_log);
  return v_entry;
end;
$$;

-- ── 3. ย้อนการจ่ายค่างวด ───────────────────────────────────────────────────

create or replace function public.undo_installment_entry(
  p_entry uuid,
  p_log   jsonb default null
) returns card_installment_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry card_installment_entries;
  v_src   text;
begin
  select * into v_entry from card_installment_entries where id = p_entry;
  if not found then raise exception 'ไม่พบงวดผ่อนนี้'; end if;
  perform assert_can_edit(v_entry.shop_id);
  if v_entry.status <> 'paid' then raise exception 'งวดนี้ยังไม่ได้จ่าย'; end if;

  -- บอก trigger กันลบว่านี่คือ RPC ของสัญญาผ่อน ลบรายจ่ายที่ผูกไว้ได้
  perform set_config('jodflow.installment_rpc', '1', true);

  -- คืนเงินเข้ากระเป๋าต้นทางก่อน แล้วค่อยลบรายจ่ายที่ผูกไว้
  -- คืนเท่าที่จ่ายจริง (paid_amount) ไม่ใช่ยอดตามตาราง
  v_src := refund_source(v_entry.shop_id, v_entry.paid_method, v_entry.transfer_account_id);
  perform apply_wallet_effect(v_entry.shop_id, v_src, coalesce(v_entry.paid_amount, v_entry.amount));

  if v_entry.transaction_id is not null then
    delete from transactions where id = v_entry.transaction_id;
  end if;

  update card_installment_entries
     set status = 'pending', paid_amount = null, paid_at = null, paid_method = null,
         transfer_account_id = null, transaction_id = null
   where id = p_entry
   returning * into v_entry;

  -- สัญญาที่ถูกปิดเพราะงวดนี้เป็นงวดสุดท้าย ต้องกลับมาเปิด ไม่งั้นงวดที่เพิ่งย้อน
  -- จะไม่ถูกเรียกเก็บอีกเลย (close_card_statement เก็บเฉพาะสัญญา active)
  update card_installments
     set status = 'active', updated_at = now()
   where id = v_entry.installment_id and status = 'completed';

  perform write_log(v_entry.shop_id, p_log);
  return v_entry;
end;
$$;



-- ###########################################################################
-- ##  ผ่อนขั้นบันได + สัญญาที่ผ่อนมาก่อนแล้ว
-- ###########################################################################
--
-- โปรผ่อนจริงมักไม่ได้จ่ายเท่ากันทุกงวด เช่น 6 งวดแรก 390 แล้วงวดที่เหลือ 820
-- ทั้งโปรลดราคาช่วงแรก งวดแรกฟรี และขั้นบันไดหลายช่วง เขียนได้ด้วยโครงเดียวกัน
-- คือ "งวดที่ X ถึง Y จ่ายงวดละ Z" ต่อกันหลายบรรทัด จึงเก็บเป็น jsonb array
-- ไว้ดูย้อนหลังและใช้ตอนแก้ไข ส่วนยอดจริงของแต่ละงวดอยู่ในตารางงวดเหมือนเดิม
--
-- สัญญาที่ผ่อนมาก่อนเริ่มใช้แอป: งวดที่จ่ายไปแล้วถูกทำเครื่องหมาย 'prepaid'
-- ซึ่ง close_card_statement มองข้ามอยู่แล้ว (กรองเฉพาะ status = 'pending')
-- จึงไม่สร้างรายจ่ายย้อนหลังและไม่ขยับยอดหนี้บัตร เพราะเงินก้อนนั้นจ่ายไปก่อน
-- จะมาใช้ระบบ ถ้าลงย้อนหลังให้ รายงานเดือนที่ผ่านมาจะพองขึ้นและอาจนับซ้ำกับ
-- ที่ผู้ใช้เคยบันทึกไว้ด้วยวิธีอื่น งวดพวกนี้มีไว้ให้เลขงวดกับยอดคงเหลือถูกต้องเท่านั้น

-- สัญญาเช่าใช้จริงยาวได้ถึง 84 งวด (7 ปี) เพดาน 60 เดิมจึงต่ำเกินไป
alter table card_installments drop constraint if exists card_installments_months_check;
alter table card_installments add  constraint card_installments_months_check
  check (months between 1 and 120);

alter table card_installments add column if not exists tiers jsonb;
alter table card_installments add column if not exists prepaid_count int not null default 0;

-- เปิดรับสถานะ prepaid เพิ่ม (ของเดิมมี pending / billed / paid / cancelled)
alter table card_installment_entries drop constraint if exists card_installment_entries_status_check;
alter table card_installment_entries add  constraint card_installment_entries_status_check
  check (status in ('pending', 'billed', 'paid', 'prepaid', 'cancelled'));

-- ── สร้างสัญญาผ่อน: รับ tiers / prepaid_count และสถานะรายงวด ────────────────
-- p_entries รับ status รายงวดได้แล้ว ('pending' หรือ 'prepaid') ค่าเริ่มต้นคือ pending
-- ยอดต่องวดคำนวณที่ฝั่ง client (src/lib/cardCycle.js ซึ่งมีเทสต์แล้ว) เหมือนเดิม
-- จะได้ไม่ต้องเขียนสูตรซ้ำสองภาษาแล้วปัดเศษคนละแบบ

create or replace function public.create_card_installment(
  p_shop    uuid,
  p_card    uuid,
  p_data    jsonb,
  p_entries jsonb,
  p_log     jsonb default null
) returns card_installments language plpgsql security definer set search_path = public as $$
declare v_ins card_installments; v_e jsonb;
begin
  perform assert_can_edit(p_shop);
  if not exists (select 1 from credit_cards where id = p_card and shop_id = p_shop) then
    raise exception 'ไม่พบบัตรเครดิตของร้านนี้';
  end if;
  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'ต้องมีอย่างน้อยหนึ่งงวด';
  end if;

  insert into card_installments (
    shop_id, card_id, name, vendor, category_id, note,
    principal_amount, total_amount, months, monthly_amount, interest_rate,
    tiers, prepaid_count, purchase_date, first_cycle, created_by
  ) values (
    p_shop, p_card,
    coalesce(p_data->>'name', ''),
    p_data->>'vendor',
    nullif(p_data->>'category_id', '')::uuid,
    p_data->>'note',
    coalesce((p_data->>'principal_amount')::numeric, (p_data->>'total_amount')::numeric),
    (p_data->>'total_amount')::numeric,
    (p_data->>'months')::int,
    (p_data->>'monthly_amount')::numeric,
    coalesce((p_data->>'interest_rate')::numeric, 0),
    p_data->'tiers',
    coalesce((p_data->>'prepaid_count')::int, 0),
    (p_data->>'purchase_date')::date,
    p_data->>'first_cycle',
    auth.uid()
  ) returning * into v_ins;

  for v_e in select * from jsonb_array_elements(p_entries) loop
    insert into card_installment_entries (shop_id, installment_id, seq, cycle, due_date, amount, status)
    values (
      p_shop, v_ins.id,
      (v_e->>'seq')::int,
      v_e->>'cycle',
      (v_e->>'due_date')::date,
      (v_e->>'amount')::numeric,
      coalesce(v_e->>'status', 'pending')
    );
  end loop;

  -- ยังไม่แตะ outstanding และยังไม่สร้าง transactions โดยเจตนา
  -- งวด prepaid จะไม่ถูกเรียกเก็บเลย เพราะ close_card_statement กรองเฉพาะ pending
  --
  -- ยกเว้นงวดที่ตกในรอบที่ออกบิลไปแล้ว — เติมเข้าบิลใบนั้นเลย (ดูส่วนที่ 12)
  -- ไม่งั้นมันจะค้างในรอบที่ปิดแล้ว รอถูกกวาดไปบิลใบหน้า ช้าไปหนึ่งเดือนและดูเหมือนซ้ำ
  perform attach_installment_to_closed_statements(v_ins.id);

  perform write_log(p_shop, p_log);
  return v_ins;
end;
$$;

notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  11. เครื่องหมายถูกรายแถวในบิลบัตร  (เพิ่มภายหลัง — รันทับได้)
-- ###########################################################################
-- ใช้ตอนไล่เช็คบิลกับสลิปทีละบรรทัด ติ๊กไว้ว่าบรรทัดไหนตรวจแล้ว
--
-- ตั้งใจ "ไม่" ตัดเงินตอนติ๊ก เพราะธนาคารเรียกเก็บบิลทั้งใบ ไม่ได้เก็บทีละบรรทัด
-- ถ้าติ๊กแล้วตัดเงินด้วย พอจ่ายบิลทั้งใบทีหลังเงินจะถูกตัดซ้ำสองรอบ
-- การจ่ายจริงยังทำที่ pay_card_statement เหมือนเดิม (เต็มจำนวน / ขั้นต่ำ / กำหนดเอง)
--
-- row_key มาจากฝั่งหน้าจอ: 't-<transaction_id>' หรือ 'a-<card_advance_id>'
-- เก็บเป็น text เพราะบรรทัดในบิลมาจากสองตาราง จะทำ FK ไปตารางเดียวไม่ได้

create table if not exists card_row_marks (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shops(id) on delete cascade,
  card_id    uuid not null references credit_cards(id) on delete cascade,
  cycle      text,
  row_key    text not null,
  marked_by  uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (shop_id, row_key)
);

create index if not exists card_row_marks_card_idx on card_row_marks (card_id, cycle);

do $$
begin
  execute 'alter table card_row_marks enable row level security';

  execute 'drop policy if exists card_row_marks_select on card_row_marks';
  execute 'create policy card_row_marks_select on card_row_marks for select using (is_member(shop_id))';

  execute 'drop policy if exists card_row_marks_insert on card_row_marks';
  execute 'create policy card_row_marks_insert on card_row_marks for insert with check (can_edit(shop_id))';

  execute 'drop policy if exists card_row_marks_update on card_row_marks';
  execute 'create policy card_row_marks_update on card_row_marks for update using (can_edit(shop_id)) with check (can_edit(shop_id))';

  execute 'drop policy if exists card_row_marks_delete on card_row_marks';
  execute 'create policy card_row_marks_delete on card_row_marks for delete using (can_edit(shop_id))';

  execute 'alter table card_row_marks replica identity full';
  begin
    execute 'alter publication supabase_realtime add table card_row_marks';
  exception when duplicate_object then null;
  end;
end $$;

notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  12. แก้ไขและลบสัญญาผ่อน  (เพิ่มภายหลัง — รันทับได้)
-- ###########################################################################
--
-- ก่อนหน้านี้สัญญาผ่อนที่บันทึกไปแล้วแก้ได้แค่ชื่อ/ผู้ขาย/หมวดหมู่/หมายเหตุ
-- ส่วนจำนวนงวด ยอดต่องวด วันที่ซื้อ และบัตรที่ใช้รูด แก้ไม่ได้เลย
-- คนที่พิมพ์ผิดจึงต้องยกเลิกทิ้งแล้วสร้างใหม่ ซึ่งทิ้งสัญญาที่ยกเลิกไว้เป็นขยะ
-- และถ้าเคยจ่ายค่างวดผ่านแอปไปแล้ว เงินก้อนนั้นก็ค้างอยู่โดยไม่มีอะไรคืนให้
--
-- แนวคิด: แยกของที่ "ยังไม่เกิดขึ้นจริง" ออกจากของที่ "เกิดไปแล้ว"
--   • งวดที่ยัง pending/prepaid = ยังไม่มีเงินไหน ขยับได้อิสระ
--   • งวดที่ billed = เข้าบิลบัตรไปแล้ว เป็นหนี้จริงที่ธนาคารเรียกเก็บ ห้ามแตะ
--   • งวดที่ paid = จ่ายผ่านแอปไปแล้ว ต้องคืนเงินเข้ากระเป๋าต้นทางก่อนถึงจะลบได้

-- ── 12.1 แก้ไขสัญญาผ่อน ────────────────────────────────────────────────────
--
-- p_entries = null  → แก้เฉพาะข้อมูลอธิบาย (ทำได้เสมอ แม้เรียกเก็บไปแล้ว)
-- p_entries != null → แก้ทั้งแผน สร้างตารางงวดใหม่ทั้งชุด
--                     ทำได้เฉพาะตอนยังไม่มีงวดไหนถูกเรียกเก็บหรือจ่าย
--
-- ทำไมต้องลบงวดเก่าทิ้งทั้งชุดแล้วใส่ใหม่ ไม่ค่อยๆ แก้ทีละแถว
--   จำนวนงวดเปลี่ยนได้ (12 → 6) และเลขงวดกับรอบบิลเลื่อนตามวันที่ซื้อทั้งแถว
--   การจับคู่ทีละแถวจึงมีแต่จะเหลืองวดกำพร้าที่ไม่มีใครอ้างถึง

create or replace function public.update_card_installment(
  p_installment uuid,
  p_card        uuid    default null,
  p_data        jsonb   default null,
  p_entries     jsonb   default null,
  p_log         jsonb   default null
) returns card_installments language plpgsql security definer set search_path = public as $$
declare
  v_ins    card_installments;
  v_e      jsonb;
  v_locked int;
begin
  select * into v_ins from card_installments where id = p_installment;
  if not found then raise exception 'ไม่พบรายการผ่อนนี้'; end if;
  perform assert_can_edit(v_ins.shop_id);

  if v_ins.status <> 'active' then
    raise exception 'สัญญานี้ปิดหรือยกเลิกไปแล้ว แก้ไขไม่ได้';
  end if;

  -- ข้อมูลอธิบาย แก้ได้เสมอ ไม่กระทบเงินสักบาท
  update card_installments
     set name        = coalesce(p_data->>'name', name),
         vendor      = case when p_data ? 'vendor'      then nullif(p_data->>'vendor', '')                else vendor end,
         category_id = case when p_data ? 'category_id' then nullif(p_data->>'category_id', '')::uuid     else category_id end,
         note        = case when p_data ? 'note'        then nullif(p_data->>'note', '')                  else note end,
         updated_at  = now()
   where id = p_installment
   returning * into v_ins;

  if p_entries is null then
    perform write_log(v_ins.shop_id, p_log);
    return v_ins;
  end if;

  -- ตั้งแต่บรรทัดนี้ลงไปคือแก้ทั้งแผน ต้องไม่มีงวดไหนเกิดขึ้นจริงไปแล้ว
  select count(*) into v_locked
    from card_installment_entries
   where installment_id = p_installment and status in ('billed', 'paid');
  if v_locked > 0 then
    raise exception 'มีงวดที่เรียกเก็บหรือจ่ายไปแล้ว % งวด แก้จำนวนงวดหรือยอดต่องวดไม่ได้ — ย้อนงวดที่จ่ายไว้ก่อน', v_locked;
  end if;

  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'ต้องมีอย่างน้อยหนึ่งงวด';
  end if;

  if p_card is not null then
    if not exists (select 1 from credit_cards where id = p_card and shop_id = v_ins.shop_id) then
      raise exception 'ไม่พบบัตรเครดิตของร้านนี้';
    end if;
  end if;

  update card_installments
     set card_id          = coalesce(p_card, card_id),
         principal_amount = coalesce((p_data->>'principal_amount')::numeric, (p_data->>'total_amount')::numeric, principal_amount),
         total_amount     = coalesce((p_data->>'total_amount')::numeric, total_amount),
         months           = coalesce((p_data->>'months')::int, months),
         monthly_amount   = coalesce((p_data->>'monthly_amount')::numeric, monthly_amount),
         interest_rate    = coalesce((p_data->>'interest_rate')::numeric, interest_rate),
         tiers            = case when p_data ? 'tiers' then p_data->'tiers' else tiers end,
         prepaid_count    = coalesce((p_data->>'prepaid_count')::int, prepaid_count),
         purchase_date    = coalesce((p_data->>'purchase_date')::date, purchase_date),
         first_cycle      = coalesce(p_data->>'first_cycle', first_cycle),
         updated_at       = now()
   where id = p_installment
   returning * into v_ins;

  delete from card_installment_entries where installment_id = p_installment;

  for v_e in select * from jsonb_array_elements(p_entries) loop
    insert into card_installment_entries (shop_id, installment_id, seq, cycle, due_date, amount, status)
    values (
      v_ins.shop_id, v_ins.id,
      (v_e->>'seq')::int,
      v_e->>'cycle',
      (v_e->>'due_date')::date,
      (v_e->>'amount')::numeric,
      coalesce(v_e->>'status', 'pending')
    );
  end loop;

  -- งวดที่ตกในรอบที่ออกบิลไปแล้ว เติมเข้าบิลใบนั้นทันที (ดูส่วนที่ 12)
  perform attach_installment_to_closed_statements(v_ins.id);

  perform write_log(v_ins.shop_id, p_log);
  return v_ins;
end;
$$;


-- ── 12.2 ลบสัญญาผ่อนทิ้งทั้งฉบับ ───────────────────────────────────────────
--
-- ต่างจาก cancel_card_installment ที่เก็บสัญญาไว้เป็นประวัติ (ใช้ตอนเลิกผ่อนกลางคัน
-- ทั้งที่ผ่อนไปแล้วจริง) อันนี้คือ "บันทึกผิด ไม่ควรมีรายการนี้ตั้งแต่แรก"
--
-- งวดที่จ่ายผ่านแอปไปแล้วจะถูกคืนเงินเข้ากระเป๋าต้นทางและลบรายจ่ายที่ผูกไว้ให้ครบ
-- ก่อนลบสัญญา — เหมือนกดย้อนทีละงวดเอง แต่จบในทรานแซกชันเดียวจึงไม่มีทางค้างครึ่งทาง
--
-- งวดที่ billed แล้วลบไม่ได้ เพราะมันกลายเป็นยอดในบิลบัตรที่ธนาคารเรียกเก็บไปแล้ว
-- ถ้าลบตรงนี้ ยอดบิลกับยอดหนี้จะขัดกันทันทีโดยไม่มีอะไรบอก ให้ใช้ "ยกเลิก" แทน

create or replace function public.delete_card_installment(
  p_installment uuid,
  p_log         jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_ins    card_installments;
  v_entry  card_installment_entries;
  v_billed int;
  v_src    text;
begin
  select * into v_ins from card_installments where id = p_installment;
  if not found then raise exception 'ไม่พบรายการผ่อนนี้'; end if;
  perform assert_can_edit(v_ins.shop_id);

  select count(*) into v_billed
    from card_installment_entries
   where installment_id = p_installment and status = 'billed';
  if v_billed > 0 then
    raise exception 'มีงวดที่เข้าบิลบัตรไปแล้ว % งวด ลบทิ้งไม่ได้ — ใช้ "ยกเลิกสัญญา" แทน', v_billed;
  end if;

  -- บอก trigger กันลบว่านี่คือ RPC ของสัญญาผ่อน ลบรายจ่ายที่ผูกไว้ได้
  perform set_config('jodflow.installment_rpc', '1', true);

  -- คืนเงินงวดที่จ่ายผ่านแอปไปแล้ว ทีละงวด ตามกระเป๋าที่ตัดไปจริง (เท่าที่จ่ายจริง)
  -- บัญชีที่ถูกลบไปแล้ว refund_source คืนเข้าเงินสดแทน ไม่งั้นลบสัญญาไม่ได้ตลอดไป
  for v_entry in
    select * from card_installment_entries
     where installment_id = p_installment and status = 'paid'
  loop
    v_src := refund_source(v_entry.shop_id, v_entry.paid_method, v_entry.transfer_account_id);
    perform apply_wallet_effect(v_entry.shop_id, v_src, coalesce(v_entry.paid_amount, v_entry.amount));
    if v_entry.transaction_id is not null then
      delete from transactions where id = v_entry.transaction_id;
    end if;
  end loop;

  delete from card_installment_entries where installment_id = p_installment;
  delete from card_installments where id = p_installment;

  perform write_log(v_ins.shop_id, p_log);
end;
$$;


-- ###########################################################################
-- ##  12. ย้อนและแก้ทีหลังให้ปลอดภัย
-- ###########################################################################
--
-- ทุกข้อในส่วนนี้เกิดตอน "แก้ทีหลัง" ไม่ใช่ตอนบันทึกครั้งแรก
--   1) จ่ายบิลจากสองกระเป๋าแล้วย้อน เงินคืนไปกระเป๋าสุดท้ายทั้งก้อน
--      → เก็บ "ขา" การจ่ายทีละครั้ง (card_statement_payments) แล้วย้อนทีละขา
--   2) ย้อนแล้วบัญชีต้นทางถูกลบไปแล้ว → ล้มตลอดไป
--      → refund_source() คืนเข้าเงินสดแทนเมื่อบัญชีหายไป
--   3) จ่ายค่างวดไม่เต็มยอด ตารางงวดถูกเขียนทับ / งวดที่จ่ายมาก่อนสั่งจ่ายซ้ำได้
--      → paid_amount แยกจากยอดตามตาราง และกัน prepaid (ใน pay_installment_entry)
--   4) ย้อนงวดสุดท้ายแล้วสัญญาที่ปิดไปแล้วไม่กลับมาเปิด งวดหายจากทุกบิล
--      → undo_installment_entry เปิดสัญญากลับเป็น active
--   5) ยกเลิก "รายการงวดผ่อน" จากหน้าประวัติ ทะลุตัวกันของสัญญาผ่อน
--      → trigger บน transactions ห้ามลบ/แก้ยอดรายการที่ผูกกับงวด นอกจากผ่าน RPC ของสัญญา

-- ── สิทธิ์เข้าถึงตารางขาการจ่ายบิล (ตัวตารางสร้างไว้ในส่วนที่ 1) ─────────────
do $$
begin
  execute 'alter table card_statement_payments enable row level security';
  execute 'drop policy if exists card_statement_payments_select on card_statement_payments';
  execute 'create policy card_statement_payments_select on card_statement_payments for select using (is_member(shop_id))';
  execute 'drop policy if exists card_statement_payments_insert on card_statement_payments';
  execute 'create policy card_statement_payments_insert on card_statement_payments for insert with check (can_edit(shop_id))';
  execute 'drop policy if exists card_statement_payments_update on card_statement_payments';
  execute 'create policy card_statement_payments_update on card_statement_payments for update using (can_edit(shop_id)) with check (can_edit(shop_id))';
  execute 'drop policy if exists card_statement_payments_delete on card_statement_payments';
  execute 'create policy card_statement_payments_delete on card_statement_payments for delete using (can_edit(shop_id))';
end $$;

-- ── งวดที่ตกในรอบที่ออกบิลไปแล้ว → เพิ่มเข้าบิลใบนั้นเลย ────────────────────
--
-- บันทึกสัญญาผ่อนย้อนหลัง (เช่น "ผ่อนมาแล้ว 22 งวด") แล้วงวดถัดไปครบกำหนดในรอบที่
-- ระบบออกบิลไปแล้ว — ของจริงธนาคารใส่งวดนั้นในบิลใบนั้นตั้งแต่ต้น แต่บิลในระบบ
-- ถูกปิดก่อนที่จะรู้จักสัญญานี้ จึงขาดงวดนั้นไป
--
-- ถ้าปล่อยไว้ งวดจะค้างเป็น pending ในรอบที่ปิดแล้ว ตัวปิดรอบถัดไปจะกวาดไปรวม
-- กับบิลใบหน้า ยอดรวมถูกแต่ช้าไปหนึ่งเดือน และหน้าจอโชว์สองงวดในรอบเดียวจนดูเหมือน
-- ระบบสร้างซ้ำ ที่ถูกคือ "เติมเข้าบิลใบเดิม" เหมือนที่ธนาคารเห็น
--
-- ทำเฉพาะใบที่ยังไม่ถูกจ่ายครบ ใบที่จ่ายจบไปแล้วห้ามแตะ (จ่ายไปแล้วเปิดกลับไม่ได้)
-- งวดของใบนั้นปล่อยให้ตัวปิดรอบกวาดไปบิลถัดไปตามเดิม
create or replace function public.attach_installment_to_closed_statements(
  p_installment uuid
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_ins   card_installments;
  v_entry record;
  v_st    card_statements;
  v_tx    transactions;
  v_rate  numeric(5,2);
  v_n     int := 0;
begin
  select * into v_ins from card_installments where id = p_installment;
  if not found then return 0; end if;
  select coalesce(card_min_rate, 8) into v_rate from shop_settings where shop_id = v_ins.shop_id;

  for v_entry in
    select e.*, s.id as st_id
      from card_installment_entries e
      join card_statements s
        on s.card_id = v_ins.card_id and s.cycle = e.cycle and s.status <> 'paid'
     where e.installment_id = p_installment and e.status = 'pending'
     order by e.seq
  loop
    select * into v_st from card_statements where id = v_entry.st_id;

    -- แบบเดียวกับที่ close_card_statement ทำตอนปิดรอบ: รายจ่ายหนึ่งแถว + หนี้บัตรเพิ่ม
    insert into transactions (
      shop_id, date, type, amount, method, category_id, item_name, vendor,
      card_id, installment_entry_id, note, created_by
    ) values (
      v_ins.shop_id, v_st.period_end, 'expense', v_entry.amount, 'card', v_ins.category_id,
      v_ins.name || ' (งวด ' || v_entry.seq || '/' || v_ins.months || ')',
      v_ins.vendor, v_ins.card_id, v_entry.id,
      'งวดผ่อนที่เพิ่มเข้าบิลรอบที่ออกไปแล้ว', auth.uid()
    ) returning * into v_tx;
    perform apply_wallet_effect(v_ins.shop_id, 'card:' || v_ins.card_id, -v_entry.amount);

    update card_installment_entries
       set status = 'billed', transaction_id = v_tx.id, billed_at = v_st.period_end,
           statement_id = v_st.id
     where id = v_entry.id;

    -- ยอดบิลขยับตาม ขั้นต่ำคิดใหม่จากยอดใหม่ สถานะ: ยังไม่จ่ายเลย = closed, จ่ายบางส่วน = partial
    update card_statements
       set spend_amount   = spend_amount + v_entry.amount,
           amount         = amount + v_entry.amount,
           minimum_amount = greatest(0, least(amount + v_entry.amount,
                              round((amount + v_entry.amount) * coalesce(v_rate, 8) / 100, 2))),
           status         = case when paid_amount > 0 then 'partial' else 'closed' end
     where id = v_st.id;

    v_n := v_n + 1;
  end loop;

  -- สัญญาที่ทุกงวดถูกเก็บครบแล้ว
  update card_installments
     set status = 'completed', updated_at = now()
   where id = p_installment and status = 'active'
     and not exists (select 1 from card_installment_entries where installment_id = p_installment and status = 'pending');

  return v_n;
end;
$$;

-- ── กระเป๋าที่จะคืนเงินให้ ───────────────────────────────────────────────────
-- บัญชีเงินโอนที่ถูกลบไปแล้ว คืนเงินเข้าไม่ได้ (apply_wallet_effect จะ raise)
-- ให้คืนเข้าเงินสดแทน — ดีกว่าย้อนไม่ได้เลย และผู้ใช้โอนต่อเองได้
create or replace function public.refund_source(p_shop uuid, p_method text, p_account uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_method = 'transfer' and p_account is not null
         and exists (select 1 from transfer_accounts where id = p_account and shop_id = p_shop)
      then 'transfer:' || p_account
    else 'cash'
  end
$$;

-- ── กันแก้/ลบรายจ่ายที่เป็นค่างวดผ่อนจากที่อื่น ────────────────────────────────
-- รายจ่ายที่ผูกกับงวด (installment_entry_id) ถูกสร้างโดยตัวปิดรอบหรือตอนจ่ายค่างวด
-- ถ้าไปลบจากหน้าประวัติ หนี้บัตรลด แต่งวดยังเป็น billed และบิลยังเก็บอยู่ → ขัดกันถาวร
-- RPC ของสัญญาผ่อนที่ตั้งใจลบ ตั้ง jodflow.installment_rpc = '1' ไว้ก่อน
-- ส่วนการลบร้านทั้งร้าน (cascade) แถวร้านหายไปแล้วตอน trigger ทำงาน จึงปล่อยผ่าน
create or replace function public.guard_installment_transaction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('jodflow.installment_rpc', true), '') = '1' then
    return coalesce(new, old);
  end if;
  if old.installment_entry_id is null then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from shops where id = old.shop_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'รายการนี้เป็นค่างวดผ่อน ลบจากประวัติไม่ได้ — ให้ย้อนที่งวดในหน้าบัตรและหนี้สิน';
  end if;
  if new.amount is distinct from old.amount
     or new.date is distinct from old.date
     or new.card_id is distinct from old.card_id
     or new.method is distinct from old.method then
    raise exception 'รายการนี้เป็นค่างวดผ่อน แก้ยอด วันที่ หรือช่องทางไม่ได้ — ให้แก้ที่สัญญาผ่อน';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_installment_guard on transactions;
create trigger transactions_installment_guard
  before update or delete on transactions
  for each row execute function public.guard_installment_transaction();

notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  14. ซ่อมย้อนหลัง — งวดของสัญญาที่มีอยู่ก่อนแพตช์นี้
-- ###########################################################################
--
-- attach_installment_to_closed_statements ถูกเรียกตอน "สร้าง/แก้" แผนผ่อนเท่านั้น
-- สัญญาที่บันทึกไว้ก่อนหน้านั้นจึงยังมีงวดค้างเป็น pending อยู่ในรอบที่ออกบิลไปแล้ว
-- ผลที่เห็นบนหน้าจอคือบิลรอบปัจจุบันกวาดสองงวดของสัญญาเดียวกันมารวมกัน
-- (งวดที่ตกค้าง + งวดของรอบนี้) ดูเหมือนระบบสร้างรายการซ้ำ ทั้งที่ยอดรวมถูก
--
-- บล็อกนี้ไล่เรียกฟังก์ชันเดิมให้ทุกสัญญาที่ยังผ่อนอยู่ ทำงานเหมือนกันทุกอย่าง
--   • เติมงวดเข้าบิลใบที่ยังไม่จ่ายจบของรอบนั้น (สร้างรายจ่าย + เพิ่มหนี้บัตร + ยกยอดบิล)
--   • บิลที่จ่ายจบแล้วไม่แตะ งวดนั้นจะไปรวมกับบิลรอบถัดไปตามเดิม ซึ่งถูกต้องแล้ว
-- รันซ้ำได้ไม่มีผลข้างเคียง งวดที่เติมไปแล้วเปลี่ยนสถานะเป็น billed จึงไม่ถูกหยิบอีก
--
-- รันจาก SQL Editor ไม่มีผู้ใช้ล็อกอิน auth.uid() จึงเป็น NULL แต่ฟังก์ชันที่เรียกต่อ
-- (apply_wallet_effect → assert_can_edit) ตรวจสิทธิ์จาก auth.uid() → ล้มด้วย 42501
-- "ไม่มีสิทธิ์แก้ไขข้อมูลของร้านนี้" แล้วทั้งไฟล์หยุดตรงนี้ ส่วนที่ 15 ไม่ได้รัน
-- จึงต้องสวมตัวตนเจ้าของร้านชั่วคราวผ่าน claim ของ JWT (มีผลเฉพาะใน transaction นี้)
-- รายจ่ายที่ถูกสร้างจะมี created_by เป็นเจ้าของร้าน เหมือนเจ้าของกดเองจากแอป
do $$
declare
  v_ins   record;
  v_owner uuid;
  v_total int := 0;
  v_skip  int := 0;
begin
  for v_ins in
    select i.id, i.shop_id from card_installments i where i.status = 'active'
  loop
    select user_id into v_owner
      from shop_members
     where shop_id = v_ins.shop_id and role in ('owner', 'editor')
     order by case role when 'owner' then 0 else 1 end, created_at
     limit 1;
    if v_owner is null then
      v_skip := v_skip + 1;
      continue;
    end if;

    -- auth.uid() ของ Supabase อ่านจาก request.jwt.claims (รุ่นใหม่) หรือ request.jwt.claim.sub (รุ่นเก่า)
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_owner::text, true);

    v_total := v_total + coalesce(attach_installment_to_closed_statements(v_ins.id), 0);
  end loop;

  -- ถอดตัวตนออก ไม่ให้คำสั่งถัดไปในไฟล์ทำงานในนามใคร
  -- ('{}' ไม่ใช่ '' เพราะ auth.uid() แปลงค่านี้เป็น jsonb สตริงว่างจะพังตอนอ่าน)
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  raise notice 'เติมงวดผ่อนเข้าบิลที่ออกไปแล้ว % งวด (ข้ามร้านที่ไม่มีเจ้าของ % สัญญา)', v_total, v_skip;
end $$;


-- ── ตรวจผลของส่วนที่ 14 ─────────────────────────────────────────────────────
-- ทั้งสองแถวต้องเป็น 0 ถ้าไม่ใช่ ให้ส่งผลลัพธ์นี้กลับมา
select 'งวดที่ยังค้างในรอบที่ออกบิลไปแล้ว' as "ตรวจผล",
       count(*)::text as "จำนวน (ต้องเป็น 0)"
  from card_installment_entries e
  join card_installments i on i.id = e.installment_id
  join card_statements   s on s.card_id = i.card_id and s.cycle = e.cycle and s.status <> 'paid'
 where e.status = 'pending'
union all
select 'สัญญาที่มีเกินหนึ่งงวดในรอบเดียวกัน',
       count(*)::text
  from (
    select e.installment_id
      from card_installment_entries e
     where e.status = 'pending'
     group by e.installment_id, e.cycle
    having count(*) > 1
  ) x;

notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  15. รายการรูดที่ต้องไปอยู่ในบิลที่ออกไปแล้ว
-- ###########################################################################
--
-- ปัญหา: เปิดบิลจริงของธนาคารแล้วมาคีย์รายการที่เห็นในบิลลงแอป วันที่ที่คีย์คือวันนี้
-- ซึ่งเลยวันสรุปยอดไปแล้ว รายการจึงไปตกบิลรอบหน้า ทั้งที่ธนาคารเก็บในบิลใบที่กำลัง
-- จะจ่ายพรุ่งนี้ ยอดที่ต้องชำระในแอปเลยไม่ตรงกับบิลจริง
--
-- ย้อนวันที่เองไม่ช่วย และแย่กว่าเดิม: กฎการเก็บของบิลคือ "เก็บทุกอย่างที่ยังไม่มีใบไหน
-- ครอบช่วงวันที่" ถ้าย้อนวันที่เข้าไปในรอบที่ออกบิลแล้ว บิลใหม่จะข้ามมัน (ถือว่ามีใบครอบ)
-- ส่วนใบเก่าก็ปิดยอดไปแล้วไม่ได้รวมไว้ → รายการหายจากทุกบิลทั้งที่หนี้บัตรเพิ่มจริง
--
-- ทางแก้คือผูกรายการกับใบตรงๆ ผ่าน transactions.card_statement_id
--   • ผูกแล้ว = ใบนั้นเก็บรายการนี้ ยอดบิลกับขั้นต่ำถูกคิดใหม่ทันที
--   • บิลรอบถัดไปข้ามรายการที่ผูกใบแล้วเสมอ จึงไม่มีทางถูกเก็บซ้ำสองใบ
--   • ย้ายออกได้ ยอดบิลลดกลับให้เอง · แก้ยอด/ลบรายการ ยอดบิลขยับตามผ่าน trigger
--   • ใบที่จ่ายจบแล้วห้ามแตะ ต้องย้อนการจ่ายก่อน

alter table transactions add column if not exists card_statement_id uuid
  references card_statements(id) on delete set null;
create index if not exists transactions_card_statement_idx
  on transactions (card_statement_id);


-- ── คิดยอดบิลใหม่หลังมีของเข้า/ออก ───────────────────────────────────────────
-- ที่เดียวที่แก้ยอดใบ เพื่อให้ขั้นต่ำและสถานะถูกคิดด้วยกฎเดียวกันเสมอ
create or replace function public.apply_statement_delta(
  p_statement uuid,
  p_spend     numeric,
  p_credit    numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_st     card_statements;
  v_rate   numeric(5,2);
  v_amount numeric(12,2);
begin
  select * into v_st from card_statements where id = p_statement;
  if not found then return; end if;
  select coalesce(card_min_rate, 8) into v_rate from shop_settings where shop_id = v_st.shop_id;

  v_amount := v_st.amount + p_spend - p_credit;
  update card_statements
     set spend_amount   = greatest(0, spend_amount + p_spend),
         credit_amount  = greatest(0, credit_amount + p_credit),
         amount         = v_amount,
         minimum_amount = greatest(0, least(v_amount, round(v_amount * coalesce(v_rate, 8) / 100, 2))),
         -- จ่ายครบพอดีหรือเกิน = ปิดใบ · จ่ายมาบางส่วน = partial · ยังไม่จ่าย = closed
         status = case when v_amount - paid_amount <= 0 then 'paid'
                       when paid_amount > 0 then 'partial'
                       else 'closed' end
   where id = p_statement;
end;
$$;


-- ── ใส่รายการเข้าบิลใบที่ออกไปแล้ว ───────────────────────────────────────────
create or replace function public.attach_transaction_to_statement(
  p_transaction uuid,
  p_statement   uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tx transactions;
  v_st card_statements;
  v_moved    numeric(14,2);
  v_moved_at date;
begin
  select * into v_tx from transactions where id = p_transaction;
  if not found then raise exception 'ไม่พบรายการที่จะใส่เข้าบิล'; end if;
  select * into v_st from card_statements where id = p_statement;
  if not found then raise exception 'ไม่พบบิลใบนี้'; end if;

  if v_tx.shop_id <> v_st.shop_id then raise exception 'รายการกับบิลอยู่คนละร้าน'; end if;
  if v_tx.card_id is null or v_tx.card_id <> v_st.card_id then
    raise exception 'รายการนี้ไม่ได้รูดกับบัตรใบเดียวกับบิล';
  end if;
  if v_st.status = 'paid' then
    raise exception 'บิลใบนี้จ่ายจบแล้ว ใส่รายการเพิ่มไม่ได้ — ย้อนการจ่ายก่อน';
  end if;
  if v_tx.card_statement_id is not distinct from p_statement then return; end if;
  if v_tx.card_statement_id is not null then
    perform detach_transaction_from_statement(p_transaction);
  end if;

  update transactions set card_statement_id = p_statement where id = p_transaction;

  -- ยอดที่จ่ายให้รายการนี้ไว้ก่อนออกบิล (ส่วนที่ 16) ย้ายตามเข้าใบ ไม่งั้นใบจะมีรายการ
  -- แต่ไม่รู้ว่าจ่ายไปแล้ว ผู้ใช้ต้องจ่ายซ้ำ · apply_statement_delta คิดสถานะใบให้ต่อ
  with moved as (
    update card_statement_payments set statement_id = p_statement
     where transaction_id = p_transaction and statement_id is null
    returning amount, paid_at
  )
  select coalesce(sum(amount), 0), max(paid_at) into v_moved, v_moved_at from moved;
  if v_moved > 0 then
    update card_statements
       set paid_amount = paid_amount + v_moved,
           paid_at = coalesce(paid_at, v_moved_at)
     where id = p_statement;
  end if;

  perform apply_statement_delta(
    p_statement,
    case when v_tx.type = 'income' then 0 else v_tx.amount end,
    case when v_tx.type = 'income' then v_tx.amount else 0 end
  );
end;
$$;


-- ── เอารายการออกจากบิล ──────────────────────────────────────────────────────
-- ออกแล้วรายการกลับไปเป็น "ยังไม่มีใบครอบ" บิลรอบถัดไปจะกวาดไปเก็บตามปกติ
create or replace function public.detach_transaction_from_statement(
  p_transaction uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tx transactions;
  v_st card_statements;
  v_moved numeric(14,2);
begin
  select * into v_tx from transactions where id = p_transaction;
  if not found or v_tx.card_statement_id is null then return; end if;
  select * into v_st from card_statements where id = v_tx.card_statement_id;
  if found and v_st.status = 'paid' then
    raise exception 'บิลใบนี้จ่ายจบแล้ว เอารายการออกไม่ได้ — ย้อนการจ่ายก่อน';
  end if;

  update transactions set card_statement_id = null where id = p_transaction;

  -- ขาที่ตามรายการนี้เข้าใบมา (ดู attach) ถอยกลับไปเป็นขาเปิด รอบิลรอบหน้าเก็บใหม่
  -- เฉพาะขาที่ผูกรายการนี้ ขาที่จ่ายทั้งใบตามปกติไม่เกี่ยว
  with moved as (
    update card_statement_payments set statement_id = null
     where transaction_id = p_transaction and statement_id = v_tx.card_statement_id
    returning amount
  )
  select coalesce(sum(amount), 0) into v_moved from moved;
  if v_moved > 0 then
    update card_statements
       set paid_amount = greatest(0, paid_amount - v_moved)
     where id = v_tx.card_statement_id;
  end if;

  perform apply_statement_delta(
    v_tx.card_statement_id,
    case when v_tx.type = 'income' then 0 else -v_tx.amount end,
    case when v_tx.type = 'income' then -v_tx.amount else 0 end
  );
end;
$$;


-- ── แก้/ลบรายการที่ผูกใบไว้ ยอดบิลต้องขยับตาม ────────────────────────────────
-- ถ้าไม่มี trigger นี้ ลบรายการที่ผูกใบแล้ว หนี้บัตรลดแต่ยอดบิลยังค้างเท่าเดิม
-- ผู้ใช้จะจ่ายบิลด้วยยอดที่ไม่มีอยู่จริง
create or replace function public.sync_statement_on_transaction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.card_statement_id is null then return old; end if;
    -- ลบทั้งร้าน (cascade) แถวร้านหายไปแล้ว ปล่อยผ่าน
    if not exists (select 1 from shops where id = old.shop_id) then return old; end if;
    if exists (select 1 from card_statements where id = old.card_statement_id and status = 'paid') then
      raise exception 'รายการนี้อยู่ในบิลที่จ่ายจบแล้ว ลบไม่ได้ — ย้อนการจ่ายบิลก่อน';
    end if;
    perform apply_statement_delta(
      old.card_statement_id,
      case when old.type = 'income' then 0 else -old.amount end,
      case when old.type = 'income' then -old.amount else 0 end
    );
    return old;
  end if;

  -- ย้ายใบเป็นหน้าที่ของ attach/detach ซึ่งคิดยอดเองแล้ว ตรงนี้ไม่ต้องทำซ้ำ
  if new.card_statement_id is distinct from old.card_statement_id then return new; end if;
  if new.card_statement_id is null then return new; end if;
  if new.amount = old.amount and new.type = old.type then return new; end if;
  if exists (select 1 from card_statements where id = new.card_statement_id and status = 'paid') then
    raise exception 'รายการนี้อยู่ในบิลที่จ่ายจบแล้ว แก้ยอดไม่ได้ — ย้อนการจ่ายบิลก่อน';
  end if;

  perform apply_statement_delta(
    new.card_statement_id,
    (case when new.type = 'income' then 0 else new.amount end)
      - (case when old.type = 'income' then 0 else old.amount end),
    (case when new.type = 'income' then new.amount else 0 end)
      - (case when old.type = 'income' then old.amount else 0 end)
  );
  return new;
end;
$$;

drop trigger if exists transactions_statement_sync on transactions;
create trigger transactions_statement_sync
  after update or delete on transactions
  for each row execute function public.sync_statement_on_transaction();

-- ###########################################################################
-- ##  16. จ่ายรายการรูดทีละรายการก่อนออกบิล
-- ###########################################################################
--
-- วิธีใช้บัตรของคนจำนวนมาก: รูดจ่ายแล้วโอนเงินคืนเข้าบัตรเฉพาะยอดนั้นทันที
-- ไม่รอบิล (ที่ธนาคารเรียก "ชำระก่อนวันสรุปยอด") ยอดที่โอนไปโผล่ในบิลใบถัดไปเป็น
-- บรรทัด "ยอดชำระ" ทำให้ยอดที่ต้องชำระเหลือเฉพาะรายการที่ยังไม่ได้โอน
--
-- ในแอป: ขาการจ่าย (card_statement_payments) ที่ยังไม่ผูกใบ + ผูกรายการที่จ่ายให้
--   • เงินออกจากกระเป๋าที่เลือก หนี้บัตรลดทันที เหมือนจ่ายบิล (สองขา ผลรวมศูนย์)
--   • ไม่สร้าง transactions — รายจ่ายเกิดแล้วตอนรูด ถ้าบันทึกซ้ำจะนับสองเท่าในรายงาน
--   • หน้าจอหักยอดนี้ออกจาก "รอบถัดไปสะสมแล้ว" ทันที (getCurrentCycle)
--   • ตอนออกบิล close_card_statement ผูกขาเข้าใบและตั้ง paid_amount ให้ ใบจึงออกมา
--     เป็น partial/paid ตั้งแต่ต้น ย้อนได้ที่ปุ่มย้อนของบิลเหมือนขาปกติ
--   • ก่อนออกบิลย้อนได้ที่รายการนั้นเอง (undo_card_prepayment)
--   • รายการที่อยู่ในบิลที่ออกแล้ว ไม่ใช้ทางนี้ — จ่ายที่บิลด้วยยอดเฉพาะรายการแทน
--     (pay_card_statement รับยอดบางส่วนอยู่แล้ว)

create or replace function public.prepay_card_transaction(
  p_transaction uuid,
  p_method      text,
  p_account     uuid,
  p_amount      numeric,
  p_date        date,
  p_log         jsonb default null
) returns card_statement_payments language plpgsql security definer set search_path = public as $$
declare
  v_tx   transactions;
  v_paid numeric(14,2);
  v_leg  card_statement_payments;
  v_src  text;
begin
  select * into v_tx from transactions where id = p_transaction;
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
  perform assert_can_edit(v_tx.shop_id);

  if v_tx.method <> 'card' or v_tx.card_id is null then
    raise exception 'รายการนี้ไม่ได้รูดบัตร';
  end if;
  if v_tx.type <> 'expense' then
    raise exception 'จ่ายล่วงหน้าได้เฉพาะรายการรูดจ่าย';
  end if;
  if v_tx.installment_entry_id is not null then
    raise exception 'ค่างวดผ่อนจ่ายที่เมนู "จ่ายค่างวด" ของสัญญานั้นแทน';
  end if;
  -- มีใบครอบแล้ว = อยู่ในบิลที่ออกแล้ว ต้องจ่ายที่บิลใบนั้น
  if v_tx.card_statement_id is not null or exists (
    select 1 from card_statements s
     where s.card_id = v_tx.card_id and v_tx.date between s.period_start and s.period_end
  ) then
    raise exception 'รายการนี้อยู่ในบิลที่ออกแล้ว ให้กด "จ่ายบิล" แล้วใส่ยอดเฉพาะรายการนี้แทน';
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่าศูนย์'; end if;
  select coalesce(sum(amount), 0) into v_paid
    from card_statement_payments where transaction_id = p_transaction and statement_id is null;
  if v_paid + p_amount > v_tx.amount + 0.005 then
    raise exception 'จ่ายเกินยอดของรายการ (รายการ % บาท จ่ายไปแล้ว % บาท)', v_tx.amount, v_paid;
  end if;
  if p_method not in ('cash', 'transfer') then
    raise exception 'วิธีจ่ายไม่ถูกต้อง: %', p_method;
  end if;
  if p_method = 'transfer' and p_account is null then
    raise exception 'ต้องเลือกบัญชีเงินโอนที่จะจ่าย';
  end if;

  -- สองขาเหมือน pay_card_statement: เงินออกจากกระเป๋า หนี้บัตรลด
  v_src := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_tx.shop_id, v_src, -p_amount);
  perform apply_wallet_effect(v_tx.shop_id, 'card:' || v_tx.card_id, p_amount);

  insert into card_statement_payments
    (shop_id, statement_id, card_id, transaction_id, method, transfer_account_id, amount, paid_at)
  values
    (v_tx.shop_id, null, v_tx.card_id, p_transaction, p_method,
     case when p_method = 'transfer' then p_account end, p_amount, p_date)
  returning * into v_leg;

  perform write_log(v_tx.shop_id, p_log);
  return v_leg;
end;
$$;

-- ย้อนขาที่จ่ายก่อนออกบิล — ใช้ได้เฉพาะตอนที่ยังไม่ถูกรวมเข้าใบ
-- หลังออกบิลแล้วขานี้เป็นขาของบิล ต้องย้อนที่ undo_card_payment (LIFO ทีละขา)
create or replace function public.undo_card_prepayment(
  p_leg uuid,
  p_log jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_leg card_statement_payments;
begin
  select * into v_leg from card_statement_payments where id = p_leg;
  if not found then raise exception 'ไม่พบการจ่ายนี้'; end if;
  perform assert_can_edit(v_leg.shop_id);
  if v_leg.statement_id is not null then
    raise exception 'ยอดนี้ถูกรวมเข้าบิลแล้ว ให้ย้อนที่ปุ่ม "ย้อนการจ่าย" ของบิลใบนั้นแทน';
  end if;
  if v_leg.card_id is null then raise exception 'การจ่ายนี้ไม่ได้ผูกกับบัตร'; end if;

  -- บัญชีที่ถูกลบไปแล้ว refund_source คืนเข้าเงินสดแทน
  perform apply_wallet_effect(v_leg.shop_id,
    refund_source(v_leg.shop_id, v_leg.method, v_leg.transfer_account_id), v_leg.amount);
  perform apply_wallet_effect(v_leg.shop_id, 'card:' || v_leg.card_id, -v_leg.amount);

  delete from card_statement_payments where id = p_leg;
  perform write_log(v_leg.shop_id, p_log);
end;
$$;


notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  17. ทำเครื่องหมายว่ารายการในบิล "จ่ายไปแล้ว" โดยไม่ตัดเงินซ้ำ
-- ###########################################################################
--
-- เกิดกับบิลที่จ่ายไปก่อนระบบจะจำได้ว่าเงินก้อนนั้นเป็นของบรรทัดไหน (ก่อนมี
-- p_transaction ในส่วนที่ 6) เงินออกไปแล้วจริงและยอดบิลลดไปแล้ว เหลือแค่ไม่มีใครรู้
-- ว่ามันคือค่าของรายการไหน หน้าจอจึงยังขึ้นว่ายังไม่จ่าย
--
-- ฟังก์ชันนี้ไม่ขยับเงินเลยแม้แต่บาทเดียว แค่ผูก "ขา" ที่จ่ายไว้แล้วเข้ากับรายการ
-- ขาหนึ่งที่จ่ายรวมหลายบรรทัดจะถูกแบ่งให้พอดียอดของรายการ ส่วนที่เหลือยังเป็นขา
-- ที่ไม่ผูกกับใคร รอผูกกับบรรทัดอื่นต่อไป ยอดรวมของบิลจึงเท่าเดิมทุกบาท

create or replace function public.assign_statement_payment(
  p_transaction uuid,
  p_log         jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tx   transactions;
  v_st   card_statements;
  v_need numeric(14,2);
  v_take numeric(14,2);
  v_leg  card_statement_payments;
begin
  select * into v_tx from transactions where id = p_transaction;
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
  perform assert_can_edit(v_tx.shop_id);
  if v_tx.card_id is null then raise exception 'รายการนี้ไม่ได้รูดบัตร'; end if;
  if v_tx.type <> 'expense' then raise exception 'ทำเครื่องหมายจ่ายแล้วได้เฉพาะรายการที่เป็นรายจ่าย'; end if;

  -- บิลที่รายการนี้อยู่ — ผูกใบตรงๆ หรือวันที่รูดตกในช่วงของใบ (กฎเดียวกับหน้าจอ)
  select * into v_st from card_statements s
   where s.card_id = v_tx.card_id
     and (case when v_tx.card_statement_id is not null
               then s.id = v_tx.card_statement_id
               else v_tx.date between s.period_start and s.period_end end)
   order by s.period_end desc
   limit 1;
  if not found then
    raise exception 'รายการนี้ยังไม่อยู่ในบิลใบไหน — ถ้าจ่ายไปแล้วให้ใช้ "จ่ายรายการนี้ก่อนออกบิล" แทน';
  end if;

  v_need := v_tx.amount - coalesce((
    select sum(amount) from card_statement_payments
     where transaction_id = p_transaction and statement_id = v_st.id), 0);
  if v_need <= 0.005 then return; end if;   -- ทำเครื่องหมายไว้ครบแล้ว

  for v_leg in
    select * from card_statement_payments
     where statement_id = v_st.id and transaction_id is null
     order by paid_at, created_at
  loop
    exit when v_need <= 0.005;
    v_take := least(v_leg.amount, v_need);
    if v_take >= v_leg.amount - 0.005 then
      update card_statement_payments set transaction_id = p_transaction where id = v_leg.id;
    else
      -- แบ่งขา: ส่วนที่เป็นของรายการนี้แยกออกมาเป็นขาใหม่ ยอดรวมสองขาเท่าขาเดิม
      update card_statement_payments set amount = amount - v_take where id = v_leg.id;
      insert into card_statement_payments
             (shop_id, statement_id, card_id, method, transfer_account_id, amount, paid_at, transaction_id)
      values (v_leg.shop_id, v_leg.statement_id, v_leg.card_id, v_leg.method,
              v_leg.transfer_account_id, v_take, v_leg.paid_at, p_transaction);
    end if;
    v_need := v_need - v_take;
  end loop;

  if v_need > 0.005 then
    raise exception 'ยอดที่จ่ายบิลใบนี้ไปแล้วยังไม่พอสำหรับรายการนี้ — ขาดอีก % บาท ให้กด "จ่ายยอดนี้" แทน',
      to_char(v_need, 'FM999,999,990.00');
  end if;

  perform write_log(v_tx.shop_id, p_log);
end;
$$;

-- เอาเครื่องหมายออก — ขาที่ผูกไว้กลับไปเป็นขาของบิลตามเดิม เงินไม่ขยับเช่นกัน
create or replace function public.unassign_statement_payment(
  p_transaction uuid,
  p_log         jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tx transactions;
begin
  select * into v_tx from transactions where id = p_transaction;
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
  perform assert_can_edit(v_tx.shop_id);

  update card_statement_payments
     set transaction_id = null
   where transaction_id = p_transaction and statement_id is not null;

  perform write_log(v_tx.shop_id, p_log);
end;
$$;

notify pgrst, 'reload schema';

select 'ทำเครื่องหมายจ่ายแล้วโดยไม่ตัดเงินซ้ำ' as "รายการ",
       case when (select count(*) from information_schema.routines
                   where routine_schema = 'public'
                     and routine_name in ('assign_statement_payment','unassign_statement_payment')) = 2
            then '✅' else '❌ ยังไม่ครบ — รันไฟล์นี้ซ้ำอีกรอบ' end as "ผล";



-- ###########################################################################
-- ##  17. ย้อน/แก้ไขการจ่ายจากหน้าประวัติการจ่าย
-- ###########################################################################
--
-- undo_card_payment ย้อน "ขาล่าสุด" ตามจำนวนเงิน เหมาะกับปุ่มย้อนในหน้าบัตร
-- แต่หน้าประวัติการจ่ายชี้ไปที่ขาใดขาหนึ่งโดยตรง (จ่ายบิลใบเดียวหลายรอบ แล้วอยาก
-- ย้อนรอบกลาง) ถ้าใช้ตัวเดิมจะไปย้อนขาที่ไม่ได้เลือก เงินคืนผิดกระเป๋า
-- ตัวนี้ย้อนเฉพาะขาที่ระบุ: คืนเงินเข้ากระเป๋าที่ขานั้นตัดมาจริง หนี้บัตรกลับขึ้น
-- ใบกลับเป็นยังไม่จ่าย/จ่ายบางส่วน และถ้าขานั้นเคยติ๊กว่า "จ่ายให้รายการไหน"
-- ติ๊กนั้นหายไปพร้อมขา (ติ๊กคือ transaction_id บนขา ไม่ได้เก็บแยก)
create or replace function public.undo_card_payment_leg(
  p_leg uuid,
  p_log jsonb default null
) returns card_statements language plpgsql security definer set search_path = public as $$
declare
  v_leg card_statement_payments;
  v_st  card_statements;
begin
  select * into v_leg from card_statement_payments where id = p_leg;
  if not found then raise exception 'ไม่พบการจ่ายครั้งนี้ (อาจถูกย้อนไปแล้ว)'; end if;
  perform assert_can_edit(v_leg.shop_id);
  if v_leg.statement_id is null then
    raise exception 'การจ่ายนี้เป็นการจ่ายก่อนออกบิล ต้องย้อนด้วย undo_card_prepayment';
  end if;

  select * into v_st from card_statements where id = v_leg.statement_id;
  if v_st.carried_to is not null then
    raise exception 'ใบนี้ถูกยกยอดไปรวมในบิลรอบถัดไปแล้ว ย้อนการจ่ายไม่ได้ — ให้ย้อนที่บิลใบล่าสุดแทน';
  end if;

  -- คืนเข้ากระเป๋าที่ตัดมาจริง (บัญชีที่ถูกลบไปแล้ว refund_source จะเลี่ยงไปเงินสด)
  perform apply_wallet_effect(v_st.shop_id,
    refund_source(v_st.shop_id, v_leg.method, v_leg.transfer_account_id), v_leg.amount);
  perform apply_wallet_effect(v_st.shop_id, 'card:' || v_st.card_id, -v_leg.amount);

  delete from card_statement_payments where id = p_leg;

  update card_statements
     set paid_amount = paid_amount - v_leg.amount,
         status = case when amount <= 0 then 'paid'
                       when paid_amount - v_leg.amount <= 0 then 'closed' else 'partial' end,
         paid_at = case when paid_amount - v_leg.amount <= 0 then null else paid_at end,
         paid_method = case when paid_amount - v_leg.amount <= 0 then null else paid_method end,
         transfer_account_id = case when paid_amount - v_leg.amount <= 0 then null else transfer_account_id end
   where id = v_st.id
   returning * into v_st;

  perform write_log(v_st.shop_id, p_log);
  return v_st;
end;
$$;

notify pgrst, 'reload schema';

select 'ย้อนการจ่ายจากหน้าประวัติ (ส่วนที่ 17)' as "รายการ",
       case when exists (select 1 from information_schema.routines
                          where routine_schema = 'public' and routine_name = 'undo_card_payment_leg')
            then '✅' else '❌ ยังไม่มี — รันไฟล์นี้ซ้ำอีกรอบ' end as "ผล";
