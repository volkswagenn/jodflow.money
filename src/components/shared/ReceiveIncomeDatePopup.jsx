import Popup from './Popup'
import { useState } from 'react'
import { format } from 'date-fns'
import TransferAccountPicker from './TransferAccountPicker'
import DateTimeField, { toTimestamp } from './DateTimeField'
import useWalletStore from '../../store/useWalletStore'

export default function ReceiveIncomeDatePopup({ open, item, method, onConfirm, onCancel }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [receivedDate, setReceivedDate] = useState(today)
  const [receivedTime, setReceivedTime] = useState('')   // ว่าง = เที่ยงตรงของวันที่เลือก
  // ใช้บัญชีที่ผูกไว้ตอนเปิดบิลรอรับเงินเป็นค่าเริ่มต้น
  const [accountId, setAccountId] = useState(item?.defaultTransferAccountId ?? '')
  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)

  if (!open || !item) return null

  const methodLabel = method === 'cash' ? 'เงินสด' : 'เงินโอน'
  const needsAccount = method === 'transfer'
  const resolvedAccountId = needsAccount ? resolveAccount(accountId) : null
  const isToday = receivedDate === today
  const billDate = item.date
  const isBillDate = billDate && receivedDate === billDate

  return (
    <Popup
      title="ยืนยันการรับเงิน"
      sub={item.description}
      icon="savings"
      tone="in"
      width={420}
      onClose={onCancel}
      onConfirm={() => onConfirm(receivedDate, resolvedAccountId, toTimestamp(receivedDate, receivedTime))}
      disabled={!receivedDate || (needsAccount && !resolvedAccountId)}
      confirmLabel="ยืนยันรับเงิน"
    >
      <div className="flex-none bg-paper rounded-ctl px-3.5 py-3 flex flex-col gap-1.5">
        <div className="flex justify-between gap-2.5 text-[12.5px]">
          <span className="text-muted">ยอดรับ</span>
          <span className="tabular-nums font-bold text-income">{item.amount?.toLocaleString('th-TH')} บาท</span>
        </div>
        <div className="flex justify-between gap-2.5 text-[12.5px]">
          <span className="text-muted">รับเข้า</span>
          <span className="font-semibold">{methodLabel}</span>
        </div>
      </div>

      {needsAccount && (
        <TransferAccountPicker value={accountId} onChange={setAccountId} label="เข้าบัญชี" />
      )}

      <div className="flex-none">
        <DateTimeField
          label={isToday ? 'วันที่ได้รับเงิน (วันนี้)' : 'วันที่ได้รับเงิน'}
          date={receivedDate}
          time={receivedTime}
          onChange={({ date, time }) => { setReceivedDate(date); setReceivedTime(time) }}
        />
        {/* ทางลัดสองวันที่ใช้จริงเกือบทุกครั้ง — วันนี้ กับวันที่เปิดบิล
            (ลูกค้าโอนมาตั้งแต่วันเปิดบิลแต่เพิ่งมากดในระบบวันนี้) */}
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            type="button"
            onClick={() => setReceivedDate(today)}
            className={`h-8 px-3 rounded-[9px] border text-[12px] font-semibold ${
              isToday ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-hairline hover:bg-paper'
            }`}
          >
            วันนี้
          </button>
          {billDate && (
            <button
              type="button"
              onClick={() => setReceivedDate(billDate)}
              className={`h-8 px-3 rounded-[9px] border text-[12px] font-semibold ${
                isBillDate ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-hairline hover:bg-paper'
              }`}
            >
              รับเงินวันที่เปิดบิล
            </button>
          )}
        </div>
      </div>
    </Popup>
  )
}
