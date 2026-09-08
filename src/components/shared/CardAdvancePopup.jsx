import { useState } from 'react'
import Popup from './Popup'
import { format } from 'date-fns'
import AmountInput from './AmountInput'
import DatePicker from './DatePicker'
import TransferAccountPicker from './TransferAccountPicker'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * กดเงินสดจากบัตรเครดิต (แบบ Wallet Story)
 *
 * เงินที่กดเป็นการ "ย้ายเงิน" จากบัตรมาเข้ากระเป๋า ไม่ใช่รายจ่าย — หนี้บัตรเพิ่ม เงินสดเพิ่ม
 * ค่าธรรมเนียมเท่านั้นที่เป็นรายจ่ายจริง (ธนาคารมักคิด 3% + VAT 7%) และไปโผล่ในรายงาน
 * ทั้งเงินที่กดและค่าธรรมเนียมเข้าบิลรอบที่กด
 *
 * onConfirm({ amount, fee, target, date, note })  target = 'cash' | 'transfer:<id>'
 */
export default function CardAdvancePopup({ cardLabel, onConfirm, onCancel, busy }) {
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState('')
  const [method, setMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const value = Number(amount) || 0
  const feeValue = Number(fee) || 0

  const suggestFee = () => {
    if (!(value > 0)) return setError('ใส่จำนวนเงินก่อน')
    setFee(String(Math.round(value * 0.03 * 1.07 * 100) / 100))
    setError('')
  }

  const submit = () => {
    if (busy) return
    if (!(value > 0)) return setError('ใส่จำนวนเงินที่กด')
    if (feeValue < 0) return setError('ค่าธรรมเนียมต้องไม่ติดลบ')
    if (method === 'transfer' && !accountId) return setError('เลือกบัญชีที่เงินเข้า')
    onConfirm({
      amount: value,
      fee: feeValue,
      target: method === 'cash' ? 'cash' : `transfer:${accountId}`,
      date,
      note,
    })
  }

  return (
    <Popup
      title="กดเงินสดจากบัตร"
      icon="point_of_sale"
      tone="out"
      width={420}
      onClose={onCancel}
      onConfirm={submit}
      busy={busy}
      confirmLabel="บันทึกการกดเงิน"
    >
          <p className="text-xs text-gray-500">{cardLabel}</p>

          <div>
            <label className="label">จำนวนเงินที่กด (บาท)</label>
            <AmountInput
              className="input text-right"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError('') }}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div>
            <label className="label">ค่าธรรมเนียม (บาท)</label>
            <div className="flex gap-2">
              <AmountInput
                className="input text-right flex-1"
                value={fee}
                onChange={(e) => { setFee(e.target.value); setError('') }}
                placeholder="0.00"
              />
              <button className="btn btn-secondary text-xs shrink-0 px-2" onClick={suggestFee}>3% + VAT</button>
            </div>
            <p className="text-xs text-gray-400 mt-1">ดูตัวเลขจริงจากสลิปตู้ ATM หรือแอปธนาคาร ค่าธรรมเนียมจะบันทึกเป็นรายจ่ายหมวด "ค่าธรรมเนียมบัตร"</p>
          </div>

          <div>
            <label className="label">เงินเข้าที่ไหน</label>
            <div className="flex gap-1.5 mb-1.5">
              <button
                className={`btn text-xs py-1 px-3 ${method === 'cash' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setMethod('cash'); setError('') }}
              >💵 เงินสด</button>
              <button
                className={`btn text-xs py-1 px-3 ${method === 'transfer' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setMethod('transfer'); setError('') }}
              >🏦 บัญชีเงินโอน</button>
            </div>
            {method === 'transfer' && (
              <TransferAccountPicker value={accountId} onChange={(id) => { setAccountId(id); setError('') }} label="" />
            )}
          </div>

          <div>
            <label className="label">วันที่กด</label>
            <DatePicker value={date} onChange={setDate} />
            <p className="text-xs text-gray-400 mt-1">ต้องเป็นวันในรอบบิลที่ยังไม่ปิด</p>
          </div>

          <div>
            <label className="label">หมายเหตุ</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น สำรองจ่ายซัพพลายเออร์" />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {error}</p>}

          {value > 0 && (
            <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-rose-800 space-y-0.5">
              <div className="flex justify-between"><span>หนี้บัตรเพิ่ม</span><span className="tabular-nums font-semibold">{fmt(value + feeValue)}</span></div>
              <div className="flex justify-between"><span>เงินเข้า{method === 'cash' ? 'เงินสด' : 'บัญชี'}</span><span className="tabular-nums">{fmt(value)}</span></div>
              {feeValue > 0 && <div className="flex justify-between"><span>ค่าธรรมเนียม (รายจ่าย)</span><span className="tabular-nums">{fmt(feeValue)}</span></div>}
            </div>
          )}
    </Popup>
  )
}
