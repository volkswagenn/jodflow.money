import { supabase, unwrap, toThaiError } from '../supabase'
import { getShopId } from './context'
import { fromRow, fromRows } from './_map'
import { toDateString } from '../cardCycle'

/**
 * ผ่อนชำระผ่านบัตรเครดิต
 *
 * ตอนสร้างไม่แตะยอดหนี้และไม่สร้างรายจ่าย — บันทึกแค่สัญญากับตารางงวด
 * งวดจะกลายเป็นรายจ่ายทีละงวดตอนปิดรอบ (ดู close_card_statement ใน
 * supabase/card.sql) เพราะเงินไหลออกจริงทีละงวด
 */

function isMissingTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

/** สัญญาผ่อนทั้งหมดพร้อมงวด — กลืน error เฉพาะกรณีตารางยังไม่ถูกสร้าง */
export async function listInstallments() {
  const shopId = getShopId()
  const [insRes, entRes] = await Promise.all([
    // สัญญาที่ยกเลิกแล้วไม่ต้องโหลดมาเลย — ไม่มีหน้าไหนแสดงมันอีก และสัญญาหนึ่งฉบับ
    // ลากงวดมาด้วยได้ถึง 120 แถว ดึงมากองไว้เปล่าๆ ทั้งที่ไม่ได้ใช้
    // (ยังอยู่ในฐานข้อมูลครบ ไม่ได้ลบทิ้ง เผื่อต้องย้อนดูภายหลัง)
    supabase.from('card_installments').select('*').eq('shop_id', shopId)
      .neq('status', 'cancelled').order('created_at', { ascending: false }),
    supabase.from('card_installment_entries').select('*').eq('shop_id', shopId)
      .neq('status', 'cancelled').order('seq'),
  ])

  for (const res of [insRes, entRes]) {
    if (res.error) {
      if (isMissingTable(res.error)) {
        console.warn('ยังไม่มีตารางผ่อนชำระ — รัน supabase/card.sql ก่อนจึงจะใช้การผ่อนได้')
        return { installments: [], entries: [] }
      }
      throw new Error(toThaiError(res.error))
    }
  }

  const installments = fromRows('card_installments', insRes.data)

  // งวดที่ถูกเรียกเก็บไปแล้วของสัญญาที่ยกเลิก ยังเป็นสถานะ billed อยู่ (เป็นหนี้จริง
  // ที่เกิดไปแล้ว ยกเลิกย้อนหลังไม่ได้) จึงหลุดตัวกรองข้างบนมา ตัดทิ้งตรงนี้อีกชั้น
  // ไม่งั้นจะมีงวดลอยอยู่ในหน่วยความจำโดยไม่มีสัญญาแม่ให้จับคู่
  const alive = new Set(installments.map((i) => i.id))
  const entries = fromRows('card_installment_entries', entRes.data)
    .filter((e) => alive.has(e.installmentId))

  return { installments, entries }
}

/**
 * สร้างสัญญาผ่อนพร้อมงวดทั้งหมดในคำสั่งเดียว
 * @param schedule ผลจาก installmentSchedule() ใน cardCycle.js
 */
export async function createInstallment(cardId, data, schedule, log = null) {
  const row = await unwrap(supabase.rpc('create_card_installment', {
    p_shop: getShopId(),
    p_card: cardId,
    p_data: {
      name: data.name,
      vendor: data.vendor || null,
      category_id: data.categoryId || null,
      note: data.note || null,
      principal_amount: data.principalAmount ?? data.totalAmount,
      total_amount: data.totalAmount,
      months: data.months,
      monthly_amount: data.monthlyAmount,
      interest_rate: data.interestRate ?? 0,
      // ช่วงราคาของโปรฯ เก็บไว้ดูย้อนหลังและใช้ตอนแก้ไข ยอดจริงอยู่ในตารางงวด
      tiers: data.tiers ?? null,
      prepaid_count: data.prepaidCount ?? 0,
      purchase_date: data.purchaseDate,
      first_cycle: schedule[0].cycle,
    },
    // งวดที่ผ่อนมาก่อนเริ่มใช้แอปส่งเป็น 'prepaid' — close_card_statement กรอง
    // เฉพาะ 'pending' จึงข้ามให้เอง ไม่สร้างรายจ่ายย้อนหลังและไม่ขยับยอดหนี้
    p_entries: schedule.map((e) => ({
      seq: e.seq,
      cycle: e.cycle,
      due_date: toDateString(e.dueDate),
      amount: e.amount,
      status: e.seq <= (data.prepaidCount ?? 0) ? 'prepaid' : 'pending',
    })),
    p_log: log,
  }))
  return fromRow('card_installments', row)
}

/** ปิดยอดคงเหลือก่อนกำหนด — รวมงวดที่เหลือเป็นรายการเดียวเข้ารอบที่เปิดอยู่ */
export async function settleInstallment(installmentId, { date, fee = 0, log = null }) {
  const row = await unwrap(supabase.rpc('settle_card_installment', {
    p_installment: installmentId,
    p_date: date,
    p_fee: fee,
    p_log: log,
  }))
  return fromRow('card_installments', row)
}

