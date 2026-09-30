import { formatIsoThai, formatIsoThaiShort, toDateString, clampedDate } from '../../lib/cardCycle'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/*
 * ป้ายงวด — ใช้ร่วมกันทุกหน้าที่แสดงสัญญาผ่อน (หน้าบัตร · หนี้สินและงวดผ่อน)
 * แยกออกมาจากหน้าบัตรเพื่อให้ทุกหน้าเห็นงวดทั้งหมดหน้าตาเดียวกัน สีเดียวกัน ความหมายเดียวกัน
 * ไม่ใช่หน้าหนึ่งเป็นป้าย อีกหน้าเป็นแถบความคืบหน้ากับตารางที่ต้องกดเปิดก่อน
 */


/**
 * สีป้ายงวด — สามสถานะที่ต้องแยกออกจากกันให้ได้ในแวบเดียว
 *   จ่ายแล้ว = เขียว · งวดของแถวนี้ = กล่องขาวขอบเข้ม · เข้าบิลแล้วรอจ่ายบิล = ชมพู
 *   ยังไม่ถึงรอบ = เทาจาง
 *
 * งวดที่กำลังถูกเก็บต้องเป็นกล่องขาว ไม่ใช่เทาแบบเดียวกับงวดที่ยังมาไม่ถึง
 * เพราะสองอย่างนี้คนละเรื่องกันโดยสิ้นเชิง อันหนึ่งต้องเตรียมเงินไว้เดี๋ยวนี้
 * อีกอันยังไม่ต้องทำอะไร ถ้าสีเหมือนกันก็ต้องไล่อ่านวันที่ทุกป้ายถึงจะรู้
 */
const PIP_TONE = {
  // จ่ายแล้วทันกำหนด
  paid:    'bg-lime border-[#A9CF3A] text-ink',
  prepaid: 'bg-lime border-[#A9CF3A] text-ink',
  // จ่ายแล้วแต่ช้ากว่าวันครบกำหนด — ข้างในเขียว (จ่ายแล้วจริง) กรอบแดง (ช้า)
  paidLate: 'bg-lime border-expense text-ink shadow-[0_0_0_1px_#C03A2D]',
  // งวดที่ค้างอยู่ตอนนี้ ยังไม่ถึงกำหนด
  current: 'bg-white border-ink text-ink shadow-[0_0_0_1px_#16181D]',
  // เลยวันครบกำหนดแล้วยังไม่จ่าย แต่ยังไม่ถึงวันตัดรอบถัดไป — กรอบแดง
  overdue: 'bg-white border-expense text-expense shadow-[0_0_0_1px_#C03A2D]',
  // ค้างข้ามวันตัดรอบถัดไปไปแล้ว — แดงทึบ ไม่มีข้อแก้ตัวแล้ว
  overdueHard: 'bg-expense border-expense text-white',
  // เข้าบิลไปแล้ว ยังไม่ถึงกำหนด และไม่ใช่งวดที่เน้น — ชมพูจาง
  billed:  'bg-expense-soft border-[#F0C4BE] text-[#A93A2E]',
  pending: 'bg-paper border-hairline text-faint',
}
const PIP_LABEL = {
  paid: 'จ่ายแล้ว',
  prepaid: 'จ่ายมาก่อนเริ่มใช้แอป',
  billed: 'เข้าบิลแล้ว รอจ่ายบิล',
  pending: 'ยังไม่ถึงกำหนด',
}

/**
 * ป้ายงวดผ่อนในแถวรายการ — งวดละหนึ่งป้าย พร้อมวันครบกำหนดของงวดนั้น
 *
 * ของเดิมเป็นจุดเปล่า ซึ่งบอกได้แค่ "จ่ายไปกี่งวดแล้ว" ซึ่งเป็นตัวเลขที่เขียนไว้เป็น
 * ตัวหนังสือข้างๆ อยู่แล้ว จุดจึงกินที่ไปเปล่าๆ คำถามที่แถวนี้ยังตอบไม่ได้สักทีคือ
 * "งวดไหนครบกำหนดวันไหน" วันที่จึงย้ายเข้ามาอยู่ในป้ายเลย
 *
 * ป้ายกว้างเท่าเนื้อหาพอดีและตัดบรรทัดเอง จึงลงในที่ว่างของแถวได้โดยไม่ดันคอลัมน์อื่น
 */
/** วันที่แบบ 'YYYY-MM-DD' ตามเวลาเครื่อง จากค่าที่อาจเป็น date หรือ timestamptz */
const dayOf = (v) => {
  if (!v) return null
  const s = String(v)
  if (!s.includes('T')) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : toDateString(d)
}

/**
 * @param paidViaBill id ของงวดที่จ่ายไปแล้ว "ผ่านบิลบัตร" — สถานะในฐานข้อมูลยังเป็น
 *   billed อยู่ (ตั้งใจ: กฎการลบ/ยกเลิกสัญญาผูกกับสถานะนี้ ถ้าเปลี่ยนเป็น paid
 *   การลบสัญญาจะคืนเงินซ้ำกับที่จ่ายบิลไปแล้ว) แต่ในสายตาคนใช้มันคือจ่ายแล้ว
 *   ป้ายจึงต้องเป็นสีเดียวกับงวดที่จ่ายแล้ว ไม่งั้นจ่ายบิลไปหน้าจอก็ยังเหมือนเดิม
 */
