import useCreditCardStore from '../store/useCreditCardStore'
import useDebtStore from '../store/useDebtStore'
import usePendingStore from '../store/usePendingStore'
import useRecurringStore from '../store/useRecurringStore'
import useWalletStore from '../store/useWalletStore'
import useTransactionStore from '../store/useTransactionStore'
import usePaymentSlipStore from '../store/usePaymentSlipStore'
import useLogStore from '../store/useLogStore'
import { buildLogEntry } from './logBuilder'
import { walletTarget } from './api/transactions'
import { formatIsoThai } from './cardCycle'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * ย้อน / แก้ไขวิธีจ่าย ของ "การจ่ายหนึ่งครั้ง" จากหน้าประวัติการจ่าย
 *
 * การจ่ายในระบบอยู่กระจายห้าตาราง (บิลบัตร ค่างวดผ่อน งวดหนี้ ค้างชำระ รายการประจำ)
 * แต่ละชนิดย้อนคนละวิธี — ที่นี่รวมเป็นสองคำสั่งเดียว: undo กับ repay
 * โดยยึดกฎเดียวกันทุกชนิด
 *   • เงินกลับเข้ากระเป๋าที่ตัดมาจริง (ฐานข้อมูลเป็นคนคืน ไม่ใช่หน้าจอบวกลบเอง)
 *   • ของที่ถูกทำเครื่องหมายว่าจ่ายแล้วกลับเป็นยังไม่จ่าย (บิล งวด รอบเดือน รายการค้าง)
 *   • ติ๊ก "จ่ายให้รายการนี้แล้ว" บนบิลหายไปพร้อมขาที่จ่าย
 *   • สลิปที่แนบไว้ตามไปอยู่กับการจ่ายครั้งใหม่เมื่อแก้ไข และถูกลบเมื่อยกเลิก
 *
 * "แก้ไขวิธีจ่าย" = ย้อนแล้วจ่ายใหม่ด้วยยอดเดิมผ่าน RPC ตัวเดิมที่ใช้จ่ายครั้งแรก
 * ไม่มีทางลัดแก้ช่องกระเป๋าตรงๆ เพราะยอดกระเป๋าไม่ใช่ตัวเลขที่แก้แล้วจบ
 * ถ้าจ่ายใหม่ล้ม รายการจะค้างเป็น "ยังไม่จ่าย" ซึ่งเห็นได้และจ่ายซ้ำได้ ไม่มีเงินหาย
 */

const stores = () => ({
  card: useCreditCardStore.getState(),
  debt: useDebtStore.getState(),
  pending: usePendingStore.getState(),
  recurring: useRecurringStore.getState(),
  wallet: useWalletStore.getState(),
  tx: useTransactionStore.getState(),
  slip: usePaymentSlipStore.getState(),
  log: useLogStore.getState(),
})

const accountName = (id) => {
  const a = useWalletStore.getState().transferAccounts.find((x) => x.id === id)
  if (!a) return 'บัญชีที่ถูกลบไปแล้ว (จะคืนเข้าเงินสดแทน)'
  return a.bankName ? `${a.bankName} — ${a.name}` : a.name
}
const sourceName = (method, accountId) =>
  method === 'transfer' ? accountName(accountId) : method === 'card' ? 'บัตรเครดิต' : 'เงินสด'

/** ขาการจ่ายบิลของแถวนี้ (ถ้ามี) — แถวชนิด card_bill ชี้ที่ขา ยกเว้นใบเก่าที่ชี้ที่ใบ */
function legOf(row) {
  if (row.kind !== 'card_bill' || row.legacy) return null
  return useCreditCardStore.getState().statementPayments.find((l) => l.id === row.refId) ?? null
}

/**
 * แผนการย้อน — ตอบว่า "ย้อนได้ไหม" และ "จะเกิดอะไรขึ้นบ้าง" เป็นบรรทัดภาษาคน
 * ใช้ทั้งปิดปุ่ม (พร้อมเหตุผล) และเป็นข้อความยืนยันก่อนกด — ผู้ใช้ต้องรู้ทุกอย่างที่จะ
 * ถูกย้ายกลับก่อนกด ไม่ใช่มารู้ทีหลังว่าติ๊กหาย
 */
