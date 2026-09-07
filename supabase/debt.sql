-- ไฟล์: supabase/debt.sql
-- ============================================================================
-- JodFlow — หนี้สินและลูกหนี้   [debt.sql]
--
-- Supabase → SQL Editor → Role = postgres → วางทั้งไฟล์ → Run
-- รันซ้ำได้ ไม่ลบข้อมูล  (ต้องรัน card.sql ก่อน เพราะทับ clear_shop_data ให้รวมตารางนี้)
--
-- หนี้ก้อนยาวที่มีตารางผ่อน เช่น ผ่อนบ้าน ผ่อนรถ เงินกู้ และเงินที่ให้คนอื่นยืม
-- ลอกโครงจาก card_installments แต่แยกตารางเพราะเส้นทางเงินคนละทาง
--   งวดผ่อนบัตร → ถูกเรียกเก็บผ่านบิลบัตร
--   งวดหนี้สิน  → ตัดจากเงินสด/บัญชีตรงๆ ตามวันครบกำหนดของมันเอง
--
-- ทิศทางสองแบบในตารางเดียว ต่างแค่เงินเข้ากับเงินออกสลับกัน
--   payable    = เราติดคนอื่น  จ่ายงวด → รายจ่าย + เงินออก
--   receivable = คนอื่นติดเรา  รับคืน  → รายรับ  + เงินเข้า
--
-- จ่ายค่างวดหนี้คือ "รายจ่ายจริง" ต่างจากจ่ายบิลบัตรที่เป็นการย้ายเงิน
-- เพราะตอนกู้เงินมาไม่เคยบันทึกเป็นรายจ่าย ค่างวดจึงเป็นครั้งแรกที่เงินก้อนนี้เข้ารายงาน
-- ============================================================================


-- ###########################################################################
-- ##  1. ตาราง
-- ###########################################################################

