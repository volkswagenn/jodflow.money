import Popup from './Popup'
import UiIcon from './UiIcon'
import { useState } from 'react'
import { format } from 'date-fns'
import useWalletStore from '../../store/useWalletStore'
import DatePicker from './DatePicker'
import TransferAccountPicker from './TransferAccountPicker'
import { formatIsoThai } from '../../lib/cardCycle'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * จ่ายงวดหนี้ / รับคืนงวดหนี้
 * ให้เห็นก่อนกดยืนยันว่าหลังจ่ายแล้วคงเหลือเท่าไร เหลือกี่งวด งวดถัดไปวันไหน
 * และเงินในกระเป๋าที่เลือกจะเหลือเท่าไร
 *
 * onConfirm({ method, accountId, amount, date })
 */
export default function PayDebtPopup({ debt, entry, progress, onConfirm, onCancel, busy }) {
  const isRecv = debt.direction === 'receivable'
  const [method, setMethod] = useState(debt.defaultMethod || 'transfer')
  const [accountId, setAccountId] = useState(debt.defaultAccountId || '')
  const [amount, setAmount] = useState(String(entry.amount))
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [error, setError] = useState('')

  const cash = useWalletStore((s) => s.cash)
  const accounts = useWalletStore((s) => s.transferAccounts)
  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)

  const value = Number(amount) || 0
  const resolved = method === 'transfer' ? resolveAccount(accountId) : null
  const source = method === 'cash' ? cash : (accounts.find((a) => a.id === resolved)?.balance ?? null)
  const after = source === null ? null : (isRecv ? source + value : source - value)

  const remainingAfter = Math.max(0, progress.remainingAmount - value)
  const countAfter = Math.max(0, progress.remainingCount - 1)
  const nextAfter = progress.rows.find((r) => r.status === 'pending' && r.seq > entry.seq) ?? null

  const submit = () => {
    if (busy) return
    if (!(value > 0)) return setError('ใส่จำนวนเงิน')
    if (method === 'transfer' && !resolved) return setError('เลือกบัญชี')
    onConfirm({ method, accountId: resolved, amount: value, date })
  }

  return (
    <Popup
      title={isRecv ? 'รับคืนค่างวด' : 'จ่ายค่างวด'}
      sub={`${debt.name} · งวดที่ ${entry.seq} จาก ${debt.months}`}
      icon="receipt_long"
      tone="out"
      width={420}
      onClose={onCancel}
      onConfirm={submit}
      busy={busy}
      confirmLabel={`${isRecv ? 'ยืนยันรับคืน' : 'ยืนยันจ่าย'} ${fmt(value)}`}
      error={error}
    >
      {/* ยอดงวดตัวใหญ่บนสุด — เป็นตัวเลขเดียวที่ต้องยืนยันก่อนกด */}
      <div className={`flex-none rounded-[14px] px-3.5 py-3 ${isRecv ? 'bg-income-soft border border-[#BFE0D2]' : 'bg-paper'}`}>
        <div className="text-[11.5px] text-muted">ยอดงวดนี้</div>
        <div className={`tabular-nums text-[29px] font-semibold tracking-[-0.025em] leading-[1.15] ${isRecv ? 'text-income' : 'text-ink'}`}>
          {fmt(value)}
        </div>
        <div className="text-[11.5px] text-faint mt-0.5">ครบกำหนด {formatIsoThai(entry.dueDate)}</div>
      </div>

      <div className="flex-none">
        <label className="block text-[11.5px] text-muted mb-[5px]">{isRecv ? 'รับเข้า' : 'จ่ายจาก'}</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'cash', label: 'เงินสด', icon: 'cash', sub: fmt(cash) },
            { key: 'transfer', label: 'เงินโอน', icon: 'bank', sub: '' },
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
                {m.sub && <span className="tabular-nums text-[11px] opacity-70">{m.sub}</span>}
              </button>
            )
          })}
        </div>
        {method === 'transfer' && (
          <div className="mt-2"><TransferAccountPicker value={accountId} onChange={setAccountId} label="" /></div>
        )}
      </div>

      <div className="flex-none grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11.5px] text-muted mb-[5px]">วันที่</label>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <label className="block text-[11.5px] text-muted mb-[5px]">จำนวน</label>
          <input
            className="input h-10 text-right tabular-nums"
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError('') }}
          />
        </div>
      </div>

      {/* บอกผลหลังกด — เหลือกี่งวด ปิดสัญญาเมื่อไหร่ เงินในกระเป๋าจะเหลือเท่าไร */}
      <div className="flex-none rounded-ctl bg-paper px-3 py-2.5 text-[11.5px] flex flex-col gap-1">
        <p className="text-muted">หลัง{isRecv ? 'รับคืน' : 'จ่าย'}งวดนี้</p>
        <div className="flex justify-between"><span>คงเหลือ</span><span className="tabular-nums font-semibold">{fmt(remainingAfter)}</span></div>
        <div className="flex justify-between"><span>เหลืออีก</span><span className="tabular-nums font-semibold">{countAfter} งวด</span></div>
        {nextAfter ? (
          <div className="flex justify-between">
            <span>งวดถัดไป งวดที่ {nextAfter.seq}</span>
            <span className="tabular-nums">{formatIsoThai(nextAfter.dueDate)}</span>
          </div>
        ) : (
          <div className="flex justify-between text-income font-semibold"><span>งวดสุดท้าย</span><span>ปิดสัญญา</span></div>
        )}
        {after !== null && (
          <div className={`flex justify-between border-t border-hairline pt-1 mt-0.5 ${after < 0 ? 'text-expense' : 'text-income'}`}>
            <span>{isRecv ? 'เงินในกระเป๋าหลังรับ' : 'เงินในกระเป๋าหลังจ่าย'}</span>
            <span className="tabular-nums font-semibold">{fmt(after)}</span>
          </div>
        )}
      </div>
    </Popup>
  )
}