export function undoPlan(row) {
  const lines = []
  const money = (src) => (row.incoming
    ? `ถอน ${fmt(row.amount)} บาท ออกจาก${src} (เงินที่รับมาต้องออกไป)`
    : `คืน ${fmt(row.amount)} บาท เข้า${src}`)
  const slipLine = row.slip ? 'สลิปที่แนบไว้กับการจ่ายนี้จะถูกลบ' : null

  if (row.kind === 'card_bill') {
    const st = row.ref
    if (row.legacy) {
      if (st?.carriedTo) return { ok: false, reason: 'ใบนี้ถูกยกยอดไปรวมในบิลรอบถัดไปแล้ว ย้อนได้ที่บิลใบล่าสุดในหน้าบัตรเท่านั้น' }
      lines.push(money(sourceName(st?.paidMethod, st?.transferAccountId)))
      lines.push(`บิลรอบ ${st?.cycle ?? ''} กลับเป็นยังไม่จ่าย และยอดหนี้บัตรเพิ่มขึ้น ${fmt(row.amount)}`)
    } else {
      const leg = legOf(row)
      if (!leg) return { ok: false, reason: 'ไม่พบขาการจ่ายนี้แล้ว (อาจถูกย้อนไปก่อนหน้า) — รีเฟรชหน้า' }
      lines.push(money(sourceName(leg.method, leg.transferAccountId)))
      if (leg.statementId) {
        if (st?.carriedTo) return { ok: false, reason: 'ใบนี้ถูกยกยอดไปรวมในบิลรอบถัดไปแล้ว ย้อนได้ที่บิลใบล่าสุดในหน้าบัตรเท่านั้น' }
        const left = Number(st?.paidAmount ?? 0) - Number(leg.amount)
        lines.push(`บิลรอบ ${st?.cycle ?? ''} กลับเป็น${left > 0.005 ? `จ่ายบางส่วน (ค้างเพิ่ม ${fmt(leg.amount)})` : 'ยังไม่จ่าย'} และยอดหนี้บัตรเพิ่มขึ้น ${fmt(leg.amount)}`)
        if (leg.transactionId) {
          const tx = useTransactionStore.getState().transactions.find((t) => t.id === leg.transactionId)
          lines.push(`เอาติ๊ก "จ่ายแล้ว" ออกจากรายการ "${tx?.itemName ?? 'รายการในบิล'}"`)
        }
      } else {
        const tx = useTransactionStore.getState().transactions.find((t) => t.id === leg.transactionId)
        lines.push(`รายการ "${tx?.itemName ?? '(รายการถูกลบไปแล้ว)'}" กลับไปรวมในบิลรอบที่กำลังมาถึงเต็มจำนวน`)
      }
    }
  } else if (row.kind === 'card_installment') {
    const e = row.ref
    lines.push(money(sourceName(e.paidMethod, e.transferAccountId)))
    lines.push(`งวดที่ ${e.seq} กลับเป็นยังไม่จ่าย และลบรายจ่ายที่ผูกไว้ (สัญญาที่ปิดไปแล้วจะเปิดกลับ)`)
  } else if (row.kind === 'debt') {
    const e = row.ref
    if (!e.paidMethod) return { ok: false, reason: 'งวดนี้ไม่ได้บันทึกว่าจ่ายจากกระเป๋าไหน ระบบคืนเงินให้ไม่ได้' }
    lines.push(money(sourceName(e.paidMethod, e.transferAccountId)))
    lines.push(`งวดที่ ${e.seq} กลับเป็นยังไม่จ่าย และลบรายการที่ผูกไว้ (สัญญาที่ปิดไปแล้วจะเปิดกลับ)`)
  } else if (row.kind === 'pending') {
    const p = row.ref
    if (!p.paidMethod) return { ok: false, reason: 'รายการนี้ไม่ได้บันทึกว่าจ่ายจากกระเป๋าไหน ระบบคืนเงินให้ไม่ได้' }
    lines.push(money(sourceName(p.paidMethod, p.transferAccountId)))
    lines.push('รายการกลับเป็นค้างชำระ และลบรายจ่ายที่สร้างไว้ตอนจ่าย')
    if (p.recurringEntryId) lines.push('รอบเดือนของรายการประจำที่ผูกอยู่กลับเป็นยังไม่จ่าย')
  } else if (row.kind === 'recurring') {
    const e = row.ref
    if (e.pendingPaymentId) {
      return { ok: false, reason: 'รอบนี้ถูกจ่ายผ่าน "รายการค้างชำระ" — ให้ย้อนที่แถวของรายการค้างชำระนั้นแทน (แท็บ รายการค้างชำระ)' }
    }
    lines.push(money(sourceName(e.paidMethod, e.transferAccountId)))
    lines.push('รอบเดือนนี้กลับเป็นยังไม่จ่าย และลบรายจ่ายที่ผูกไว้')
  } else {
    return { ok: false, reason: 'ยังไม่รองรับการย้อนของรายการชนิดนี้' }
  }
  if (slipLine) lines.push(slipLine)
  return { ok: true, lines }
}

