import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Popup from './Popup'
import { bindBalanceGuard } from '../../lib/balanceGuard'

const fmt = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * ป๊อปอัปของด่านยอดเงิน — ติดตั้งครั้งเดียวใน App แล้วทุกเส้นทางจ่ายเงินใช้ร่วมกัน
 * (ดู lib/balanceGuard.js ว่าทำไมต้องเป็นด่านเดียว)
 *
 * สองหน้าตา ตามค่าตั้งของร้าน
 *   เงินไม่พอจ่าย      ไม่มีปุ่มยืนยัน บอกว่าขาดเท่าไร และทางออกสองทาง
 *   ยอดเงินจะติดลบ     เตือนยอดหลังจ่าย แล้วให้เลือกเอง
 */
export default function BalanceGuardPopup() {
  const navigate = useNavigate()
  const [ask, setAsk] = useState(null)

  useEffect(() => bindBalanceGuard(setAsk), [])

  if (!ask) return null

  const answer = (ok) => {
    ask.resolve(ok)
    setAsk(null)
  }

  const rows = (
    <dl className="rounded-ctl border border-hairline divide-y divide-[#F2F0EA] text-[12.5px]">
      <div className="flex justify-between gap-3 px-3.5 py-2.5">
        <dt className="text-muted">ยอดที่จะตัดออก</dt>
        <dd className="font-semibold tabular-nums">{fmt(ask.amount)} บาท</dd>
      </div>
      <div className="flex justify-between gap-3 px-3.5 py-2.5">
        <dt className="text-muted">คงเหลือใน{ask.label}</dt>
        <dd className="font-semibold tabular-nums">{fmt(ask.balance)} บาท</dd>
      </div>
      <div className="flex justify-between gap-3 px-3.5 py-2.5">
        <dt className="text-muted">{ask.allow ? 'หลังจ่ายจะเหลือ' : 'ขาดอีก'}</dt>
        <dd className="font-semibold tabular-nums text-expense">
          {ask.allow ? fmt(ask.after) : fmt(Math.abs(ask.after))} บาท
        </dd>
      </div>
    </dl>
  )

  // ── ร้านตั้งไว้ไม่ให้ติดลบ: จ่ายไม่ได้ ───────────────────────────────────
  if (!ask.allow) {
    return (
      <Popup
        title="เงินไม่พอจ่าย"
        sub={`${ask.label}มีไม่ถึงยอดที่จะจ่าย`}
        icon="error"
        headTone="danger"
        width={420}
        onClose={() => answer(false)}
        footer={
          <div className="flex-none flex items-center gap-2 px-[17px] py-3 border-t border-[#EFEDE7] bg-[#FAF9F6]">
            <button
              onClick={() => { answer(false); navigate('/settings') }}
              className="h-[38px] px-4 rounded-[11px] border border-hairline bg-white text-[13px] font-semibold hover:bg-paper"
            >
              ไปหน้าตั้งค่า
            </button>
            <button
              onClick={() => answer(false)}
              className="ml-auto h-[38px] px-[18px] rounded-[11px] bg-ink text-white text-[13px] font-semibold hover:brightness-125"
            >
              รับทราบ
            </button>
          </div>
        }
      >
        {rows}
        <p className="text-[12px] text-muted leading-relaxed">
          รายการนี้ยังไม่ถูกบันทึก — เลือกแหล่งเงินอื่น เติมเงินเข้า{ask.label}ก่อน
          หรือเปิด <b className="text-ink">"อนุญาตให้ยอดเงินติดลบ"</b> ที่หน้าตั้งค่า
        </p>
      </Popup>
    )
  }

  // ── ร้านอนุญาตให้ติดลบ: เตือนแล้วให้เลือก ────────────────────────────────
  return (
    <Popup
      title="ยอดเงินจะติดลบ"
      sub={`จ่ายแล้ว${ask.label}จะติดลบ`}
      icon="error"
      headTone="note"
      width={420}
      onClose={() => answer(false)}
      onConfirm={() => answer(true)}
      confirmLabel="จ่ายต่อ"
      cancelLabel="ยกเลิก"
      danger
    >
      {rows}
      <p className="text-[12px] text-muted leading-relaxed">
        เมื่อกดจ่ายต่อ ยอดใน{ask.label}จะติดลบเป็น <b className="text-expense">{fmt(ask.after)} บาท</b>
      </p>
    </Popup>
  )
}
