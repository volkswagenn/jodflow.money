import { useState } from 'react'
import AmountInput from './AmountInput'
import { format } from 'date-fns'
import useWalletStore from '../../store/useWalletStore'
import DatePicker from './DatePicker'
import TransferAccountPicker from './TransferAccountPicker'
import { formatIsoThai } from '../../lib/cardCycle'
import Popup from './Popup'
import UiIcon from './UiIcon'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * จ่ายบิลบัตรเครดิต
 *
 * ยอดเริ่มต้นคือเต็มจำนวนเสมอ เพราะเป็นทางเลือกที่ถูกต้องในเกือบทุกกรณี
 * ปุ่มขั้นต่ำมีไว้ให้กดได้ แต่มีคำเตือนกำกับว่าระยะปลอดดอกเบี้ยจะหายไป
 * ซึ่งเป็นความเข้าใจผิดที่แพงที่สุดเรื่องบัตรเครดิต
 *
 * onConfirm({ method, accountId, amount, date })
 * preset = { amount, label } เปิดมาพร้อมยอดที่ตั้งไว้ (เช่นจ่ายเฉพาะรายการเดียวในบิล)
 */
export default function PayCardBillPopup({ statement, cardLabel, onConfirm, onCancel, busy, preset = null }) {
  const remaining = Number(statement.amount) - Number(statement.paidAmount)
  const minimum = Math.min(Number(statement.minimumAmount) || 0, remaining)

  const [method, setMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState(String(preset?.amount > 0 ? Math.min(preset.amount, remaining) : remaining))
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [error, setError] = useState('')

  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)
  const cash = useWalletStore((s) => s.cash)
  const accounts = useWalletStore((s) => s.transferAccounts)

  const value = Number(amount) || 0
  const isMinimum = minimum > 0 && Math.abs(value - minimum) < 0.005 && value < remaining
  const isPartial = value > 0 && value < remaining && !isMinimum

  // ยอดในกระเป๋าที่จะจ่าย ใช้เตือนก่อนกด ไม่ได้บล็อก
  const sourceBalance = method === 'cash'
    ? cash
    : (accounts.find((a) => a.id === resolveAccount(accountId))?.balance ?? null)
  const notEnough = sourceBalance !== null && value > sourceBalance

  const setPreset = (v) => { setAmount(String(v)); setError('') }

  const submit = () => {
    if (busy) return
    if (!(value > 0)) return setError('ใส่จำนวนเงินที่จะจ่าย')
    const resolved = method === 'transfer' ? resolveAccount(accountId) : null
    if (method === 'transfer' && !resolved) return setError('เลือกบัญชีที่จะจ่าย')
    onConfirm({ method, accountId: resolved, amount: value, date })
  }

  const isFull = Math.abs(value - remaining) < 0.005
  const isCustom = !isFull && !isMinimum

  return (
    <Popup
      title="จ่ายบิลบัตรเครดิต"
      sub={`${cardLabel} · รอบ ${statement.cycle ?? '—'}`}
      icon="credit_card"
      tone="out"
      headTone="danger"
      width={460}
      onClose={onCancel}
      onConfirm={submit}
      busy={busy}
      confirmLabel={`จ่าย ${fmt(value)} บาท`}
      error={error}
    >
      {/* ยอดที่ต้องจ่ายตัวใหญ่สุดในกล่อง — เป็นตัวเลขเดียวที่คนเปิดป๊อปอัปนี้มาดู */}
      <div className="flex-none bg-expense-soft border border-[#F0C4BE] rounded-[14px] px-3.5 py-3">
        <div className="text-[11.5px] text-[#A93A2E]">{cardLabel} · รอบ {statement.cycle ?? '—'}</div>
        <div className="tabular-nums text-[29px] font-semibold text-[#C03A2D] tracking-[-0.025em] leading-[1.15] mt-px">
          {fmt(remaining)}
        </div>
        <div className="text-[11.5px] text-[#7A5B56] mt-0.5">
          ครบกำหนด {formatIsoThai(statement.dueDate)}
          {minimum > 0 && ` · ขั้นต่ำ ${fmt(minimum)}`}
          {Number(statement.paidAmount) > 0
            ? ` · จ่ายไปแล้ว ${fmt(statement.paidAmount)}`
            : ' · ยังไม่จ่ายในรอบนี้'}
        </div>
      </div>

      <div className="flex-none">
        <label className="block text-[11.5px] text-muted mb-[5px]">จ่ายจาก</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'cash', label: 'เงินสด', icon: 'cash' },
            { key: 'transfer', label: 'เงินโอน', icon: 'bank' },
          ].map((m) => {
            const on = method === m.key
            return (
              <button
                key={m.key}
                onClick={() => { setMethod(m.key); setError('') }}
                className={`h-10 rounded-[11px] text-[13px] flex items-center justify-center gap-1.5 transition ${
                  on ? 'bg-ink text-white font-semibold' : 'border border-hairline bg-white text-muted hover:bg-paper'
                }`}
              >
                <UiIcon name={m.icon} tone={on ? 'w' : undefined} size={15} />
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {method === 'transfer' && (
        <div className="flex-none">
          <label className="block text-[11.5px] text-muted mb-[5px]">ตัดจากบัญชี</label>
          <TransferAccountPicker value={accountId} onChange={setAccountId} label="" />
        </div>
      )}

      <div className="flex-none">
        <label className="block text-[11.5px] text-muted mb-[5px]">จำนวนที่จ่าย</label>
        <div className="grid grid-cols-3 gap-2 mb-[7px]">
          <button
            onClick={() => setPreset(remaining)}
            className={`h-8 rounded-[9px] border border-hairline text-[12px] font-semibold ${
              isFull ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-paper'
            }`}
          >
            เต็มจำนวน {fmt(remaining)}
          </button>
          <button
            onClick={() => setPreset(minimum)}
            disabled={!(minimum > 0 && minimum < remaining)}
            className={`h-8 rounded-[9px] border border-hairline text-[12px] font-semibold disabled:opacity-40 ${
              isMinimum ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-paper'
            }`}
          >
            ขั้นต่ำ {fmt(minimum)}
          </button>
          <button
            onClick={() => { setAmount(''); setError('') }}
            className={`h-8 rounded-[9px] border border-hairline text-[12px] font-semibold ${
              isCustom ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-paper'
            }`}
          >
            กำหนดยอดเอง
          </button>
        </div>
        <AmountInput
          className="h-11 px-[13px] border border-ink rounded-[11px] w-full text-right text-[19px] font-semibold tabular-nums outline-none"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setError('') }}
          placeholder="0.00"
        />
      </div>

      <div className="flex-none">
        <label className="block text-[11.5px] text-muted mb-[5px]">วันที่จ่าย</label>
        <DatePicker value={date} onChange={setDate} />
      </div>

      {preset?.label && Math.abs(value - Math.min(preset.amount, remaining)) < 0.005 && (
        <div className="flex-none bg-[#FAF9F6] border border-[#EFEDE7] rounded-ctl px-3 py-2.5 text-[11.5px] text-muted leading-relaxed">
          ยอดนี้คือรายการ "{preset.label}" ในบิลใบนี้ — จ่ายเฉพาะรายการนี้ ส่วนที่เหลือของบิลยังค้างอยู่
          แก้ยอดได้ถ้าโอนจริงไม่เท่านี้
        </div>
      )}
      {isCustom && !preset?.label && (
        <div className="flex-none bg-[#FAF9F6] border border-[#EFEDE7] rounded-ctl px-3 py-2.5 text-[11.5px] text-muted leading-relaxed">
          พิมพ์ยอดที่โอนจริงลงในช่องด้านบน ใช้ตอนจ่ายไม่ตรงยอดเต็มและไม่ตรงขั้นต่ำ
          เช่นจ่ายบางส่วนหรือจ่ายเกินเพื่อเก็บเป็นเครดิต · ยอดที่เหลือจะคิดดอกเบี้ยตามเงื่อนไขบัตร
        </div>
      )}

      {(isMinimum || (isPartial && value > 0)) && (
        <div className="flex-none bg-pending-soft border border-pending-line rounded-ctl px-3 py-2.5 text-[11.5px] text-[#8A6A15] leading-relaxed">
          <b className="flex items-center gap-1.5">
            <UiIcon name="warning" tone="amber" size={15} />
            จ่ายไม่เต็มจำนวน
          </b>
          ระยะปลอดดอกเบี้ยจะหายไป และธนาคารจะคิดดอกเบี้ยย้อนตั้งแต่วันที่ทำรายการ ไม่ใช่คิดจากยอดที่เหลือ
          <br />
          ยอดที่เหลือ {fmt(remaining - value)} บาท จะถูกยกไปรวมในบิลรอบถัดไป
        </div>
      )}

      {value > remaining && (
        <div className="flex-none bg-income-soft border border-[#BFE0D2] rounded-ctl px-3 py-2.5 text-[11.5px] text-[#0F6A50] leading-relaxed">
          จ่ายเกิน {fmt(value - remaining)} บาท — ส่วนที่เกินจะเป็นเครดิตในบัตร และถูกหักออกจากบิลรอบถัดไปให้เอง
        </div>
      )}

      {notEnough && (
        <p className="flex-none text-[11.5px] text-expense bg-expense-soft rounded-ctl px-3 py-2">
          ยอดใน{method === 'cash' ? 'เงินสด' : 'บัญชีที่เลือก'}มี {fmt(sourceBalance)} บาท จ่ายแล้วจะติดลบ
        </p>
      )}

      <p className="flex-none text-[11px] text-faint leading-relaxed">
        การจ่ายบิลเป็นการย้ายเงินไปปิดหนี้ ไม่ใช่รายจ่ายก้อนใหม่ รายจ่ายถูกบันทึกไปแล้วตั้งแต่วันที่รูด
        จึงไม่ถูกนับซ้ำในรายงาน
      </p>
    </Popup>
  )
}
