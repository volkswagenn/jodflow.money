import { supabase, unwrap } from '../supabase'
import { canEditShop, getShopId } from './context'
import { fromRow, fromRows, toRow } from './_map'
import { selectAll } from './_page'
import { billedAmount, occursInMonth, pauseInfo } from '../recurringSchedule'

// รายการประจำ (แม่แบบ) + entries รายเดือนที่งอกจากแม่แบบ

export async function listRecurringItems() {
  return fromRows('recurring_items', await selectAll(() =>
    supabase.from('recurring_items').select('*').eq('shop_id', getShopId()).order('created_at').order('id')
  ))
}

export async function createRecurringItem(data) {
  const row = toRow('recurring_items', { ...data, shopId: getShopId() })
  return fromRow('recurring_items', await unwrap(
    supabase.from('recurring_items').insert(row).select().single()
  ))
}

export async function updateRecurringItem(id, changes) {
  const row = toRow('recurring_items', { ...changes, updatedAt: new Date().toISOString() })
  return fromRow('recurring_items', await unwrap(
    supabase.from('recurring_items').update(row).eq('id', id).select().single()
  ))
}

/**
 * ลบแม่แบบ แต่เก็บรอบที่จ่ายไปแล้วไว้เป็นประวัติ
 *
 * ⚠ ห้าม delete แถวใน recurring_items ถ้ายังมีรอบที่จ่ายแล้ว — foreign key ของ
 *   recurring_entries เป็น on delete cascade ลบแม่แบบ 1 แถวจะพารอบที่จ่ายไปแล้ว
 *   หายตามไปทุกเดือนทุกปี (หน้าจอยังโชว์อยู่จนกว่าจะรีเฟรช จึงดูเหมือนข้อมูลหายเอง)
 *   กรณีนั้นให้ตั้ง deleted = true เป็นการซ่อนแทน ประวัติเดือนเก่าจึงยังมีชื่อรายการอยู่
 *
 * @returns แถวที่ถูกซ่อน หรือ null ถ้าลบออกจริง (ไม่มีประวัติให้เก็บ)
 */
export async function deleteRecurringItem(id) {
  await unwrap(
    supabase.from('recurring_entries').delete()
      .eq('recurring_id', id).neq('status', 'paid')
  )

  const paid = await unwrap(
    supabase.from('recurring_entries').select('id')
      .eq('recurring_id', id).eq('status', 'paid').limit(1)
  )

  if (paid?.length) {
    return fromRow('recurring_items', await unwrap(
      supabase.from('recurring_items')
        .update({ deleted: true, enabled: false, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
    ))
  }

  await unwrap(supabase.from('recurring_items').delete().eq('id', id))
  return null
}

/**
 * เมื่อรายการกลายเป็นรายปี entry "รอจ่าย" ของเดือนอื่นที่เคยงอกไว้ต้องหายไป
 * (ที่จ่ายแล้วเก็บไว้เป็นประวัติ) — คืน id ที่ลบเพื่อให้ store ตัดออกจากหน้าจอ
 */
export async function deletePendingEntriesOutsideMonth(recurringId, billingMonth) {
  const rows = await unwrap(
    supabase.from('recurring_entries').select('id, month')
      .eq('recurring_id', recurringId).eq('status', 'pending')
  )
  const ids = (rows ?? [])
    .filter((r) => Number(r.month.split('-')[1]) !== Number(billingMonth))
    .map((r) => r.id)
  if (ids.length > 0) await unwrap(supabase.from('recurring_entries').delete().in('id', ids))
  return ids
}

/** ลบรอบที่ยังไม่จ่ายในช่วงเดือน [fromMonth, untilMonth) — ใช้ตอนสั่งพักเรียกเก็บ */
export async function deletePendingEntriesInRange(recurringId, fromMonth, untilMonth) {
  const rows = await unwrap(
    supabase.from('recurring_entries').select('id, month')
      .eq('recurring_id', recurringId).eq('status', 'pending')
      .gte('month', fromMonth).lt('month', untilMonth)
  )
  const ids = (rows ?? []).map((r) => r.id)
  if (ids.length > 0) await unwrap(supabase.from('recurring_entries').delete().in('id', ids))
  return ids
}

// ── entries รายเดือน ────────────────────────────────────────────────────────

export async function listRecurringEntries() {
  return fromRows('recurring_entries', await selectAll(() =>
    supabase.from('recurring_entries').select('*').eq('shop_id', getShopId()).order('due_date').order('id')
  ))
}

/**
 * สร้าง entries ของเดือนที่ระบุ — เรียกซ้ำได้ไม่เกิดรายการซ้ำ
 * เพราะตาราง recurring_entries มี unique (recurring_id, month) และเราใช้ upsert
 * แบบ ignoreDuplicates ให้ฐานข้อมูลเป็นคนตัดสิน ไม่ใช่เช็คใน JS แล้วแข่งกันเขียน
 */
export async function generateEntries(month, computeDueDate) {
  // viewer ไม่มีสิทธิ์ insert — ถ้ายิงไป RLS จะปฏิเสธแล้วเด้ง error ทุกครั้งที่เปิดปฏิทิน
  // รอบของเดือนนั้นจะถูกสร้างเมื่อ owner/editor เปิดดูแทน
  if (!canEditShop()) return []
  const shopId = getShopId()
  const [year, mon] = month.split('-').map(Number)
  // รายปีสร้าง entry เฉพาะเดือนที่ตรงกับเดือนเรียกเก็บ รายเดือนสร้างทุกเดือน
  // เดือนที่ถูกพักไว้ไม่ต้องออกบิล — ต่างจากปิดใช้งานตรงที่พักมีวันกลับมาเอง
  const items = (await listRecurringItems()).filter(
    (it) => it.enabled && !it.deleted && occursInMonth(it, mon) && !pauseInfo(it, month)
  )
  if (items.length === 0) return []

  const rows = items.map((item) => ({
    shop_id: shopId,
    recurring_id: item.id,
    month,
    due_date: computeDueDate(year, mon, item.billingDay),
    status: 'pending',
    amount: item.amountType === 'fixed' ? billedAmount(item) : 0,
  }))

  return fromRows('recurring_entries', await unwrap(
    supabase
      .from('recurring_entries')
      .upsert(rows, { onConflict: 'recurring_id,month', ignoreDuplicates: true })
      .select()
  ))
}

export async function updateRecurringEntry(id, changes) {
  return fromRow('recurring_entries', await unwrap(
    supabase.from('recurring_entries').update(toRow('recurring_entries', changes)).eq('id', id).select().single()
  ))
}

/** ย้อนการจ่ายรอบเดือนหนึ่งรอบ: คืนเงินตามรายจ่ายที่ผูกอยู่ ลบรายจ่าย กลับเป็นยังไม่จ่าย */
export async function undoRecurringEntry(id, log = null) {
  const row = await unwrap(supabase.rpc('undo_recurring_entry', { p_entry: id, p_log: log }))
  return fromRow('recurring_entries', row)
}

/** แก้ไขการจ่ายรอบเดือนในที่ — คืนเงินเดิม (สด/โอน/บัตร) ตัดเงินใหม่ แก้รอบและรายจ่ายที่ผูก */
export async function editRecurringPayment(id, { method, accountId = null, amount, paidAt, log = null }) {
  const row = await unwrap(supabase.rpc('edit_recurring_payment', {
    p_entry: id, p_method: method, p_account: accountId, p_amount: amount, p_paid_at: paidAt, p_log: log,
  }))
  return fromRow('recurring_entries', row)
}
