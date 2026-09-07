-- ไฟล์: supabase/recurring.sql
-- ============================================================================
-- JodFlow — รายการประจำ ทั้งส่วนที่เพิ่มทีหลัง   [recurring.sql]
--
-- ★ ไฟล์ประจำเรื่อง "รายการประจำ" ★
-- มีอะไรเปลี่ยนเรื่องรายการประจำ จะถูกเพิ่มลงไฟล์นี้เสมอ ไม่แตกไฟล์ใหม่
-- เวลาอัปเดต: เปิดแท็บเดิมใน SQL Editor ลบของเก่าออก วางไฟล์นี้ทั้งไฟล์ แล้ว Run
--
-- ทุกคำสั่งรันซ้ำได้ ไม่มีคำสั่งลบหรือแก้ข้อมูล ของที่มีอยู่แล้วจะถูกข้ามเอง
-- ฐานข้อมูลใหม่เอี่ยมไม่ต้องรัน ใช้ setup.sql ไฟล์เดียวจบ
--
-- สิ่งที่อยู่ในไฟล์นี้
--   รอบรายปี · ซ่อนแทนการลบเมื่อมีประวัติ · พักการเรียกเก็บชั่วคราว · VAT 3 แบบ
-- ============================================================================



-- ── รอบเรียกเก็บ: รายเดือน / รายปี ─────────────────────────────────────────
alter table recurring_items add column if not exists frequency text not null default 'monthly'
  check (frequency in ('monthly', 'yearly'));
alter table recurring_items add column if not exists billing_month int
  check (billing_month between 1 and 12);

-- ── กันประวัติหายตอนลบแม่แบบ ───────────────────────────────────────────────
alter table recurring_items add column if not exists deleted boolean not null default false;

-- ── พักการเรียกเก็บชั่วคราว ────────────────────────────────────────────────
alter table recurring_items add column if not exists paused_from  date;
alter table recurring_items add column if not exists paused_until date;

-- ── VAT ────────────────────────────────────────────────────────────────────
alter table recurring_items add column if not exists vat_rate numeric(5,2) not null default 0;
alter table recurring_items add column if not exists vat_mode text not null default 'none'
  check (vat_mode in ('none', 'included', 'add'));

-- ── บัตรเครดิตที่ตั้งไว้ล่วงหน้า ────────────────────────────────────────────
--
-- default_method รับค่า 'card' ได้อยู่แล้ว (คอลัมน์เป็น text ไม่มี check) แต่ยัง
-- ไม่มีที่เก็บว่า "รูดใบไหน" พอถึงวันจ่ายจึงต้องมานั่งเลือกบัตรใหม่ทุกครั้ง
--
-- ห่อด้วย do block เพราะตารางบัตรเครดิตมาจาก card.sql — ถ้ายังไม่ได้รันไฟล์นั้น
-- คำสั่งนี้จะข้ามไปเงียบๆ แทนที่จะ error แล้วทำให้ทั้งไฟล์ rollback
do $$
begin
  if to_regclass('public.credit_cards') is not null then
    alter table recurring_items add column if not exists default_card_id uuid
      references credit_cards(id) on delete set null;
  end if;
end $$;

-- ── รอบบิลที่บิลใบนี้เรียกเก็บ ──────────────────────────────────────────────
--
-- บิลสาธารณูปโภคของไทยเกือบทั้งหมดเรียกเก็บ "ย้อนหลัง": บิลค่าไฟที่ครบกำหนดวันที่ 15
-- กันยายน คือค่าไฟที่ใช้ไปเมื่อเดือนสิงหาคม ส่วนค่าบริการรายเดือนอย่างซอฟต์แวร์
-- มักเก็บล่วงหน้าสำหรับเดือนที่กำลังจะใช้ ทั้งสองแบบอยู่ปนกันในหน้าเดียว
--
-- ของเดิมระบบรู้แค่ "เดือนที่ต้องจ่าย" (recurring_entries.month) เลยตอบไม่ได้ว่า
-- เงินก้อนนี้เป็นค่าอะไรของเดือนไหน เวลาเทียบกับบิลจริงจากผู้ให้บริการจึงงง
--
-- คอลัมน์นี้เก็บส่วนต่างเป็นจำนวนเดือน: รอบบิล = เดือนที่จ่าย + offset
--    0 = รอบเดือนเดียวกับที่จ่าย (ค่าตั้งต้น — ของเดิมทั้งหมดถือเป็นแบบนี้)
--   -1 = บิลของเดือนก่อน (ค่าไฟ ค่าน้ำ ค่าเน็ต ค่าโทรศัพท์)
--   +1 = จ่ายล่วงหน้าสำหรับเดือนถัดไป (ค่าเช่า ค่าบริการรายเดือนบางเจ้า)
alter table recurring_items add column if not exists billing_cycle_offset int not null default 0
  check (billing_cycle_offset between -3 and 3);