create table if not exists debts (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references shops(id) on delete cascade,
  direction          text not null default 'payable'
                     check (direction in ('payable', 'receivable')),
  name               text not null default '',
  counterparty       text,                        -- เจ้าหนี้ หรือคนที่ยืมเรา
  category_id        uuid references categories(id) on delete set null,
  note               text,

  principal_amount   numeric(14,2) not null default 0,  -- เงินต้น
  total_amount       numeric(14,2) not null,            -- ยอดรวมทุกงวด = ผลบวกของตารางงวด
  months             int not null check (months between 1 and 480),
  monthly_amount     numeric(14,2) not null,
  interest_rate      numeric(5,2) not null default 0,   -- ต่อเดือน แบบคงที่
  tiers              jsonb,                              -- ช่วงราคาถ้าค่างวดไม่เท่ากัน
  prepaid_count      int not null default 0,             -- ผ่อนมาก่อนเริ่มใช้ระบบ
  term               text not null default 'long'
                     check (term in ('short', 'long')),  -- ระยะสั้น = ผ่อนจบภายใน 1 ปี

  first_due          date not null,                      -- งวดแรกครบกำหนด
  due_day            int not null check (due_day between 1 and 31),

  default_method     text check (default_method in ('cash', 'transfer')),
  default_account_id uuid references transfer_accounts(id) on delete set null,

  status             text not null default 'active'
                     check (status in ('active', 'completed', 'cancelled')),
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists debts_shop_idx on debts (shop_id, status, direction);

-- ระยะของหนี้ (จัดการข้อมูล → หนี้สิน) สำหรับฐานข้อมูลที่สร้างตาราง debts ไปก่อนหน้า
alter table debts add column if not exists term text not null default 'long';
alter table debts drop constraint if exists debts_term_check;
alter table debts add  constraint debts_term_check check (term in ('short', 'long'));

create table if not exists debt_entries (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references shops(id) on delete cascade,
  debt_id             uuid not null references debts(id) on delete cascade,
  seq                 int not null,
  due_date            date not null,
  amount              numeric(14,2) not null,
  status              text not null default 'pending'
                      check (status in ('pending', 'paid', 'prepaid', 'cancelled')),
  paid_at             timestamptz,
  paid_method         text check (paid_method in ('cash', 'transfer')),
  transfer_account_id uuid references transfer_accounts(id) on delete set null,
  transaction_id      uuid references transactions(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (debt_id, seq)
);

create index if not exists debt_entries_debt_idx on debt_entries (debt_id, status, due_date);
create index if not exists debt_entries_shop_due_idx on debt_entries (shop_id, status, due_date);

-- รายจ่าย/รายรับที่เกิดจากงวดหนี้ รู้ว่ามาจากงวดไหน — ใช้กรองในรายงาน
alter table transactions add column if not exists debt_entry_id uuid
  references debt_entries(id) on delete set null;


-- ###########################################################################
-- ##  2. สร้างหนี้พร้อมงวดทั้งหมดในคำสั่งเดียว
-- ###########################################################################
-- p_entries = [{ seq, due_date, amount, status }] คำนวณจาก client (cardCycle.js)
-- งวดที่ผ่อนมาก่อนส่งเป็น 'prepaid' ไม่สร้างรายจ่ายย้อนหลัง มีไว้ให้เลขงวดถูก

create or replace function public.create_debt(
  p_shop    uuid,
  p_data    jsonb,
  p_entries jsonb,
  p_log     jsonb default null
) returns debts language plpgsql security definer set search_path = public as $$
declare v_debt debts; v_e jsonb;
begin
  perform assert_can_edit(p_shop);
  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'ต้องมีอย่างน้อยหนึ่งงวด';
  end if;

  insert into debts (
    shop_id, direction, name, counterparty, category_id, note,
    principal_amount, total_amount, months, monthly_amount, interest_rate,
    tiers, prepaid_count, first_due, due_day, term,
    default_method, default_account_id, created_by
  ) values (
    p_shop,
    coalesce(p_data->>'direction', 'payable'),
    coalesce(p_data->>'name', ''),
    p_data->>'counterparty',
    nullif(p_data->>'category_id', '')::uuid,
    p_data->>'note',
    coalesce((p_data->>'principal_amount')::numeric, (p_data->>'total_amount')::numeric),
    (p_data->>'total_amount')::numeric,
    (p_data->>'months')::int,
    (p_data->>'monthly_amount')::numeric,
    coalesce((p_data->>'interest_rate')::numeric, 0),
    p_data->'tiers',
    coalesce((p_data->>'prepaid_count')::int, 0),
    (p_data->>'first_due')::date,
    (p_data->>'due_day')::int,
    case when p_data->>'term' = 'short' then 'short' else 'long' end,
    nullif(p_data->>'default_method', ''),
    nullif(p_data->>'default_account_id', '')::uuid,
    auth.uid()
  ) returning * into v_debt;

  for v_e in select * from jsonb_array_elements(p_entries) loop
    insert into debt_entries (shop_id, debt_id, seq, due_date, amount, status)
    values (
      p_shop, v_debt.id,
      (v_e->>'seq')::int,
      (v_e->>'due_date')::date,
      (v_e->>'amount')::numeric,
      coalesce(v_e->>'status', 'pending')
    );
  end loop;

  perform write_log(p_shop, p_log);
  return v_debt;
end;
$$;


-- ###########################################################################
-- ##  3. จ่ายงวด / รับคืนงวด
-- ###########################################################################
-- payable    → สร้างรายจ่าย เงินออกจากกระเป๋าที่เลือก
-- receivable → สร้างรายรับ  เงินเข้ากระเป๋าที่เลือก
-- ทั้งสองแบบ งวดกลายเป็น paid และผูก transaction_id ไว้ย้อนได้

create or replace function public.pay_debt_entry(
  p_entry   uuid,
  p_method  text,
  p_account uuid,
  p_amount  numeric,
  p_date    date,
  p_log     jsonb default null
) returns debt_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry debt_entries;
  v_debt  debts;
  v_tx    transactions;
  v_src   text;
  v_type  text;
  v_sign  numeric;
begin
  select * into v_entry from debt_entries where id = p_entry;
  if not found then raise exception 'ไม่พบงวดนี้'; end if;
  perform assert_can_edit(v_entry.shop_id);

  if v_entry.status = 'paid' then raise exception 'งวดนี้จ่ายไปแล้ว'; end if;
  if v_entry.status = 'prepaid' then raise exception 'งวดนี้ผ่อนมาก่อนใช้ระบบแล้ว'; end if;
  if v_entry.status = 'cancelled' then raise exception 'งวดนี้ถูกยกเลิกไปแล้ว'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่าศูนย์'; end if;
  if p_method not in ('cash', 'transfer') then raise exception 'วิธีจ่ายไม่ถูกต้อง: %', p_method; end if;
  if p_method = 'transfer' and p_account is null then raise exception 'ต้องเลือกบัญชี'; end if;

  select * into v_debt from debts where id = v_entry.debt_id;
  if not found then raise exception 'ไม่พบรายการหนี้ของงวดนี้'; end if;

  -- เราติดคนอื่น = จ่ายออก (expense, -) / คนอื่นติดเรา = รับคืน (income, +)
  if v_debt.direction = 'receivable' then v_type := 'income'; v_sign := 1;
  else v_type := 'expense'; v_sign := -1; end if;

  insert into transactions (
    shop_id, date, type, amount, method, transfer_account_id, category_id,
    item_name, vendor, debt_entry_id, note, created_by
  ) values (
    v_entry.shop_id, p_date, v_type, p_amount, p_method,
    case when p_method = 'transfer' then p_account else null end,
    v_debt.category_id,
    v_debt.name || ' (งวด ' || v_entry.seq || '/' || v_debt.months || ')',
    v_debt.counterparty, v_entry.id,
    case when v_type = 'income' then 'รับคืนงวดหนี้' else 'จ่ายค่างวดหนี้' end,
    auth.uid()
  ) returning * into v_tx;

  v_src := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_entry.shop_id, v_src, v_sign * p_amount);

  update debt_entries
     set status = 'paid', amount = p_amount, paid_at = (p_date::timestamp at time zone 'Asia/Bangkok'),
         paid_method = p_method, transfer_account_id = p_account, transaction_id = v_tx.id
   where id = p_entry
   returning * into v_entry;

  -- ครบทุกงวดแล้วปิดสัญญาให้เอง
  update debts d set status = 'completed', updated_at = now()
   where d.id = v_debt.id and d.status = 'active'
     and not exists (select 1 from debt_entries e where e.debt_id = d.id and e.status = 'pending');

  perform write_log(v_entry.shop_id, p_log);
  return v_entry;
end;
$$;

-- ย้อนการจ่ายงวด — ลบรายการที่สร้างไว้ คืนเงินกลับกระเป๋า งวดกลับเป็น pending
create or replace function public.undo_debt_entry(
  p_entry uuid,
  p_log   jsonb default null
) returns debt_entries language plpgsql security definer set search_path = public as $$
declare v_entry debt_entries; v_debt debts; v_src text; v_sign numeric;
begin
  select * into v_entry from debt_entries where id = p_entry;
  if not found then raise exception 'ไม่พบงวดนี้'; end if;
  perform assert_can_edit(v_entry.shop_id);
  if v_entry.status <> 'paid' then raise exception 'งวดนี้ยังไม่ได้จ่าย'; end if;
  if v_entry.paid_method is null then raise exception 'ไม่รู้ว่าจ่ายจากกระเป๋าไหน ย้อนให้ไม่ได้'; end if;

  select * into v_debt from debts where id = v_entry.debt_id;
  v_sign := case when v_debt.direction = 'receivable' then -1 else 1 end;

  v_src := case when v_entry.paid_method = 'cash' then 'cash'
                else 'transfer:' || v_entry.transfer_account_id end;
  perform apply_wallet_effect(v_entry.shop_id, v_src, v_sign * v_entry.amount);

  if v_entry.transaction_id is not null then
    delete from transactions where id = v_entry.transaction_id;
  end if;

  update debt_entries
     set status = 'pending', paid_at = null, paid_method = null,
         transfer_account_id = null, transaction_id = null
   where id = p_entry
   returning * into v_entry;

  update debts set status = 'active', updated_at = now()
   where id = v_debt.id and status = 'completed';

  perform write_log(v_entry.shop_id, p_log);
  return v_entry;
end;
$$;


-- ###########################################################################
-- ##  4. ปิดยอดก่อนกำหนด / ยกเลิก
-- ###########################################################################

-- รวมงวดที่เหลือเป็นรายการเดียว จ่ายจากกระเป๋าที่เลือก แล้วปิดสัญญา
create or replace function public.settle_debt(
  p_debt    uuid,
  p_method  text,
  p_account uuid,
  p_date    date,
  p_fee     numeric default 0,
  p_log     jsonb default null
) returns debts language plpgsql security definer set search_path = public as $$
declare v_debt debts; v_left numeric(14,2); v_n int; v_tx transactions; v_src text; v_type text; v_sign numeric; v_total numeric(14,2);
begin
  select * into v_debt from debts where id = p_debt;
  if not found then raise exception 'ไม่พบรายการหนี้นี้'; end if;
  perform assert_can_edit(v_debt.shop_id);
  if v_debt.status <> 'active' then raise exception 'รายการหนี้นี้ปิดไปแล้ว'; end if;
  if p_method not in ('cash', 'transfer') then raise exception 'วิธีจ่ายไม่ถูกต้อง'; end if;
  if p_method = 'transfer' and p_account is null then raise exception 'ต้องเลือกบัญชี'; end if;

  select coalesce(sum(amount), 0), count(*) into v_left, v_n
    from debt_entries where debt_id = p_debt and status = 'pending';
  if v_n = 0 then raise exception 'ไม่มีงวดที่เหลือให้ปิด'; end if;
  v_total := v_left + coalesce(p_fee, 0);

  if v_debt.direction = 'receivable' then v_type := 'income'; v_sign := 1;
  else v_type := 'expense'; v_sign := -1; end if;

  insert into transactions (
    shop_id, date, type, amount, method, transfer_account_id, category_id,
    item_name, vendor, note, created_by
  ) values (
    v_debt.shop_id, p_date, v_type, v_total, p_method,
    case when p_method = 'transfer' then p_account else null end,
    v_debt.category_id,
    v_debt.name || ' (ปิดยอดคงเหลือ ' || v_n || ' งวด)',
    v_debt.counterparty, 'ปิดยอดหนี้ก่อนกำหนด', auth.uid()
  ) returning * into v_tx;

  v_src := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_debt.shop_id, v_src, v_sign * v_total);

  update debt_entries
     set status = 'paid', paid_at = (p_date::timestamp at time zone 'Asia/Bangkok'),
         paid_method = p_method, transfer_account_id = p_account, transaction_id = v_tx.id
   where debt_id = p_debt and status = 'pending';

  update debts set status = 'completed', updated_at = now()
   where id = p_debt returning * into v_debt;

  perform write_log(v_debt.shop_id, p_log);
  return v_debt;
