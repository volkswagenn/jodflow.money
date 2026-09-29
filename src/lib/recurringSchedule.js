/**
 * รอบของรายการประจำ
 *   monthly = เรียกเก็บทุกเดือน วันที่ billingDay
 *   yearly  = เรียกเก็บปีละครั้ง เดือน billingMonth วันที่ billingDay
 *
 * รายการเก่าที่ไม่มี frequency ถือเป็นรายเดือน
 */

export const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const THAI_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

export const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: '🗓️ รายเดือน', desc: 'เรียกเก็บทุกเดือน' },
  { value: 'yearly', label: '📆 รายปี', desc: 'เรียกเก็บปีละครั้ง' },
]

export const isYearly = (item) => item?.frequency === 'yearly'

/** รายการนี้ต้องมี entry ในเดือน (1–12) นี้ไหม */
export function occursInMonth(item, month) {
  if (!isYearly(item)) return true
  return Number(item.billingMonth) === Number(month)
}

/** ข้อความสั้นบอกรอบ เช่น "ทุกวันที่ 4" / "ทุก 4 ม.ค. ของทุกปี" */
export function scheduleLabel(item, { short = false } = {}) {
  if (!isYearly(item)) return short ? `ทุกวันที่ ${item.billingDay}` : `ทุกวันที่ ${item.billingDay} ของเดือน`
  const m = THAI_MONTHS_SHORT[(Number(item.billingMonth) || 1) - 1]
  return short ? `${item.billingDay} ${m} ทุกปี` : `ทุกวันที่ ${item.billingDay} ${m} ของทุกปี`
}

// ── VAT ─────────────────────────────────────────────────────────────────────

//
// มี 3 แบบ เพราะใบเรียกเก็บจริงมาได้ทั้งสองหน้า
//   none     ยอดที่กรอกคือยอดสุทธิ ไม่เกี่ยวกับภาษี (ค่าตั้งต้น)
//   included ยอดที่กรอกรวม VAT มาแล้ว — ใช้ตอนกรอกตามยอดที่ถูกเรียกเก็บมาเป๊ะๆ
//            ระบบถอดฐานภาษีให้ดูได้ แต่ยอดที่ต้องจ่ายเท่ากับที่กรอก
//   add      ยอดที่กรอกยังไม่รวม VAT ระบบบวกให้ตอนออกบิล
//
// fixedAmount เก็บ "ตัวเลขที่ผู้ใช้กรอก" เสมอไม่ว่าโหมดไหน การสลับโหมดจึงไม่ทำให้
// ยอดเพี้ยนหรือบวกซ้อนกัน ยอดที่ต้องจ่ายให้อ่านจาก billedAmount() ทุกที่

/** อัตรา VAT มาตรฐานของไทย เก็บเป็นตัวเลขในฐานข้อมูลเผื่อวันหน้าเปลี่ยน */
export const VAT_RATE = 7

export const VAT_MODES = [
  { value: 'none', label: 'ไม่มี VAT', desc: 'ยอดตามที่กรอก' },
  { value: 'included', label: 'รวม VAT แล้ว', desc: 'แยกฐานภาษีให้' },
  { value: 'add', label: 'บวก VAT', desc: `เพิ่ม ${VAT_RATE}% จากยอด` },
]

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * โหมด VAT ของรายการ
 * รายการเก่าที่มีแต่ vatRate ให้ถือเป็น add เพราะตอนนั้นมีความหมายเดียวคือบวกเพิ่ม
 */
export function vatMode(item) {
  const mode = item?.vatMode
  if (mode === 'none' || mode === 'included' || mode === 'add') return mode
  return Number(item?.vatRate ?? 0) > 0 ? 'add' : 'none'
}

export const hasVat = (item) => vatMode(item) !== 'none'

/** ยอดที่ต้องจ่ายจริง — มีแต่โหมด add เท่านั้นที่ยอดโตขึ้นจากที่กรอก */
export function billedAmount(item) {
  const base = Number(item?.fixedAmount ?? 0)
  const rate = Number(item?.vatRate ?? VAT_RATE)
  return round2(vatMode(item) === 'add' ? base * (1 + rate / 100) : base)
}

/** แยกยอดเป็นฐานภาษี / VAT / ยอดที่ต้องจ่าย ใช้แสดงรายละเอียดในฟอร์มและการ์ด */
export function vatBreakdown(amount, mode, rate = VAT_RATE) {
  const n = Number(amount) || 0
  const r = Number(rate) || 0
  if (mode === 'add') {
    const vat = round2(n * (r / 100))
    return { base: round2(n), vat, total: round2(n + vat) }
  }
  if (mode === 'included') {
    const base = round2(n / (1 + r / 100))
    return { base, vat: round2(n - base), total: round2(n) }
  }
  return { base: round2(n), vat: 0, total: round2(n) }
}

/** ป้ายสั้นสำหรับการ์ด เช่น "รวม VAT 7%" */
export function vatLabel(item) {
  const mode = vatMode(item)
  const rate = Number(item?.vatRate ?? VAT_RATE)
  if (mode === 'add') return `+VAT ${rate}%`
  if (mode === 'included') return `รวม VAT ${rate}%`
  return ''
}

