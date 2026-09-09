/**
 * ตัวช่วยแปลงค่าให้อ่านออกในหน้าแอดมิน — รวมไว้ที่เดียวเพื่อให้ทุกหน้าพูดภาษาเดียวกัน
 * (ที่อื่นในแอปใช้ lib/dateUtils แต่หน้านี้ต้องแสดง "วันหมดอายุ" กับ "เหลือกี่วัน"
 *  ซึ่งเป็นแนวคิดที่มีเฉพาะฝั่งแอดมิน)
 */

export const STATUS_LABEL = {
  trial: 'ทดลองใช้',
  active: 'ใช้งานอยู่',
  suspended: 'ถูกระงับ',
  closed: 'ปิดบัญชี',
}

/** สีของป้ายสถานะ — ร้านที่หมดอายุแล้วต้องเป็นสีแดงถึงจะเห็นจากอีกฝั่งของตาราง */
export function statusTone(shop) {
  if (shop.status === 'closed') return 'bg-hairline text-muted'
  if (shop.status === 'suspended') return 'bg-expense-soft text-expense'
  if (!shop.isOpen) return 'bg-expense-soft text-expense'
  if (shop.status === 'trial') return 'bg-pending-soft text-pending'
  return 'bg-income-soft text-income'
}

export function statusText(shop) {
  if (!shop.isOpen && (shop.status === 'trial' || shop.status === 'active')) return 'หมดอายุแล้ว'
  return STATUS_LABEL[shop.status] ?? shop.status
}

export function thaiDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function thaiDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** ข้อความบอกอายุที่เหลือ — เขียนเป็นคำ ไม่ใช่ตัวเลขดิบ จะได้ตัดสินใจได้ทันทีที่กวาดตา */
export function expiryText(shop) {
  if (!shop.expiresAt) return 'ไม่มีวันหมดอายุ'
  const days = Math.ceil((new Date(shop.expiresAt).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return `หมดอายุแล้ว ${Math.abs(days)} วัน`
  if (days === 0) return 'หมดอายุวันนี้'
  return `เหลือ ${days} วัน (ถึง ${thaiDate(shop.expiresAt)})`
}

/** ISO ของ "สิ้นวัน" ตามเวลาไทย — ใช้ตอนแอดมินเลือกวันหมดอายุจากปฏิทิน */
export function endOfDayIso(dateStr) {
  if (!dateStr) return null
  return new Date(`${dateStr}T23:59:59+07:00`).toISOString()
}

/** yyyy-mm-dd สำหรับใส่ใน <input type="date"> */
export function toDateInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ACTION_LABEL = {
  VIEW_SHOP: 'เปิดดูข้อมูลลูกค้า',
  SET_ACCESS: 'เปลี่ยนสถานะ/วันหมดอายุ',
  EXTEND: 'ต่ออายุ',
  RESET_REQ: 'จัดการคำขอรหัสผ่าน',
}

export const actionLabel = (a) => ACTION_LABEL[a] ?? a