/** ยกเลิกงวดที่เหลือ — งวดที่เรียกเก็บไปแล้วยังอยู่ เพราะเกิดขึ้นจริง */
export async function cancelInstallment(installmentId, log = null) {
  const row = await unwrap(supabase.rpc('cancel_card_installment', {
    p_installment: installmentId,
    p_log: log,
  }))
  return fromRow('card_installments', row)
}

/** แก้เฉพาะข้อมูลอธิบาย — ทำได้เสมอ ไม่ว่างวดจะเดินไปถึงไหนแล้ว */
export async function updateInstallment(id, { name, vendor, categoryId, note }, log = null) {
  const row = await unwrap(supabase.rpc('update_card_installment', {
    p_installment: id,
    p_card: null,
    p_data: { name, vendor: vendor || null, category_id: categoryId || null, note: note || null },
    p_entries: null,
    p_log: log,
  }))
  return fromRow('card_installments', row)
}

/**
 * แก้ทั้งแผน — บัตร วันที่ซื้อ จำนวนงวด ยอดต่องวด แล้วสร้างตารางงวดใหม่ทั้งชุด
 *
 * ฐานข้อมูลจะปฏิเสธถ้ามีงวดไหนถูกเรียกเก็บเข้าบิลหรือจ่ายไปแล้ว เพราะงวดพวกนั้น
 * เป็นเงินที่เกิดขึ้นจริงไปแล้ว การรื้อตารางใหม่จะทำให้ยอดที่บันทึกไว้ลอยทันที
 *
 * @param schedule ผลจาก installmentSchedule()/tieredSchedule() ใน cardCycle.js
 */
export async function updateInstallmentPlan(id, cardId, data, schedule, log = null) {
  const row = await unwrap(supabase.rpc('update_card_installment', {
    p_installment: id,
    p_card: cardId,
    p_data: {
      name: data.name,
      vendor: data.vendor || null,
      category_id: data.categoryId || null,
      note: data.note || null,
      principal_amount: data.principalAmount ?? data.totalAmount,
      total_amount: data.totalAmount,
      months: data.months,
      monthly_amount: data.monthlyAmount,
      interest_rate: data.interestRate ?? 0,
      tiers: data.tiers ?? null,
      prepaid_count: data.prepaidCount ?? 0,
      purchase_date: data.purchaseDate,
      first_cycle: schedule[0].cycle,
    },
    p_entries: schedule.map((e) => ({
      seq: e.seq,
      cycle: e.cycle,
      due_date: toDateString(e.dueDate),
      amount: e.amount,
      status: e.seq <= (data.prepaidCount ?? 0) ? 'prepaid' : 'pending',
    })),
    p_log: log,
  }))
  return fromRow('card_installments', row)
}

/**
 * ลบสัญญาทิ้งทั้งฉบับ — ใช้กับรายการที่บันทึกผิด ไม่ควรมีตั้งแต่แรก
 * งวดที่จ่ายผ่านแอปไปแล้วจะถูกคืนเงินเข้ากระเป๋าต้นทางและลบรายจ่ายที่ผูกไว้ให้ครบ
 * ต่างจาก cancelInstallment ที่เก็บสัญญาไว้เป็นประวัติเพราะผ่อนไปจริงแล้ว
 */
export async function deleteInstallment(id, log = null) {
  await unwrap(supabase.rpc('delete_card_installment', { p_installment: id, p_log: log }))
}

/**
 * จ่ายค่างวดทีละงวดจากบัญชี/เงินสด
 *
 * ตัดเงิน สร้างรายจ่าย และปิดงวด จบในทรานแซกชันเดียวที่ฐานข้อมูล
 * ถ้าแยกยิงหลายคำสั่งแล้วเน็ตหลุดคั่นกลาง จะได้เงินที่หายไปโดยไม่มีรายการ
 */
export async function payInstallmentEntry(entryId, { method, accountId = null, amount, paidAt, log = null }) {
  const row = await unwrap(supabase.rpc('pay_installment_entry', {
    p_entry: entryId,
    p_method: method,
    p_account: accountId,
    p_amount: amount,
    p_paid_at: paidAt,
    p_log: log,
  }))
  return fromRow('card_installment_entries', row)
}

/** ย้อนการจ่ายค่างวด — คืนเงินเข้ากระเป๋าเดิมและลบรายจ่ายที่ผูกไว้ */
export async function undoInstallmentEntry(entryId, log = null) {
  const row = await unwrap(supabase.rpc('undo_installment_entry', { p_entry: entryId, p_log: log }))
  return fromRow('card_installment_entries', row)
}

/** แก้ไขการจ่ายค่างวดในที่ — คืนเงินเดิม ตัดเงินใหม่ แก้งวดและรายจ่ายที่ผูก ในคำสั่งเดียว */
export async function editInstallmentPayment(entryId, { method, accountId = null, amount, paidAt, log = null }) {
  const row = await unwrap(supabase.rpc('edit_installment_payment', {
    p_entry: entryId, p_method: method, p_account: accountId, p_amount: amount, p_paid_at: paidAt, p_log: log,
  }))
  return fromRow('card_installment_entries', row)
}