/** ดึงข้อมูลใหม่ทุกร้านที่การจ่ายชนิดนี้แตะ — ยอดกระเป๋าและสถานะต้องตรงกับฐานข้อมูลทันที */
async function refreshFor(kind) {
  const s = stores()
  const jobs = [s.wallet.refresh(), s.tx.refresh(), s.slip.refresh()]
  if (kind === 'card_bill' || kind === 'card_installment') jobs.push(s.card.refresh())
  if (kind === 'debt') jobs.push(s.debt.refresh())
  if (kind === 'pending') jobs.push(s.pending.refresh(), s.recurring.refresh())
  if (kind === 'recurring') jobs.push(s.recurring.refresh())
  await Promise.all(jobs)
}

const logEntry = (type, row, description, extra = {}) => buildLogEntry({
  activityType: type,
  description,
  oldValue: { kind: row.kind, refId: row.refId, amount: row.amount, source: row.source },
  ...extra,
})

/** ย้อนการจ่ายหนึ่งครั้ง — คืนเงิน คืนสถานะ ลบสลิป */
export async function undoPaymentRow(row) {
  const plan = undoPlan(row)
  if (!plan.ok) throw new Error(plan.reason)
  const s = stores()
  const log = logEntry('PAYMENT_UNDO', row,
    `ยกเลิกการจ่าย "${row.title}" ${fmt(row.amount)} บาท จากหน้าประวัติการจ่าย — ${plan.lines.join(' · ')}`)

  if (row.kind === 'card_bill') {
    if (row.legacy) await s.card.undoPayment(row.ref.id, row.amount, log)
    else {
      const leg = legOf(row)
      if (leg.statementId) await s.card.undoPaymentLeg(leg.id, log)
      else await s.card.undoPrepayment(leg.id, log)
    }
  } else if (row.kind === 'card_installment') {
    await s.card.undoEntry(row.ref.id, log)
  } else if (row.kind === 'debt') {
    await s.debt.undoEntry(row.ref.id, log)
  } else if (row.kind === 'pending') {
    await s.pending.undoPendingPayment(row.ref.id, log)
  } else if (row.kind === 'recurring') {
    await s.recurring.undoEntryPayment(row.ref.id, log)
  }

  // สลิปผูกกับการจ่ายครั้งนั้น พอการจ่ายไม่มีแล้วสลิปก็ไม่ควรลอยอยู่
  if (row.slip?.id) { try { await s.slip.remove(row.slip.id) } catch { /* สลิปหายไปก่อนแล้วก็ไม่เป็นไร */ } }
  await refreshFor(row.kind)
}

/**
 * จ่ายซ้ำด้วยวิธี/บัญชี/วันที่ใหม่ ยอดเท่าเดิม — ใช้หลัง undo ในการ "แก้ไขวิธีจ่าย"
 * คืน refId ของการจ่ายครั้งใหม่ (ขาการจ่ายบิลได้ id ใหม่ ชนิดอื่นใช้ id เดิม)
 */
async function repay(row, { method, accountId, date }) {
  const s = stores()
  const amount = Number(row.amount)
  const log = logEntry('PAYMENT_EDIT', row,
    `แก้ไขวิธีจ่าย "${row.title}" ${fmt(amount)} บาท → ${sourceName(method, accountId)} วันที่ ${formatIsoThai(date)}`,
    { newValue: { method, accountId, date, amount } })

  if (row.kind === 'card_bill') {
    if (row.legacy) {
      await s.card.payStatement(row.ref.id, { method, accountId, amount, date, log })
      return newestLegId(row.ref.id, amount)
    }
    const leg = legOf(row)
    if (leg.statementId) {
      await s.card.payStatement(leg.statementId, { method, accountId, amount, date, log, transactionId: leg.transactionId ?? null })
      return newestLegId(leg.statementId, amount)
    }
    const newLeg = await s.card.prepayTransaction(leg.transactionId, { method, accountId, amount, date, log })
    return newLeg?.id ?? null
  }
  if (row.kind === 'card_installment') {
    await s.card.payEntry(row.ref.id, { method, accountId, amount, paidAt: new Date(`${date}T12:00:00`).toISOString(), log })
    return row.refId
  }
  if (row.kind === 'debt') {
    await s.debt.payEntry(row.ref.id, { method, accountId, amount, date, log })
    return row.refId
  }
  if (row.kind === 'pending') {
    await s.pending.payPendingAtomic(row.ref.id, { method, accountId, date, log })
    return row.refId
  }
  if (row.kind === 'recurring') {
    // ทางเดียวกับหน้ารายการประจำ: รายจ่าย + ตัดเงิน + log จบใน RPC เดียว แล้วผูกรอบ
    const e = row.ref
    const item = s.recurring.items.find((i) => i.id === e.recurringId)
    const target = walletTarget(method, { transferAccountId: accountId })
    if (!target) throw new Error('กรุณาเลือกบัญชีเงินโอน')
    const tx = await s.tx.addTransaction({
      type: 'expense', date, amount, category: item?.category ?? null, method,
      ...(accountId ? { transferAccountId: accountId } : {}),
      itemName: item?.name ?? row.title, vendor: item?.vendor ?? null, note: item?.note ?? null,
      recurringEntryId: e.id,
    }, { effect: { target, delta: -amount }, log })
    await s.recurring.updateEntry(e.id, {
      status: 'paid', amount, paidMethod: method, transferAccountId: accountId ?? null, cardId: null,
      paidAt: new Date(`${date}T12:00:00`).toISOString(), transactionId: tx?.id ?? null, pendingPaymentId: null,
    })
    return row.refId
  }
  throw new Error('ยังไม่รองรับการแก้ไขของรายการชนิดนี้')
}

