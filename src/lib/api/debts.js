import { supabase, unwrap, toThaiError } from '../supabase'
import { getShopId } from './context'
import { fromRow, fromRows } from './_map'
import { toDateString } from '../cardCycle'

/**
 * หนี้สินและลูกหนี้
 *
 * หนี้ก้อนยาวที่มีตารางผ่อน เช่น ผ่อนบ้าน ผ่อนรถ เงินกู้ และเงินที่ให้คนอื่นยืม
 * ตอนสร้างบันทึกแค่สัญญากับตารางงวด ยังไม่สร้างรายรับรายจ่ายและยังไม่ขยับเงิน
 * เงินขยับตอนกดจ่ายทีละงวด (pay_debt_entry) ซึ่งสร้างรายจ่ายจริงหนึ่งแถว
 * เพราะตอนกู้มาไม่เคยบันทึกเป็นรายจ่าย ต่างจากจ่ายบิลบัตรที่เป็นแค่การย้ายเงิน
 */

function isMissingTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

/** ทั้งสัญญาและงวด — กลืน error เฉพาะกรณีตารางยังไม่ถูกสร้าง */
export async function listDebts() {
  const shopId = getShopId()
  const [dRes, eRes] = await Promise.all([
    supabase.from('debts').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
    supabase.from('debt_entries').select('*').eq('shop_id', shopId).order('seq'),
  ])
  for (const res of [dRes, eRes]) {
    if (res.error) {
      if (isMissingTable(res.error)) {
        console.warn('ยังไม่มีตารางหนี้สิน — รัน supabase/debt.sql ก่อนจึงจะใช้หนี้สินได้')
        return { debts: [], entries: [] }
      }
      throw new Error(toThaiError(res.error))
    }
  }
  return { debts: fromRows('debts', dRes.data), entries: fromRows('debt_entries', eRes.data) }
}

/** @param schedule จาก debtSchedule() ใน cardCycle.js */
export async function createDebt(data, schedule, log = null) {
  const prepaid = data.prepaidCount ?? 0
  const row = await unwrap(supabase.rpc('create_debt', {
    p_shop: getShopId(),
    p_data: {
      direction: data.direction ?? 'payable',
      name: data.name,
      counterparty: data.counterparty || null,
      category_id: data.categoryId || null,
      term: data.term === 'short' ? 'short' : 'long',
      note: data.note || null,
      principal_amount: data.principalAmount ?? data.totalAmount,
      total_amount: data.totalAmount,
      months: data.months,
      monthly_amount: data.monthlyAmount,
      interest_rate: data.interestRate ?? 0,
      tiers: data.tiers ?? null,
      prepaid_count: prepaid,
      first_due: data.firstDue,
      due_day: data.dueDay,
      default_method: data.defaultMethod || null,
      default_account_id: data.defaultAccountId || null,
    },
    p_entries: schedule.map((e) => ({
      seq: e.seq,
      due_date: toDateString(e.dueDate),
      amount: e.amount,
      status: e.seq <= prepaid ? 'prepaid' : 'pending',
    })),
    p_log: log,
  }))
  return fromRow('debts', row)
}

export async function payDebtEntry(entryId, { method, accountId = null, amount, date, log = null }) {
  const row = await unwrap(supabase.rpc('pay_debt_entry', {
    p_entry: entryId, p_method: method, p_account: accountId,
    p_amount: amount, p_date: date, p_log: log,
  }))
  return fromRow('debt_entries', row)
}

export async function undoDebtEntry(entryId, log = null) {
  const row = await unwrap(supabase.rpc('undo_debt_entry', { p_entry: entryId, p_log: log }))
  return fromRow('debt_entries', row)
}

/** แก้ไขการจ่ายงวดหนี้ในที่ — คืนเงินเดิม ตัดเงินใหม่ แก้งวดและรายการที่ผูก ในคำสั่งเดียว */
export async function editDebtPayment(entryId, { method, accountId = null, amount, date, log = null }) {
  const row = await unwrap(supabase.rpc('edit_debt_payment', {
    p_entry: entryId, p_method: method, p_account: accountId, p_amount: amount, p_date: date, p_log: log,
  }))
  return fromRow('debt_entries', row)
}

export async function settleDebt(debtId, { method, accountId = null, date, fee = 0, log = null }) {
  const row = await unwrap(supabase.rpc('settle_debt', {
    p_debt: debtId, p_method: method, p_account: accountId,
    p_date: date, p_fee: fee, p_log: log,
  }))
  return fromRow('debts', row)
}

export async function cancelDebt(debtId, log = null) {
  const row = await unwrap(supabase.rpc('cancel_debt', { p_debt: debtId, p_log: log }))
  return fromRow('debts', row)
}

/** แก้ได้เฉพาะข้อมูลอธิบายและค่าเริ่มต้นการจ่าย — ยอดกับงวดแตะไม่ได้ */
export async function updateDebt(id, { name, counterparty, categoryId, term, note, defaultMethod, defaultAccountId }) {
  const row = await unwrap(
    supabase.from('debts').update({
      name, counterparty: counterparty || null, category_id: categoryId || null, note: note || null,
      ...(term ? { term: term === 'short' ? 'short' : 'long' } : {}),
      default_method: defaultMethod || null, default_account_id: defaultAccountId || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single()
  )
  return fromRow('debts', row)
}

/**
 * แก้ไขสัญญาทั้งฉบับ รวมยอด จำนวนงวด และวันครบกำหนด
 *
 * งวดที่จ่ายผ่านระบบไปแล้ว (paid) ฝั่งฐานข้อมูลจะไม่แตะเลย เพราะมีเงินออกจาก
 * กระเป๋าและมีรายการผูกอยู่จริง ส่วนงวดที่เหลือถูกสร้างใหม่ตามตารางที่ส่งไป
 * ต้องทำในคำสั่งเดียว ไม่งั้นเน็ตหลุดกลางทางจะได้ตารางงวดครึ่งเก่าครึ่งใหม่
 */
export async function editDebt(id, data, schedule, log = null) {
  const prepaid = data.prepaidCount ?? 0
  const row = await unwrap(supabase.rpc("edit_debt", {
    p_debt: id,
    p_data: {
      name: data.name,
      counterparty: data.counterparty || null,
      category_id: data.categoryId || null,
      term: data.term === "short" ? "short" : "long",
      note: data.note || null,
      principal_amount: data.principalAmount ?? data.totalAmount,
      total_amount: data.totalAmount,
      months: data.months,
      monthly_amount: data.monthlyAmount,
      interest_rate: data.interestRate ?? 0,
      tiers: data.tiers ?? null,
      prepaid_count: prepaid,
      first_due: data.firstDue,
      due_day: data.dueDay,
      default_method: data.defaultMethod || null,
      default_account_id: data.defaultAccountId || null,
    },
    p_entries: schedule.map((e) => ({
      seq: e.seq,
      due_date: toDateString(e.dueDate),
      amount: e.amount,
      status: e.seq <= prepaid ? "prepaid" : "pending",
    })),
    p_log: log,
  }))
  return fromRow("debts", row)
}
