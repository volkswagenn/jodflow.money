import { useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { th } from 'date-fns/locale'
import useLogStore from '../../store/useLogStore'
import useTransactionStore from '../../store/useTransactionStore'
import useCreditCardStore from '../../store/useCreditCardStore'
import usePaymentHistory from '../../hooks/usePaymentHistory'
import { slipsInstalled } from '../../lib/api/paymentSlips'
import { paymentViewerItem, fileShortLabel, whenText } from '../../lib/paymentSlipView'
import { slipTarget, txTarget } from '../../lib/attachmentTargets'
import { ACTIVITY_LABELS } from '../../lib/logBuilder'
import { localDateStr } from '../../lib/dateUtils'
import Icon from '../../components/shared/Icon'
import DateRangeFilter from '../../components/shared/DateRangeFilter'
import AttachmentManagerPopup from '../../components/shared/AttachmentManagerPopup'
import SlipImage from '../../components/shared/SlipImage'
import SlipViewerPopup from '../../components/shared/SlipViewerPopup'
import { getAttachments } from '../../components/shared/AttachmentViewer'

// ── Constants ──────────────────────────────────────────────────────────────────

const TX_LOG_TYPES = new Set([
  'ADD_INCOME', 'ADD_INCOME_MAIN', 'ADD_OTHER_INCOME',
  'ADD_EXPENSE', 'EDIT_INCOME', 'EDIT_EXPENSE',
])

// บันทึกพวกนี้ชี้ไปที่รายการเงินใบหนึ่ง ซึ่งอาจมีใบเสร็จแนบอยู่
const TX_FILE_TYPES = new Set([...TX_LOG_TYPES, 'RECURRING_PAID', 'UPLOAD_RECEIPT', 'ATTACHMENT_EDIT'])
// บันทึกเรื่องไฟล์เอง ไม่ต้องชวนแนบซ้ำในแถวนี้ถ้าไฟล์ถูกเอาออกไปแล้ว
const FILE_LOG_TYPES = new Set(['ATTACH_PAYMENT_SLIP', 'ATTACHMENT_EDIT', 'UPLOAD_RECEIPT'])

// บันทึกกับขาการจ่ายถูกเขียนในคำสั่งเดียวกัน เวลาจึงแทบตรงกัน เผื่อไว้สำหรับบันทึกรุ่นเก่า
// ที่เขียนแยกคำสั่ง — ถ้าไม่จำกัด จ่ายแล้วย้อนแล้วจ่ายใหม่ยอดเดิม บันทึกครั้งแรก
// (ซึ่งการจ่ายไม่มีอยู่แล้ว) จะไปโชว์สลิปของครั้งใหม่
const LEG_MATCH_MS = 2 * 60 * 1000

/**
 * บันทึกนี้คือการจ่ายแถวไหน — คืน key เดียวกับ usePaymentHistory
 *
 * การจ่ายส่วนใหญ่บันทึก id ไว้ตรงๆ ยกเว้นจ่ายบิลบัตรที่บันทึก id ของใบ ซึ่งใบเดียวจ่ายได้
 * หลายครั้ง จึงต้องหาขาจากใบ (หรือรายการ) ยอด และเวลา
 */
function paymentKeyOfLog(log, legs) {
  const v = log.newValue ?? {}
  switch (log.activityType) {
    case 'ATTACH_PAYMENT_SLIP':
    case 'ATTACHMENT_EDIT': return v.kind && v.refId ? `${v.kind}:${v.refId}` : null
    case 'INSTALLMENT_PAY': return v.entryId ? `card_installment:${v.entryId}` : null
    case 'DEBT_PAY':
    case 'DEBT_RECEIVE': return v.entryId ? `debt:${v.entryId}` : null
    case 'PAY_PENDING': return v.pendingId ? `pending:${v.pendingId}` : null
    case 'RECURRING_PAID': return v.recurringEntryId ? `recurring:${v.recurringEntryId}` : null
    case 'CARD_PAYMENT':
    case 'CARD_AUTOPAY':
    case 'CARD_PREPAY': {
      const at = new Date(log.timestamp).getTime()
      let best = null
      let bestGap = LEG_MATCH_MS
      for (const l of legs) {
        const same = v.statementId ? l.statementId === v.statementId : (v.transactionId && l.transactionId === v.transactionId)
        if (!same || Math.abs(Number(l.amount) - Number(v.amount)) > 0.005) continue
        const gap = Math.abs(new Date(l.createdAt).getTime() - at)
        if (gap <= bestGap) { best = l; bestGap = gap }
      }
      if (best) return `card_bill:${best.id}`
      // ใบเก่าที่จ่ายก่อนระบบแยกเก็บทีละขา ประวัติการจ่ายใช้ id ของใบแทน
      return v.statementId ? `card_bill:${v.statementId}` : null
    }
    default: return null
  }
}

/** ไฟล์ของรายการเงิน → สิ่งที่ SlipViewerPopup แสดง */
function transactionViewerItem(tx, kindLabel) {
  const files = getAttachments(tx)
  const uploadedAt = files[0]?.uploadedAt
  return {
    key: `tx:${tx.id}`,
    title: tx.itemName ?? 'รายการ',
    kindLabel,
    amount: Number(tx.amount || 0),
    incoming: tx.type === 'income',
    facts: [
      ['วันที่', whenText(tx.date)],
      ['ผู้ขาย', tx.vendor || '—'],
      ['เลขที่ใบเสร็จ', tx.receiptNo || '—'],
      ...(uploadedAt ? [['แนบเมื่อ', whenText(uploadedAt)]] : []),
    ],
    files,
    target: txTarget(tx),
  }
}

// ── AllTab ─────────────────────────────────────────────────────────────────────

function typeColor(type) {
  if (TX_LOG_TYPES.has(type) || type === 'DELETE_TRANSACTION' || type === 'CANCEL_TRANSACTION') {
    if (type.includes('INCOME') || type === 'ADD_INCOME_MAIN') return 'bg-emerald-100 text-emerald-700'
    if (type.includes('EXPENSE') || type === 'OPEN_BILL') return 'bg-red-100 text-red-700'
    if (type === 'DELETE_TRANSACTION' || type === 'CANCEL_TRANSACTION') return 'bg-orange-100 text-orange-700'
    return 'bg-blue-100 text-blue-700'
  }
  if (type === 'PAY_PENDING') return 'bg-amber-100 text-amber-700'
  if (['CASH_DEPOSIT', 'TRANSFER_TO_WALLET', 'WITHDRAW_FROM_TRANSFER', 'OPEN_BILL_INCOME'].includes(type))
    return 'bg-emerald-100 text-emerald-700'
  if (type?.startsWith('SUB_')) return 'bg-purple-100 text-purple-700'
  if (type === 'IMPORT_DATA') return 'bg-indigo-100 text-indigo-700'
  return 'bg-gray-100 text-gray-600'
}

/** ไอคอน + สีของแต่ละชนิดเหตุการณ์ — ใช้แทนป้ายข้อความยาวๆ ในตาราง */
function TYPE_TINT(type) {
  if (type === 'TX_INCOME_RECORD' || (type ?? '').includes('INCOME')) {
    return { box: 'bg-income-soft text-income', icon: 'arrow_downward' }
  }
  if (type === 'TX_EXPENSE_RECORD' || (type ?? '').includes('EXPENSE') || type === 'OPEN_BILL') {
    return { box: 'bg-expense-soft text-expense', icon: 'arrow_upward' }
  }
  if ((type ?? '').startsWith('CARD')) return { box: 'bg-expense-soft text-[#A93A2E]', icon: 'credit_card' }
  if ((type ?? '').startsWith('SUB_')) return { box: 'bg-recurring-soft text-recurring', icon: 'savings' }
  if ((type ?? '').startsWith('RECURRING')) return { box: 'bg-recurring-soft text-recurring', icon: 'history' }
  if ((type ?? '').startsWith('DEBT') || (type ?? '').startsWith('INSTALLMENT')) {
    return { box: 'bg-pending-soft text-pending', icon: 'receipt_long' }
  }
  if (type === 'PAY_PENDING' || (type ?? '').includes('PENDING')) {
    return { box: 'bg-pending-soft text-pending', icon: 'pending_actions' }
  }
  if (type === 'IMPORT_DATA') return { box: 'bg-transfer-soft text-transfer', icon: 'upload_file' }
  if ((type ?? '').includes('TAX')) return { box: 'bg-[#FBEFE4] text-[#B4571E]', icon: 'receipt_long' }
  return { box: 'bg-paper text-muted', icon: 'edit_note' }
}

function AllTab() {
  const { logs } = useLogStore()
  const { transactions } = useTransactionStore()
  const [filter, setFilter] = useState('month')
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [onlyFiles, setOnlyFiles] = useState(false)
  const [viewKey, setViewKey] = useState(null)
  const [manageTarget, setManageTarget] = useState(null)
  const legs = useCreditCardStore((s) => s.statementPayments)
  const paymentRows = usePaymentHistory()
  const paymentByKey = useMemo(() => new Map(paymentRows.map((r) => [r.key, r])), [paymentRows])
  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions])

  // log ที่ post_transaction เขียนจะมี newValue.transactionId (ฐานข้อมูลใส่ให้)
  // ส่วน log รุ่นเก่าเก็บทั้งรายการไว้ใน newValue จึงมี newValue.id — รับทั้งสองแบบ
  const loggedTransactionIds = new Set(
    logs
      .filter((log) => TX_LOG_TYPES.has(log.activityType))
      .map((log) => log.newValue?.transactionId ?? log.newValue?.id)
      .filter(Boolean)
  )

  const transactionEvents = transactions
    .filter((tx) => !loggedTransactionIds.has(tx.id))
    .map((tx) => ({
      id: `tx:${tx.id}`,
      timestamp: tx.createdAt ?? `${tx.date}T00:00:00`,
      date: tx.date,
      activityType: tx.type === 'income' ? 'TX_INCOME_RECORD' : 'TX_EXPENSE_RECORD',
      label: tx.type === 'income' ? 'ธุรกรรมรายรับ' : 'ธุรกรรมรายจ่าย',
      description: `${tx.type === 'income' ? 'รายรับ' : 'รายจ่าย'} "${tx.itemName ?? 'ไม่ระบุ'}" ${Number(tx.amount || 0).toLocaleString()} บาท`,
      walletEffect: { delta: tx.type === 'income' ? Number(tx.amount || 0) : -Number(tx.amount || 0) },
      viewer: getAttachments(tx).length > 0 ? transactionViewerItem(tx, tx.type === 'income' ? 'รายรับ' : 'รายจ่าย') : null,
      attachTo: getAttachments(tx).length > 0 ? null : txTarget(tx),
    }))

  const systemEvents = logs
    .map((log) => {
      const label = ACTIVITY_LABELS[log.activityType] ?? log.activityType
      const payment = paymentByKey.get(paymentKeyOfLog(log, legs)) ?? null
      const tx = TX_FILE_TYPES.has(log.activityType)
        ? txById.get(log.newValue?.transactionId ?? log.newValue?.id)
        : null
      // สลิปของการจ่ายมาก่อนใบเสร็จ — รายการประจำที่จ่ายแล้วมีได้ทั้งสองอย่าง
      let viewer = null
      if (payment && getAttachments(payment.slip).length > 0) viewer = paymentViewerItem(payment)
      else if (tx && getAttachments(tx).length > 0) viewer = transactionViewerItem(tx, label)
      return {
        ...log,
        id: `log:${log.id}`,
        // timestamp เป็น ISO/UTC — ต้องแปลงเป็นวันที่ท้องถิ่นก่อนเทียบกับช่วงวันที่ที่ผู้ใช้เลือก
        date: localDateStr(log.timestamp),
        label,
        viewer,
        // รายการที่ยังอยู่แต่ยังไม่มีไฟล์ แนบจากแถวนี้ได้เลย
        attachTo: viewer || FILE_LOG_TYPES.has(log.activityType) ? null
          : payment ? (slipsInstalled() ? slipTarget(payment) : null)
          : tx ? txTarget(tx) : null,
      }
    })

  const typeOptions = [
    { value: '', label: 'ทุกประเภท' },
    { value: 'TX_INCOME_RECORD', label: 'ธุรกรรมรายรับ' },
    { value: 'TX_EXPENSE_RECORD', label: 'ธุรกรรมรายจ่าย' },
    ...Object.entries(ACTIVITY_LABELS)
      .map(([value, label]) => ({ value, label })),
  ]

  const events = [...transactionEvents, ...systemEvents]
    .filter((event) => {
      const d = event.date || localDateStr(event.timestamp)
      if (d < startDate || d > endDate) return false
      if (typeFilter && event.activityType !== typeFilter) return false
      if (onlyFiles && !event.viewer) return false
      if (search) {
        const haystack = [
          event.description,
          event.label,
          event.activityType,
        ]
          .filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))

  // สลิปใบเดียวโผล่ได้หลายแถว (ตอนจ่าย + ตอนแนบ) กดถัดไปในตัวดูต้องไม่เจอใบเดิมซ้ำ
  const seenViewers = new Set()
  const viewerItems = events
    .map((event) => event.viewer)
    .filter((item) => {
      if (!item || seenViewers.has(item.key)) return false
      seenViewers.add(item.key)
      return true
    })

  // ชิปกรองด่วน — ชนิดที่คนมองหาบ่อยที่สุด ส่วนที่เหลือยังเลือกจากรายการเต็มได้
  const QUICK = [
    { value: '', label: 'ทั้งหมด' },
    { value: 'TX_INCOME_RECORD', label: 'รายรับ' },
    { value: 'TX_EXPENSE_RECORD', label: 'รายจ่าย' },
    { value: 'PAY_PENDING', label: 'จ่ายค้างชำระ' },
    { value: 'CARD_PAYMENT', label: 'จ่ายบิลบัตร' },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* แถบกรองอยู่ในการ์ดของตัวเอง แยกจากการ์ดรายการ — เลื่อนอ่านรายการยาวๆ
          แล้วแถบกรองยังอยู่ที่เดิม ไม่ปนกับเนื้อหา */}
      <div className="card px-4 py-3 flex items-center gap-2 flex-wrap flex-none">
        <DateRangeFilter
          filter={filter} setFilter={setFilter}
          startDate={startDate} endDate={endDate}
          setStartDate={setStartDate} setEndDate={setEndDate}
          compact
        />
        {QUICK.map((q) => {
          const on = typeFilter === q.value
          return (
            <button
              key={q.value || 'all'}
              onClick={() => setTypeFilter(q.value)}
              className={`h-8 px-3 rounded-[9px] text-[12.5px] border transition ${
                on ? 'bg-ink text-white border-ink font-semibold' : 'bg-white text-muted border-hairline hover:bg-paper'
              }`}
            >
              {q.label}
            </button>
          )
        })}
        <button
          onClick={() => setOnlyFiles((v) => !v)}
          aria-pressed={onlyFiles}
          className={`h-8 px-3 rounded-[9px] text-[12.5px] border flex items-center gap-1 transition ${
            onlyFiles ? 'bg-ink text-white border-ink font-semibold' : 'bg-white text-muted border-hairline hover:bg-paper'
          }`}
        >
          <Icon name="attach_file" size={15} />
          มีไฟล์แนบ
        </button>
        <select
          className="h-8 px-2.5 rounded-[9px] border border-hairline bg-white text-[12.5px] text-muted"
          value={QUICK.some((q) => q.value === typeFilter) ? '' : typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">ชนิดอื่น…</option>
          {typeOptions.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="ml-auto min-w-[200px] flex-1 sm:flex-none h-[34px] px-3 rounded-ctl bg-paper flex items-center gap-2">
          <Icon name="search" size={17} className="text-faint flex-none" />
          <input
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px]"
            placeholder="ค้นหาคำในรายการ"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card px-[18px] pt-1.5 pb-0 flex-1 min-h-0">
      {events.length === 0 ? (
        <p className="text-center text-[13px] text-faint py-12">ไม่มีประวัติในช่วงที่เลือก</p>
      ) : (
        <div>
          {events.map((event) => {
            const delta = event.walletEffect?.delta
            const tone = TYPE_TINT(event.activityType)
            return (
              // จอแคบวางวันที่กับยอดลงมาบรรทัดล่าง ชื่อรายการจะได้เต็มบรรทัด
              // ของเดิมคอลัมน์วันที่ 104px กับยอดกินที่จนเหลือชื่อไม่กี่ตัว ("ค่าท…")
              // sm:contents ทำให้จอใหญ่ลูกข้างในกลับไปเรียงแถวเดียวเหมือนเดิมทุกอย่าง
              <div
                key={event.id}
                className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 py-2.5 border-b border-[#F2F0EA] hover:bg-[#FAF9F6] -mx-2 px-2 rounded-lg"
              >
                <span className="hidden sm:block w-[104px] flex-none">
                  <span className="tabular-nums block text-[12.5px] font-medium">
                    {(() => { try { return format(new Date(event.timestamp), 'd MMM yy', { locale: th }) } catch { return event.date } })()}
                  </span>
                  <span className="tabular-nums block text-[10.5px] text-faint">
                    {(() => { try { return format(new Date(event.timestamp), 'HH:mm', { locale: th }) } catch { return '' } })()}
                  </span>
                </span>

                <div className="flex items-start gap-2.5 min-w-0 sm:contents">
                  <span className={`w-[30px] h-[30px] flex-none rounded-[9px] flex items-center justify-center ${tone.box}`}>
                    <Icon name={tone.icon} size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] line-clamp-2 sm:line-clamp-none sm:truncate">{event.description}</span>
                    <span className="block text-[11px] text-faint">{event.label}</span>
                  </span>
                </div>

                <div className="flex items-center gap-2 pl-[40px] sm:pl-0 sm:contents">
                  <span className="sm:hidden tabular-nums text-[11px] text-faint">
                    {(() => { try { return format(new Date(event.timestamp), 'd MMM yy · HH:mm', { locale: th }) } catch { return event.date } })()}
                  </span>
                  {/* คอลัมน์ไฟล์กว้างคงที่ ยอดเงินทุกแถวจะได้ตรงกันไม่ว่าแถวนั้นมีไฟล์หรือไม่ */}
                  <span className="flex-none sm:w-[128px] flex sm:justify-end">
                    {event.viewer && (
                      <button
                        onClick={() => setViewKey(event.viewer.key)}
                        aria-label={`เปิด${fileShortLabel(event.viewer.files[0])}ของ ${event.viewer.title}`}
                        className="h-11 pl-[3px] pr-[9px] rounded-[10px] border border-[#D8D4C9] bg-white flex items-center gap-[7px] transition hover:border-ink hover:shadow-card"
                      >
                        <SlipImage path={event.viewer.files[0]?.path} className="w-7 h-9 rounded-md border border-hairline" />
                        <span className="text-[11.5px] font-semibold">
                          {fileShortLabel(event.viewer.files[0])}
                          {event.viewer.files.length > 1 && <span className="tabular-nums text-muted font-medium"> {event.viewer.files.length}</span>}
                        </span>
                      </button>
                    )}
                    {event.attachTo && (
                      <button
                        onClick={() => setManageTarget(event.attachTo)}
                        aria-label={`แนบไฟล์ของ ${event.attachTo.title}`}
                        className="h-11 px-2.5 rounded-[10px] border border-dashed border-[#B9B5A9] bg-[#FAF9F6] text-[11.5px] font-semibold text-muted flex items-center gap-1 hover:border-ink hover:text-ink"
                      >
                        <Icon name="add" size={15} />
                        {event.attachTo.kind === 'slip' ? 'แนบสลิป' : 'แนบไฟล์'}
                      </button>
                    )}
                  </span>
                  {delta != null ? (
                    <span className={`tabular-nums ml-auto sm:ml-0 sm:w-[84px] sm:text-right flex-none text-[13px] font-semibold ${delta > 0 ? 'text-income' : 'text-expense'}`}>
                      {delta > 0 ? '+' : ''}{Number(delta).toLocaleString()}
                    </span>
                  ) : <span className="hidden sm:block w-[84px] flex-none" />}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </div>

      {viewKey && (
        <SlipViewerPopup
          items={viewerItems}
          itemKey={viewKey}
          onChangeItem={setViewKey}
          onClose={() => setViewKey(null)}
          onManage={(item) => setManageTarget(item.target)}
        />
      )}
      {manageTarget && <AttachmentManagerPopup target={manageTarget} onClose={() => setManageTarget(null)} />}
    </div>
  )
}


// ── Page ───────────────────────────────────────────────────────────────────────


export default function HistoryPage() {
  const loadFirstPage = useLogStore((s) => s.loadFirstPage)
  const loadMore = useLogStore((s) => s.loadMore)
  const loading = useLogStore((s) => s.loading)
  const hasMore = useLogStore((s) => s.hasMore)
  const loadedCount = useLogStore((s) => s.logs.length)
  const total = useLogStore((s) => s.total)
  const [loadError, setLoadError] = useState('')

  const handleLoadMore = () => {
    loadMore().catch((err) => setLoadError(err.message))
  }

  /**
   * ประวัติไม่ได้ถูกโหลดตอนเปิดแอป (hydrate.js ข้ามไว้ เพราะตารางโตได้เป็นหมื่นแถว)
   * หน้านี้จึงต้องสั่งโหลดเอง — ก่อนหน้านี้ไม่มีใครเรียกเลย ทำให้แท็บประวัติ
   * ขึ้นว่า "ไม่มีข้อมูล" เสมอทั้งที่ในฐานข้อมูลมีอยู่จริง
   */
  useEffect(() => {
    let alive = true
    loadFirstPage().catch((err) => {
      if (alive) setLoadError(err.message)
    })
    return () => { alive = false }
  }, [loadFirstPage])

  return (
    <div className="space-y-3.5">
      {loadError && (
        <p className="text-[12.5px] text-expense bg-expense-soft border border-[#F0C4BE] rounded-ctl px-4 py-2.5">
          โหลดประวัติไม่สำเร็จ — {loadError}
        </p>
      )}

      {/* หน้านี้แสดงประวัติทุกการเปลี่ยนแปลงในรายการเดียว ไม่มีแท็บแยก
          รายการเงินอย่างเดียวดูได้ที่ บันทึกรายการ › ค้นหารายการ ซึ่งกรองได้ละเอียดกว่า
          (แท็บ "รายการเงิน" เดิมถูกถอดออก บันทึกไว้ใน MOCKUP-NOTES.md ข้อ ก9) */}
      {loading && loadedCount === 0 ? (
        <div className="card flex items-center justify-center py-14">
          <div className="w-7 h-7 rounded-full border-[3px] border-hairline border-t-ink animate-spin" />
        </div>
      ) : (
        <AllTab />
      )}

      {/* ประวัติโหลดทีละหน้า (หน้าละ 100) — ถ้าเลือกช่วงวันที่ย้อนหลังแล้วไม่เจอ
          ให้กดโหลดเพิ่มจนครอบคลุมช่วงนั้น ไม่งั้นจะเข้าใจผิดว่าไม่มีประวัติ */}
      {hasMore && (
        <div className="flex items-center justify-center gap-3">
          <button className="btn btn-secondary text-sm" onClick={handleLoadMore} disabled={loading}>
            {loading ? 'กำลังโหลด…' : 'โหลดประวัติเก่ากว่านี้'}
          </button>
          <span className="text-xs text-gray-400">
            โหลดแล้ว {loadedCount.toLocaleString()} / {total.toLocaleString()} รายการ
          </span>
        </div>
      )}
    </div>
  )
}