end;
$$;

-- ยกเลิกงวดที่เหลือ งวดที่จ่ายไปแล้วยังอยู่เพราะเกิดขึ้นจริง
create or replace function public.cancel_debt(
  p_debt uuid,
  p_log  jsonb default null
) returns debts language plpgsql security definer set search_path = public as $$
declare v_debt debts;
begin
  select * into v_debt from debts where id = p_debt;
  if not found then raise exception 'ไม่พบรายการหนี้นี้'; end if;
  perform assert_can_edit(v_debt.shop_id);

  update debt_entries set status = 'cancelled' where debt_id = p_debt and status = 'pending';
  update debts set status = 'cancelled', updated_at = now() where id = p_debt returning * into v_debt;

  perform write_log(v_debt.shop_id, p_log);
  return v_debt;
end;
$$;


-- ###########################################################################
-- ##  5. ล้างข้อมูลร้าน — รวมตารางหนี้ด้วย (ทับของ card.sql)
-- ###########################################################################

create or replace function public.clear_shop_data(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(p_shop) then
    raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่ล้างข้อมูลได้' using errcode = '42501';
  end if;

  delete from tax_invoices             where shop_id = p_shop;
  delete from pending_payments         where shop_id = p_shop;
  delete from pending_incomes          where shop_id = p_shop;
  delete from transactions             where shop_id = p_shop;
  delete from debt_entries             where shop_id = p_shop;
  delete from debts                    where shop_id = p_shop;
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
-- ##  5.5 แก้ไขสัญญา (ยอด จำนวนงวด วันครบกำหนด)
-- ###########################################################################
--
-- เดิมแก้ได้แค่ชื่อกับหมายเหตุ เพราะกลัวไปทับงวดที่จ่ายเงินไปแล้ว
-- แต่คนกรอกผิดตั้งแต่แรกก็มี การบังคับให้ยกเลิกแล้วสร้างใหม่ทำให้ประวัติการจ่าย
-- ที่ทำไว้ถูกต้องแล้วหายไปด้วย ซึ่งแย่กว่าเดิม
--
-- วิธีที่ปลอดภัย: งวดที่ "จ่ายผ่านระบบแล้ว" (status = paid) ห้ามแตะเด็ดขาด
-- เพราะมีเงินออกจากกระเป๋าและมีรายการผูกอยู่จริง ส่วนงวดที่เหลือสร้างใหม่ได้ทั้งหมด
--
-- ถ้าจำนวนงวดใหม่น้อยกว่างวดที่จ่ายไปแล้ว = ตัดประวัติทิ้ง จึงปฏิเสธไปตรงๆ

create or replace function public.edit_debt(
  p_debt    uuid,
  p_data    jsonb,
  p_entries jsonb,
  p_log     jsonb default null
) returns debts language plpgsql security definer set search_path = public as $$
declare
  v_debt debts;
  v_paid int;
  v_e    jsonb;
begin
  select * into v_debt from debts where id = p_debt;
  if not found then raise exception 'ไม่พบรายการหนี้สินนี้'; end if;
  perform assert_can_edit(v_debt.shop_id);

  if v_debt.status = 'cancelled' then raise exception 'รายการนี้ถูกยกเลิกไปแล้ว'; end if;
  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'ต้องมีอย่างน้อยหนึ่งงวด';
  end if;

  select coalesce(max(seq), 0) into v_paid
    from debt_entries where debt_id = p_debt and status = 'paid';

  if (p_data->>'months')::int < v_paid then
    raise exception 'ลดจำนวนงวดเหลือ % ไม่ได้ เพราะจ่ายผ่านระบบไปแล้วถึงงวดที่ %',
      (p_data->>'months')::int, v_paid;
  end if;

  update debts set
    name               = coalesce(p_data->>'name', name),
    counterparty       = p_data->>'counterparty',
    category_id        = nullif(p_data->>'category_id', '')::uuid,
    note               = p_data->>'note',
    term               = case when p_data->>'term' = 'short' then 'short' else 'long' end,
    principal_amount   = coalesce((p_data->>'principal_amount')::numeric, (p_data->>'total_amount')::numeric),
    total_amount       = (p_data->>'total_amount')::numeric,
    months             = (p_data->>'months')::int,
    monthly_amount     = (p_data->>'monthly_amount')::numeric,
    interest_rate      = coalesce((p_data->>'interest_rate')::numeric, 0),
    tiers              = p_data->'tiers',
    prepaid_count      = coalesce((p_data->>'prepaid_count')::int, 0),
    first_due          = (p_data->>'first_due')::date,
    due_day            = (p_data->>'due_day')::int,
    default_method     = nullif(p_data->>'default_method', ''),
    default_account_id = nullif(p_data->>'default_account_id', '')::uuid,
    updated_at         = now()
  where id = p_debt
  returning * into v_debt;

  -- งวดที่ยังไม่ได้จ่ายผ่านระบบ ล้างทิ้งแล้วสร้างใหม่ตามตารางที่ส่งมา
  delete from debt_entries where debt_id = p_debt and status <> 'paid';

  for v_e in select * from jsonb_array_elements(p_entries) loop
    -- ข้ามเฉพาะงวดที่จ่ายไปแล้วจริงๆ ของเดิมยังอยู่ครบไม่ถูกแตะ
    --
    -- ต้องเช็คทีละงวด ไม่ใช่เทียบกับเลขงวดสูงสุดที่จ่าย เพราะงวดที่จ่ายอาจไม่ได้
    -- เรียงต่อกันจากงวดแรก เช่นจ่ายมาก่อนใช้ระบบ 23 งวดแล้วมาจ่ายงวดที่ 24 ผ่านแอป
    -- ถ้าข้ามทุกงวดที่เลขน้อยกว่า 24 งวด 1–23 จะถูกลบทิ้งแล้วไม่ถูกสร้างคืน
    if exists (
      select 1 from debt_entries
       where debt_id = p_debt and seq = (v_e->>'seq')::int and status = 'paid'
    ) then
      continue;
    end if;
    insert into debt_entries (shop_id, debt_id, seq, due_date, amount, status)
    values (
      v_debt.shop_id, p_debt,
      (v_e->>'seq')::int,
      (v_e->>'due_date')::date,
      (v_e->>'amount')::numeric,
      coalesce(v_e->>'status', 'pending')
    )
    on conflict (debt_id, seq) do update
      set due_date = excluded.due_date, amount = excluded.amount, status = excluded.status;
  end loop;

  perform write_log(v_debt.shop_id, p_log);
  return v_debt;
end;
$$;


-- ###########################################################################
-- ##  6. RLS + Realtime
-- ###########################################################################

do $$
declare t text;
begin
  foreach t in array array['debts', 'debt_entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_member(shop_id))', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (can_edit(shop_id))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (can_edit(shop_id)) with check (can_edit(shop_id))', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (can_edit(shop_id))', t || '_delete', t);
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  7. ซ่อมงวดที่หายไป
-- ###########################################################################
--
-- ใช้เมื่อตารางงวดไม่ครบ เช่นเริ่มที่งวด 24 ทั้งที่สัญญามี 60 งวด
--
-- ที่มา: edit_debt รุ่นแรกล้างงวดที่ยังไม่จ่ายทิ้งแล้วข้ามการสร้างคืนผิดเงื่อนไข
-- (ข้ามทุกงวดที่เลขน้อยกว่างวดสูงสุดที่จ่ายแล้ว) งวดที่ผ่อนมาก่อนใช้ระบบจึงหายไป
-- รุ่นปัจจุบันแก้แล้ว บล็อกนี้มีไว้เติมของที่หายไปก่อนหน้ากลับคืน
--
-- ปลอดภัย: เติมเฉพาะเลขงวดที่ยังไม่มีในตาราง ไม่แตะงวดที่มีอยู่แล้วแม้แต่แถวเดียว
-- รันซ้ำได้ ครั้งที่สองจะไม่มีอะไรให้เติมแล้ว

do $repair$
declare
  v_d      record;
  v_seq    int;
  v_due    date;
  v_amount numeric(14,2);
  v_status text;
  v_added  int := 0;
  v_total  int := 0;
begin
  for v_d in
    select d.*, (select count(*) from debt_entries e where e.debt_id = d.id) as have
      from debts d
     where d.status <> 'cancelled'
  loop
    if v_d.have >= v_d.months then
      continue;   -- ครบอยู่แล้ว
    end if;

    -- สัญญาแบบค่างวดไม่เท่ากันคำนวณคืนไม่ได้จากข้อมูลที่เหลืออยู่ ข้ามไปเพื่อความปลอดภัย
    if v_d.tiers is not null then
      raise notice 'ข้าม "%": เป็นสัญญาค่างวดขั้นบันได ต้องแก้ด้วยมือ', v_d.name;
      continue;
    end if;

    for v_seq in 1..v_d.months loop
      if exists (select 1 from debt_entries where debt_id = v_d.id and seq = v_seq) then
        continue;
      end if;

      -- วันครบกำหนดของงวดที่ n = เดือนของงวดแรก + (n-1) เดือน ตรึงวันที่ตาม due_day
      -- ใช้ least() กันเดือนที่สั้นกว่า เช่น due_day = 31 แต่เดือนกุมภาพันธ์
      v_due := make_date(
        extract(year  from (v_d.first_due + make_interval(months => v_seq - 1)))::int,
        extract(month from (v_d.first_due + make_interval(months => v_seq - 1)))::int,
        least(
          v_d.due_day,
          extract(day from (
            date_trunc('month', v_d.first_due + make_interval(months => v_seq - 1))
            + interval '1 month - 1 day'
          ))::int
        )
      );

      v_amount := v_d.monthly_amount;
      v_status := case when v_seq <= v_d.prepaid_count then 'prepaid' else 'pending' end;

      insert into debt_entries (shop_id, debt_id, seq, due_date, amount, status)
      values (v_d.shop_id, v_d.id, v_seq, v_due, v_amount, v_status);

      v_added := v_added + 1;
    end loop;

    v_total := v_total + 1;
    raise notice 'ซ่อม "%": เติมงวดที่หายไปครบ % งวดแล้ว', v_d.name, v_d.months;
  end loop;

  if v_added = 0 then
    raise notice 'ไม่มีงวดที่หาย — ทุกสัญญาครบอยู่แล้ว';
  else
    raise notice 'เติมทั้งหมด % งวด จาก % สัญญา', v_added, v_total;
  end if;
end
$repair$;

-- ตรวจผล: คอลัมน์ "ขาด" ต้องเป็น 0 ทุกแถว
select d.name as "สัญญา",
       d.months as "งวดตามสัญญา",
       count(e.id)::int as "งวดที่มีจริง",
       (d.months - count(e.id))::int as "ขาด"
  from debts d
  left join debt_entries e on e.debt_id = d.id
 where d.status <> 'cancelled'
 group by d.id, d.name, d.months
 order by d.name;


-- ###########################################################################
-- ##  ตรวจผลการติดตั้ง
-- ###########################################################################

select 'ตารางหนี้สิน' as "รายการ", count(*)::text || ' / 2' as "ผล"
  from information_schema.tables
 where table_schema = 'public' and table_name in ('debts', 'debt_entries')
union all
select 'คอลัมน์ transactions.debt_entry_id',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'transactions' and column_name = 'debt_entry_id')
            then '✅' else '❌' end
