import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useObligationRows, { OBLIGATION_KINDS } from './useObligationRows'
import usePendingStore from '../../store/usePendingStore'
import useCreditCardStore from '../../store/useCreditCardStore'
import useDebtStore from '../../store/useDebtStore'
import useWalletStore from '../../store/useWalletStore'
import useTransactionStore from '../../store/useTransactionStore'
import useLogStore from '../../store/useLogStore'
import EditTransactionPopup from '../../components/shared/EditTransactionPopup'
import { buildLogEntry } from '../../lib/logBuilder'
import { daysUntil } from '../../lib/cardCycle'
import { localDateStr, THAI_MONTH_SHORT } from '../../lib/dateUtils'
import StatCard from '../../components/shared/StatCard'
import Icon from '../../components/shared/Icon'
import PayCardBillPopup from '../../components/shared/PayCardBillPopup'
import PayDebtPopup from '../../components/shared/PayDebtPopup'
import PayPendingDatePopup from '../../components/shared/PayPendingDatePopup'
import ReceiveIncomeDatePopup from '../../components/shared/ReceiveIncomeDatePopup'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import FileUploadPopup from '../../components/shared/FileUploadPopup'
import { AttachmentButton, getAttachments, getPrimaryAttachment } from '../../components/shared/AttachmentViewer'
import AttachmentManagerPopup from '../../components/shared/AttachmentManagerPopup'
import { incomeTarget, pendingTarget } from '../../lib/attachmentTargets'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })
const plain = (n) => Number(n ?? 0).toLocaleString('th-TH')

/**
 * ชิปกรองชนิดงาน — 5 อันตามแบบ
 *
 * หนี้สิน รายการประจำ และใบกำกับภาษี ยังอยู่ในตารางเหมือนเดิม แค่ไม่มีชิปกรองแยก
 * (แบบกำหนดไว้ 5 อัน บันทึกไว้ใน MOCKUP-NOTES.md ข้อ ก8 รอรีวิว)
 */
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด', dot: '#16181D' },
  { key: 'pending', label: 'ค้างจ่าย', dot: OBLIGATION_KINDS.pending.dot },
  { key: 'card', label: 'บิลบัตร', dot: OBLIGATION_KINDS.card.dot },
  // แบบมือถือมี 4 ชิป (ไม่มีงวดผ่อน) — จอเล็กจึงซ่อนชิปนี้ งวดผ่อนยังอยู่ใน "ทั้งหมด"
  { key: 'installment', label: 'งวดผ่อน', dot: OBLIGATION_KINDS.installment.dot, mobileHidden: true },
  { key: 'income', label: 'รอรับเงิน', short: 'รอรับ', dot: OBLIGATION_KINDS.income.dot },
]
const FILTER_KEYS = FILTERS.map((f) => f.key)

const INFLOW = new Set(['income', 'receivable'])
// ใบกำกับภาษีเป็นเอกสารที่ต้องตามเก็บ ไม่ใช่เงินที่ต้องจ่าย จึงไม่นับในยอดรวม
const NON_CASH = new Set(['tax'])

