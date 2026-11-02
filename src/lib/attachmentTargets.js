import { getAttachments } from '../components/shared/AttachmentViewer'
import { buildLogEntry } from './logBuilder'
import usePaymentSlipStore from '../store/usePaymentSlipStore'
import usePendingStore from '../store/usePendingStore'
import useTransactionStore from '../store/useTransactionStore'
import useLogStore from '../store/useLogStore'

/**
 * "สิ่งที่แนบไฟล์ได้" — หน้าต่างจัดการไฟล์ตัวเดียวใช้กับทุกชนิด ไม่ต้องรู้ว่าไฟล์เก็บที่ตารางไหน
 *
 * แก้ไฟล์แนบต้องไม่แตะเงินเด็ดขาด รายการเงินจึงส่งเฉพาะช่องไฟล์เข้า edit_transaction
 * โดยไม่มีคำสั่งย้อน/ตัดเงิน ส่วนตัวไฟล์บน Storage ไม่ถูกลบ เพราะรายการค้างจ่ายที่จ่ายแล้ว
 * ใช้ไฟล์เดียวกับรายการจ่าย และประวัติเก็บพาธเดิมไว้ เผื่อต้องตามกลับ
 */
export const slipTarget = (row) => ({
  kind: 'slip', record: row, title: row.title, amount: row.amount, createdAt: row.paidAt,
})
export const pendingTarget = (p) => ({
  kind: 'pending', record: p, title: p.description ?? p.itemName ?? 'รายการค้างจ่าย', amount: p.amount, createdAt: p.createdAt,
})
export const incomeTarget = (p) => ({
  kind: 'income', record: p, title: p.description ?? p.itemName ?? 'รายการรอรับเงิน', amount: p.amount, createdAt: p.createdAt,
})
export const txTarget = (tx) => ({
  kind: 'tx', record: tx, title: tx.itemName || 'รายการ', amount: tx.amount, createdAt: tx.date,
})

const slipOf = (row) => usePaymentSlipStore.getState().getSlip(row.kind, row.refId)

/** ไฟล์ปัจจุบัน — อ่านจาก store เสมอ แถวที่หน้าจอถือไว้อาจเก่าไปแล้ว */
export function targetFiles({ kind, record }) {
  if (kind === 'slip') return getAttachments(slipOf(record))
  if (kind === 'pending') return getAttachments(usePendingStore.getState().pendingPayments.find((p) => p.id === record.id) ?? record)
  if (kind === 'income') return getAttachments(usePendingStore.getState().pendingIncomes.find((p) => p.id === record.id) ?? record)
  return getAttachments(useTransactionStore.getState().transactions.find((t) => t.id === record.id) ?? record)
}

// ช่อง document_* คือไฟล์ใบแรกที่หน้าจอรุ่นเก่าอ่าน — ลบไฟล์หมดแล้วต้องล้างด้วย
// ไม่งั้น getAttachments จะถอยไปอ่านช่องนี้แล้วไฟล์ที่ลบไปกลับมาโผล่อีก
const docFields = (files) => ({
  attachments: files,
  documentPath: files[0]?.path ?? null,
  documentType: files[0]?.type ?? null,
  documentLabel: files[0]?.label ?? null,
})

const refOf = ({ kind, record }) => {
  if (kind === 'slip') return { kind: record.kind, refId: record.refId }
  if (kind === 'pending') return { pendingId: record.id }
  if (kind === 'income') return { pendingIncomeId: record.id }
  return { transactionId: record.id }
}

/**
 * บันทึกรายการไฟล์ใหม่ทั้งชุด
 * @param prev ไฟล์ก่อนแก้ — เก็บลงประวัติ ถ้าลบหรือเปลี่ยนผิดยังตามพาธเดิมกลับได้
 */
export async function saveTargetFiles(target, files, { prev = [], action, isAdd = false }) {
  const { kind, record } = target
  const log = buildLogEntry({
    activityType: kind === 'slip' && isAdd ? 'ATTACH_PAYMENT_SLIP' : 'ATTACHMENT_EDIT',
    description: `${action} — "${target.title}"`,
    oldValue: { files: prev.map((f) => f.path) },
    newValue: { ...refOf(target), files: files.length },
  })

  if (kind === 'tx') {
    // log ลง RPC เดียวกับการแก้ — สำเร็จหรือล้มไปด้วยกัน
    await useTransactionStore.getState().editTransaction(record.id, docFields(files), { log })
    await usePendingStore.getState().syncPendingByTxId(record.id, docFields(files))
    return
  }

  if (kind === 'slip') {
    const slip = slipOf(record)
    const store = usePaymentSlipStore.getState()
    if (files.length > 0 || slip?.note) {
      await store.save({ kind: record.kind, refId: record.refId, paidAt: record.paidAt, attachments: files, note: slip?.note ?? null })
    } else if (slip) {
      await store.remove(slip.id)
    }
  } else if (kind === 'pending') {
    await usePendingStore.getState().updatePendingById(record.id, docFields(files))
    // รายการค้างแบบเก่าผูกกับรายการเงินอยู่แล้ว ไฟล์ทั้งสองฝั่งต้องตรงกัน
    if (record.transactionId && useTransactionStore.getState().transactions.some((t) => t.id === record.transactionId)) {
      await useTransactionStore.getState().editTransaction(record.transactionId, docFields(files))
    }
  } else {
    await usePendingStore.getState().updatePendingIncomeById(record.id, docFields(files))
  }
  await useLogStore.getState().addLog(log)
}
