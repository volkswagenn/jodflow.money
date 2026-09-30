import Popup from '../../components/shared/Popup'
import { useState } from 'react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import useDebtStore from '../../store/useDebtStore'
import useWalletStore from '../../store/useWalletStore'
import useLogStore from '../../store/useLogStore'
import { buildLogEntry } from '../../lib/logBuilder'
import { formatIsoThai, daysUntil } from '../../lib/cardCycle'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import DatePicker from '../../components/shared/DatePicker'
import TransferAccountPicker from '../../components/shared/TransferAccountPicker'
import PayDebtPopup from '../../components/shared/PayDebtPopup'
import SourceTag from '../../components/shared/SourceTag'
import EntryPips from '../../components/shared/EntryPips'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * สีของสถานะงวด — ชุดเดียวกับตารางงวดผ่อนบัตร (Recurring/InstallmentList)
 *
 * งวดที่จ่ายไปแล้วต้องเป็นสีเขียวทั้งคู่ ไม่งั้นงวดที่ผ่อนมาก่อนเริ่มใช้แอปจะดูเหมือน
 * ยังไม่จ่าย ทั้งที่จ่ายไปแล้วจริง — สัญญาผ่อนรถ 60 งวดที่ผ่อนมาแล้ว 23 งวด
 * จะอ่านแล้วนึกว่าค้างทั้งตาราง แต่ใช้เขียวคนละเฉดเพื่อให้ยังแยกออกว่างวดไหน
 * กดจ่ายผ่านแอป (มีเงินออกจากกระเป๋าให้ตรวจสอบย้อนได้) กับงวดไหนแค่บันทึกไว้เฉยๆ
 */