union all
select 'ฟังก์ชัน RPC ของหนี้สิน', count(*)::text || ' / 6'
  from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('create_debt', 'pay_debt_entry', 'undo_debt_entry', 'settle_debt', 'cancel_debt', 'edit_debt_payment');



-- ── แก้ไขการจ่ายงวดหนี้ในที่ (วิธี/บัญชี/ยอด/วันที่) ───────────────────────────
-- คืนของเดิมเข้ากระเป๋าเดิม ตัดของใหม่จากกระเป๋าใหม่ แล้วแก้งวดกับรายการที่ผูกไว้
-- id คงเดิม สลิปและประวัติไม่หลุด ล้มตรงไหนย้อนทั้งก้อน
create or replace function public.edit_debt_payment(
  p_entry   uuid,
  p_method  text,
  p_account uuid,
  p_amount  numeric,
  p_date    date,
  p_log     jsonb default null
) returns debt_entries language plpgsql security definer set search_path = public as $$
declare
  v_entry debt_entries;
  v_debt  debts;
  v_sign  numeric;
  v_old   text;
  v_new   text;
begin
  select * into v_entry from debt_entries where id = p_entry;
  if not found then raise exception 'ไม่พบงวดนี้'; end if;
  perform assert_can_edit(v_entry.shop_id);
  if v_entry.status <> 'paid' then raise exception 'งวดนี้ยังไม่ได้จ่าย'; end if;
  if v_entry.paid_method is null then raise exception 'งวดนี้ไม่ได้บันทึกว่าจ่ายจากกระเป๋าไหน แก้ไขไม่ได้'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่าศูนย์'; end if;
  if p_method not in ('cash', 'transfer') then raise exception 'วิธีจ่ายไม่ถูกต้อง: %', p_method; end if;
  if p_method = 'transfer' and p_account is null then raise exception 'ต้องเลือกบัญชี'; end if;
  if p_date is null then raise exception 'ต้องระบุวันที่จ่าย'; end if;

  select * into v_debt from debts where id = v_entry.debt_id;
  -- เราติดคนอื่น = เงินออก (-) · คนอื่นติดเรา = เงินเข้า (+) — คืนกับตัดจึงกลับด้านกัน
  v_sign := case when v_debt.direction = 'receivable' then 1 else -1 end;

  v_old := case when v_entry.paid_method = 'transfer' and v_entry.transfer_account_id is not null
                 and exists (select 1 from transfer_accounts where id = v_entry.transfer_account_id)
                then 'transfer:' || v_entry.transfer_account_id else 'cash' end;
  v_new := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_entry.shop_id, v_old, -v_sign * v_entry.amount);
  perform apply_wallet_effect(v_entry.shop_id, v_new,  v_sign * p_amount);

  if v_entry.transaction_id is not null then
    update transactions
       set date = p_date, amount = p_amount, method = p_method,
           transfer_account_id = case when p_method = 'transfer' then p_account end
     where id = v_entry.transaction_id;
  end if;

  update debt_entries
     set amount = p_amount, paid_at = (p_date::timestamp at time zone 'Asia/Bangkok'),
         paid_method = p_method,
         transfer_account_id = case when p_method = 'transfer' then p_account end
   where id = p_entry
   returning * into v_entry;

  perform write_log(v_entry.shop_id, p_log);
  return v_entry;
end;
$$;

notify pgrst, 'reload schema';

select 'แก้ไขการจ่ายงวดหนี้ในที่' as "รายการ",
       case when exists (select 1 from information_schema.routines
                          where routine_schema = 'public' and routine_name = 'edit_debt_payment')
            then '✅' else '❌ ยังไม่มี — รันไฟล์นี้ซ้ำอีกรอบ' end as "ผล";
