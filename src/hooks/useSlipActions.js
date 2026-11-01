import usePaymentSlipStore from '../store/usePaymentSlipStore'
import useLogStore from '../store/useLogStore'
import { buildLogEntry } from '../lib/logBuilder'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/** แนบ / เปลี่ยน / เอาสลิปออกจากการจ่ายที่มีอยู่แล้ว — ใช้ร่วมกันทุกหน้าประวัติ */
export default function useSlipActions() {
  const save = usePaymentSlipStore((s) => s.save)
  const remove = usePaymentSlipStore((s) => s.remove)
  const addLog = useLogStore((s) => s.addLog)

  const attachPaths = async (row, paths) => {
    const attachments = paths.map((path, i) => ({
      path, type: 'slip', label: paths.length > 1 ? `สลิป ${i + 1}` : 'สลิปโอนเงิน',
      uploadedAt: new Date().toISOString(),
    }))
    // เปลี่ยนไฟล์ต้องไม่ลบบันทึกเพิ่มเติมที่อยู่แถวเดียวกัน
    await save({ kind: row.kind, refId: row.refId, paidAt: row.paidAt, attachments, note: row.slip?.note ?? null })
    await addLog(buildLogEntry({
      activityType: 'ATTACH_PAYMENT_SLIP',
      description: `แนบสลิปการจ่าย "${row.title}" ${fmt(row.amount)} บาท`,
      newValue: { kind: row.kind, refId: row.refId, files: paths.length },
    }))
    return attachments
  }

  const dropSlip = async (row) => {
    if (row.slip?.id) await remove(row.slip.id)
  }

  return { attachPaths, dropSlip }
}