const STATUS = {
  paid:      { label: '✓ จ่ายแล้ว', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  prepaid:   { label: '✓ ผ่อนมาก่อนใช้ระบบ', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  pending:   { label: 'ยังไม่ถึง', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-gray-50 text-gray-400 border-gray-200 line-through' },
}

function SettlePopup({ debt, progress, onConfirm, onCancel, busy }) {
  const [method, setMethod] = useState(debt.defaultMethod || 'transfer')
  const [accountId, setAccountId] = useState(debt.defaultAccountId || '')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [fee, setFee] = useState('')
  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)
  const total = progress.remainingAmount + (Number(fee) || 0)
  return (
    <Popup
      title="ปิดยอดคงเหลือ"
      icon="receipt_long"
      width={420}
      onClose={onCancel}
      onConfirm={undefined}
      busy={busy}
      confirmLabel="ปิดยอด"
    >
        <p className="text-sm text-gray-600">รวม {progress.remainingCount} งวดที่เหลือ <strong className="tabular-nums">{fmt(progress.remainingAmount)}</strong> บาท แล้วปิดสัญญา "{debt.name}"</p>
        <div className="grid grid-cols-2 gap-2">
          <button className={`btn text-sm ${method === 'cash' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod('cash')}>💵 เงินสด</button>
          <button className={`btn text-sm ${method === 'transfer' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod('transfer')}>🏦 เงินโอน</button>
        </div>
        {method === 'transfer' && <TransferAccountPicker value={accountId} onChange={setAccountId} label="" />}
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">วันที่</label><DatePicker value={date} onChange={setDate} /></div>
          <div><label className="label">ค่าธรรมเนียม</label><input className="input text-right" type="number" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" /></div>
        </div>
        <p className="text-xs text-gray-500">ยอดรวมที่จะจ่าย {fmt(total)} บาท</p>
    </Popup>
  )
}

function DebtCard({ debt, onPay, onUndo, onSettle, onCancelDebt }) {
  const [open, setOpen] = useState(false)
  const progress = useDebtStore((s) => s.getProgress(debt.id))
  if (!progress) return null
  const isRecv = debt.direction === 'receivable'
  const active = debt.status === 'active'
  const next = progress.next
  const left = next ? daysUntil(new Date(next.dueDate + 'T00:00:00')) : null
  const tone = isRecv ? 'text-emerald-700' : 'text-amber-800'

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${active ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-lg grid place-items-center text-lg shrink-0 ${isRecv ? 'bg-emerald-50' : 'bg-amber-50'}`}>{isRecv ? '🤝' : '📒'}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">
            {debt.name}
            {!active && <span className="ml-2 text-xs font-normal text-gray-400">{debt.status === 'completed' ? 'ปิดแล้ว' : 'ยกเลิก'}</span>}
          </p>
          <p className="text-xs text-gray-500 truncate flex items-center gap-1.5 flex-wrap">
            <SourceTag source={isRecv ? 'receivable' : 'debt'} detail={debt.counterparty || undefined} />
            <span className="truncate">{isRecv ? 'คนอื่นติดเรา' : 'เราติดคนอื่น'}</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">{isRecv ? 'รอรับคืน' : 'คงเหลือ'}</p>
          <p className={`font-bold tabular-nums ${tone}`}>{fmt(progress.remainingAmount)}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1 gap-3">
          <span>งวดละ {fmt(debt.monthlyAmount)} · ยอดรวม {fmt(debt.totalAmount)}</span>
          <span className="tabular-nums shrink-0">งวด {progress.doneCount} จาก {debt.months}</span>
        </div>
        {/* ป้ายทุกงวดแทนแถบความคืบหน้า — แบบเดียวกับหน้าบัตร เห็นเลยว่างวดไหนครบกำหนดวันไหน
            จ่ายแล้วหรือยัง ไม่ต้องกดเปิดตารางก่อน (ตารางด้านล่างยังอยู่ไว้ดูวันจ่ายจริงและย้อนการจ่าย) */}
        <EntryPips rows={progress.rows} />
      </div>

      {active && next && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 flex-wrap">
          <p className="text-xs text-gray-600 min-w-0">
            งวดถัดไป งวดที่ {next.seq} · <strong className="tabular-nums">{fmt(next.amount)}</strong> · {formatIsoThai(next.dueDate)}
            {left !== null && (
              <span className={`ml-1 ${left < 0 ? 'text-red-600 font-medium' : left <= 7 ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>
                {left < 0 ? `เกินกำหนด ${-left} วัน` : `อีก ${left} วัน`}
              </span>
            )}
          </p>
          <button className="btn btn-primary text-xs !h-8 px-3 shrink-0" onClick={() => onPay(debt, next, progress)}>
            {isRecv ? 'รับคืน' : 'จ่ายงวด'}
          </button>
        </div>
      )}

      <div className="flex gap-2 items-center flex-wrap">
        <button className="text-xs text-gray-500 hover:text-gray-700 mr-auto" onClick={() => setOpen((v) => !v)}>
          {open ? '▲ ซ่อนตารางงวด' : `▼ ตารางงวด (${debt.months})`}
        </button>
        {active && progress.remainingCount > 0 && (
          <>
            <button className="btn btn-secondary text-xs py-1 px-2.5" onClick={() => onSettle(debt, progress)}>ปิดยอดคงเหลือ</button>
            <button className="btn btn-secondary text-xs py-1 px-2.5 text-red-600" onClick={() => onCancelDebt(debt, progress)}>ยกเลิก</button>
          </>
        )}
      </div>

      {open && (
        <div className="border-t pt-2 overflow-x-auto">
          <table className="w-full text-xs min-w-[400px]">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="py-1 pr-2 font-medium">งวด</th>
                <th className="py-1 pr-2 font-medium">ครบกำหนด</th>
                <th className="py-1 pr-2 font-medium text-right">จำนวน</th>
                <th className="py-1 pr-2 font-medium">สถานะ</th>
                <th className="py-1 font-medium">จ่ายจริง</th>
              </tr>
            </thead>
            <tbody>
              {progress.rows.map((r) => {
                const st = STATUS[r.status] ?? STATUS.pending
                const early = r.status === 'paid' && r.paidAt && r.paidAt.slice(0, 10) < r.dueDate
                return (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="py-1.5 pr-2 tabular-nums text-gray-600">{r.seq}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-gray-500">{formatIsoThai(r.dueDate)}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-right text-gray-700">{fmt(r.amount)}</td>
                    <td className="py-1.5 pr-2"><span className={`inline-block rounded-full border px-2 py-0.5 ${st.cls}`}>{st.label}</span></td>
                    <td className="py-1.5 tabular-nums text-emerald-600 whitespace-nowrap">
                      {r.paidAt ? formatIsoThai(r.paidAt.slice(0, 10)) : '—'}
                      {early && <span className="ml-1 rounded-full bg-lime px-1.5 text-[10px] text-ink">ก่อนกำหนด</span>}
                      {r.status === 'paid' && active && (
                        <button className="ml-2 text-gray-400 hover:text-red-600" onClick={() => onUndo(debt, r)}>ย้อน</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function DebtList({ embedded = false, bare = false }) {
  const debts = useDebtStore((s) => s.debts)
  const totals = useDebtStore((s) => s.getTotals())
  const { payEntry, undoEntry, settleDebt, cancelDebt } = useDebtStore()
  const refreshWallet = useWalletStore((s) => s.refresh)
  const { addLog } = useLogStore()

  const [payTarget, setPayTarget] = useState(null)
  const [undoTarget, setUndoTarget] = useState(null)
  const [settleTarget, setSettleTarget] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const handlePay = ({ method, accountId, amount, date }) => run(async () => {
    const { debt, entry } = payTarget
    const isRecv = debt.direction === 'receivable'
    await payEntry(entry.id, {
      method, accountId, amount, date,
      log: buildLogEntry({
        activityType: isRecv ? 'DEBT_RECEIVE' : 'DEBT_PAY',
        description: `${isRecv ? 'รับคืน' : 'จ่าย'}งวดที่ ${entry.seq}/${debt.months} "${debt.name}" ${fmt(amount)} บาท ${isRecv ? 'เข้า' : 'จาก'}${method === 'cash' ? 'เงินสด' : 'เงินโอน'}`,
        walletEffect: { target: method, delta: isRecv ? amount : -amount, transferAccountId: accountId },
        newValue: { debtId: debt.id, entryId: entry.id, amount, date },
      }),
    })
    await refreshWallet()
    setPayTarget(null)
  })

  const handleUndo = () => run(async () => {
    const { debt, entry } = undoTarget
    await undoEntry(entry.id, buildLogEntry({
      activityType: 'DEBT_UNDO',
      description: `ย้อนการจ่ายงวดที่ ${entry.seq} "${debt.name}" ${fmt(entry.amount)} บาท`,
      oldValue: entry,
    }))
    await refreshWallet()
    setUndoTarget(null)
  })

  const handleSettle = ({ method, accountId, date, fee }) => run(async () => {
    const { debt, progress } = settleTarget
    await settleDebt(debt.id, {
      method, accountId, date, fee,
      log: buildLogEntry({
        activityType: 'DEBT_SETTLE',
        description: `ปิดยอด "${debt.name}" ${progress.remainingCount} งวด ${fmt(progress.remainingAmount + fee)} บาท`,
        newValue: { debtId: debt.id, amount: progress.remainingAmount, fee },
      }),
    })
    await refreshWallet()
    setSettleTarget(null)
  })

  const handleCancel = () => run(async () => {
    const { debt, progress } = cancelTarget
    await cancelDebt(debt.id, buildLogEntry({
      activityType: 'DEBT_CANCEL',
      description: `ยกเลิก "${debt.name}" เหลือ ${progress.remainingCount} งวด`,
      oldValue: debt,
    }))
    setCancelTarget(null)
  })

  const active = debts.filter((d) => d.status === 'active')
  const done = debts.filter((d) => d.status !== 'active')

  return (
    <div className="space-y-3">
      {/* bare = หน้าที่เรียกมามีหัวข้อและยอดรวมของตัวเองอยู่แล้ว (หน้าบัตรและหนี้สิน)
          ถ้าไม่ซ่อน จะเห็นหัวข้อกับยอดรวมซ้ำสองชุดติดกัน */}
      {!bare && (
      <div className="flex items-start justify-between gap-3">
        {embedded ? (
          <div className="min-w-0">
            <h2 className="section-title">📒 หนี้สินและลูกหนี้</h2>
            <p className="text-xs text-gray-500 mt-1">
              สัญญาผ่อน เงินกู้ และเงินที่ให้คนอื่นยืม — จ่ายทีละงวดได้ที่นี่
              เงินออกจากกระเป๋าที่เลือกทันที ไม่ผ่านบิลบัตร
            </p>
          </div>
        ) : (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex-1 min-w-0">
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-amber-900">เราติดคนอื่น</span>
            <span className="font-bold tabular-nums text-amber-800">{fmt(totals.payable)}</span>
          </div>
          {totals.receivable > 0 && (
            <div className="flex justify-between gap-3 text-sm mt-0.5">
              <span className="text-emerald-800">คนอื่นติดเรา</span>
              <span className="font-bold tabular-nums text-emerald-700">{fmt(totals.receivable)}</span>
            </div>
          )}
        </div>
        )}
        <Link to="/manage/debts" className="btn btn-secondary text-xs shrink-0">จัดการหนี้สิน</Link>
      </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {error}</p>}

      {active.length === 0 && done.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <div className="text-3xl mb-2">📒</div>
          <p className="text-sm">ยังไม่มีหนี้สิน</p>
          <p className="text-xs mt-1">
            เพิ่มได้ที่{' '}
            <Link to="/manage/debts" className="text-blue-600 hover:underline">จัดการข้อมูล → หนี้สิน</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {active.map((d) => (
              <DebtCard key={d.id} debt={d}
                onPay={(debt, entry, progress) => setPayTarget({ debt, entry, progress })}
                onUndo={(debt, entry) => setUndoTarget({ debt, entry })}
                onSettle={(debt, progress) => setSettleTarget({ debt, progress })}
                onCancelDebt={(debt, progress) => setCancelTarget({ debt, progress })} />
            ))}
          </div>
          {done.length > 0 && (
            <div>
              <button className="text-xs text-gray-500 hover:text-gray-700" onClick={() => setShowDone((v) => !v)}>
                {showDone ? '▲ ซ่อนที่จบแล้ว' : `▼ ที่จบแล้ว ${done.length} รายการ`}
              </button>
              {showDone && (
                <div className="space-y-2.5 mt-2.5">
                  {done.map((d) => <DebtCard key={d.id} debt={d} onPay={() => {}} onUndo={() => {}} onSettle={() => {}} onCancelDebt={() => {}} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {payTarget && <PayDebtPopup debt={payTarget.debt} entry={payTarget.entry} progress={payTarget.progress} onConfirm={handlePay} onCancel={() => setPayTarget(null)} busy={busy} />}
      {settleTarget && <SettlePopup debt={settleTarget.debt} progress={settleTarget.progress} onConfirm={handleSettle} onCancel={() => setSettleTarget(null)} busy={busy} />}

      <ConfirmPopup open={!!undoTarget} title="ย้อนการจ่ายงวด"
        message={undoTarget ? `คืนเงิน ${fmt(undoTarget.entry.amount)} บาท กลับกระเป๋าเดิม ลบรายการที่สร้างไว้ และงวดที่ ${undoTarget.entry.seq} กลับเป็นยังไม่จ่าย\n\nยืนยันหรือไม่?` : ''}
        onConfirm={handleUndo} onCancel={() => setUndoTarget(null)} confirmLabel="ย้อนการจ่าย" danger />
      <ConfirmPopup open={!!cancelTarget} title="ยกเลิกหนี้สิน"
        message={cancelTarget ? `ยกเลิกงวดที่เหลือ ${cancelTarget.progress.remainingCount} งวด (${fmt(cancelTarget.progress.remainingAmount)} บาท) ของ "${cancelTarget.debt.name}"?\n\nงวดที่จ่ายไปแล้วยังอยู่ เพราะเกิดขึ้นจริง` : ''}
        onConfirm={handleCancel} onCancel={() => setCancelTarget(null)} confirmLabel="ยกเลิกหนี้สิน" danger />
    </div>
  )
}
