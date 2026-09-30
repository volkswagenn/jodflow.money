import Popup from '../../components/shared/Popup'
import { useState } from 'react'
import AmountInput from '../../components/shared/AmountInput'
import { format } from 'date-fns'
import useCreditCardStore from '../../store/useCreditCardStore'
import useLogStore from '../../store/useLogStore'
import { buildLogEntry } from '../../lib/logBuilder'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import DatePicker from '../../components/shared/DatePicker'
import AppIcon from '../../components/shared/AppIcon'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import PayCardBillPopup from '../../components/shared/PayCardBillPopup'
import PickBillPopup from './PickBillPopup'
import PayInstallmentPopup from './PayInstallmentPopup'
import InstallmentFormPopup from '../../components/shared/InstallmentFormPopup'
import InstallmentHistoryPopup from '../../components/shared/InstallmentHistoryPopup'
import useWalletStore from '../../store/useWalletStore'
import { formatIsoThai } from '../../lib/cardCycle'
import SourceTag from '../../components/shared/SourceTag'
import EntryPips from '../../components/shared/EntryPips'
import useTransactionStore from '../../store/useTransactionStore'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * สีของสถานะงวด
 *
 * งวดที่จ่ายไปแล้วต้องเป็นสีเขียวทั้งคู่ ไม่งั้นงวดที่ผ่อนมาก่อนเริ่มใช้แอปจะดูเหมือน
 * ยังไม่จ่าย ทั้งที่จ่ายไปแล้วจริง — แต่ใช้เขียวคนละเฉดเพื่อให้ยังแยกออกว่า
 * งวดไหนกดจ่ายผ่านแอป (มีเงินออกจากกระเป๋าให้ตรวจสอบได้) กับงวดไหนแค่บันทึกไว้เฉยๆ
 */