/** วัน/เดือนย่อของคอลัมน์ครบกำหนด + สีตามความเร่งด่วน */
function dueParts(due) {
  const d = new Date(due + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return { day: '—', mon: '', tone: 'text-ink', label: '' }
  const left = daysUntil(d)
  const tone = left < 0 ? 'text-expense' : left <= 7 ? 'text-pending' : 'text-ink'
  const label = left < 0 ? `เกินกำหนด ${-left} วัน` : left === 0 ? 'ครบกำหนดวันนี้' : left === 1 ? 'ครบกำหนดพรุ่งนี้' : `อีก ${left} วัน`
  return { day: String(d.getDate()), mon: THAI_MONTH_SHORT[d.getMonth()], tone, label, left }
}

/**
 * รอดำเนินการ — ทุกอย่างที่ต้องจ่ายและรอรับ อยู่ในตารางเดียวเรียงตามวันครบกำหนด
 *
 * ของเดิมแยกเป็น 3 แท็บ (ค้างจ่าย / รอรับเงิน / สิ่งที่ต้องจ่าย) ซึ่งทำให้ต้องเปิดสลับ
 * ไปมาเพื่อตอบว่าอาทิตย์นี้ต้องเตรียมเงินเท่าไร ตอนนี้เป็นตารางเดียวกรองด้วยชิปแทน
 * และกดจ่ายได้ทุกชนิดจากแถวตรงนั้นเลย
 */
export default function PendingTasksPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filterParam = params.get('tab')
  const filter = FILTER_KEYS.includes(filterParam) ? filterParam : 'all'
  const setFilter = (key) => setParams(key === 'all' ? {} : { tab: key }, { replace: true })

  const rows = useObligationRows()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [payCard, setPayCard] = useState(null)
  const [payDebt, setPayDebt] = useState(null)
  const [payPending, setPayPending] = useState(null)   // { item, method }
  const [receive, setReceive] = useState(null)          // { item, method }
  const [taxUpload, setTaxUpload] = useState(null)
  const [manageTarget, setManageTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editingTx, setEditingTx] = useState(null)
  // มือถือ: แถวไหนกด ⋯ อยู่ (กางปุ่มรอง แก้ไข/ลบ/ไฟล์แนบ ของแถวนั้น)
  const [moreRow, setMoreRow] = useState(null)
  const transactions = useTransactionStore((s) => s.transactions)

  const { payStatement, getCardLabel } = useCreditCardStore()
  const { payEntry } = useDebtStore()
  const {
    payPendingAtomic, receivePendingIncomeAtomic, receiveTaxInvoice,
    deletePending, deletePendingIncome, deleteTaxInvoice,
  } = usePendingStore()
  const refreshWallet = useWalletStore((s) => s.refresh)
  const { addLog } = useLogStore()

  const stats = useMemo(() => {
    const out = rows.filter((r) => !INFLOW.has(r.kind) && !NON_CASH.has(r.kind))
    const overdue = out.filter((r) => daysUntil(new Date(r.due + 'T00:00:00')) < 0)
    const soon = out.filter((r) => {
      const d = daysUntil(new Date(r.due + 'T00:00:00'))
      return d >= 0 && d <= 7
    })
    const later = out.filter((r) => daysUntil(new Date(r.due + 'T00:00:00')) > 7)
    const inflow = rows.filter((r) => INFLOW.has(r.kind))
    const sum = (list) => list.reduce((s, r) => s + r.amount, 0)
    const oldest = overdue.length
      ? Math.max(...overdue.map((r) => -daysUntil(new Date(r.due + 'T00:00:00'))))
      : 0
    return {
      overdue: { total: sum(overdue), count: overdue.length, oldest },
      soon: { total: sum(soon), count: soon.length },
      later: { total: sum(later), count: later.length },
      inflow: { total: sum(inflow), count: inflow.length },
    }
  }, [rows])

  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter)
  const shownTotal = shown.reduce(
    (s, r) => s + (INFLOW.has(r.kind) || NON_CASH.has(r.kind) ? 0 : r.amount),
    0
  )

  // มือถือ: เกินกำหนดยกขึ้นเป็นการ์ดแดงใบเดียว ที่เหลือคั่นหัวกลุ่ม "7 วันข้างหน้า" / "ถัดไป"
  // แถวเรียงตามวันครบกำหนดอยู่แล้ว ตำแหน่งแรกของแต่ละกลุ่มจึงหาได้ครั้งเดียว
  const lefts = shown.map((r) => dueParts(r.due).left)
  const mobileOverdue = shown.filter((_, i) => lefts[i] < 0)
  const soonStart = lefts.findIndex((l) => l >= 0 && l <= 7)
  const laterStart = lefts.findIndex((l) => l > 7)

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const doPayCard = ({ method, accountId, amount, date, slipFiles }) => run(async () => {
    const s = payCard
    await payStatement(s.id, { method, accountId, amount, date, slipFiles, log: buildLogEntry({
      activityType: 'CARD_PAYMENT',
      description: `จ่ายบิลบัตร "${getCardLabel(s.cardId)}" รอบ ${s.cycle} ${fmt(amount)} บาท`,
      walletEffect: { target: method, delta: -amount, transferAccountId: accountId },
      newValue: { statementId: s.id, amount, date },
    }) })
    await refreshWallet(); setPayCard(null)
  })

  const doPayDebt = ({ method, accountId, amount, date, slipFiles }) => run(async () => {
    const { debt, entry } = payDebt
    const recv = debt.direction === 'receivable'
    await payEntry(entry.id, { method, accountId, amount, date, slipFiles, log: buildLogEntry({
      activityType: recv ? 'DEBT_RECEIVE' : 'DEBT_PAY',
      description: `${recv ? 'รับคืน' : 'จ่าย'}งวดที่ ${entry.seq}/${debt.months} "${debt.name}" ${fmt(amount)} บาท`,
      walletEffect: { target: method, delta: recv ? amount : -amount, transferAccountId: accountId },
      newValue: { debtId: debt.id, entryId: entry.id, amount, date },
    }) })
    await refreshWallet(); setPayDebt(null)
  })

  const doPayPending = (date, accountId, _paidAt, slipFiles) => run(async () => {
    const { item, method } = payPending
    await payPendingAtomic(item.id, { method, accountId, date, slipFiles, log: buildLogEntry({
      activityType: 'PAY_PENDING',
      description: `ชำระค้างชำระ "${item.description ?? item.itemName}" ${fmt(item.amount)} บาท (${method === 'cash' ? 'เงินสด' : 'เงินโอน'}) วันที่ ${date}`,
      walletEffect: { target: method === 'cash' ? 'cash' : `transfer:${accountId}`, delta: -item.amount, transferAccountId: accountId },
      newValue: { pendingId: item.id, paidDate: date, transferAccountId: accountId },
    }) })
    setPayPending(null)
  })

  const doReceive = (date, accountId) => run(async () => {
    const { item, method } = receive
    await receivePendingIncomeAtomic(item.id, { method, accountId, date, log: buildLogEntry({
      activityType: 'RECEIVE_INCOME',
      description: `รับเงิน "${item.description}" ${fmt(item.amount)} บาท (${method === 'cash' ? 'เงินสด' : 'เงินโอน'}) วันที่ ${date}`,
      walletEffect: { target: method === 'cash' ? 'cash' : `transfer:${accountId}`, delta: +item.amount, transferAccountId: accountId },
      newValue: { pendingIncomeId: item.id, receivedDate: date, transferAccountId: accountId },
    }) })
    setReceive(null)
  })

  const doDelete = () => run(async () => {
    const t = deleteTarget
    if (t.kind === 'income') await deletePendingIncome(t.data.id)
    else if (t.kind === 'tax') await deleteTaxInvoice(t.data.id)
    else await deletePending(t.data.id)
    setDeleteTarget(null)
  })

  /** ปุ่มหลักของแถว — ชนิดไหนจ่ายที่นี่ได้ ชนิดไหนต้องไปหน้าของมัน */
  const rowAction = (r) => {
    if (r.action === 'payCard') return () => setPayCard(r.data)
    if (r.action === 'payDebt') return () => setPayDebt(r.data)
    if (r.action === 'payPending') return () => setPayPending({ item: r.data, method: r.data.defaultMethod || 'cash' })
    if (r.action === 'receive') return () => setReceive({ item: r.data, method: 'cash' })
    if (r.action === 'receiveTax') return () => setTaxUpload(r.data)
    if (r.action === 'goto') return () => navigate(r.goto)
    return null
  }

  /** รับใบกำกับภาษี — แนบไฟล์ได้ หรือกด "ข้ามไป" ถ้ายังไม่มีไฟล์ */
  const doReceiveTax = (savedPath) => {
    const item = taxUpload
    const paths = Array.isArray(savedPath) ? savedPath : (savedPath ? [savedPath] : [])
    setTaxUpload(null)
    run(async () => {
      await receiveTaxInvoice(item.id, paths[0] ?? null)
      addLog(buildLogEntry({
        activityType: 'RECEIVE_TAX_INVOICE',
        description: `รับใบกำกับภาษี: "${item.itemName ?? 'ไม่ระบุ'}"${item.receiptNo ? ` เลขที่ ${item.receiptNo}` : ''}`,
        newValue: { taxInvoiceId: item.id, filePath: paths[0] ?? null, filePaths: paths },
      }))
    })
  }

  return (
    // จอกว้าง ตารางอยู่ซ้าย การ์ดตัวเลขไปเรียงลงมาเป็นคอลัมน์ขวา 320px
    // ตารางจึงได้ความสูงเต็มจอ ไม่ต้องเลื่อนผ่านการ์ดก่อนถึงรายการที่ต้องจัดการ
    <div
      className="grid gap-3 min-h-0
        grid-cols-1 grid-rows-[auto_1fr] [grid-template-areas:'sum''list']
        wide:grid-cols-[minmax(0,1fr)_320px] wide:grid-rows-1 wide:[grid-template-areas:'list_sum']"
    >
      {/* มือถือไม่มีการ์ดตัวเลข 4 ใบตามแบบ — ยอดเกินกำหนดไปอยู่ในการ์ดแดงในรายการแทน */}
      <div className="[grid-area:sum] hidden lg:grid grid-cols-2 lg:grid-cols-4 wide:grid-cols-1 wide:content-start gap-3 min-w-0">
        <StatCard
          tone="expense"
          label="เกินกำหนด"
          value={fmt(stats.overdue.total)}
          sub={stats.overdue.count ? `${stats.overdue.count} รายการ · นานสุด ${stats.overdue.oldest} วัน` : 'ไม่มีรายการเกินกำหนด'}
          onClick={() => setFilter('all')}
        />
        <StatCard tone="pending" label="ครบกำหนด 7 วันนี้" value={fmt(stats.soon.total)} sub={`${stats.soon.count} รายการ`} />
        <StatCard tone="plain" label="ยังไม่ครบกำหนด" value={fmt(stats.later.total)} sub={`${stats.later.count} รายการ`} />
        <StatCard tone="transfer" label="รอรับเงิน" value={fmt(stats.inflow.total)} sub={`${stats.inflow.count} บิล`} onClick={() => setFilter('income')} />
      </div>

      <div className="[grid-area:list] card flex flex-col overflow-hidden min-h-0">
        <div className="flex items-center gap-2 px-4 sm:px-[18px] pt-3.5 pb-2.5 flex-nowrap overflow-x-auto [scrollbar-width:none] lg:flex-wrap lg:overflow-visible border-b border-[#F2F0EA]">
          <span className="hidden lg:inline flex-none text-[14.5px] font-semibold">ทุกอย่างที่ต้องทำ</span>
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`${f.mobileHidden ? 'hidden lg:flex' : 'flex'} flex-none h-[34px] lg:h-[30px] px-3 lg:px-[11px] rounded-[9px] text-[12.5px] lg:text-[12px] items-center gap-1.5 border transition ${
                  active ? 'bg-ink text-white border-ink font-semibold' : 'bg-white text-ink border-hairline hover:bg-paper'
                }`}
              >
                <span className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: active ? '#C7F250' : f.dot }} />
                <span className="lg:hidden">{f.short ?? f.label}</span>
                <span className="hidden lg:inline">{f.label}</span>
              </button>
            )
          })}
          <span className="flex-1 min-w-0" />
          <span className="hidden lg:inline flex-none text-[11.5px] text-faint">เรียงตามวันครบกำหนด</span>
        </div>

        {error && (
          <p className="mx-4 sm:mx-[18px] mb-2 text-[12.5px] text-expense bg-expense-soft border border-[#F0C4BE] rounded-ctl px-3.5 py-2">
            ทำรายการไม่สำเร็จ — {error}
          </p>
        )}

        {/* หัวตาราง — ซ่อนบนจอเล็กเพราะแถวเปลี่ยนเป็นการ์ดแทน */}
        <div className="hidden lg:grid grid-cols-[74px_minmax(0,1fr)_128px_130px_216px] gap-3 px-[18px] pb-2 text-[11px] tracking-[0.08em] uppercase text-faint border-b border-[#EFEDE7]">
          <span>ครบกำหนด</span><span>รายการ</span><span>ประเภท</span><span className="text-right">ยอด</span><span />
        </div>

        {/* มือถือ: ของที่เกินกำหนดรวมอยู่ในการ์ดแดงใบเดียว กดจ่ายได้จากตรงนี้ (แถวปกติของมันซ่อนไว้) */}
        {mobileOverdue.length > 0 && (
          <div className="lg:hidden mx-4 mt-3 rounded-[13px] border border-[#F0C4BE] bg-[#FEF6F5] px-3.5 py-3">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="font-semibold text-expense">เกินกำหนด {mobileOverdue.length} รายการ</span>
              <span className="tabular-nums font-bold text-expense">
                {fmt(mobileOverdue.reduce((s, r) => s + (INFLOW.has(r.kind) || NON_CASH.has(r.kind) ? 0 : r.amount), 0))}
              </span>
            </div>
            {mobileOverdue.map((r) => {
              const d = dueParts(r.due)
              const onAction = rowAction(r)
              return (
                <div key={r.key} className="flex items-center gap-2.5 mt-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium truncate">{r.title}</span>
                    <span className="block text-[11px] text-expense truncate">
                      ครบกำหนด {d.day} {d.mon} · เลยมา {-d.left} วัน
                    </span>
                  </span>
                  {onAction && (
                    <button
                      onClick={onAction}
                      disabled={busy}
                      className="flex-none h-10 px-4 rounded-[11px] bg-expense text-white text-[12.5px] font-semibold disabled:opacity-50"
                    >
                      {r.actionLabel}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="px-4 sm:px-[18px]">
          {shown.length === 0 ? (
            <p className="text-center text-[13px] text-faint py-12">ไม่มีรายการในกลุ่มนี้</p>
          ) : shown.map((r, i) => {
            const d = dueParts(r.due)
            const kind = OBLIGATION_KINDS[r.kind]
            const inflow = INFLOW.has(r.kind)
            const onAction = rowAction(r)
            const overdue = d.left < 0
            const attachments = r.data ? getAttachments(r.data) : []
            const canDelete = r.kind === 'pending' || r.kind === 'income' || r.kind === 'tax'
            const canEdit = r.kind === 'pending' && !!r.data?.transactionId
            const hasSecondary = attachments.length > 0 || canEdit || canDelete
            const groupHead = i === soonStart ? '7 วันข้างหน้า' : i === laterStart ? 'ถัดไป' : null

            return (
              <Fragment key={r.key}>
                {groupHead && (
                  <div className="lg:hidden text-[11px] tracking-[0.08em] uppercase text-faint pt-3.5 pb-1">{groupHead}</div>
                )}
                {/* จอใหญ่เป็นตาราง 5 คอลัมน์ มือถือเป็นการ์ดสองบรรทัด (ข้อมูล / ปุ่ม)
                    lg:contents ทำให้ลูกของบรรทัดแรกกลายเป็นช่องตารางเองบนจอใหญ่ */}
                <div
                  className={`${overdue ? 'hidden lg:grid' : 'flex flex-col lg:grid'} lg:grid-cols-[74px_minmax(0,1fr)_128px_130px_216px] gap-2 lg:gap-3 lg:items-center py-3 border-b border-[#F2F0EA] ${
                    overdue ? 'bg-[#FEF6F5] -mx-4 px-4 sm:-mx-[18px] sm:px-[18px]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 lg:contents">
                    <span className="flex flex-col flex-none w-9 lg:w-[74px]">
                      <span className={`tabular-nums text-[15px] lg:text-[13.5px] font-bold leading-[1.1] ${d.tone}`}>{d.day}</span>
                      <span className="text-[10px] text-faint">{d.mon}</span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium truncate">{r.title}</span>
                      <span className={`block text-[11px] truncate ${overdue ? 'text-expense' : 'text-faint'}`}>
                        <span className="lg:hidden">{kind.label} · </span>
                        {d.label}{r.meta ? ` · ${r.meta}` : ''}{r.note ? ` · ${r.note}` : ''}
                      </span>
                    </span>

                    <span className={`hidden lg:inline-flex text-[11.5px] rounded-full px-2.5 py-0.5 justify-self-start self-center ${kind.tagBg} ${kind.tagFg}`}>
                      {kind.label}
                    </span>

                    <span className={`tabular-nums text-right text-sm font-semibold flex-none ${
                      inflow ? 'text-income' : NON_CASH.has(r.kind) ? 'text-faint' : overdue ? 'text-expense' : 'text-ink'
                    }`}>
                      {inflow ? '+' : ''}{fmt(r.amount)}
                    </span>
                  </div>

                  <div className="flex gap-1.5 items-center lg:justify-end">
                    {onAction && (
                      <button
                        onClick={onAction}
                        disabled={busy}
                        className={`h-10 lg:h-8 flex-1 lg:flex-none px-3.5 rounded-[11px] lg:rounded-[9px] text-[12.5px] font-semibold disabled:opacity-50 ${
                          r.action === 'goto'
                            ? 'bg-paper text-ink hover:bg-hairline'
                            : overdue ? 'bg-expense text-white hover:brightness-110'
                            : inflow ? 'bg-income text-white hover:brightness-110'
                            : 'bg-ink text-white hover:bg-black'
                        }`}
                      >
                        {r.actionLabel}
                      </button>
                    )}
                    {/* มือถือ: ปุ่มรองซ่อนหลัง ⋯ ตามแบบ จอใหญ่โชว์ทั้งหมด */}
                    {hasSecondary && (
                      <button
                        onClick={() => setMoreRow(moreRow === r.key ? null : r.key)}
                        title="เพิ่มเติม"
                        className={`lg:hidden w-10 h-10 rounded-[11px] border flex items-center justify-center ${
                          moreRow === r.key ? 'bg-ink border-ink text-lime' : 'border-hairline text-muted'
                        }`}
                      >
                        <Icon name="more_horiz" size={20} />
                      </button>
                    )}
                    <span className={`${moreRow === r.key ? 'flex' : 'hidden'} lg:flex gap-1.5 items-center`}>
                      {r.kind === 'tax' && attachments.length > 0 && (
                        <AttachmentButton attachment={getPrimaryAttachment(r.data)} attachments={attachments} compact />
                      )}
                      {(r.kind === 'pending' || r.kind === 'income') && (
                        <button
                          onClick={() => setManageTarget(r.kind === 'income' ? incomeTarget(r.data) : pendingTarget(r.data))}
                          disabled={busy}
                          title={attachments.length > 0 ? 'ดู แนบเพิ่ม เปลี่ยน หรือลบไฟล์' : 'แนบไฟล์'}
                          aria-label={`ไฟล์แนบของ ${r.title} ${attachments.length} ไฟล์`}
                          className={`min-w-10 h-10 lg:min-w-8 lg:h-8 px-1.5 rounded-[11px] lg:rounded-[9px] border flex items-center justify-center gap-0.5 text-[11.5px] font-semibold disabled:opacity-50 ${
                            attachments.length > 0 ? 'border-ink text-ink bg-white hover:bg-paper' : 'border-hairline text-faint hover:bg-paper hover:text-ink'
                          }`}
                        >
                          <Icon name="attach_file" size={17} />
                          {attachments.length > 0 && <span className="tabular-nums">{attachments.length}</span>}
                        </button>
                      )}
                      {/* บิลค้างชำระที่ผูกกับรายการบันทึกไว้ แก้ยอด/ชื่อได้จากตรงนี้เลย
                          (ของเดิมต้องไปหาที่หน้าค้นหารายการ) */}
                      {canEdit && (
                        <button
                          onClick={() => {
                            const tx = transactions.find((t) => t.id === r.data.transactionId)
                            if (tx) setEditingTx(tx)
                          }}
                          title="แก้ไขรายการที่ผูกอยู่"
                          className="w-10 h-10 lg:w-8 lg:h-8 rounded-[11px] lg:rounded-[9px] border border-hairline flex items-center justify-center text-faint hover:bg-paper hover:text-ink"
                        >
                          <Icon name="edit_note" size={17} />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleteTarget(r)}
                          title="ลบรายการนี้"
                          className="w-10 h-10 lg:w-8 lg:h-8 rounded-[11px] lg:rounded-[9px] border border-hairline flex items-center justify-center text-faint hover:bg-paper hover:text-expense"
                        >
                          <Icon name="close" size={17} />
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              </Fragment>
            )
          })}
        </div>

        <div className="mt-auto border-t border-[#EFEDE7] px-4 sm:px-[18px] py-3 flex items-center gap-3.5 text-[12px] text-muted flex-wrap">
          <span>บิลบัตรกับงวดผ่อนแยกสีไว้ เพราะเงินออกตอนปิดรอบ ไม่ใช่ตอนซื้อ</span>
          <span className="tabular-nums ml-auto">รวมที่ต้องจ่าย <b className="text-ink">{fmt(shownTotal)}</b></span>
        </div>
      </div>

      {payCard && (
        <PayCardBillPopup
          statement={payCard}
          cardLabel={getCardLabel(payCard.cardId)}
          onConfirm={doPayCard}
          onCancel={() => setPayCard(null)}
          busy={busy}
        />
      )}
      {payDebt && (
        <PayDebtPopup
          debt={payDebt.debt}
          entry={payDebt.entry}
          progress={payDebt.progress}
          onConfirm={doPayDebt}
          onCancel={() => setPayDebt(null)}
          busy={busy}
        />
      )}
      <PayPendingDatePopup
        open={!!payPending}
        item={payPending?.item}
        method={payPending?.method}
        onConfirm={doPayPending}
        onCancel={() => setPayPending(null)}
      />
      <ReceiveIncomeDatePopup
        open={!!receive}
        item={receive?.item}
        method={receive?.method}
        onConfirm={doReceive}
        onCancel={() => setReceive(null)}
      />
      {editingTx && <EditTransactionPopup transaction={editingTx} onClose={() => setEditingTx(null)} />}
      {manageTarget && <AttachmentManagerPopup target={manageTarget} onClose={() => setManageTarget(null)} />}
      {taxUpload && (
        <FileUploadPopup
          title="อัปโหลดใบกำกับภาษี"
          description={`${taxUpload.itemName ?? ''}${taxUpload.receiptNo ? ` · เลขที่ ${taxUpload.receiptNo}` : ''}`}
          createdAt={taxUpload.createdAt}
          filenamePrefix="taxinvoice"
          folderBase="taxinvoices"
          onConfirm={doReceiveTax}
          onCancel={() => setTaxUpload(null)}
        />
      )}
      <ConfirmPopup
        open={!!deleteTarget}
        title={
          deleteTarget?.kind === 'income' ? 'ลบรายการรอรับเงิน'
            : deleteTarget?.kind === 'tax' ? 'ลบรายการรอใบกำกับภาษี'
            : 'ลบรายการค้างชำระ'
        }
        message={`ลบ "${deleteTarget?.title ?? ''}" ${plain(deleteTarget?.amount)} บาท?`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
        confirmLabel="ลบ"
        danger
      />
    </div>
  )
}
