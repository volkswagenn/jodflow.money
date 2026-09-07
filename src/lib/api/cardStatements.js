import { supabase, unwrap, toThaiError } from '../supabase'
import { getShopId } from './context'
import { fromRow, fromRows } from './_map'
import { toDateString } from '../cardCycle'

/**
 * ใบแจ้งยอดบัตรเครดิต
 *
 * ตารางเก็บเฉพาะรอบที่ปิดแล้ว รอบที่กำลังเดินอยู่คำนวณสดจาก transactions
 * เพราะยอดของมันเปลี่ยนทุกครั้งที่รูด การเก็บไว้จะต้องคอยไล่อัปเดตแล้วเพี้ยนได้ง่าย
 *
 * การจ่ายบิลไม่สร้าง transactions โดยเจตนา — ดูเหตุผลใน supabase/card.sql
 */

function isMissingTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

/**
 * ใบแจ้งยอดทั้งหมดของร้าน
 *
 * กลืน error เฉพาะกรณีตารางยังไม่ถูกสร้าง (ยังไม่ได้รัน card.sql)
 * ด้วยเหตุผลเดียวกับ listCreditCards คือ loadAllData ล้มทั้งชุด
 */
export async function listCardStatements() {
  const { data, error } = await supabase
    .from('card_statements')
    .select('*')
    .eq('shop_id', getShopId())
    .order('period_end', { ascending: false })

  if (error) {
    if (isMissingTable(error)) {
      console.warn('ยังไม่มีตาราง card_statements — รัน supabase/card.sql ก่อนจึงจะใช้รอบบิลได้')
      return []
    }
    throw new Error(toThaiError(error))
  }
  return fromRows('card_statements', data)
}

/**
 * ปิดรอบหนึ่งรอบ — เรียกซ้ำได้ ถ้าปิดไปแล้วจะคืนใบเดิมโดยไม่ทำอะไรเพิ่ม
 * @param period { cycle, start, end, due } จาก pendingCycles()
 */
export async function closeStatement(cardId, period) {
  const row = await unwrap(supabase.rpc('close_card_statement', {
    p_shop: getShopId(),
    p_card: cardId,
    p_cycle: period.cycle,
    p_start: toDateString(period.start),
    p_end: toDateString(period.end),
    p_due: toDateString(period.due),
  }))
  return fromRow('card_statements', row)
}

/** จ่ายบิล — ย้ายเงินสองขาในทรานแซกชันเดียว ไม่สร้างรายจ่ายใหม่ */
export async function payStatement(
  statementId,
  // transactionId = จ่ายบิลด้วยยอดของรายการเดียวในบิล ขาที่จ่ายจะผูกกับรายการนั้น
  // หน้าจอจึงติ๊กถูกหน้าบรรทัดได้ว่าจ่ายไปแล้ว (ไม่ส่ง = จ่ายทั้งบิลเหมือนเดิม)
  { method, accountId = null, amount, date, log = null, transactionId = null },
) {
  const args = {
    p_statement: statementId,
    p_method: method,
    p_account: accountId,
    p_amount: amount,
    p_date: date,
    p_log: log,
  }
  const { data, error } = await supabase.rpc('pay_card_statement', { ...args, p_transaction: transactionId })
  if (!error) return fromRow('card_statements', data)

  // ฐานข้อมูลที่ยังไม่ได้รัน card.sql รอบใหม่จะไม่รู้จัก p_transaction (PGRST202)
  // ยอมจ่ายบิลแบบเดิมไปก่อนดีกว่าจ่ายไม่ได้เลย — แค่ไม่รู้ว่าเป็นของบรรทัดไหน
  if (error.code === 'PGRST202' || /p_transaction/i.test(error.message ?? '')) {
    return fromRow('card_statements', await unwrap(supabase.rpc('pay_card_statement', args)))
  }
  throw new Error(toThaiError(error))
}

/** ย้อนการจ่ายบิล — คืนเงินเข้ากระเป๋าเดิมและหนี้บัตรกลับมาเท่าเดิม */
export async function undoPayment(statementId, amount, log = null) {
  const row = await unwrap(supabase.rpc('undo_card_payment', {
    p_statement: statementId,
    p_amount: amount,
    p_log: log,
  }))
  return fromRow('card_statements', row)
}

/**
 * ขาการจ่ายบิลทั้งหมด — บิลใบเดียวจ่ายได้หลายครั้งจากคนละกระเป๋า
 *
 * ใช้ทำหน้าประวัติการจ่าย และเป็นตัวที่ undo_card_payment ใช้คืนเงินทีละขา
 * ตารางนี้เพิ่งมีในรุ่นหลัง บิลที่จ่ายไปก่อนหน้านั้นจึงไม่มีขา — หน้าประวัติ
 * จะถอยไปอ่าน paid_at/paid_method ที่ตัวใบแทน
 */