export default function EntryPips({ rows, currentSeq: currentSeqProp = null, closingDay = null, paidViaBill = null }) {
  const list = (rows ?? []).filter((r) => r.status !== 'cancelled')
  if (list.length === 0) return null
  const isPaid = (r) => r.status === 'paid' || r.status === 'prepaid' || !!paidViaBill?.has(r.id)
  // แสดงทุกงวดไม่ตัด — สัญญา 84 งวดก็ต้องเห็นครบ ป้ายตัดบรรทัดเองตามความกว้าง
  // (เคยตัดที่ 12 แล้วขึ้น "+72 งวด" ซึ่งซ่อนสิ่งที่คนเปิดหน้านี้มาดูพอดี)
  const shown = list
  const today = toDateString(new Date())
  // งวดที่เน้น = งวดที่ผู้ใช้ค้างอยู่จริงตอนนี้: งวดแรกที่ยังไม่จ่าย ไม่ว่าจะเข้าบิลแล้ว
  // (billed) หรือกำลังจะเข้า (pending) — ตามที่ธนาคารมอง งวดที่เข้าบิลแล้วแต่ยังไม่จ่าย
  // ยังเป็นภาระของงวดนั้น ไม่ได้ถูกเลื่อนไปงวดถัดไป ที่เรียกใช้ระบุมาแทนได้
  const currentSeq = currentSeqProp
    ?? list.find((r) => !isPaid(r))?.seq
    ?? null
  // วันตัดรอบถัดจากรอบของงวดนี้ — ค้างข้ามวันนี้ไปคือค้างจริงจัง ไม่ใช่แค่ช้าไม่กี่วัน
  // (รหัสรอบคือเดือนที่ตัด ใช้เป็นเลขเดือน 0-based ของเดือนถัดไปได้พอดี)
  const nextCutoffOf = (r) => {
    const [y, m] = String(r.cycle ?? '').split('-').map(Number)
    if (!y || !m || !closingDay) return null
    return toDateString(clampedDate(y, m, closingDay))
  }
  // สามคำถามเรียงตามลำดับ: จ่ายหรือยัง → จ่ายทันไหม / ค้างนานแค่ไหน → เป็นงวดที่เน้นไหม
  const toneOf = (r) => {
    if (r.status === 'prepaid') return PIP_TONE.prepaid
    if (r.status === 'paid' || paidViaBill?.has(r.id)) {
      const paidDay = dayOf(r.paidAt)
      return paidDay && r.dueDate && paidDay > r.dueDate ? PIP_TONE.paidLate : PIP_TONE.paid
    }
    if (r.dueDate && today > r.dueDate) {
      const cut = nextCutoffOf(r)
      return cut && today > cut ? PIP_TONE.overdueHard : PIP_TONE.overdue
    }
    if (r.seq === currentSeq) return PIP_TONE.current
    return r.status === 'billed' ? PIP_TONE.billed : PIP_TONE.pending
  }
  const labelOf = (r) => {
    if (r.status !== 'paid' && paidViaBill?.has(r.id)) return 'จ่ายแล้วผ่านบิลบัตร'
    if (r.status === 'paid') {
      const paidDay = dayOf(r.paidAt)
      return paidDay && r.dueDate && paidDay > r.dueDate ? `จ่ายแล้ว แต่ช้ากว่ากำหนด (${formatIsoThai(paidDay)})` : 'จ่ายแล้วทันกำหนด'
    }
    if (r.status !== 'prepaid' && r.dueDate && today > r.dueDate) {
      const cut = nextCutoffOf(r)
      return cut && today > cut ? 'ค้างข้ามวันตัดรอบถัดไปแล้ว' : 'เลยกำหนดแล้ว ยังไม่จ่าย'
    }
    if (r.seq === currentSeq && r.status === 'pending') return 'งวดที่ค้างอยู่ตอนนี้'
    return PIP_LABEL[r.status] ?? r.status
  }
  return (
    // เรียงต่อกันแล้วตัดบรรทัดเหมือนเดิม แต่ป้ายทุกใบกว้างเท่ากัน (กำหนดตายตัว ไม่ยืดตามช่อง)
    // ขอบป้ายจึงตรงกันเป็นคอลัมน์โดยไม่ต้องใช้ตาราง ซึ่งจะยืดป้ายให้เต็มแถวจนดูหนา
    // 86px คือความกว้างที่เคสยาวสุด "28 มี.ค. 69" (วันสองหลัก + เดือน 4 ตัวอักษร + ปี พ.ศ.)
    // ยังอยู่ครบในฟอนต์ 9.5px — แคบกว่านี้ปีจะถูกตัดเป็น … ซึ่งคือสิ่งที่ผู้ใช้ทักมา
    <span className="flex flex-wrap gap-1">
      {shown.map((r) => (
        <span
          key={r.seq}
          title={'งวดที่ ' + r.seq + ' จาก ' + list.length + ' · ครบกำหนด ' + formatIsoThai(r.dueDate)
            + ' · ' + fmt(r.amount) + ' บาท · '
            + labelOf(r)}
          className={'flex items-center gap-1 w-[86px] flex-none h-[17px] px-1.5 rounded-[5px] border text-[9.5px] leading-none tabular-nums whitespace-nowrap '
            + toneOf(r)}
        >
          {/* เลขงวดกว้างคงที่ชิดขวา เส้นคั่นทุกใบจึงอยู่ตำแหน่งเดียวกันทั้งคอลัมน์ */}
          <span className="font-bold w-[13px] text-right flex-none">{r.seq}</span>
          <span className="w-px h-[9px] bg-current opacity-30 flex-none" />
          <span className="opacity-80">{formatIsoThaiShort(r.dueDate)}</span>
        </span>
      ))}
    </span>
  )
}
