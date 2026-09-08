import { useMemo, useState } from 'react'
import Popup from './Popup'
import AmountInput from './AmountInput'
import { formatThaiShort } from '../../lib/cardCycle'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * ปรับแต่งค่างวดทีละงวด
 *
 * โปรฯ ผ่อนของจริงประกาศเป็นรายงวด ("สามงวดแรก 307.87 ที่เหลือ 311.96") คนกรอก
 * จึงถือตัวเลขรายงวดมา ไม่ได้ถือ "ช่วง" มา ป๊อปอัปนี้ให้กรอกแบบที่ถืออยู่จริง
 * แล้วค่อยยุบเป็นช่วงให้ตอนบันทึก (tiersFromAmounts) โครงข้อมูลเดิมไม่ต้องแตะ
 *
 * งวดที่ไม่ได้เปิดสวิตช์ = ใช้ค่าเริ่มต้น (ค่างวดปกติ) จะได้ไม่ต้องพิมพ์ซ้ำทุกงวด
 * เมื่อรู้ยอดรวมที่ต้องการ (target) งวดสุดท้ายที่ไม่ได้กำหนดเองจะรับเศษที่เหลือ
 * ให้อัตโนมัติ — ตรงกับวิธีที่ใบเสนอผ่อนเขียนไว้ว่างวดสุดท้ายเป็นยอดคงเหลือ
 *
 * @param months   จำนวนงวด
 * @param amounts  ค่างวดตั้งต้นรายงวด (ยาวเท่า months, '' = ยังไม่กำหนด)
 * @param base     ค่างวดเริ่มต้นของงวดที่ไม่ได้กำหนดเอง
 * @param target   ยอดรวมที่ต้องการ (ไม่ส่ง = ไม่ต้องเทียบ)
 * @param dueDates วันครบกำหนดรายงวด (ไม่ส่ง = ไม่แสดงวันที่)
 * @param onSave   คืนค่างวดรายงวดเป็น array ของ string
 */
export default function PerInstallmentPopup({
  months, amounts = [], base = 0, target = null, dueDates = null, onClose, onSave,
}) {
  const m = Math.max(1, Math.round(Number(months) || 1))
  const baseAmount = round2(base)

  // งวดไหน "กำหนดเอง" — งวดที่มีค่ามาตั้งแต่ต้นและไม่เท่าค่าเริ่มต้นถือว่ากำหนดเองไว้แล้ว
  const [rows, setRows] = useState(() =>
    Array.from({ length: m }, (_, i) => {
      const v = amounts[i]
      const has = v !== '' && v != null
      return { custom: has && round2(v) !== baseAmount, value: has ? String(v) : '' }
    })
  )

  const setRow = (i, patch) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  // งวดสุดท้ายรับเศษให้เอง ถ้ารู้ยอดรวมที่ต้องการและไม่ได้กำหนดงวดสุดท้ายไว้เอง
  const tailIndex = Number(target) > 0 && !rows[m - 1]?.custom ? m - 1 : -1

  const values = useMemo(() => {
    // งวดที่ไม่ได้เปิดสวิตช์ = เหมือนงวดก่อนหน้า ตรงกับวิธีที่โปรฯ ผ่อนประกาศมา
    // ("งวด 1–3 ละ 307.87 งวด 4–6 ละ 311.96" = เปิดสวิตช์แค่งวด 1 กับงวด 4)
    let carry = baseAmount
    const out = rows.map((r) => {
      if (r.custom) carry = round2(r.value)
      return carry
    })
    if (tailIndex >= 0) {
      const others = out.reduce((s, v, i) => (i === tailIndex ? s : s + v), 0)
      out[tailIndex] = round2(Number(target) - others)
    }
    return out
  }, [rows, baseAmount, tailIndex, target])

  const total = round2(values.reduce((s, v) => s + v, 0))
  const overTarget = Number(target) > 0 && total > Number(target) + 0.005
  const badTail = tailIndex >= 0 && !(values[tailIndex] > 0)

  return (
    <Popup
      title="ปรับแต่งค่างวดทีละงวด"
      sub={`${m} งวด · เปิดสวิตช์เฉพาะงวดที่ค่างวดไม่เท่าปกติ`}
      icon="payments"
      tone="plan"
      width={440}
      onClose={onClose}
      onConfirm={() => onSave(values.map((v) => String(v)))}
      confirmLabel="เสร็จสิ้น"
      disabled={badTail}
      error={
        badTail
          ? `ยอดที่กำหนดเองรวมกันเกินยอดรวมแล้ว งวดที่ ${tailIndex + 1} จึงเหลือ ${fmt(values[tailIndex])}`
          : ''
      }
    >
      <div className="space-y-1 max-h-[52vh] overflow-y-auto -mx-1 px-1">
        {rows.map((r, i) => {
          const isTail = i === tailIndex
          return (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRow(i, { custom: !r.custom, value: r.custom ? '' : String(values[i]) })}
                className={`w-10 h-6 rounded-full flex-none relative transition-colors ${
                  r.custom ? 'bg-lime' : 'bg-hairline'
                }`}
                title={r.custom ? 'กลับไปใช้ค่างวดปกติ' : 'กำหนดค่างวดนี้เอง'}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    r.custom ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="w-[92px] flex-none text-[12px] leading-tight">
                <span className="block font-semibold">งวด {i + 1}</span>
                {dueDates?.[i] && (
                  <span className="block text-[10.5px] text-muted tabular-nums">{formatThaiShort(dueDates[i])}</span>
                )}
              </span>
              {r.custom ? (
                <AmountInput
                  className="input !h-8 flex-1 text-right text-[13px]"
                  value={r.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  placeholder={String(baseAmount)}
                />
              ) : (
                <span
                  className={`flex-1 h-8 rounded-ctl border px-2.5 flex items-center justify-end text-[13px] tabular-nums ${
                    isTail ? 'border-lime bg-lime/10 text-ink' : 'border-hairline bg-paper text-muted'
                  }`}
                  title={isTail ? 'งวดสุดท้าย — รับยอดที่เหลือให้อัตโนมัติ' : 'เท่ากับงวดก่อนหน้า'}
                >
                  {fmt(values[i])}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ยอดรวมสดขณะแก้ — ต้องเห็นทันทีว่ายังขาดหรือเกินเท่าไร ไม่ใช่รู้ตอนกดบันทึกแล้วโดนเด้ง */}
      <div
        className={`flex items-center justify-between rounded-ctl border px-3 py-2 text-[13px] ${
          overTarget ? 'border-expense-line bg-expense-soft' : 'border-hairline bg-paper'
        }`}
      >
        <span className="font-semibold">ทั้งหมด</span>
        <span className="tabular-nums font-semibold">
          {fmt(total)}
          {Number(target) > 0 && <span className="text-muted font-normal"> / {fmt(target)}</span>}
          <span className="text-muted font-normal"> บาท</span>
        </span>
      </div>
      <p className="text-[11.5px] text-muted -mt-1">
        งวดที่ไม่ได้เปิดสวิตช์จะเท่ากับงวดก่อนหน้า — โปรฯ แบบ “งวด 1–3 ละ 307.87 ที่เหลือ 311.96”
        จึงเปิดแค่งวด 1 กับงวด 4
        {tailIndex >= 0 && ` · งวดที่ ${tailIndex + 1} เป็นยอดที่เหลือให้อัตโนมัติ`}
      </p>
    </Popup>
  )
}
