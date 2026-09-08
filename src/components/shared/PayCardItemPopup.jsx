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
 * จ่ายรายการรูดทีละรายการก่อนออกบิล
 *
 * คนจำนวนมากใช้บัตรแบบ "รูดแล้วโอนคืนทันที" ไม่รอบิล ยอดที่โอนไปจะโผล่ในบิล
 * ใบถัดไปเป็นบรรทัดยอดชำระ ทำให้ยอดที่ต้องชำระเหลือแค่รายการที่ยังไม่ได้โอน
 * ป๊อปอัปนี้จึงเปิดมาพร้อมยอดเต็มของรายการ (เกือบทุกครั้งคือยอดที่โอนจริง)
 * แก้ได้แต่ห้ามเกินยอดของรายการ ถ้าอยากจ่ายเกินให้ไปที่ปุ่มจ่ายบิล
 *
 * onConfirm({ method, accountId, amount, date })
 */
export default function PayCardItemPopup({ item, cardLabel, onConfirm, onCancel, busy }) {
  const remaining = Number(item.remaining)

  const [method, setMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState(String(remaining))
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [error, setError] = useState('')

  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)
  const cash = useWalletStore((s) => s.cash)
  const accounts = useWalletStore((s) => s.transferAccounts)

  const value = Number(amount) || 0
  const sourceBalance = method === 'cash'
    ? cash
    : (accounts.find((a) => a.id === resolveAccount(accountId))?.balance ?? null)
  const notEnough = sourceBalance !== null && value > sourceBalance
  const isFull = Math.abs(value - remaining) < 0.005

  const submit = () => {
    if (busy) return
    if (!(value > 0)) return setError('ใส่จำนวนเงินที่จะจ่าย')
    if (value > remaining + 0.005) return setError(`จ่ายได้ไม่เกินยอดของรายการ ${fmt(remaining)} บาท`)
    const resolved = method === 'transfer' ? resolveAccount(accountId) : null
    if (method === 'transfer' && !resolved) return setError('เลือกบัญชีที่จะจ่าย')
    onConfirm({ method, accountId: resolved, amount: value, date })
  }

  return (
    <Popup
      title="จ่ายรายการนี้ก่อนออกบิล"
      sub={cardLabel}
      icon="credit_card"
      tone="out"
      width={440}
      onClose={onCancel}
      onConfirm={submit}
      busy={busy}
      confirmLabel={`จ่าย ${fmt(value)} บาท`}
      error={error}
    >
      <div className="flex-none bg-[#FAF9F6] border border-[#EFEDE7] rounded-[14px] px-3.5 py-3">
        <div className="text-[11.5px] text-faint">
          รูด {formatIsoThai(item.date)}{item.tag ? ` · ${item.tag}` : ''}
        </div>
        <div className="text-[13.5px] font-semibold truncate mt-px">{item.name}</div>
        <div className="tabular-nums text-[27px] font-semibold tracking-[-0.025em] leading-[1.15] mt-0.5">
          {fmt(remaining)}
        </div>
        {Number(item.paid) > 0 && (
          <div className="text-[11.5px] text-faint mt-0.5">
            ยอดรายการ {fmt(item.amount)} · จ่ายไปแล้ว {fmt(item.paid)}
          </div>
        )}
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
        <div className="grid grid-cols-2 gap-2 mb-[7px]">
          <button
            onClick={() => { setAmount(String(remaining)); setError('') }}
            className={`h-8 rounded-[9px] border border-hairline text-[12px] font-semibold ${
              isFull ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-paper'
            }`}
          >
            เต็มรายการ {fmt(remaining)}
          </button>
          <button
            onClick={() => { setAmount(''); setError('') }}
            className={`h-8 rounded-[9px] border border-hairline text-[12px] font-semibold ${
              !isFull ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-paper'
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

      {value > 0 && value < remaining - 0.005 && (
        <div className="flex-none bg-pending-soft border border-pending-line rounded-ctl px-3 py-2.5 text-[11.5px] text-[#8A6A15] leading-relaxed">
          จ่ายบางส่วน — อีก {fmt(remaining - value)} บาท ของรายการนี้จะยังอยู่ในบิลรอบที่กำลังมาถึง
        </div>
      )}

      {notEnough && (
        <p className="flex-none text-[11.5px] text-expense bg-expense-soft rounded-ctl px-3 py-2">
          ยอดใน{method === 'cash' ? 'เงินสด' : 'บัญชีที่เลือก'}มี {fmt(sourceBalance)} บาท จ่ายแล้วจะติดลบ
        </p>
      )}

      <p className="flex-none text-[11px] text-faint leading-relaxed">
        ยอดนี้จะถูกหักออกจาก "รอบถัดไปสะสมแล้ว" ทันที และเมื่อบิลออก ใบนั้นจะขึ้นว่าจ่ายไปแล้วเท่านี้
        เป็นการย้ายเงินไปปิดหนี้บัตร ไม่ใช่รายจ่ายก้อนใหม่ — รายจ่ายถูกบันทึกไปแล้วตั้งแต่วันที่รูด
      </p>
    </Popup>
  )
}
