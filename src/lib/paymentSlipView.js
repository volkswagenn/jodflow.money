import { getAttachments } from '../components/shared/AttachmentViewer'
import { PAYMENT_KINDS } from '../hooks/usePaymentHistory'
import { formatIsoThai } from './cardCycle'

/**
 * '2026-09-06T13:45:00' → '6 ก.ย. 2569 13:45'
 *
 * ค่าที่เก็บมามีสองแบบ: บางตารางเก็บเป็นวันที่ล้วน ('2026-09-05') บางตารางเก็บ
 * เวลาเต็ม การเอาวันที่ล้วนไปแปลงเป็นเวลาจะได้เวลาปลอมตามโซนเวลา (07:00)
 * จึงดูจากรูปแบบของค่าที่เก็บ ไม่ใช่จากผลการแปลง
 * และเวลาเที่ยงตรงคือค่าตั้งต้นตอนผู้ใช้เลือกแค่วันที่ ไม่ใช่เวลาจ่ายจริง จึงไม่โชว์
 */
export function whenText(value) {
  if (!value) return '—'
  const hasTime = typeof value === 'string' && value.includes('T')
  if (!hasTime) return formatIsoThai(value)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return formatIsoThai(value)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return time === '12:00' ? formatIsoThai(day) : `${formatIsoThai(day)} ${time}`
}

/** แถวของ usePaymentHistory → สิ่งที่ SlipViewerPopup แสดง */
export function paymentViewerItem(row) {
  const files = getAttachments(row.slip)
  const uploadedAt = files[0]?.uploadedAt
  return {
    key: row.key,
    title: row.title,
    kindLabel: PAYMENT_KINDS[row.kind]?.label ?? '',
    amount: row.amount,
    incoming: !!row.incoming,
    facts: [
      ['จ่ายเมื่อ', whenText(row.paidAt)],
      [row.incoming ? 'เข้ากระเป๋า' : 'ตัดจาก', row.source || '—'],
      ['รายละเอียด', row.detail || '—'],
      ...(uploadedAt ? [['แนบเมื่อ', whenText(uploadedAt)]] : []),
    ],
    files,
    row,
  }
}

/** ชื่อสั้นบนปุ่มในแถว — บอกว่าไฟล์นี้คืออะไรก่อนกดเปิด */
export function fileShortLabel(file) {
  if (file?.type === 'slip') return 'สลิป'
  if (file?.type === 'taxinvoice') return 'ใบกำกับ'
  return 'ใบเสร็จ'
}
