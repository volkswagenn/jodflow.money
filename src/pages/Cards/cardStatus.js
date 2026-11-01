import { formatIsoThaiShort, toDateString } from '../../lib/cardCycle'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

// เหลือไม่เกินกี่วันถึงนับว่าใกล้ครบกำหนด — แถบเปลี่ยนเป็นแดงเข้มให้สะดุดตา
const HOT_DAYS = 3

// แถบเทาบนชิปที่เลือกอยู่ (พื้นเข้ม) ต้องเปลี่ยนเฉด ไม่งั้นเป็นแถบสว่างโดดออกมาจากชิปเข้ม
const QUIET = { bg: '#F4F3EF', fg: '#5F646C', bgOn: '#2A2E35', fgOn: '#C9CDD2' }
const OVERDUE = { bg: '#8E2219', fg: '#FFFFFF' }
const HOT = { bg: '#C03A2D', fg: '#FFFFFF' }
const SOON = { bg: '#FBE9E7', fg: '#A93A2E' }
// สีเดียวกับป้ายงวดที่จ่ายแล้ว (EntryPips) — เห็นมะนาวที่ไหนก็แปลว่าจ่ายแล้วเหมือนกันทั้งแอป
const PAID = { bg: '#C7F250', fg: '#16181D' }
const PARTIAL = { bg: '#FBF7EC', fg: '#7A5608' }

/** คำบอกเวลาของบิลที่ค้าง: เลยกำหนด / วันนี้ / อีกกี่วัน */
const whenText = (days) => (days === 0 ? 'ครบกำหนดวันนี้' : `อีก ${days} วัน`)

/**
 * แถบสถานะของบัตรหนึ่งใบ จากผลของ getCardBillStatus
 * เรียงตามสิ่งที่ต้องทำ: เลยกำหนดต้องเด่นที่สุด จ่ายแล้วต้องเห็นชัดแต่ไม่แย่งสายตาจากของที่ต้องจ่าย
 */
export function statusBand(st) {
  if (st.kind === 'billing' || st.kind === 'partial') {
    if (st.days < 0) {
      return { ...OVERDUE, icon: 'error', text: `เลยกำหนด ${-st.days} วัน` + (st.paid > 0 ? ` · จ่ายแล้ว ${fmt(st.paid)}` : '') }
    }
    const tone = st.days <= HOT_DAYS ? HOT : st.kind === 'partial' ? PARTIAL : SOON
    return st.kind === 'partial'
      ? { ...tone, icon: 'pending_actions', text: `จ่ายแล้ว ${fmt(st.paid)} · ${whenText(st.days)}` }
      : { ...tone, icon: 'schedule', text: `กำลังเรียกเก็บ · ${whenText(st.days)}` }
  }
  if (st.kind === 'paid') {
    const when = st.paidAt ? ` · ${formatIsoThaiShort(st.paidAt)}` : ''
    return { ...PAID, icon: 'check_circle', text: `จ่ายแล้ว ${fmt(st.paid)}${when}` }
  }
  if (st.kind === 'open') {
    const closing = st.closing ? ` · สรุปยอด ${formatIsoThaiShort(toDateString(st.closing))}` : ''
    return { ...QUIET, icon: 'event_repeat', text: `ยังไม่ออกบิล${closing}` }
  }
  return { ...QUIET, icon: 'remove', text: 'ไม่มียอดในรอบนี้' }
}