// ── พักการเรียกเก็บชั่วคราว ─────────────────────────────────────────────────
//
// ต่างจากการปิดใช้งาน
//   พัก     = มีกำหนด ครบแล้วกลับมาเรียกเก็บเอง ระหว่างพักยังเห็นการ์ดอยู่
//   ปิดใช้  = ไม่มีกำหนด หายไปจากทุกหน้า จนกว่าจะกดเปิดเอง
//
// เก็บเป็นเดือนไม่ใช่วัน เพราะรอบเรียกเก็บเป็นรายเดือน การพัก "ครึ่งเดือน"
// ไม่มีความหมายกับบิลที่ออกเดือนละครั้ง

const monthOf = (d) => (d ? String(d).slice(0, 7) : null)

/** จำนวนเดือนจาก a ถึง b (รูปแบบ 'YYYY-MM') */
export function monthDiff(a, b) {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

/** เลื่อนเดือนไปข้างหน้า n เดือน คืนรูปแบบ 'YYYY-MM' */
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number)
  const total = (y * 12 + (m - 1)) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export const monthFirstDay = (month) => `${month}-01`

/** '6 ก.ย.' ตามเวลาไทย — บอกวันที่จ่าย/วันที่กดข้ามบนแถวที่ขีดฆ่าแล้ว */
export function shortThaiDate(iso) {
  if (!iso) return ''
  const s = String(iso)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`
}

/** เดือนถัดจากรอบนี้แบบสั้น เช่น 'ต.ค.' — ใช้บนป้ายนับถอยหลังและปุ่ม "ไป … เลย" */
export function nextMonthShort(month) {
  const m = Number(addMonths(month, 1).split('-')[1])
  return THAI_MONTHS_SHORT[m - 1]
}

/**
 * รายการนี้ถูกพักอยู่ในเดือนที่ระบุไหม
 * @returns null ถ้าไม่ได้พัก หรือ { resumeMonth, totalMonths, monthsLeft }
 */
export function pauseInfo(item, month) {
  const resume = monthOf(item?.pausedUntil)
  if (!resume || month >= resume) return null
  const from = monthOf(item.pausedFrom) ?? month
  return {
    resumeMonth: resume,
    totalMonths: Math.max(monthDiff(from, resume), 1),
    monthsLeft: Math.max(monthDiff(month, resume), 1),
  }
}

/** ข้อความบอกสถานะพัก เช่น "พัก 3 เดือน เหลืออีก 2 เดือน กลับมาเรียกเก็บ ธ.ค. 2569" */
export function pauseLabel(info) {
  if (!info) return ''
  const [y, m] = info.resumeMonth.split('-').map(Number)
  return `พัก ${info.totalMonths} เดือน · เหลืออีก ${info.monthsLeft} เดือน · กลับมาเรียกเก็บ ${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`
}

// ── รอบบิลที่บิลใบนี้เรียกเก็บ ────────────────────────────────────────────────
//
// "เดือนที่ต้องจ่าย" กับ "รอบบิลที่จ่าย" เป็นคนละเดือนได้ และในหน้าเดียวกันมีทั้งสองแบบ
// ปนกัน — บิลค่าไฟที่ครบกำหนด 15 ก.ย. คือค่าไฟของเดือน ส.ค. ส่วนค่าบริการซอฟต์แวร์
// ที่ตัดวันที่ 18 ก.ย. คือค่าบริการของเดือน ก.ย. เอง
// item.billingCycleOffset เก็บส่วนต่างเป็นจำนวนเดือน (ดู supabase/recurring.sql)

export const CYCLE_OFFSETS = [
  { value: -1, label: 'ของเดือนก่อนหน้า', hint: 'ค่าไฟ ค่าน้ำ ค่าเน็ต ค่าโทรศัพท์ — เก็บย้อนหลังจากที่ใช้ไปแล้ว' },
  { value: 0, label: 'ของเดือนที่จ่าย', hint: 'ค่าบริการที่เก็บของเดือนนั้นเลย เช่นค่าสมาชิกรายเดือน' },
  { value: 1, label: 'ของเดือนถัดไป', hint: 'จ่ายล่วงหน้า เช่นค่าเช่าที่จ่ายก่อนเข้าอยู่' },
]

/** เดือนของรอบบิลที่ entry ใบนี้เรียกเก็บ — รูปแบบ 'YYYY-MM' */
export function cycleMonth(item, entryMonth) {
  const offset = Number(item?.billingCycleOffset) || 0
  return offset === 0 ? entryMonth : addMonths(entryMonth, offset)
}

/** 'ส.ค. 2569' — ชื่อเดือนของรอบบิล */
export function monthName(month, { full = false } = {}) {
  const [y, m] = String(month ?? '').split('-').map(Number)
  if (!y || !m) return '—'
  return `${(full ? THAI_MONTHS_FULL : THAI_MONTHS_SHORT)[m - 1]} ${y + 543}`
}

/**
 * ป้ายบอกรอบบิลของ entry — คืน null เมื่อรอบบิลตรงกับเดือนที่จ่าย
 * เพราะกรณีนั้นการเขียนซ้ำไม่ได้บอกอะไรใหม่ นอกจากทำให้แถวรก
 */
export function cycleLabel(item, entryMonth, { always = false } = {}) {
  const offset = Number(item?.billingCycleOffset) || 0
  if (offset === 0 && !always) return null
  return `รอบบิล ${monthName(cycleMonth(item, entryMonth))}`
}
