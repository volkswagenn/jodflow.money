import Popup from './Popup'
import { useState } from 'react'
import { format } from 'date-fns'
import TransferAccountPicker from './TransferAccountPicker'
import DateTimeField, { toTimestamp } from './DateTimeField'
import useWalletStore from '../../store/useWalletStore'
import SlipPicker from './SlipPicker'

export default function PayPendingDatePopup({ open, item, method, danger = false, onConfirm, onCancel }) {
  const [paidDate, setPaidDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [paidTime, setPaidTime] = useState('')   // ว่าง = เที่ยงตรงของวันที่เลือก
  // ใช้บัญชีที่ผูกไว้ตอนเปิดบิล/ตั้งรายการประจำเป็นค่าเริ่มต้น
  const [accountId, setAccountId] = useState(item?.defaultTransferAccountId ?? '')
  const [slipFiles, setSlipFiles] = useState([])
  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)

  if (!open || !item) return null

  const methodLabel = method === 'cash' ? 'เงินสด' : 'เงินโอน'
  const needsAccount = method === 'transfer'
  const resolvedAccountId = needsAccount ? resolveAccount(accountId) : null

  return (
    <Popup
      title={danger ? 'ยอดเงินจะติดลบ' : 'ยืนยันการชำระเงิน'}
      sub={item.description}
      icon={danger ? 'error' : 'payments'}
      headTone={danger ? 'danger' : 'default'}
      width={420}
      onClose={onCancel}
      onConfirm={() => onConfirm(paidDate, resolvedAccountId, toTimestamp(paidDate, paidTime), slipFiles)}
      danger={danger}
      disabled={!paidDate || (needsAccount && !resolvedAccountId)}
      confirmLabel="ยืนยันชำระ"
    >
      <div className="flex-none bg-paper rounded-ctl px-3.5 py-3 flex flex-col gap-1.5">
        <div className="flex justify-between gap-2.5 text-[12.5px]">
          <span className="text-muted">ยอดชำระ</span>
          <span className="tabular-nums font-bold">{item.amount?.toLocaleString('th-TH')} บาท</span>
        </div>
        <div className="flex justify-between gap-2.5 text-[12.5px]">
          <span className="text-muted">วิธีชำระ</span>
          <span className="font-semibold">{methodLabel}</span>
        </div>
      </div>

      {danger && (
        <p className="flex-none text-[11.5px] text-expense bg-expense-soft border border-[#F0C4BE] rounded-ctl px-3 py-2.5 leading-relaxed">
          การชำระนี้จะทำให้ยอด{methodLabel}ติดลบ กรุณาตรวจสอบก่อนยืนยัน
        </p>
      )}

      {needsAccount && (
        <TransferAccountPicker value={accountId} onChange={setAccountId} label="ตัดจากบัญชี" />
      )}

      <DateTimeField
        label="วันที่จ่ายเงิน"
        date={paidDate}
        time={paidTime}
        onChange={({ date, time }) => { setPaidDate(date); setPaidTime(time) }}
      />

      <SlipPicker files={slipFiles} onChange={setSlipFiles} />
    </Popup>
  )
}