const STATUS_STYLE = {
  paid:      { label: '✓ จ่ายแล้ว', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  prepaid:   { label: '✓ จ่ายมาก่อนใช้ระบบ', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  billed:    { label: 'อยู่ในบิล รอจ่าย', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending:   { label: 'ยังไม่ถึงรอบ', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-gray-50 text-gray-400 border-gray-200 line-through' },
}

function SettlePopup({ installment, remaining, count, onConfirm, onCancel, busy }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [fee, setFee] = useState('')

  return (
    <Popup
      title="ปิดยอดคงเหลือ"
      icon="credit_card"
      width={420}
      onClose={onCancel}
      onConfirm={undefined}
      busy={busy}
      confirmLabel="ปิดยอด"
    >
        <p className="text-sm text-gray-600">
          รวมงวดที่เหลือ <strong>{count} งวด</strong> เป็นรายการเดียว{' '}
          <strong className="tabular-nums">{fmt(remaining)}</strong> บาท
          เข้าบิลรอบที่เปิดอยู่ แล้วปิดสัญญา "{installment.name}"
        </p>
        <div>
          <label className="label">วันที่ปิดยอด</label>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <label className="label">ค่าธรรมเนียมปิดยอด (ถ้ามี)</label>
          <AmountInput
            className="input"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <p className="text-xs text-gray-500">
          ยอดรวมที่จะเข้าบิล {fmt(remaining + (Number(fee) || 0))} บาท
        </p>
    </Popup>
  )
}

function InstallmentCard({ installment, paidViaBill = null, onSettle, onCancelInstallment, onPayEntry, onUndoEntry, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const progress = useCreditCardStore((s) => s.getInstallmentProgress(installment.id))
  const cardLabel = useCreditCardStore((s) => s.getCardLabel(installment.cardId))
  const cardShort = useCreditCardStore((s) => s.getCardShortLabel(installment.cardId))
  const card = useCreditCardStore((s) => s.getCard(installment.cardId))
  if (!progress) return null

  const total = Number(installment.totalAmount)
  // สัญญาเก่าที่สร้างก่อนมีช่องดอกเบี้ยจะไม่มี principalAmount ให้ถือว่าเท่ายอดรวม
  const principal = Number(installment.principalAmount ?? installment.totalAmount)
  const interest = Math.round((total - principal) * 100) / 100
  const hasInterest = interest > 0
  const hasTiers = Array.isArray(installment.tiers) && installment.tiers.length > 1
  const done = progress.paidCount + progress.billedCount + progress.prepaidCount
  // "งวดถัดไป" คืองวดที่ยังไม่ถูกเรียกเก็บ งวดที่อยู่ในบิลแล้วถือว่าเลยไปแล้ว
  const nextRow = progress.rows.find((r) => r.status === 'pending')
  const isActive = installment.status === 'active'

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isActive ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 flex-none rounded-lg bg-paper flex items-center justify-center">
          <AppIcon value={card?.icon} size={18} fallback={DEFAULT_ICONS.card} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">
            {installment.name}
            {!isActive && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                {installment.status === 'completed' ? 'ผ่อนครบแล้ว' : 'ยกเลิกแล้ว'}
              </span>
            )}
          </p>
          <p className="text-xs text-gray-500 truncate flex items-center gap-1.5">
            <SourceTag source="installment" detail={cardShort} />
            <span className="truncate">{cardLabel}</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">คงเหลือ</p>
          {/* คงเหลือ = ที่ยังไม่ได้จ่ายจริง รวมงวดที่เข้าบิลแล้วแต่ยังไม่ได้จ่ายบิล */}
          <p className="font-bold tabular-nums text-rose-600">{fmt(progress.unpaidAmount)}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1 gap-3">
          <span>
            {hasTiers ? (
              <>
                ขั้นบันได {installment.tiers.length} ช่วง · ยอดรวม <strong className="text-gray-700">{fmt(total)}</strong>
                {' '}({installment.tiers.map((t) => `งวด ${t.from}-${t.to} ละ ${fmt(t.amount)}`).join(' · ')})
              </>
            ) : hasInterest ? (
              <>
                ราคา {fmt(principal)} + ดอกเบี้ย {fmt(interest)} ({installment.interestRate}% ต่อเดือน)
                {' '}= <strong className="text-gray-700">{fmt(total)}</strong> · งวดละ {fmt(installment.monthlyAmount)}
              </>
            ) : (
              <>ยอดเต็ม {fmt(total)} · งวดละ {fmt(installment.monthlyAmount)} · ผ่อน 0%</>
            )}
          </span>
          <span className="tabular-nums shrink-0">งวด {done} จาก {installment.months}</span>
        </div>
        {/* ป้ายทุกงวดแทนแถบความคืบหน้า — แบบเดียวกับหน้าบัตร */}
        <EntryPips rows={progress.rows} closingDay={card?.closingDay} paidViaBill={paidViaBill} />
      </div>

      {isActive && nextRow && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
          <p className="text-xs text-gray-600 min-w-0">
            งวดถัดไป งวดที่ {nextRow.seq} · {fmt(nextRow.amount)} บาท · ครบกำหนด {formatIsoThai(nextRow.dueDate)}
          </p>
          {/* เงินจริงออกจากบัญชีเสมอ บัตรแค่ติดตามวงเงิน จึงจ่ายงวดได้ตลอดไม่ต้องรอบิล */}
          <button
            className="btn btn-primary text-xs !h-8 px-3 flex-shrink-0"
            onClick={() => onPayEntry(installment, nextRow)}
          >
            จ่ายค่างวด
          </button>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <button
          className="text-xs text-gray-500 hover:text-gray-700"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▲ ซ่อนตารางงวด' : `▼ ดูตารางงวด (${installment.months} งวด)`}
        </button>
        {/* ย้อนดูสัญญาที่ผ่อนจบไปแล้วได้ด้วย จึงไม่ผูกกับ isActive — คำถามที่คนถามหลังผ่อนจบ
            คือ "งวดไหนจ่ายวันไหน ตรงไหม" ซึ่งตารางงวดด้านบนไม่ได้ตอบ */}
        <button
          className="text-xs text-gray-500 hover:text-gray-700 mr-auto"
          onClick={() => setHistoryOpen(true)}
        >
          🧾 ประวัติการผ่อน
        </button>
        {isActive && onEdit && (
          <button className="btn btn-secondary text-xs py-1 px-2.5" onClick={() => onEdit(installment)}>
            แก้ไข
          </button>
        )}
        {isActive && onDelete && progress.billedCount === 0 && (
          <button className="btn btn-secondary text-xs py-1 px-2.5 text-red-600" onClick={() => onDelete(installment, progress)}>
            ลบทิ้ง
          </button>
        )}
        {isActive && progress.remainingCount > 0 && (
          <>
            <button className="btn btn-secondary text-xs py-1 px-2.5" onClick={() => onSettle(installment, progress)}>
              ปิดยอดคงเหลือ
            </button>
            <button
              className="btn btn-secondary text-xs py-1 px-2.5 text-red-600"
              onClick={() => onCancelInstallment(installment, progress)}
            >
              ยกเลิก
            </button>
          </>
        )}
      </div>

      {historyOpen && (
        <InstallmentHistoryPopup installment={installment} onClose={() => setHistoryOpen(false)} />
      )}

      {open && (
        <div className="border-t pt-2 overflow-x-auto">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="py-1 pr-2 font-medium">งวด</th>
                <th className="py-1 pr-2 font-medium">รอบบิล</th>
                <th className="py-1 pr-2 font-medium">ครบกำหนด</th>
                <th className="py-1 pr-2 font-medium text-right">จำนวน</th>
                <th className="py-1 pr-2 font-medium">สถานะ</th>
                <th className="py-1 font-medium">จ่ายจริงวันที่</th>
              </tr>
            </thead>
            <tbody>
              {progress.rows.map((r) => {
                const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending
                return (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="py-1.5 pr-2 tabular-nums text-gray-600">{r.seq}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-gray-500">{r.cycle}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-gray-500">{formatIsoThai(r.dueDate)}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-right text-gray-700">{fmt(r.amount)}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`inline-block rounded-full border px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="py-1.5 tabular-nums text-emerald-600 whitespace-nowrap">
                      {r.paidAt ? formatIsoThai(String(r.paidAt).slice(0, 10)) : '—'}
                      {/* คืนยอดได้เฉพาะงวดที่จ่ายผ่านแอป — งวดที่จ่ายผ่านบิลบัตรต้องไปย้อนที่บิล
                          ไม่งั้นยอดบิลกับยอดงวดจะขัดกัน */}
                      {r.status === 'paid' && r.paidMethod && isActive && (
                        <button
                          className="ml-2 text-gray-400 hover:text-red-600"
                          onClick={() => onUndoEntry(installment, r)}
                        >
                          ย้อน
                        </button>
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

export default function InstallmentList({ bare = false }) {
  const installments = useCreditCardStore((s) => s.installments)
  const statements = useCreditCardStore((s) => s.statements)
  const transactions = useTransactionStore((s) => s.transactions)
  const { settleInstallment, cancelInstallment, payStatement, payEntry, undoEntry } = useCreditCardStore()
  const deleteInstallment = useCreditCardStore((s) => s.deleteInstallment)
  const getUnpaidStatements = useCreditCardStore((s) => s.getUnpaidStatements)
  const getInstallmentMonthly = useCreditCardStore((s) => s.getInstallmentMonthly)
  const getCardLabel = useCreditCardStore((s) => s.getCardLabel)
  const getCardShortLabel = useCreditCardStore((s) => s.getCardShortLabel)
  const getCard = useCreditCardStore((s) => s.getCard)
  const refreshWallet = useWalletStore((s) => s.refresh)
  const { addLog } = useLogStore()

  const [showDone, setShowDone] = useState(false)
  const [settleTarget, setSettleTarget] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [payTarget, setPayTarget] = useState(null)   // ใบแจ้งยอดที่กำลังจ่าย
  const [pickBill, setPickBill] = useState(false)   // หน้าต่างเลือกบิล
  const [payEntryTarget, setPayEntryTarget] = useState(null) // { installment, entry }
  const [undoEntryTarget, setUndoEntryTarget] = useState(null) // { installment, entry }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // งวดผ่อนถูกเรียกเก็บผ่านบิลบัตร การจ่ายจริงจึงเกิดที่บิล ไม่ใช่ที่ตัวสัญญาผ่อน
  // เดิมหน้านี้ไม่มีทางไปจ่ายเลย ต้องข้ามไปหน้ากระเป๋าเงินเอง จึงยกบิลมาไว้ตรงนี้
  const unpaidBills = getUnpaidStatements()
  const unpaidTotal = unpaidBills.reduce(
    (sum, s) => sum + (Number(s.amount || 0) - Number(s.paidAmount || 0)), 0
  )


  const handlePayEntry = async ({ method, accountId, amount, paidAt }) => {
    const { installment, entry } = payEntryTarget
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await payEntry(entry.id, {
        method, accountId, amount, paidAt,
        log: buildLogEntry({
          activityType: 'INSTALLMENT_PAY',
          description:
            `จ่ายค่างวด "${installment.name}" งวดที่ ${entry.seq}/${installment.months} ` +
            `${fmt(amount)} บาท จาก${method === 'cash' ? 'เงินสด' : 'เงินโอน'}`,
          walletEffect: { target: method, delta: -amount, transferAccountId: accountId },
          newValue: { entryId: entry.id, installmentId: installment.id, amount, method, paidAt },
        }),
      })
      await refreshWallet()
      setPayEntryTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleUndoEntry = async () => {
    const { installment, entry } = undoEntryTarget
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await undoEntry(entry.id, buildLogEntry({
        activityType: 'INSTALLMENT_PAY_UNDO',
        description:
          `ย้อนการจ่ายค่างวด "${installment.name}" งวดที่ ${entry.seq}/${installment.months} ` +
          `คืนเงิน ${fmt(entry.amount)} บาท`,
        oldValue: entry,
      }))
      await refreshWallet()
      setUndoEntryTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handlePayBill = async ({ method, accountId, amount, date }) => {
    const statement = payTarget
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await payStatement(statement.id, {
        method, accountId, amount, date,
        log: buildLogEntry({
          activityType: 'CARD_PAYMENT',
          description:
            `จ่ายบิลบัตร "${getCardLabel(statement.cardId)}" รอบ ${statement.cycle} ` +
            `${fmt(amount)} บาท จาก${method === 'cash' ? 'เงินสด' : 'เงินโอน'}`,
          walletEffect: { target: method, delta: -amount, transferAccountId: accountId },
          newValue: { statementId: statement.id, cardId: statement.cardId, amount, date, method },
        }),
      })
      // เงินออกจากกระเป๋าที่เซิร์ฟเวอร์แล้ว ดึงยอดจริงกลับมา
      await refreshWallet()
      setPayTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const active = installments.filter((i) => i.status === 'active')

  // งวดที่ "จ่ายแล้วผ่านบิลบัตร" — สถานะในฐานข้อมูลยังเป็น billed (ดูเหตุผลที่ EntryPips)
  // นับเมื่อรายการของงวดผูกอยู่กับบิลที่จ่ายครบแล้ว กฎเดียวกับหน้าบัตร
  const paidViaBill = (() => {
    const paidIds = new Set(statements.filter((st) => st.status === 'paid').map((st) => st.id))
    const out = new Set()
    for (const t of transactions) {
      if (t.installmentEntryId && t.cardStatementId && paidIds.has(t.cardStatementId)) out.add(t.installmentEntryId)
    }
    return out
  })()
  // สัญญาที่ยกเลิกแล้วไม่ถูกโหลดมาตั้งแต่ชั้น API — ตัวกรองนี้กันไว้อีกชั้นเผื่อ
  // ข้อมูลเก่าที่ค้างอยู่ใน store ก่อนรีเฟรช จะได้ไม่โผล่มาให้เห็นชั่ววูบ
  const done = installments.filter((i) => i.status === 'completed')

  const handleSettle = async ({ date, fee }) => {
    const { installment, progress } = settleTarget
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await settleInstallment(installment.id, {
        date,
        fee,
        log: buildLogEntry({
          activityType: 'INSTALLMENT_SETTLE',
          description:
            `ปิดยอดผ่อน "${installment.name}" ก่อนกำหนด ` +
            `${progress.remainingCount} งวด ${fmt(progress.remainingAmount + fee)} บาท`,
          oldValue: installment,
          newValue: { installmentId: installment.id, amount: progress.remainingAmount, fee, date },
        }),
      })
      setSettleTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async () => {
    const { installment, progress } = cancelTarget
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await cancelInstallment(installment.id, buildLogEntry({
        activityType: 'INSTALLMENT_CANCEL',
        description: `ยกเลิกการผ่อน "${installment.name}" เหลืออีก ${progress.remainingCount} งวด`,
        oldValue: installment,
      }))
      setCancelTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /** ลบทั้งรายการ — ฐานข้อมูลคืนเงินงวดที่จ่ายผ่านแอปให้ ยอดกระเป๋าจึงต้องดึงใหม่ */
  const handleDeleteInstallment = async () => {
    const { installment, progress } = deleteTarget
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await deleteInstallment(installment.id, buildLogEntry({
        activityType: 'INSTALLMENT_DELETE',
        description:
          `ลบรายการผ่อน "${installment.name}" ${installment.months} งวด รวม ${fmt(installment.totalAmount)} บาท` +
          (progress.paidCount > 0 ? ` · คืนเงินงวดที่จ่ายไปแล้ว ${progress.paidCount} งวด` : ''),
        oldValue: installment,
      }))
      await refreshWallet()
      setDeleteTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // งวดถัดไปจริงของแต่ละสัญญา ไม่ใช่ monthly_amount ที่เก็บไว้ในสัญญา —
  // สัญญาขั้นบันไดค่างวดไม่เท่ากันทุกงวด ใช้ค่าในสัญญาจะได้คนละตัวกับหน้าอื่น
  const monthlyTotal = getInstallmentMonthly()

  return (
    <div className="space-y-4">
      {/* bare = หน้าที่เรียกมามีหัวข้อและยอดสรุปของตัวเองอยู่แล้ว (หน้าบัตรและหนี้สิน) */}
      {!bare && (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
        <h2 className="section-title">💳 ผ่อนชำระผ่านบัตรเครดิต</h2>
        <p className="text-xs text-gray-500 mt-1">
          รายการที่แบ่งจ่ายเป็นงวด แต่ละงวดถูกเรียกเก็บรวมในบิลบัตรอัตโนมัติ
          จึงจ่ายที่บิลไม่ใช่ที่ตัวรายการผ่อน เริ่มผ่อนได้จากฟอร์มบันทึกรายจ่าย
          เลือกบัตรเครดิตแล้วติ๊ก "แบ่งชำระ"
        </p>
        </div>
        {/* ปุ่มถาวร ไม่ต้องรอให้มีบิลถึงจะโผล่ กดแล้วเห็นทุกใบว่าใบไหนจ่ายได้แล้ว */}
        <button className="btn btn-warning text-sm flex-shrink-0" onClick={() => setPickBill(true)}>
          💳 จ่ายบิลบัตร
          {unpaidTotal > 0 && <span className="ml-1 tabular-nums">{fmt(unpaidTotal)}</span>}
        </button>
      </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {error}</p>}

      {active.length === 0 && done.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <div className="text-3xl mb-2">💳</div>
          <p className="text-sm">ยังไม่มีรายการผ่อน</p>
          <p className="text-xs mt-1">บันทึกรายจ่าย เลือกบัตรเครดิต แล้วติ๊ก "แบ่งชำระ"</p>
        </div>
      ) : (
        <>
          {active.length > 0 && !bare && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-rose-800">
                กำลังผ่อน {active.length} รายการ
              </span>
              <span className="text-sm font-semibold tabular-nums text-rose-700">
                {fmt(monthlyTotal)} บาท / เดือน
              </span>
            </div>
          )}

          <div className="space-y-2.5">
            {active.map((i) => (
              <InstallmentCard
                key={i.id}
                installment={i}
                paidViaBill={paidViaBill}
                onPayEntry={(ins, row) => setPayEntryTarget({ installment: ins, entry: row })}
                onUndoEntry={(ins, row) => setUndoEntryTarget({ installment: ins, entry: row })}
                onSettle={(ins, progress) => setSettleTarget({ installment: ins, progress })}
                onCancelInstallment={(ins, progress) => setCancelTarget({ installment: ins, progress })}
                onEdit={(ins) => setEditTarget(ins)}
                onDelete={(ins, progress) => setDeleteTarget({ installment: ins, progress })}
              />
            ))}
          </div>

          {done.length > 0 && (
            <div>
              <button
                className="text-xs text-gray-500 hover:text-gray-700"
                onClick={() => setShowDone((v) => !v)}
              >
                {showDone ? '▲ ซ่อนรายการที่จบแล้ว' : `▼ รายการที่จบแล้ว ${done.length} รายการ`}
              </button>
              {showDone && (
                <div className="space-y-2.5 mt-2.5">
                  {done.map((i) => (
                    <InstallmentCard
                      key={i.id}
                      installment={i}
                      paidViaBill={paidViaBill}
                      onSettle={() => {}}
                      onCancelInstallment={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmPopup
        open={!!undoEntryTarget}
        title="ย้อนการจ่ายค่างวด"
        message={
          undoEntryTarget
            ? `ย้อนงวดที่ ${undoEntryTarget.entry.seq} ของ "${undoEntryTarget.installment.name}"?

` +
              `• คืนเงิน ${fmt(undoEntryTarget.entry.amount)} บาท เข้ากระเป๋าเดิม
` +
              `• ลบรายการจ่ายที่ผูกไว้
` +
              `• งวดกลับไปเป็น "ยังไม่ถึงรอบ" และจะถูกเรียกเก็บเข้าบิลตามปกติ`
            : ''
        }
        confirmLabel="ย้อนการจ่าย"
        danger
        onConfirm={handleUndoEntry}
        onCancel={() => setUndoEntryTarget(null)}
      />

      {payEntryTarget && (
        <PayInstallmentPopup
          installment={payEntryTarget.installment}
          entry={payEntryTarget.entry}
          card={getCard(payEntryTarget.installment.cardId)}
          onConfirm={handlePayEntry}
          onCancel={() => setPayEntryTarget(null)}
          busy={busy}
        />
      )}

      {pickBill && (
        <PickBillPopup
          onPick={(statement) => { setPickBill(false); setPayTarget(statement) }}
          onClose={() => setPickBill(false)}
        />
      )}

      {payTarget && (
        <PayCardBillPopup
          statement={payTarget}
          cardLabel={getCardLabel(payTarget.cardId)}
          onConfirm={handlePayBill}
          onCancel={() => setPayTarget(null)}
          busy={busy}
        />
      )}

      {settleTarget && (
        <SettlePopup
          installment={settleTarget.installment}
          remaining={settleTarget.progress.remainingAmount}
          count={settleTarget.progress.remainingCount}
          onConfirm={handleSettle}
          onCancel={() => setSettleTarget(null)}
          busy={busy}
        />
      )}

      <ConfirmPopup
        open={!!cancelTarget}
        title="ยกเลิกการผ่อน"
        message={
          cancelTarget
            ? `ยกเลิกงวดที่เหลืออีก ${cancelTarget.progress.remainingCount} งวด (${fmt(cancelTarget.progress.remainingAmount)} บาท) ของ "${cancelTarget.installment.name}"?\n\nงวดที่เรียกเก็บไปแล้วจะยังอยู่ เพราะเกิดขึ้นจริง ถ้าได้เงินคืนจากการคืนสินค้า ให้บันทึกเป็นรายรับที่ปลายทางเป็นบัตรแยกต่างหาก`
            : ''
        }
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
        confirmLabel="ยกเลิกการผ่อน"
        danger
      />

      {editTarget && (
        <InstallmentFormPopup installment={editTarget} onClose={() => setEditTarget(null)} />
      )}

      {/* ลบทิ้ง = บันทึกผิด ไม่ควรมีรายการนี้ตั้งแต่แรก ต่างจากยกเลิกที่เก็บไว้เป็นประวัติ */}
      <ConfirmPopup
        open={!!deleteTarget}
        title="ลบรายการผ่อนทิ้ง"
        message={
          deleteTarget
            ? `"${deleteTarget.installment.name}" จะถูกลบออกทั้งรายการ พร้อมตารางงวดทั้งหมด\n\n` +
              (deleteTarget.progress.paidCount > 0
                ? `เงินของงวดที่จ่ายผ่านแอปไปแล้ว ${deleteTarget.progress.paidCount} งวด จะถูกคืนเข้ากระเป๋าต้นทางให้\n\n`
                : '') +
              'ใช้เมื่อบันทึกผิดเท่านั้น ถ้าผ่อนไปจริงแล้วแต่จะเลิกกลางคัน ให้ใช้ "ยกเลิก" แทน'
            : ''
        }
        onConfirm={handleDeleteInstallment}
        onCancel={() => setDeleteTarget(null)}
        confirmLabel="ลบทิ้ง"
        danger
      />
    </div>
  )
}
