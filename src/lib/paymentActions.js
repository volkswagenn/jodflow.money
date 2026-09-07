import useCreditCardStore from '../store/useCreditCardStore'
import useDebtStore from '../store/useDebtStore'
import usePendingStore from '../store/usePendingStore'
import useRecurringStore from '../store/useRecurringStore'
import useWalletStore from '../store/useWalletStore'
import useTransactionStore from '../store/useTransactionStore'
import usePaymentSlipStore from '../store/usePaymentSlipStore'
import useLogStore from '../store/useLogStore'
import { buildLogEntry } from './logBuilder'
import { formatIsoThai } from './cardCycle'
import { toTimestamp } from '../components/shared/DateTimeField'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * แก้ไข / ยกเลิก "การจ่ายหนึ่งครั้ง" จากหน้าประวัติการจ่าย
 *
 * การจ่ายในระบบอยู่กระจายห้าตาราง (บิลบัตร ค่างวดผ่อน งวดหนี้ ค้างชำระ รายการประจำ)
 * แต่ละชนิดมีกติกาเงินคนละแบบ — ที่นี่รวมเป็นสองคำสั่ง: edit กับ undo โดยยึดกฎเดียวกัน
 *
 *   แก้ไข  = แก้ "ในที่" คำสั่งเดียวจบ: ฐานข้อมูลคืนเงินเข้ากระเป๋าเดิม ตัดจากกระเป๋าใหม่
 *            ปรับยอดบิล/หนี้ตามส่วนต่าง แล้วแก้วันที่/ยอด/วิธี — id ของการจ่ายคงเดิม
 *            สลิป ติ๊ก "จ่ายให้รายการนี้" และประวัติจึงอยู่ครบ ไม่มีจังหวะที่รายการกลายเป็น
 *            "ยังไม่จ่าย" และถ้าล้มตรงไหนทั้งก้อนย้อนกลับเอง
 *            (โปรแกรมบัญชีใหญ่ๆ บังคับให้ลบแล้วบันทึกใหม่ ซึ่งเป็นคำบ่นอันดับต้นๆ ของผู้ใช้
 *             ที่นี่ทำแบบแก้ในที่ แต่เก็บค่าก่อน/หลังไว้ในประวัติทั้งหมดให้ตรวจสอบย้อนหลังได้)
 *   ยกเลิก = เงินกลับเข้ากระเป๋าที่ตัดมาจริง ของที่ถูกทำเครื่องหมายว่าจ่ายแล้วกลับเป็น
 *            ยังไม่จ่าย ติ๊กบนบิลหาย สลิปถูกลบ
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