/** ขาล่าสุดของใบ (หลัง refresh) — pay_card_statement คืนใบ ไม่คืนขา จึงต้องหาเอง */
function newestLegId(statementId, amount) {
  const legs = useCreditCardStore.getState().statementPayments
    .filter((l) => l.statementId === statementId && Math.abs(Number(l.amount) - amount) < 0.005)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  return legs[0]?.id ?? null
}

/**
 * แก้ไขวิธีจ่าย = ย้อน แล้วจ่ายใหม่ยอดเดิม แล้วย้ายสลิป (ถ้ามี) ไปอยู่กับการจ่ายครั้งใหม่
 * ถ้าขั้นจ่ายใหม่ล้ม การย้อนไปแล้วไม่ถูกดึงกลับ — รายการจะค้างเป็น "ยังไม่จ่าย"
 * ซึ่งเห็นได้ชัดและกดจ่ายซ้ำได้ ดีกว่าพยายามย้อนซ้อนแล้วได้สถานะที่ไม่มีใครรู้ว่าอยู่ตรงไหน
 */
export async function editPaymentRow(row, params) {
  if (!params.method) throw new Error('เลือกวิธีจ่าย')
  if (params.method === 'transfer' && !params.accountId) throw new Error('เลือกบัญชีเงินโอน')
  if (!params.date) throw new Error('เลือกวันที่จ่าย')
  // เงินสดไม่มีบัญชี — ไม่ส่ง id บัญชีที่ค้างจากฟอร์มติดไปให้ RPC ตีความ
  params = { ...params, accountId: params.method === 'transfer' ? params.accountId : null }
  const plan = undoPlan(row)
  if (!plan.ok) throw new Error(plan.reason)

  const s = stores()
  const slip = row.slip
  // ย้อนโดยไม่ลบสลิป (ต่างจาก undoPaymentRow) เพราะจะย้ายไปครั้งใหม่
  const undoLog = logEntry('PAYMENT_UNDO', row, `ย้อนเพื่อแก้ไขวิธีจ่าย "${row.title}" ${fmt(row.amount)} บาท`)
  if (row.kind === 'card_bill') {
    if (row.legacy) await s.card.undoPayment(row.ref.id, row.amount, undoLog)
    else {
      const leg = legOf(row)
      if (leg.statementId) await s.card.undoPaymentLeg(leg.id, undoLog)
      else await s.card.undoPrepayment(leg.id, undoLog)
    }
  } else if (row.kind === 'card_installment') await s.card.undoEntry(row.ref.id, undoLog)
  else if (row.kind === 'debt') await s.debt.undoEntry(row.ref.id, undoLog)
  else if (row.kind === 'pending') await s.pending.undoPendingPayment(row.ref.id, undoLog)
  else if (row.kind === 'recurring') await s.recurring.undoEntryPayment(row.ref.id, undoLog)

  let newRefId = null
  try {
    newRefId = await repay(row, params)
  } finally {
    await refreshFor(row.kind)
  }

  if (slip && newRefId && newRefId !== row.refId) {
    await s.slip.save({ kind: row.kind, refId: newRefId, paidAt: `${params.date}T12:00:00`, attachments: slip.attachments, note: slip.note })
    try { await s.slip.remove(slip.id) } catch { /* ของเก่าหายไปเองก็ได้ */ }
  }
  return newRefId
}
