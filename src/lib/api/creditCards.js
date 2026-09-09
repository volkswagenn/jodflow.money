import { supabase, unwrap, toThaiError } from '../supabase'
import { getShopId, getUserId } from './context'
import { fromRow, fromRows, toRow } from './_map'

/**
 * บัตรเครดิต
 *
 * กติกาเดียวกับกระเป๋าเงินอื่น: **ห้ามอ่านยอดมาบวกลบใน JS แล้วเขียนทับ**
 * ยอดหนี้คงค้าง (outstanding) ขยับผ่าน apply_wallet_effect ฝั่งฐานข้อมูลเท่านั้น
 * ซึ่งถูกเรียกจาก post_transaction / edit_transaction / cancel_transaction อีกที
 * ที่นี่จึงมีแต่การสร้าง แก้ข้อมูลบัตร และลบ — ไม่มีฟังก์ชันตั้งยอดหนี้โดยตรง
 *
 * ข้อยกเว้นเดียวคือ adjustOutstanding() สำหรับตอนผู้ใช้แก้ยอดยกมาเองในฟอร์มแก้ไขบัตร
 * ซึ่งก็ยังส่งเป็น delta ให้ฐานข้อมูลบวกให้ ไม่ได้เขียนทับยอด
 */

/** ฐานข้อมูลยังไม่มีตาราง credit_cards (ยังไม่ได้รัน supabase/card.sql) */
function isMissingTable(error) {
  // 42P01 = undefined_table ของ Postgres, PGRST205 = PostgREST หาตารางใน schema cache ไม่เจอ
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

/**
 * บัตรที่ยังไม่ถูกลบ เรียงตามลำดับที่ผู้ใช้จัด
 *
 * ตัวนี้ตัวเดียวที่ไม่ใช้ unwrap เพราะต้องแยกให้ออกว่า "ตารางยังไม่ถูกสร้าง" ต่างจาก
 * error อื่น loadAllData เป็นแบบล้มทั้งชุด ถ้าปล่อยให้ throw ตอนที่ยังไม่ได้รัน card.sql
 * ผู้ใช้จะเปิดแอปไม่ได้ทั้งแอป ทั้งที่แค่ฟีเจอร์บัตรยังไม่พร้อม
 * จึงคืนรายการว่างไปก่อน แล้วส่วนอื่นของแอปยังทำงานได้ตามปกติ
 * error อื่น (สิทธิ์ เน็ตหลุด) ยังโยนต่อเหมือนเดิม
 */
export async function listCreditCards() {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('shop_id', getShopId())
    .eq('deleted', false)
    .order('sort_order')
    .order('created_at')

  if (error) {
    if (isMissingTable(error)) {
      console.warn('ยังไม่มีตาราง credit_cards — รัน supabase/card.sql ก่อนจึงจะใช้บัตรเครดิตได้')
      return []
    }
    throw new Error(toThaiError(error))
  }
  return fromRows('credit_cards', data)
}

export async function createCreditCard({
  bankName = '',
  name = '',
  last4 = '',
  creditLimit = 0,
  outstanding = 0,
  closingDay = 25,
  dueDay = 15,
  cashbackRate = 0,
  annualFee = 0,
  annualFeeMonth = null,
  autopayMode = 'off',
  autopayAccountId = null,
  autopayAmount = 0,
  note = '',
  icon,
}) {
  const row = toRow('credit_cards', {
    shopId: getShopId(),
    // ไม่ได้เลือกไอคอน = ไม่ส่งคีย์นี้เลย (toRow ทิ้งคีย์ undefined)
    // ร้านที่ยังไม่ได้รัน icons.sql รอบใหม่จึงยังเพิ่มบัตรได้ตามปกติ
    icon: icon || undefined,
    bankName,
    name,
    last4: last4 || null,
    creditLimit: Number(creditLimit) || 0,
    // ยอดหนี้ยกมาตอนสร้างบัตร — หลังจากนี้ขยับผ่าน RPC เท่านั้น
    outstanding: Number(outstanding) || 0,
    closingDay: Number(closingDay) || 25,
    dueDay: Number(dueDay) || 15,
    cashbackRate: Number(cashbackRate) || 0,
    annualFee: Number(annualFee) || 0,
    annualFeeMonth: annualFeeMonth ? Number(annualFeeMonth) : null,
    autopayMode: autopayMode || 'off',
    autopayAccountId: autopayMode === 'off' ? null : autopayAccountId || null,
    autopayAmount: Number(autopayAmount) || 0,
    note: note || null,
  })
  return fromRow('credit_cards', await unwrap(
    supabase.from('credit_cards').insert(row).select().single()
  ))
}

/** แก้ได้เฉพาะข้อมูลบัตร — ยอดหนี้ต้องไปทาง adjustOutstanding เท่านั้น */
export async function updateCreditCard(id, {
  bankName, name, last4, creditLimit, closingDay, dueDay, cashbackRate, note, sortOrder, enabled,
  annualFee, annualFeeMonth, autopayMode, autopayAccountId, autopayAmount, icon,
}) {
  const row = toRow('credit_cards', {
    bankName, name, last4, creditLimit, closingDay, dueDay, cashbackRate, note, sortOrder, enabled,
    annualFee, annualFeeMonth, autopayMode, autopayAccountId, autopayAmount, icon,
    updatedAt: new Date().toISOString(),
  })
  return fromRow('credit_cards', await unwrap(
    supabase.from('credit_cards').update(row).eq('id', id).select().single()
  ))
}

/**
 * ปรับยอดหนี้โดยตรง (ใช้ตอนแก้ยอดยกมาในฟอร์มแก้ไขบัตร)
 *
 * ส่ง delta ให้ฐานข้อมูลบวกเอง ไม่ได้เขียนทับยอด — ถ้ามีคนอื่นรูดบัตรพร้อมกัน
 * ยอดจะยังถูกต้อง ไปทาง apply_wallet_effect เพื่อให้ผ่านเส้นทางเดียวกับที่อื่น
 *
 * หมายเหตุเครื่องหมาย: apply_wallet_effect กลับเครื่องหมายให้ (outstanding - delta)
 * อยากให้หนี้ "เพิ่ม" X ต้องส่ง delta = -X
 */
export async function adjustOutstanding(cardId, outstandingDelta) {
  await unwrap(supabase.rpc('apply_wallet_effect', {
    p_shop: getShopId(),
    p_target: `card:${cardId}`,
    p_delta: -outstandingDelta,
  }))
}

/**
 * ลบแบบนุ่ม — ห้าม hard delete
 * transactions.card_id เป็น on delete set null การลบจริงจะทำให้รายการเก่า
 * ไม่รู้ว่าเคยรูดบัตรใบไหน และประวัติจะอ่านไม่รู้เรื่อง
 */
export async function deleteCreditCard(id) {
  await unwrap(
    supabase
      .from('credit_cards')
      .update({ deleted: true, enabled: false, updated_at: new Date().toISOString() })
      .eq('id', id)
  )
}

export async function reorderCreditCards(orderedIds) {
  const shopId = getShopId()
  await Promise.all(
    orderedIds.map((id, index) =>
      unwrap(supabase.from('credit_cards').update({ sort_order: index }).eq('id', id).eq('shop_id', shopId))
    )
  )
}

// ── กดเงินสดจากบัตร (card.sql ส่วน 9b) ──────────────────────────────────

/** รายการกดเงินสดทั้งหมดของร้าน — ตารางยังไม่มี (ยังไม่รัน card.sql รอบใหม่) ให้คืนว่าง */
export async function listCardAdvances() {
  const { data, error } = await supabase
    .from('card_advances')
    .select('*')
    .eq('shop_id', getShopId())
    .order('date', { ascending: false })

  if (error) {
    if (isMissingTable(error)) {
      console.warn('ยังไม่มีตาราง card_advances — รัน supabase/card.sql รอบใหม่ก่อนจึงจะกดเงินสดจากบัตรได้')
      return []
    }
    throw new Error(toThaiError(error))
  }
  return fromRows('card_advances', data)
}

/**
 * กดเงินสด — RPC ทำทั้งขาหนี้บัตรเพิ่ม เงินเข้ากระเป๋า และรายจ่ายค่าธรรมเนียมใน transaction เดียว
 * target = 'cash' | 'transfer:<accountId>'
 */
export async function cashAdvance(cardId, { amount, fee = 0, target, date, note = '', log = null }) {
  const row = await unwrap(supabase.rpc('card_cash_advance', {
    p_shop: getShopId(),
    p_card: cardId,
    p_amount: amount,
    p_fee: fee,
    p_target: target,
    p_date: date,
    p_note: note || null,
    p_log: log,
  }))
  return fromRow('card_advances', row)
}

export async function undoCashAdvance(advanceId, log = null) {
  await unwrap(supabase.rpc('undo_card_advance', { p_advance: advanceId, p_log: log }))
}

// ── เครื่องหมายถูกรายแถวในบิลบัตร (card.sql ส่วน 11) ─────────────────────────

/**
 * บรรทัดที่ติ๊กไว้แล้วของร้าน — คืน Set ของ rowKey
 * ตารางยังไม่มี (ยังไม่รัน card.sql รอบใหม่) ให้คืนว่างแทนที่จะพังทั้งหน้า
 */
export async function listCardRowMarks() {
  const { data, error } = await supabase
    .from('card_row_marks')
    .select('row_key')
    .eq('shop_id', getShopId())

  if (error) {
    if (isMissingTable(error)) {
      console.warn('ยังไม่มีตาราง card_row_marks — รัน supabase/card.sql รอบใหม่ก่อนจึงจะติ๊กรายการในบิลได้')
      return []
    }
    throw new Error(toThaiError(error))
  }
  return (data ?? []).map((r) => r.row_key)
}

/** ติ๊กหนึ่งบรรทัด — ไม่แตะยอดเงินใดๆ เป็นแค่เครื่องหมายว่าไล่เช็คแล้ว */
export async function markCardRow({ cardId, cycle, rowKey }) {
  await unwrap(
    supabase.from('card_row_marks').insert({
      shop_id: getShopId(),
      card_id: cardId,
      cycle: cycle ?? null,
      row_key: rowKey,
      marked_by: getUserId(),
    })
  )
  return rowKey
}

/** เอาเครื่องหมายถูกออก */
export async function unmarkCardRow(rowKey) {
  await unwrap(
    supabase.from('card_row_marks').delete().eq('shop_id', getShopId()).eq('row_key', rowKey)
  )
  return rowKey
}