export async function listStatementPayments() {
  const { data, error } = await supabase
    .from('card_statement_payments')
    .select('*')
    .eq('shop_id', getShopId())
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingTable(error)) {
      console.warn('ยังไม่มีตาราง card_statement_payments — รัน supabase/card.sql')
      return []
    }
    throw new Error(toThaiError(error))
  }
  return fromRows('card_statement_payments', data)
}

/**
 * ใส่รายการรูดเข้าบิลใบที่ออกไปแล้ว — ยอดบิลกับขั้นต่ำถูกคิดใหม่ที่ฐานข้อมูล
 * ใช้ตอนคีย์รายการที่เห็นในบิลจริงของธนาคารหลังวันสรุปยอดผ่านไปแล้ว
 * (เหตุผลเต็มดู supabase/card.sql ส่วนที่ 15)
 */
export async function attachTransaction(transactionId, statementId) {
  await unwrap(supabase.rpc('attach_transaction_to_statement', {
    p_transaction: transactionId,
    p_statement: statementId,
  }))
}

/** เอารายการออกจากบิล — กลับไปเป็นรายการที่ยังไม่มีใบครอบ บิลรอบถัดไปจะเก็บแทน */
export async function detachTransaction(transactionId) {
  await unwrap(supabase.rpc('detach_transaction_from_statement', { p_transaction: transactionId }))
}

/**
 * จ่ายรายการรูดทีละรายการก่อนออกบิล — เงินออกจากกระเป๋า หนี้บัตรลด ไม่สร้างรายจ่ายใหม่
 * ขาที่ได้ยังไม่ผูกใบ (statementId ว่าง) จนกว่าบิลรอบนั้นจะออก (supabase/card.sql ส่วนที่ 16)
 */
export async function prepayTransaction(transactionId, { method, accountId = null, amount, date, log = null }) {
  const row = await unwrap(supabase.rpc('prepay_card_transaction', {
    p_transaction: transactionId,
    p_method: method,
    p_account: accountId,
    p_amount: amount,
    p_date: date,
    p_log: log,
  }))
  return fromRow('card_statement_payments', row)
}

/** ย้อนการจ่ายก่อนออกบิล — ได้เฉพาะขาที่ยังไม่ถูกรวมเข้าบิล */
export async function undoPrepayment(legId, log = null) {
  await unwrap(supabase.rpc('undo_card_prepayment', { p_leg: legId, p_log: log }))
}

/**
 * ทำเครื่องหมายว่ารายการในบิลนี้จ่ายไปแล้ว โดยไม่ตัดเงินซ้ำ
 * ใช้กับรายการที่จ่ายไปก่อนระบบจะจำได้ว่าเงินก้อนไหนเป็นของบรรทัดไหน
 * (supabase/card.sql ส่วนที่ 17) — ผูกขาที่จ่ายไว้แล้วเข้ากับรายการเท่านั้น
 */
export async function assignStatementPayment(transactionId, log = null) {
  const { error } = await supabase.rpc('assign_statement_payment', { p_transaction: transactionId, p_log: log })
  if (!error) return
  // ยังไม่ได้รัน card.sql รอบใหม่ — บอกให้ไปรัน ไม่ใช่โยนข้อความ 404 ดิบๆ ใส่หน้า
  if (error.code === 'PGRST202') {
    throw new Error('ฐานข้อมูลยังไม่มีคำสั่งนี้ — เปิด Supabase แล้วรัน supabase/card.sql ทับในแท็บเดิมก่อน')
  }
  throw new Error(toThaiError(error))
}

/** เอาเครื่องหมายจ่ายแล้วออก — ขากลับไปเป็นยอดจ่ายของบิลตามเดิม เงินไม่ขยับ */
export async function unassignStatementPayment(transactionId, log = null) {
  await unwrap(supabase.rpc('unassign_statement_payment', { p_transaction: transactionId, p_log: log }))
}

/**
 * ย้อนการจ่ายบิล "ขาเดียว" ที่ระบุ — ใช้จากหน้าประวัติการจ่าย
 * undoPayment ย้อนขาล่าสุดตามจำนวนเงิน ถ้าเลือกย้อนขากลางจะไปคืนผิดกระเป๋า
 */
export async function undoPaymentLeg(legId, log = null) {
  const row = await unwrap(supabase.rpc('undo_card_payment_leg', { p_leg: legId, p_log: log }))
  return fromRow('card_statements', row)
}