-- ── ตรวจผล: ควรได้ 9 แถว (ถ้ายังไม่ได้รัน card.sql จะได้ 8 — ขาด default_card_id) ──

select column_name as คอลัมน์, data_type as ชนิด, column_default as ค่าตั้งต้น
  from information_schema.columns
 where table_schema = 'public' and table_name = 'recurring_items'
   and column_name in ('frequency','billing_month','deleted',
                       'paused_from','paused_until','vat_rate','vat_mode',
                       'default_card_id','billing_cycle_offset')
 order by column_name;



-- ── ย้อนการจ่ายรอบเดือนของรายการประจำ (ใช้จากหน้าประวัติการจ่าย) ─────────────
-- รอบที่จ่ายสด/โอน/บัตรมีรายจ่ายผูกอยู่ (transaction_id) เงินที่ต้องคืนอ่านจากรายจ่าย
-- นั้นตรงๆ (วิธีจ่าย บัญชี บัตร) จึงคืนถูกกระเป๋าแม้รอบนั้นจะจำวิธีจ่ายไว้ไม่ครบ
-- รอบที่ถูกจ่ายผ่าน "รายการค้างชำระ" ต้องย้อนที่รายการค้างชำระ (undo_pending_payment)
-- เพราะเงินและรายจ่ายอยู่ที่นั่น ถ้าย้อนตรงนี้สองฝั่งจะไม่ตรงกัน
create or replace function public.undo_recurring_entry(
  p_entry uuid,
  p_log   jsonb default null
) returns recurring_entries language plpgsql security definer set search_path = public as $$
declare v_e recurring_entries; v_tx transactions; v_target text;
begin
  select * into v_e from recurring_entries where id = p_entry;
  if v_e.id is null then raise exception 'ไม่พบรอบเดือนนี้'; end if;
  perform assert_can_edit(v_e.shop_id);
  if v_e.status <> 'paid' then raise exception 'รอบนี้ยังไม่ได้จ่าย'; end if;
  if v_e.pending_payment_id is not null then
    raise exception 'รอบนี้ถูกจ่ายผ่านรายการค้างชำระ ให้ย้อนที่ประวัติของรายการค้างชำระแทน';
  end if;

  if v_e.transaction_id is not null then
    select * into v_tx from transactions where id = v_e.transaction_id;
    if v_tx.id is not null then
      v_target := case v_tx.method
        when 'cash' then 'cash'
        when 'transfer' then case
          when v_tx.transfer_account_id is not null
               and exists (select 1 from transfer_accounts where id = v_tx.transfer_account_id)
            then 'transfer:' || v_tx.transfer_account_id else 'cash' end
        when 'card' then case when v_tx.card_id is not null then 'card:' || v_tx.card_id else null end
        else null end;
      if v_target is not null then
        perform apply_wallet_effect(v_e.shop_id, v_target, v_tx.amount);
      end if;
      delete from transactions where id = v_tx.id;
    end if;
  elsif v_e.paid_method in ('cash', 'transfer') then
    -- ของเก่าที่ไม่มีรายจ่ายผูก คืนตามที่รอบนั้นจำไว้
    perform apply_wallet_effect(v_e.shop_id,
      case when v_e.paid_method = 'transfer' and v_e.transfer_account_id is not null
                and exists (select 1 from transfer_accounts where id = v_e.transfer_account_id)
           then 'transfer:' || v_e.transfer_account_id else 'cash' end,
      v_e.amount);
  end if;

  update recurring_entries
     set status = 'pending', paid_at = null, paid_method = null,
         transaction_id = null, transfer_account_id = null
   where id = p_entry
   returning * into v_e;

  perform write_log(v_e.shop_id, p_log);
  return v_e;
end;
$$;

notify pgrst, 'reload schema';

select 'ย้อนการจ่ายรอบเดือนจากหน้าประวัติ' as "รายการ",
       case when exists (select 1 from information_schema.routines
                          where routine_schema = 'public' and routine_name = 'undo_recurring_entry')
            then '✅' else '❌ ยังไม่มี — รันไฟล์นี้ซ้ำอีกรอบ' end as "ผล";