/** 'YYYY-MM-DD' ตามเวลาเครื่อง จากค่าที่เป็นวันล้วนหรือเวลาเต็ม */
const dayOf = (v) => {
  if (!v) return null
  if (typeof v === 'string' && !v.includes('T')) return v.slice(0, 10)
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** 'HH:mm' จากเวลาเต็ม — เที่ยงตรงคือค่าตั้งต้นของ "ไม่รู้เวลา" จึงถือว่าว่าง */
const timeOf = (v) => {
  if (!v || typeof v !== 'string' || !v.includes('T')) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return t === '12:00' ? '' : t
}

/**
 * แผนการยกเลิก — ตอบว่า "ย้อนได้ไหม" และ "จะเกิดอะไรขึ้นบ้าง" เป็นบรรทัดภาษาคน
 * ใช้ทั้งปิดปุ่ม (พร้อมเหตุผล) และเป็นข้อความยืนยันก่อนกด — ผู้ใช้ต้องรู้ทุกอย่างที่จะ
 * ถูกย้ายกลับก่อนกด ไม่ใช่มารู้ทีหลังว่าติ๊กหาย
 */
export function undoPlan(row) {
  const lines = []
  const money = (src) => (row.incoming
    ? `ถอน ${fmt(row.amount)} บาท ออกจาก${src} (เงินที่รับมาต้องออกไป)`
    : `คืน ${fmt(row.amount)} บาท เข้า${src}`)
  const slipLine = row.slip?.attachments?.length ? 'สลิปที่แนบไว้กับการจ่ายนี้จะถูกลบ' : null

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

/**
 * แผนการแก้ไข — แก้ได้ไหม แก้ช่องไหนได้บ้าง และค่าปัจจุบันสำหรับเติมฟอร์ม
 *   amount  แก้ยอดได้ไหม (รายการค้างชำระยอดคือยอดของรายการ · บิลเก่าไม่มีขาแก้ยอดไม่ได้)
 *   time    เก็บเวลาไหม (บิลบัตรกับงวดหนี้เก็บเป็นวันล้วน)
 *   maxAmount เพดานยอด (ขาที่จ่ายก่อนออกบิลห้ามเกินยอดรายการ)
 */
export function editPlan(row) {
  const base = { ok: true, amount: true, time: false, maxAmount: null }
  const cur = (method, accountId, amount = row.amount) => ({
    method: method === 'transfer' ? 'transfer' : 'cash',
    accountId: method === 'transfer' ? (accountId ?? null) : null,
    amount: Number(amount),
    date: row.day ?? dayOf(row.paidAt),
    time: timeOf(row.paidAt),
    note: row.slip?.note ?? '',
  })

  if (row.kind === 'card_bill') {
    const st = row.ref
    if (st?.carriedTo) return { ok: false, reason: 'ใบนี้ถูกยกยอดไปรวมในบิลรอบถัดไปแล้ว แก้ได้ที่บิลใบล่าสุดในหน้าบัตรเท่านั้น' }
    if (row.legacy) return { ...base, amount: false, current: cur(st?.paidMethod, st?.transferAccountId) }
    const leg = legOf(row)
    if (!leg) return { ok: false, reason: 'ไม่พบขาการจ่ายนี้แล้ว (อาจถูกย้อนไปก่อนหน้า) — รีเฟรชหน้า' }
    let maxAmount = null
    if (!leg.statementId) {
      const tx = useTransactionStore.getState().transactions.find((t) => t.id === leg.transactionId)
      if (!tx) return { ok: false, reason: 'รายการที่จ่ายให้ถูกลบไปแล้ว แก้ไขไม่ได้' }
      const others = useCreditCardStore.getState().statementPayments
        .filter((l) => l.transactionId === leg.transactionId && !l.statementId && l.id !== leg.id)
        .reduce((n, l) => n + Number(l.amount), 0)
      maxAmount = Number(tx.amount) - others
    }
    return { ...base, maxAmount, current: cur(leg.method, leg.transferAccountId, leg.amount) }
  }
  if (row.kind === 'card_installment') {
    const e = row.ref
    if (!e.paidMethod) return { ok: false, reason: 'งวดนี้จ่ายรวมในบิลบัตร ให้แก้ที่การจ่ายบิลใบนั้นแทน' }
    return { ...base, time: true, current: cur(e.paidMethod, e.transferAccountId, e.paidAmount ?? e.amount) }
  }
  if (row.kind === 'debt') {
    const e = row.ref
    if (!e.paidMethod) return { ok: false, reason: 'งวดนี้ไม่ได้บันทึกว่าจ่ายจากกระเป๋าไหน ระบบย้ายเงินให้ไม่ได้' }
    return { ...base, current: cur(e.paidMethod, e.transferAccountId, e.amount) }
  }
  if (row.kind === 'pending') {
    const p = row.ref
    if (!p.paidMethod) return { ok: false, reason: 'รายการนี้ไม่ได้บันทึกว่าจ่ายจากกระเป๋าไหน ระบบย้ายเงินให้ไม่ได้' }
    return { ...base, amount: false, time: true, current: cur(p.paidMethod, p.transferAccountId, p.amount) }
  }
  if (row.kind === 'recurring') {
    const e = row.ref
    if (e.pendingPaymentId) {
      return { ok: false, reason: 'รอบนี้ถูกจ่ายผ่าน "รายการค้างชำระ" — ให้แก้ที่แถวของรายการค้างชำระนั้นแทน (แท็บ รายการค้างชำระ)' }
    }
    if (!e.paidMethod && !e.transactionId) return { ok: false, reason: 'รอบนี้ไม่ได้บันทึกว่าจ่ายจากกระเป๋าไหน ระบบย้ายเงินให้ไม่ได้' }
    return { ...base, time: true, current: cur(e.paidMethod, e.transferAccountId, e.amount) }
  }
  return { ok: false, reason: 'ยังไม่รองรับการแก้ไขของรายการชนิดนี้' }
}

const sameMoney = (a, b) =>
  a.method === b.method && (a.accountId ?? null) === (b.accountId ?? null) && Math.abs(Number(a.amount) - Number(b.amount)) < 0.005
const sameWhen = (a, b, withTime) => a.date === b.date && (!withTime || (a.time || '') === (b.time || ''))

/**
 * บอกล่วงหน้าว่ากดบันทึกแล้วระบบจะทำอะไรให้บ้าง — โชว์ใต้ฟอร์มตลอดเวลาที่แก้
 * คืน [] เมื่อยังไม่มีอะไรเปลี่ยน
 */
export function describeEdit(row, form, plan) {
  const cur = plan.current
  const lines = []
  const verbIn = row.incoming ? 'ถอน' : 'คืน'
  const verbOut = row.incoming ? 'รับเข้า' : 'ตัดจาก'
  const srcChanged = cur.method !== form.method || (cur.accountId ?? null) !== (form.accountId ?? null)
  const amtChanged = plan.amount && Math.abs(Number(cur.amount) - Number(form.amount)) > 0.005
  if (srcChanged || amtChanged) {
    lines.push(`${verbIn} ${fmt(cur.amount)} บาท ${row.incoming ? 'ออกจาก' : 'เข้า'}${sourceName(cur.method, cur.accountId)} → ${verbOut}${sourceName(form.method, form.accountId)} ${fmt(form.amount)} บาท`)
    if (amtChanged && row.kind === 'card_bill') {
      const d = Number(form.amount) - Number(cur.amount)
      lines.push(d > 0 ? `ยอดที่จ่ายบิลเพิ่มขึ้น ${fmt(d)} (หนี้บัตรลดลงเท่ากัน)` : `ยอดที่จ่ายบิลลดลง ${fmt(-d)} (หนี้บัตรเพิ่มขึ้นเท่ากัน)`)
    }
  }
  if (!sameWhen(cur, form, plan.time)) {
    lines.push(`วันที่จ่ายเปลี่ยนเป็น ${formatIsoThai(form.date)}${plan.time && form.time ? ` ${form.time} น.` : ''}`)
  }
  if ((form.note ?? '') !== (cur.note ?? '')) lines.push(form.note ? 'บันทึกเพิ่มเติมถูกอัปเดต' : 'ลบบันทึกเพิ่มเติม')
  return lines
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

/** ยกเลิกการจ่ายหนึ่งครั้ง — คืนเงิน คืนสถานะ ลบสลิป */
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
 * แก้ไขการจ่ายในที่ — คำสั่งเดียวต่อชนิด ฐานข้อมูลย้ายเงินให้เอง
 * form = { method, accountId, amount, date, time, note }
 * แตะเฉพาะส่วนที่เปลี่ยน: เงิน/วันที่ไม่เปลี่ยนก็ไม่เรียก RPC (แก้แค่บันทึกเพิ่มเติมได้)
 * คืนบรรทัดสรุปว่าทำอะไรไปบ้าง
 */
export async function editPaymentRow(row, form) {
  const plan = editPlan(row)
  if (!plan.ok) throw new Error(plan.reason)
  if (!form.method) throw new Error('เลือกวิธีจ่าย')
  if (form.method === 'transfer' && !form.accountId) throw new Error('เลือกบัญชีเงินโอน')
  if (!form.date) throw new Error('เลือกวันที่จ่าย')
  const amount = plan.amount ? Number(form.amount) : Number(plan.current.amount)
  if (!(amount > 0)) throw new Error('จำนวนเงินต้องมากกว่าศูนย์')
  if (plan.maxAmount != null && amount > plan.maxAmount + 0.005) {
    throw new Error(`จ่ายเกินยอดของรายการ — ใส่ได้ไม่เกิน ${fmt(plan.maxAmount)} บาท`)
  }
  // เงินสดไม่มีบัญชี — ไม่ส่ง id บัญชีที่ค้างจากฟอร์มติดไปให้ RPC ตีความ
  const next = { method: form.method, accountId: form.method === 'transfer' ? form.accountId : null, amount, date: form.date, time: form.time || '' }
  const lines = describeEdit(row, { ...next, note: form.note ?? '' }, plan)
  if (lines.length === 0) return []

  const s = stores()
  const cur = plan.current
  const moneyOrWhenChanged = !sameMoney(cur, next) || !sameWhen(cur, next, plan.time)
  const paidAt = toTimestamp(next.date, plan.time ? next.time : '')

  if (moneyOrWhenChanged) {
    const log = logEntry('PAYMENT_EDIT', row,
      `แก้ไขรายการจ่าย "${row.title}" — ${lines.join(' · ')}`,
      {
        oldValue: { kind: row.kind, refId: row.refId, method: cur.method, accountId: cur.accountId, amount: cur.amount, date: cur.date, time: cur.time },
        newValue: { kind: row.kind, refId: row.refId, ...next },
      })
    if (row.kind === 'card_bill') {
      if (row.legacy) await s.card.editStatementPayment(row.ref.id, { method: next.method, accountId: next.accountId, date: next.date, log })
      else await s.card.editPaymentLeg(row.refId, { method: next.method, accountId: next.accountId, amount, date: next.date, log })
    } else if (row.kind === 'card_installment') {
      await s.card.editEntryPayment(row.ref.id, { method: next.method, accountId: next.accountId, amount, paidAt, log })
    } else if (row.kind === 'debt') {
      await s.debt.editEntryPayment(row.ref.id, { method: next.method, accountId: next.accountId, amount, date: next.date, log })
    } else if (row.kind === 'pending') {
      await s.pending.editPendingPayment(row.ref.id, { method: next.method, accountId: next.accountId, paidAt, log })
    } else if (row.kind === 'recurring') {
      await s.recurring.editEntryPayment(row.ref.id, { method: next.method, accountId: next.accountId, amount, paidAt, log })
    }
  }

  // บันทึกเพิ่มเติมอยู่กับสลิป (แถวสลิปมีได้แม้ไม่มีไฟล์) — id การจ่ายคงเดิม สลิปไม่ต้องย้าย
  const note = (form.note ?? '').trim()
  const noteChanged = note !== (cur.note ?? '')
  if (noteChanged || (row.slip && moneyOrWhenChanged)) {
    if (row.slip || note) {
      await s.slip.save({ kind: row.kind, refId: row.refId, paidAt, attachments: row.slip?.attachments ?? [], note: note || null })
    }
  }

  await refreshFor(row.kind)
  return lines
}
