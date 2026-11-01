import { useState } from 'react'
import Popup from '../../components/shared/Popup'
import AmountInput from '../../components/shared/AmountInput'
import { format } from 'date-fns'
import TransferAccountPicker from '../../components/shared/TransferAccountPicker'
import CreditCardPicker from '../../components/shared/CreditCardPicker'
import DateTimeField, { toTimestamp } from '../../components/shared/DateTimeField'
import useWalletStore from '../../store/useWalletStore'
import useCreditCardStore from '../../store/useCreditCardStore'
import SlipPicker from '../../components/shared/SlipPicker'

const METHOD_OPTIONS = [
  { value: 'cash', label: '💵 เงินสด' },
  { value: 'transfer', label: '🏦 โอนเงิน' },
  { value: 'card', label: '💳 บัตรเครดิต' },
  { value: 'pending', label: '📋 ค้างชำระ' },
]

export default function PayEntryPopup({ entry, item, onConfirm, onSaveAmount, onClose }) {
  const isVariable = item.amountType === 'variable'
  const [amount, setAmount] = useState(entry.amount > 0 ? String(entry.amount) : '')
  // ใช้วิธีจ่าย/บัญชีที่ตั้งไว้ตอนสร้างรายการประจำเป็นค่าเริ่มต้น
  const [method, setMethod] = useState(item.defaultMethod ?? '')
  const [accountId, setAccountId] = useState(item.defaultTransferAccountId ?? '')
  const [cardId, setCardId] = useState(item.defaultCardId ?? '')
  const [paidDate, setPaidDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [paidTime, setPaidTime] = useState('')   // ว่าง = เที่ยงตรงของวันที่เลือก
  const [slipFiles, setSlipFiles] = useState([])
  const [error, setError] = useState('')

  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)
  const resolveCard = useCreditCardStore((s) => s.resolveCardId)

  const parsedAmount = parseFloat(amount)
  const canSaveAmount = !isNaN(parsedAmount) && parsedAmount > 0
  const needsAccount = method === 'transfer'
  const needsCard = method === 'card'
  // รูดบัตรกับค้างชำระยังไม่มีเงินออก จึงยังไม่มีสลิปให้แนบ
  const canAttachSlip = method === 'cash' || method === 'transfer'
  const canSubmit = method && paidDate && canSaveAmount
    && (!needsAccount || !!resolveAccount(accountId))
    && (!needsCard || !!resolveCard(cardId))

  const handleSaveAmount = () => {
    if (!canSaveAmount) { setError('กรุณากรอกยอดเงินที่ถูกต้อง'); return }
    onSaveAmount(parsedAmount)
  }

  const handleConfirm = () => {
    if (!method) { setError('กรุณาเลือกวิธีชำระ'); return }
    if (!parsedAmount || parsedAmount <= 0) { setError('กรุณากรอกยอดเงินที่ถูกต้อง'); return }
    if (!paidDate) { setError('กรุณาเลือกวันที่จ่ายเงิน'); return }
    if (needsAccount && !resolveAccount(accountId)) { setError('กรุณาเลือกบัญชีที่จะตัดเงิน'); return }
    if (needsCard && !resolveCard(cardId)) { setError('กรุณาเลือกบัตรเครดิต'); return }
    onConfirm(
      parsedAmount, method, paidDate,
      needsAccount ? resolveAccount(accountId) : null,
      needsCard ? resolveCard(cardId) : null,
      toTimestamp(paidDate, paidTime),
      canAttachSlip ? slipFiles : []
    )
  }

  return (
    <Popup
      title="บันทึกการจ่าย"
      sub={item.name}
      icon="history"
      width={460}
      onClose={onClose}
      footer={
        <div className="flex-none flex items-center gap-2 px-[17px] py-3 border-t border-[#EFEDE7] bg-[#FAF9F6]">
          <button
            onClick={onClose}
            className="h-[38px] px-4 rounded-[11px] border border-hairline bg-white text-[13px] font-semibold hover:bg-paper"
          >
            ยกเลิก
          </button>
          {/* รายการยอดไม่คงที่มีปุ่มบันทึกยอดแยก — เอาไว้จดยอดบิลก่อนโดยยังไม่จ่าย */}
          {isVariable && (
            <button
              onClick={handleSaveAmount}
              disabled={!canSaveAmount}
              className="h-[38px] px-4 rounded-[11px] border border-hairline bg-white text-[13px] font-semibold hover:bg-paper disabled:opacity-50"
            >
              บันทึกยอด
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="ml-auto h-[38px] px-[18px] rounded-[11px] bg-ink text-white text-[13px] font-semibold hover:brightness-125 disabled:opacity-50"
          >
            จ่ายแล้ว
          </button>
        </div>
      }
    >
          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              ยอดเงิน (บาท) {isVariable && <span className="text-red-500">*</span>}
            </label>
            <AmountInput
              className="input w-full text-right text-lg font-bold"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError('') }}
              placeholder="0.00"
              autoFocus={isVariable}
            />
            {!isVariable && (
              <p className="text-xs text-gray-400 mt-1">ยอดคงที่จาก template แก้ไขได้หากจำเป็น</p>
            )}
          </div>

          {/* Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              วิธีชำระ <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {METHOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setMethod(opt.value); setError('') }}
                  className={`py-2.5 px-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    method === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {item.defaultMethod && (
              <p className="text-xs text-gray-400 mt-1">เลือกให้อัตโนมัติจากที่ตั้งไว้ในรายการประจำ</p>
            )}
          </div>

          {/* บัญชีที่จะตัดเงิน */}
          {needsAccount && (
            <TransferAccountPicker value={accountId} onChange={setAccountId} label="ตัดจากบัญชี" />
          )}

          {/* รูดบัตร — ไม่ตัดเงินสด/เงินโอน แต่ไปเพิ่มหนี้ในบัตรแทน */}
          {needsCard && (
            <>
              <CreditCardPicker value={cardId} onChange={setCardId} label="รูดบัตร" />
              <p className="text-xs text-gray-500">
                ยอดนี้จะไปสะสมเป็นหนี้ในบัตร แล้วไปรวมอยู่ในบิลของรอบนั้น ไม่ตัดเงินตอนนี้
              </p>
            </>
          )}

          {/* Paid date + time */}
          <DateTimeField
            label="วันที่จ่ายเงิน *"
            date={paidDate}
            time={paidTime}
            onChange={({ date, time }) => { setPaidDate(date); setPaidTime(time); setError('') }}
          />

          {canAttachSlip && <SlipPicker files={slipFiles} onChange={setSlipFiles} />}

          {error && <p className="text-sm text-red-500">{error}</p>}
    </Popup>
  )
}
