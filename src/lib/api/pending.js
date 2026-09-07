import { supabase, unwrap } from '../supabase'
import { getShopId } from './context'
import { fromRow, fromRows, toRow } from './_map'
import { selectAll } from './_page'

/**
 * ค้างชำระ / รอรับเงิน / รอใบกำกับภาษี
 *
 * การ "กดจ่าย" และ "กดรับเงิน" เป็นงานหลายสเต็ป (สร้าง transaction + ปิดรายการค้าง
 * + ขยับยอด + เขียน log) จึงต้องผ่าน RPC ที่ทำให้จบในครั้งเดียว ห้ามยิงทีละคำสั่งจาก client
 */

// ── ค้างชำระ ────────────────────────────────────────────────────────────────

export async function listPendingPayments() {
  return fromRows('pending_payments', await selectAll(() =>
    supabase.from('pending_payments').select('*').eq('shop_id', getShopId())
      .order('created_at', { ascending: false }).order('id')
  ))
}

export async function createPendingPayment(data) {
  const row = toRow('pending_payments', { ...data, shopId: getShopId(), status: data.status ?? 'pending' })
  return fromRow('pending_payments', await unwrap(
    supabase.from('pending_payments').insert(row).select().single()
  ))
}

export async function updatePendingPayment(id, changes) {
  return fromRow('pending_payments', await unwrap(
    supabase.from('pending_payments').update(toRow('pending_payments', changes)).eq('id', id).select().single()
  ))
}

export async function deletePendingPayment(id) {
  await unwrap(supabase.from('pending_payments').delete().eq('id', id))
}

/**
 * จ่ายรายการค้างชำระ — สร้าง transaction + ตัดเงิน + ปิดรายการค้าง
 * + อัปเดตรายการประจำที่ผูกอยู่ ทั้งหมดในคำสั่งเดียว คืน transaction ที่สร้าง
 */
export async function payPendingPayment(id, { method, accountId = null, date = null, log = null }) {
  return fromRow('transactions', await unwrap(
    supabase.rpc('pay_pending_payment', {
      p_pending: id, p_method: method, p_account: accountId, p_date: date, p_log: log,
    })
  ))
}

export async function deletePendingPaymentByTxId(transactionId) {
  await unwrap(
    supabase.from('pending_payments').delete().eq('shop_id', getShopId()).eq('transaction_id', transactionId)
  )
}

// ── รอรับเงิน ───────────────────────────────────────────────────────────────

export async function listPendingIncomes() {
  return fromRows('pending_incomes', await selectAll(() =>
    supabase.from('pending_incomes').select('*').eq('shop_id', getShopId())
      .order('created_at', { ascending: false }).order('id')
  ))
}

export async function createPendingIncome(data) {
  const row = toRow('pending_incomes', { ...data, shopId: getShopId(), status: data.status ?? 'pending' })
  return fromRow('pending_incomes', await unwrap(
    supabase.from('pending_incomes').insert(row).select().single()
  ))
}

export async function updatePendingIncome(id, changes) {
  return fromRow('pending_incomes', await unwrap(
    supabase.from('pending_incomes').update(toRow('pending_incomes', changes)).eq('id', id).select().single()
  ))
}

export async function deletePendingIncome(id) {
  await unwrap(supabase.from('pending_incomes').delete().eq('id', id))
}

/** รับเงินที่รออยู่ — สร้าง transaction + เพิ่มเงินเข้ากระเป๋า + ปิดรายการรอ ในคำสั่งเดียว */
export async function receivePendingIncome(id, { method, accountId = null, date = null, log = null }) {
  return fromRow('transactions', await unwrap(
    supabase.rpc('receive_pending_income', {
      p_pending: id, p_method: method, p_account: accountId, p_date: date, p_log: log,
    })
  ))
}

// ── รอใบกำกับภาษี ───────────────────────────────────────────────────────────

export async function listTaxInvoices() {
  return fromRows('tax_invoices', await selectAll(() =>
    supabase.from('tax_invoices').select('*').eq('shop_id', getShopId())
      .order('created_at', { ascending: false }).order('id')
  ))
}

export async function createTaxInvoice(data) {
  const row = toRow('tax_invoices', { ...data, shopId: getShopId(), status: data.status ?? 'waiting' })
  return fromRow('tax_invoices', await unwrap(
    supabase.from('tax_invoices').insert(row).select().single()
  ))
}

export async function updateTaxInvoice(id, changes) {
  return fromRow('tax_invoices', await unwrap(
    supabase.from('tax_invoices').update(toRow('tax_invoices', changes)).eq('id', id).select().single()
  ))
}

export async function receiveTaxInvoice(id, filePath = null) {
  const changes = { status: 'received', received_at: new Date().toISOString() }
  if (filePath) changes.file_path = filePath
  return fromRow('tax_invoices', await unwrap(
    supabase.from('tax_invoices').update(changes).eq('id', id).select().single()
  ))
}

export async function unreceiveTaxInvoice(id) {
  return fromRow('tax_invoices', await unwrap(
    supabase.from('tax_invoices')
      .update({ status: 'waiting', received_at: null, file_path: null })
      .eq('id', id).select().single()
  ))
}

export async function deleteTaxInvoice(id) {
  await unwrap(supabase.from('tax_invoices').delete().eq('id', id))
}

export async function deleteTaxInvoiceByTxId(transactionId) {
  await unwrap(
    supabase.from('tax_invoices').delete().eq('shop_id', getShopId()).eq('transaction_id', transactionId)
  )
}

/** ย้อนการจ่ายรายการค้างชำระ: คืนเงิน ลบรายจ่าย กลับเป็นค้างชำระ (และรอบประจำที่ผูกอยู่) */
export async function undoPendingPayment(id, log = null) {
  const row = await unwrap(supabase.rpc('undo_pending_payment', { p_pending: id, p_log: log }))
  return fromRow('pending_payments', row)
}
