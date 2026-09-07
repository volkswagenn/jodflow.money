-- ไฟล์: supabase/wallet.sql
-- ============================================================================
-- JodFlow — RPC สำหรับงานเงินที่ขยับ "สองก้อนพร้อมกัน"   [wallet.sql]
--
-- functions.sql มี post_transaction / cancel_transaction / adjust_* แล้ว
-- แต่ยังขาดงานที่ต้องย้ายเงินจากที่หนึ่งไปอีกที่หนึ่ง ซึ่งถ้าปล่อยให้ client
-- ยิง adjust_* สองครั้งแล้วเน็ตหลุดคั่นกลาง = เงินหายจริง (ตัดออกแล้วไม่เข้าปลายทาง)
-- ทุกฟังก์ชันในไฟล์นี้จึงทำทั้งขาออกและขาเข้าใน transaction เดียว
--
-- รันไฟล์นี้หลัง functions.sql — เป็น create or replace ทั้งหมด รันซ้ำได้
-- ============================================================================

-- ── ย้ายเงินสด ↔ บัญชีเงินโอน ───────────────────────────────────────────────

create or replace function public.move_cash_transfer(
  p_shop    uuid,
  p_account uuid,
  p_amount  numeric,
  p_to      text,               -- 'transfer' = สด→โอน, 'cash' = โอน→สด
  p_log     jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_can_edit(p_shop);
  if p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่า 0'; end if;

  -- ตรวจ `found` ทันทีหลัง update บัญชีเงินโอน — ถ้าไปตรวจหลัง update wallet_state
  -- (ซึ่งเจอแถวเสมอ) ฝั่ง โอน→สด จะบวกเงินสดให้ทั้งที่บัญชีต้นทางไม่มีอยู่จริง
  if p_to = 'transfer' then
    update wallet_state set cash = cash - p_amount, updated_at = now() where shop_id = p_shop;
    update transfer_accounts set balance = balance + p_amount
     where id = p_account and shop_id = p_shop;
    if not found then raise exception 'ไม่พบบัญชีเงินโอนของร้านนี้'; end if;
  elsif p_to = 'cash' then
    update transfer_accounts set balance = balance - p_amount
     where id = p_account and shop_id = p_shop;
    if not found then raise exception 'ไม่พบบัญชีเงินโอนของร้านนี้'; end if;
    update wallet_state set cash = cash + p_amount, updated_at = now() where shop_id = p_shop;
  else
    raise exception 'ปลายทางไม่ถูกต้อง: %', p_to;
  end if;

  perform write_log(p_shop, p_log);
end;
$$;

-- ── ฝาก/ถอน ระหว่างกระเป๋าหลักกับกระเป๋าย่อย ────────────────────────────────
-- p_direction: 'in'  = จากกระเป๋าหลัก → กระเป๋าย่อย (ฝาก)
--              'out' = จากกระเป๋าย่อย → กระเป๋าหลัก (ถอน)
-- p_method: 'cash' หรือ 'transfer' (ถ้า transfer ต้องมี p_account)

create or replace function public.move_sub_wallet(
  p_shop      uuid,
  p_sub       uuid,
  p_amount    numeric,
  p_direction text,
  p_method    text,
  p_account   uuid default null,
  p_log       jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_sign numeric;
begin
  perform assert_can_edit(p_shop);
  if p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่า 0'; end if;
  if p_direction not in ('in', 'out') then raise exception 'ทิศทางไม่ถูกต้อง: %', p_direction; end if;
  if p_method = 'transfer' and p_account is null then
    raise exception 'ต้องระบุบัญชีเงินโอน';
  end if;

  -- ฝาก = กระเป๋าย่อยเพิ่ม กระเป๋าหลักลด / ถอน = กลับกัน
  v_sign := case when p_direction = 'in' then 1 else -1 end;

  update sub_wallets set balance = balance + (v_sign * p_amount)
   where id = p_sub and shop_id = p_shop;
  if not found then raise exception 'ไม่พบกระเป๋าตังค์ย่อยของร้านนี้'; end if;

  if p_method = 'cash' then
    update wallet_state set cash = cash - (v_sign * p_amount), updated_at = now()
     where shop_id = p_shop;
  else
    update transfer_accounts set balance = balance - (v_sign * p_amount)
     where id = p_account and shop_id = p_shop;
    if not found then raise exception 'ไม่พบบัญชีเงินโอนของร้านนี้'; end if;
  end if;

  perform write_log(p_shop, p_log);
end;
$$;

-- ── โอนระหว่างกระเป๋าย่อยสองใบ ──────────────────────────────────────────────

create or replace function public.move_between_sub_wallets(
  p_shop uuid, p_from uuid, p_to uuid, p_amount numeric, p_log jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_can_edit(p_shop);
  if p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่า 0'; end if;
  if p_from = p_to then raise exception 'ต้นทางกับปลายทางเป็นกระเป๋าเดียวกัน'; end if;

  update sub_wallets set balance = balance - p_amount where id = p_from and shop_id = p_shop;
  if not found then raise exception 'ไม่พบกระเป๋าต้นทาง'; end if;

  update sub_wallets set balance = balance + p_amount where id = p_to and shop_id = p_shop;
  if not found then raise exception 'ไม่พบกระเป๋าปลายทาง'; end if;

  perform write_log(p_shop, p_log);
end;
$$;

-- ── ยืมเงินจากกระเป๋าย่อย (ตัดกระเป๋า + เข้ากระเป๋าหลัก + สร้างรายการยืม) ────

create or replace function public.borrow_from_sub_wallet(
  p_shop     uuid,
  p_sub      uuid,
  p_amount   numeric,
  p_method   text,                    -- เงินที่ยืมออกมาเข้าทางไหน
  p_account  uuid default null,
  p_sub_name text default null,
  p_log      jsonb default null
) returns loans language plpgsql security definer set search_path = public as $$
declare v_loan loans;
begin
  perform assert_can_edit(p_shop);
  if p_amount <= 0 then raise exception 'จำนวนเงินต้องมากกว่า 0'; end if;
  if p_method = 'transfer' and p_account is null then raise exception 'ต้องระบุบัญชีเงินโอน'; end if;

  update sub_wallets set balance = balance - p_amount where id = p_sub and shop_id = p_shop;
  if not found then raise exception 'ไม่พบกระเป๋าตังค์ย่อยของร้านนี้'; end if;

  if p_method = 'cash' then
    update wallet_state set cash = cash + p_amount, updated_at = now() where shop_id = p_shop;
  else
    update transfer_accounts set balance = balance + p_amount
     where id = p_account and shop_id = p_shop;
    if not found then raise exception 'ไม่พบบัญชีเงินโอนของร้านนี้'; end if;
  end if;

  insert into loans (shop_id, sub_wallet_id, sub_name, amount, method, transfer_account_id)
  values (p_shop, p_sub, p_sub_name, p_amount, p_method, p_account)
  returning * into v_loan;

  perform write_log(p_shop, p_log);
  return v_loan;
end;
$$;

-- ── คืนเงินที่ยืม (ตัดกระเป๋าหลัก + คืนกระเป๋าย่อย + ปิดรายการยืม) ──────────

create or replace function public.return_loan(
  p_loan    uuid,
  p_method  text,
  p_account uuid default null,
  p_log     jsonb default null
) returns loans language plpgsql security definer set search_path = public as $$
declare v_loan loans;
begin
  select * into v_loan from loans where id = p_loan;
  if v_loan.id is null then raise exception 'ไม่พบรายการยืมนี้'; end if;
  if v_loan.returned then raise exception 'รายการนี้คืนไปแล้ว'; end if;
  perform assert_can_edit(v_loan.shop_id);
  if p_method = 'transfer' and p_account is null then raise exception 'ต้องระบุบัญชีเงินโอน'; end if;

  if p_method = 'cash' then
    update wallet_state set cash = cash - v_loan.amount, updated_at = now()
     where shop_id = v_loan.shop_id;
  else
    update transfer_accounts set balance = balance - v_loan.amount
     where id = p_account and shop_id = v_loan.shop_id;
    if not found then raise exception 'ไม่พบบัญชีเงินโอนของร้านนี้'; end if;
  end if;

  -- กระเป๋าย่อยที่ยืมมาอาจถูกลบไปแล้ว (FK เป็น set null) — ถ้าเป็นแบบนั้นห้ามตัดเงินหลัก
  -- ทิ้งโดยไม่มีที่ให้คืน ต้องบอกผู้ใช้ให้ลบรายการยืมแทน
  update sub_wallets set balance = balance + v_loan.amount where id = v_loan.sub_wallet_id;
  if not found then
    raise exception 'กระเป๋าตังค์ย่อยที่ยืมมาถูกลบไปแล้ว คืนเงินไม่ได้ — ให้ลบรายการยืมนี้แทน';
  end if;

  update loans
     set returned = true, returned_at = now(), return_method = p_method, return_account_id = p_account
   where id = p_loan
  returning * into v_loan;

  perform write_log(v_loan.shop_id, p_log);
  return v_loan;
end;
$$;

-- ── จ่ายรายการค้างชำระ (สร้าง transaction + ตัดเงิน + ปิดรายการค้าง + log) ──

create or replace function public.pay_pending_payment(
  p_pending uuid,
  p_method  text,
  p_account uuid default null,
  p_date    date default null,
  p_log     jsonb default null
) returns transactions language plpgsql security definer set search_path = public as $$
declare v_p pending_payments; v_tx transactions; v_target text;
begin
  select * into v_p from pending_payments where id = p_pending;
  if v_p.id is null then raise exception 'ไม่พบรายการค้างชำระนี้'; end if;
  if v_p.status = 'paid' then raise exception 'รายการนี้จ่ายไปแล้ว'; end if;
  perform assert_can_edit(v_p.shop_id);
  if p_method = 'transfer' and p_account is null then raise exception 'ต้องระบุบัญชีเงินโอน'; end if;

  insert into transactions (
    shop_id, date, type, amount, method, category_id, item_name, vendor,
    receipt_no, tax_status, note, transfer_account_id, recurring_entry_id,
    attachments, document_path, document_type, document_label, created_by
  ) values (
    v_p.shop_id, coalesce(p_date, current_date), 'expense', v_p.amount, p_method,
    v_p.category_id, v_p.item_name, v_p.vendor, v_p.receipt_no, v_p.tax_status,
    v_p.note, p_account, v_p.recurring_entry_id,
    v_p.attachments, v_p.document_path, v_p.document_type, v_p.document_label, auth.uid()
  ) returning * into v_tx;

  v_target := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_p.shop_id, v_target, -v_p.amount);

  update pending_payments
     set status = 'paid', paid_at = now(), paid_method = p_method,
         transfer_account_id = p_account, transaction_id = v_tx.id
   where id = p_pending;

  -- รายการประจำที่ผูกอยู่ต้องเปลี่ยนเป็นจ่ายแล้วด้วย ไม่งั้นเดือนนั้นจะค้างอยู่
  if v_p.recurring_entry_id is not null then
    update recurring_entries
       set status = 'paid', paid_at = now(), paid_method = p_method,
           transaction_id = v_tx.id, amount = v_p.amount,
           transfer_account_id = p_account
     where id = v_p.recurring_entry_id;
  end if;

  perform write_log(v_p.shop_id, p_log);
  return v_tx;
end;
$$;

-- ── รับเงินที่รออยู่ (สร้าง transaction + เพิ่มเงิน + ปิดรายการรอ + log) ────

create or replace function public.receive_pending_income(
  p_pending uuid,
  p_method  text,
  p_account uuid default null,
  p_date    date default null,
  p_log     jsonb default null
) returns transactions language plpgsql security definer set search_path = public as $$
declare v_p pending_incomes; v_tx transactions; v_target text;
begin
  select * into v_p from pending_incomes where id = p_pending;
  if v_p.id is null then raise exception 'ไม่พบรายการรอรับเงินนี้'; end if;
  if v_p.status = 'received' then raise exception 'รายการนี้รับเงินไปแล้ว'; end if;
  perform assert_can_edit(v_p.shop_id);
  if p_method = 'transfer' and p_account is null then raise exception 'ต้องระบุบัญชีเงินโอน'; end if;

  insert into transactions (
    shop_id, date, type, amount, method, category_id, item_name, note,
    transfer_account_id, other_income_type, attachments,
    document_path, document_type, document_label, created_by
  ) values (
    v_p.shop_id, coalesce(p_date, current_date), 'income', v_p.amount, p_method,
    v_p.category_id, coalesce(v_p.item_name, v_p.description, 'รับเงินจากรายการรอ'),
    v_p.note, p_account, v_p.other_income_type, v_p.attachments,
    v_p.document_path, v_p.document_type, v_p.document_label, auth.uid()
  ) returning * into v_tx;

  v_target := case when p_method = 'cash' then 'cash' else 'transfer:' || p_account end;
  perform apply_wallet_effect(v_p.shop_id, v_target, v_p.amount);

  update pending_incomes
     set status = 'received', received_at = now(), received_method = p_method,
         transfer_account_id = p_account, transaction_id = v_tx.id
   where id = p_pending;

  perform write_log(v_p.shop_id, p_log);
  return v_tx;
end;
$$;

-- ── ย้อนการจ่ายรายการค้างชำระ (ใช้จากหน้าประวัติการจ่าย) ──────────────────────
-- ตรงข้ามกับ pay_pending_payment ทุกอย่าง: คืนเงินเข้ากระเป๋าที่ตัดไป ลบรายจ่ายที่
-- สร้างไว้ รายการกลับเป็นค้างชำระ และรอบเดือนของรายการประจำที่ผูกอยู่กลับเป็นยังไม่จ่าย
-- คืนเข้าเงินสดถ้าบัญชีที่เคยตัดถูกลบไปแล้ว (ดีกว่าย้อนไม่ได้เลย ผู้ใช้โอนต่อเองได้)
create or replace function public.undo_pending_payment(
  p_pending uuid,
  p_log     jsonb default null
) returns pending_payments language plpgsql security definer set search_path = public as $$
declare v_p pending_payments; v_target text;
begin
  select * into v_p from pending_payments where id = p_pending;
  if v_p.id is null then raise exception 'ไม่พบรายการค้างชำระนี้'; end if;
  perform assert_can_edit(v_p.shop_id);
  if v_p.status <> 'paid' then raise exception 'รายการนี้ยังไม่ได้จ่าย'; end if;
  if v_p.paid_method is null then raise exception 'ไม่รู้ว่าจ่ายจากกระเป๋าไหน ย้อนให้ไม่ได้'; end if;

  v_target := case
    when v_p.paid_method = 'transfer' and v_p.transfer_account_id is not null
         and exists (select 1 from transfer_accounts where id = v_p.transfer_account_id)
      then 'transfer:' || v_p.transfer_account_id
    else 'cash'
  end;
  perform apply_wallet_effect(v_p.shop_id, v_target, v_p.amount);

  if v_p.transaction_id is not null then
    delete from transactions where id = v_p.transaction_id;
  end if;

  update pending_payments
     set status = 'pending', paid_at = null, paid_method = null,
         transfer_account_id = null, transaction_id = null
   where id = p_pending
   returning * into v_p;

  if v_p.recurring_entry_id is not null then
    update recurring_entries
       set status = 'pending', paid_at = null, paid_method = null,
           transaction_id = null, transfer_account_id = null
     where id = v_p.recurring_entry_id;
  end if;

  perform write_log(v_p.shop_id, p_log);
  return v_p;
end;
$$;

-- ── ตรวจว่าฟังก์ชันครบ (ควรได้ 8 แถว) ───────────────────────────────────────

select routine_name
  from information_schema.routines
 where routine_schema = 'public'
   and routine_name in (
     'move_cash_transfer', 'move_sub_wallet', 'move_between_sub_wallets',
     'borrow_from_sub_wallet', 'return_loan',
     'pay_pending_payment', 'receive_pending_income', 'undo_pending_payment'
   )
 order by routine_name;
