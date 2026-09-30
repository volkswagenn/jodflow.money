import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import useRecurringStore from '../../store/useRecurringStore'
import useTransactionStore from '../../store/useTransactionStore'
import usePendingStore from '../../store/usePendingStore'
import useLogStore from '../../store/useLogStore'
import { buildLogEntry } from '../../lib/logBuilder'
import { addToWallet } from '../../lib/walletEngine'
import { ensureCanPay } from '../../lib/balanceGuard'
import useCreditCardStore from '../../store/useCreditCardStore'
import { methodLabel } from '../../lib/walletEngine'
import { walletTarget } from '../../lib/api/transactions'
import { cancelTransaction } from '../../lib/transactionActions'
import useWalletStore from '../../store/useWalletStore'
import AppIcon from '../../components/shared/AppIcon'
import UiIcon from '../../components/shared/UiIcon'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import RecurringEntryCard from './RecurringEntryCard'
import RecurringEntryRow from './RecurringEntryRow'
import { addMonths, isYearly, monthName, occursInMonth, pauseInfo, pauseLabel, scheduleLabel } from '../../lib/recurringSchedule'
import PausePopup from './PausePopup'
import RecurringPausedCard from './RecurringPausedCard'
import { localMonthStr } from '../../lib/dateUtils'
import RecurringItemForm from './RecurringItemForm'
import PayEntryPopup from './PayEntryPopup'

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

// มุมมองรายการ: card = การ์ดเต็ม / compact = บรรทัดเดียว — จำไว้ในเครื่องต่อผู้ใช้
const VIEW_KEY = 'jodflow.recurring.view'
function loadView() {
  try { return localStorage.getItem(VIEW_KEY) === 'compact' ? 'compact' : 'card' } catch { return 'card' }
}

/**
 * บิลที่จัดการแล้วอยู่ในหัวข้อ "จ่ายแล้ว" นานกี่วัน ก่อนจะหายไปแล้วรอบเดือนหน้าขึ้นมาแทน
 *
 * เป็นกติกาการแสดงผลล้วนๆ ไม่แตะเงินและไม่แตะข้อมูล จึงเก็บในเครื่องเหมือนมุมมอง
 * การ์ด/บรรทัดเดียว ไม่ต้องรัน SQL เพิ่ม และแต่ละคนตั้งความยาวที่ตัวเองถนัดได้
 * 10 วันเป็นค่าตั้งต้น — ยาวพอให้สลิปธนาคารมาครบ สั้นพอไม่ให้หน้ารก
 */
const KEEP_KEY = 'jodflow.recurring.keepDays'
const KEEP_OPTIONS = [7, 10, 15, 30]
function loadKeepDays() {
  try {
    const n = Number(localStorage.getItem(KEEP_KEY))
    return KEEP_OPTIONS.includes(n) ? n : 10
  } catch { return 10 }
}

/** จำนวนวันเต็มจากวันที่ (ISO) ถึงวันนี้ — ใช้นับอายุของบิลที่จัดการไปแล้ว */
function daysSince(iso) {
  if (!iso) return 0
  // วันที่ล้วน (due_date) อ่านเป็นเที่ยงคืนเวลาไทย ส่วน timestamp (paid_at / skipped_at)
  // ต้องแปลงเป็นวันของเวลาไทยก่อน — ตัดสตริง 10 ตัวแรกของ ISO แบบเดิมได้วันของ UTC
  // ซึ่งจ่ายตอนตีหนึ่งจะถูกนับเป็นเมื่อวาน แล้วนับถอยหลังขาดไปหนึ่งวัน
  const s = String(iso)
  const then = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
  if (Number.isNaN(then.getTime())) return 0
  then.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((today - then) / 86400000)
}

/** เวลาที่ "จัดการ" รอบนี้ — จ่ายใช้วันที่จ่าย ข้ามใช้วันที่กดข้าม */
const handledAt = (e) => (e.status === 'paid' ? e.paidAt : e.skippedAt) ?? null

/**
 * บิลที่จ่ายแล้ว/ข้ามแล้ว ยังอยู่ในเดือนของมันไหม และเหลืออีกกี่วันจะไปเป็นบิลเดือนถัดไป
 *
 * นับจากวันที่จัดการจริง ไม่ใช่วันครบกำหนด (รอบข้ามเก่าที่ไม่มี skipped_at ถึงค่อยใช้วันครบกำหนด)
 * กด "ไป … เลย" หลังการจัดการครั้งล่าสุด = ย้ายทันทีไม่ต้องรอ — เทียบเวลาไว้ เพราะถ้า
 * ยกเลิกการจ่ายแล้วจ่ายใหม่ ค่าที่กดไว้ก่อนหน้าต้องไม่มีผลกับการจ่ายครั้งใหม่
 */
function doneState(entry, keepDays) {
  const act = handledAt(entry)
  if (entry.rolledAt && (!act || new Date(entry.rolledAt) >= new Date(act))) return { gone: true }
  const age = daysSince(act ?? entry.dueDate)
  return age >= keepDays ? { gone: true } : { gone: false, age, daysLeft: keepDays - age }
}

/**
 * หัวข้อคั่นระหว่างก้อน — จุดสี ชื่อ เดือน จำนวน และยอดรวมของก้อนนั้น
 * ตั้งใจไม่ทำเป็นการ์ด เพราะการ์ดแปลว่า "ก้อนข้อมูลหนึ่งชิ้น" ส่วนนี่คือป้ายบอกทาง
 */
function SectionHead({ dot, title, month, count, total, tone, pill, note }) {
  return (
    <div className="pt-3 first:pt-0">
      <div className="flex items-center gap-2.5">
        <span className={`w-[7px] h-[7px] rounded-full flex-none ${dot}`} />
        <span className="text-[13.5px] font-semibold whitespace-nowrap">{title}</span>
        <span className="text-[11.5px] text-faint whitespace-nowrap">{month}</span>
        <span className={`text-[10.5px] font-bold rounded-full px-2 py-px whitespace-nowrap ${pill}`}>
          {count} รายการ
        </span>
        <span className="flex-1 min-w-[12px] h-px bg-hairline" />
        <span className={`tabular-nums text-[13px] font-bold whitespace-nowrap ${tone}`}>
          {total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
        </span>
      </div>
      {note && <p className="text-[11px] text-faint leading-relaxed mt-1">{note}</p>}
    </div>
  )
}

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export default function RecurringPage() {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [payTarget, setPayTarget] = useState(null) // { entry, item }
  const [deleteItemId, setDeleteItemId] = useState(null)
  const [undoTarget, setUndoTarget] = useState(null)
  const [showItemList, setShowItemList] = useState(false)
  const [view, setView] = useState(loadView)
  const [keepDays, setKeepDays] = useState(loadKeepDays)
  const [pauseTarget, setPauseTarget] = useState(null)
  // รอบที่กำลังจะย้ายไปเป็นของเดือนก่อน — ยืนยันก่อนเสมอ เพราะรอบจะหายจากเดือนที่ดูอยู่
  const [movePrevTarget, setMovePrevTarget] = useState(null)
  const changeView = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch {} }
  const changeKeepDays = (n) => { setKeepDays(n); try { localStorage.setItem(KEEP_KEY, String(n)) } catch {} }

  const {
    items, entries, addItem, updateItem, toggleItem, deleteItem,
    generateEntries, updateEntry, markSkipped, rollToNextMonth, moveToPrevMonth, getPendingCountCurrentMonth, syncPendingEntries,
    pauseItem, resumeItem,
    syncEntryFromTransaction,
  } = useRecurringStore()
  const { addTransaction, transactions } = useTransactionStore()
  const { addPending, deletePending, pendingPayments } = usePendingStore()
  const { addLog } = useLogStore()
  const refreshWallet = useWalletStore((s) => s.refresh)
  const refreshPending = usePendingStore((s) => s.refresh)
  // งานที่แตะเงินต้องรอเซิร์ฟเวอร์ตอบ — กันกดซ้ำและแสดงผลที่ล้มบนหน้าจอ
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const month = monthKey(viewYear, viewMonth)
  // เดือนถัดไปของเดือนที่ดูอยู่ — ใช้กับหัวข้อที่ 3
  const nextMonth = monthKey(viewMonth === 11 ? viewYear + 1 : viewYear, (viewMonth + 1) % 12)

  // สร้าง entry ของเดือนที่ดูอยู่ — ต้องรันใหม่เมื่อ items เปลี่ยนด้วย
  // ไม่งั้นการเปิดใช้รายการที่ปิดไว้จะไม่สร้าง entry จนกว่าจะสลับเดือนไปกลับ
  useEffect(() => {
    generateEntries(month)
    // สร้างรอบของเดือนถัดไปด้วย เพราะหัวข้อที่ 3 ต้องมี entry จริงให้กด "จ่ายล่วงหน้า"
    // ถ้าปั้นแถวขึ้นมาลอยๆ ปุ่มจ่ายจะกดไม่ได้ ซึ่งแย่กว่าไม่มีหัวข้อนั้นเลย
    generateEntries(nextMonth)
  }, [month, nextMonth, items])

  const navigateMonth = (delta) => {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setViewMonth(m)
    setViewYear(y)
  }

  // entries for current view month, merged with item data
  //
  // ที่ยังไม่จ่ายอยู่บนสุดเรียงตามวันครบกำหนด ที่จัดการไปแล้ว (จ่ายแล้ว/ข้าม) ไหลลงล่าง
  // เพราะสิ่งที่คนเปิดหน้านี้มาทำคือ "เดือนนี้เหลืออะไรต้องจ่ายอีก" ของที่จบไปแล้ว
  // เป็นแค่หลักฐานให้ไล่ดูย้อนหลัง ไม่ควรมาแทรกกลางรายการที่ยังต้องทำ
  const monthEntries = useMemo(() => {
    const rank = (st) => (st === 'pending' ? 0 : st === 'skipped' ? 1 : 2)
    return entries
      .filter((e) => e.month === month)
      .map((e) => ({ entry: e, item: items.find((it) => it.id === e.recurringId) }))
      .filter((x) => x.item)
      .sort((a, b) => rank(a.entry.status) - rank(b.entry.status)
        || a.item.billingDay - b.item.billingDay)
  }, [entries, items, month])

  /**
   * สามหัวข้อของหน้านี้ ตอบคนละคำถาม จึงต้องแยกกันให้เห็น
   *   1. รอจ่าย        — รอบของเดือนที่ดูอยู่ที่ยังไม่ได้จ่าย = สิ่งที่ต้องลงมือทำ
   *   2. จ่ายแล้ว      — จ่ายหรือข้ามไปแล้ว เก็บไว้ไล่เช็คกับสลิปตามจำนวนวันที่ตั้งไว้
   *   3. เดือนหน้า     — พอบิลในหัวข้อ 2 ครบกำหนดเก็บ มันจะหายไป (ดูย้อนหลังที่ประวัติ
   *                      การจ่าย) แล้วรอบเดือนถัดไปของรายการนั้นขึ้นมาแทน
   *
   * นับอายุจากวันที่จ่ายจริง ส่วนรอบที่กด "ข้าม" ไม่มีวันจ่าย จึงนับจากวันครบกำหนด
   * ซึ่งคือวันที่ตัดสินใจว่าเดือนนี้ไม่ต้องจ่ายอยู่แล้ว
   */
  const openEntries = monthEntries.filter((x) => x.entry.status === 'pending')

  const doneEntries = []
  const agedOutIds = new Set()
  for (const x of monthEntries) {
    if (x.entry.status === 'pending') continue
    const st = doneState(x.entry, keepDays)
    if (st.gone) agedOutIds.add(x.item.id)
    else doneEntries.push({ ...x, age: st.age, daysLeft: st.daysLeft })
  }
  doneEntries.sort((a, b) => a.age - b.age || a.item.billingDay - b.item.billingDay)

  /**
   * หัวข้อที่ 3 — "รอบถัดไปที่ยังต้องสนใจ" ของรายการที่รอบเดือนนี้พ้นกำหนดเก็บแล้ว
   *
   * เดินหน้าทีละเดือนจากเดือนถัดไป จนเจอรอบที่ยังมีความหมายกับคนใช้ คือ
   *   • ยังไม่ได้จ่าย            → แสดงพร้อมปุ่มจ่ายล่วงหน้า
   *   • เพิ่งจ่าย ยังไม่พ้น keepDays → แสดงว่าจ่ายแล้วและเหลืออีกกี่วันจะเลื่อน
   * รอบที่จ่ายแล้วและพ้นกำหนดเก็บ ให้ข้ามไปดูรอบถัดไปต่อ
   *
   * ของเดิมล็อกไว้ที่ "เดือนที่ดู + 1" เสมอ ⇒ จ่ายล่วงหน้าไปกี่เดือนก็ตาม หัวข้อนี้
   * ไม่เคยขยับตาม คนจึงเห็นรอบที่จ่ายไปแล้วค้างอยู่ราวกับยังไม่ได้จ่าย
   *
   * เดือนที่รายการไม่ได้ออกบิล (รายปีที่ไม่ใช่เดือนเรียกเก็บ · เดือนที่พักอยู่) ข้ามไปเลย
   * ไม่งั้นจะไปจอดรอ entry ที่ไม่มีวันถูกสร้าง
   */
  const MAX_LOOKAHEAD = 12
  const { nextEntries, missingMonths } = useMemo(() => {
    if (agedOutIds.size === 0) return { nextEntries: [], missingMonths: [] }

    const byKey = new Map(entries.map((e) => [`${e.recurringId}|${e.month}`, e]))
    const rows = []
    const missing = new Set()

    for (const id of agedOutIds) {
      const item = items.find((it) => it.id === id)
      if (!item) continue

      let m = nextMonth
      for (let step = 0; step < MAX_LOOKAHEAD; step++) {
        const monthNo = Number(m.split('-')[1])
        if (!occursInMonth(item, monthNo) || pauseInfo(item, m)) {
          m = addMonths(m, 1)
          continue
        }
        const e = byKey.get(`${id}|${m}`)
        if (!e) {
          // ยังไม่ถูกสร้าง — ขอให้สร้างแล้วค่อยแสดงในรอบ render ถัดไป
          missing.add(m)
          break
        }
        if (e.status === 'pending') {
          rows.push({ entry: e, item })
          break
        }
        const st = doneState(e, keepDays)
        if (!st.gone) {
          rows.push({ entry: e, item, age: st.age, daysLeft: st.daysLeft })
          break
        }
        m = addMonths(m, 1)
      }
    }

    rows.sort((a, b) => (a.entry.month < b.entry.month ? -1 : a.entry.month > b.entry.month ? 1 : 0)
      || a.item.billingDay - b.item.billingDay)
    return { nextEntries: rows, missingMonths: [...missing].sort() }
    // agedOutIds สร้างใหม่ทุกรอบ render จึงผูก dependency กับสิ่งที่ทำให้มันเปลี่ยนแทน
  }, [entries, items, nextMonth, monthEntries, keepDays]) // eslint-disable-line react-hooks/exhaustive-deps

  // รอบของเดือนที่ไกลกว่า "เดือนถัดไป" ถูกสร้างเมื่อต้องใช้จริงเท่านั้น — คนที่ไม่เคยจ่าย
  // ล่วงหน้าจะไม่มีแถวอนาคตงอกไว้เปล่าๆ ในฐานข้อมูล
  const missingKey = missingMonths.join(',')
  useEffect(() => {
    for (const m of missingMonths) generateEntries(m)
  }, [missingKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ชื่อเดือนบนหัวข้อที่ 3 — ตอนนี้แต่ละรายการอยู่คนละเดือนได้ (ใครจ่ายล่วงหน้าไปไกล
   * ก็เลื่อนไปไกลกว่า) จึงบอกเป็นช่วงแทนเดือนเดียว ส่วนเดือนของแต่ละใบอ่านได้จาก
   * วันครบกำหนดบนแถวนั้นอยู่แล้ว
   */
  const nextMonthsLabel = useMemo(() => {
    const label = (m) => {
      const [y, mm] = m.split('-').map(Number)
      return `${THAI_MONTHS[mm - 1]} ${y + 543}`
    }
    const months = [...new Set(nextEntries.map((x) => x.entry.month))].sort()
    if (months.length === 0) return ''
    if (months.length === 1) return label(months[0])
    return `${label(months[0])} – ${label(months[months.length - 1])}`
  }, [nextEntries])

  const sumOf = (list) => list.reduce((n, x) => n + (Number(x.entry.amount) || 0), 0)

  // เดือนที่ถูกพักไม่มี entry ในฐานข้อมูลเลย (ไม่ได้ออกบิล) จึงต้องหยิบจากแม่แบบมาแสดงเอง
  // ตั้งใจให้ยังเห็นอยู่ เพราะต้องรู้ว่ารายการนี้ยังมีและจะกลับมาเมื่อไหร่
  const pausedThisMonth = useMemo(() => {
    return items
      .filter((it) => it.enabled && !it.deleted)
      .map((it) => ({ item: it, info: pauseInfo(it, month) }))
      .filter((x) => x.info)
      .sort((a, b) => a.item.billingDay - b.item.billingDay)
  }, [items, month])

  const summary = useMemo(() => {
    const paid = monthEntries.filter((x) => x.entry.status === 'paid')
    const pending = monthEntries.filter((x) => x.entry.status === 'pending')
    return {
      paidCount: paid.length,
      paidTotal: paid.reduce((s, x) => s + (x.entry.amount || 0), 0),
      pendingCount: pending.length,
      pendingTotal: pending.reduce((s, x) => s + (x.entry.amount || 0), 0),
    }
  }, [monthEntries])

  // ── Handlers ────────────────────────────────────────────────────────────────

  // ทุกตัวต้อง await ให้เซิร์ฟเวอร์ตอบรับก่อนจึงปิดหน้าต่าง — ถ้าไม่รอ เวลาบันทึกล้ม
  // (เช่นฐานข้อมูลยังไม่มีคอลัมน์ใหม่) หน้าต่างจะปิดเหมือนสำเร็จ แล้วผู้ใช้เข้าใจว่า
  // บันทึกแล้วทั้งที่ไม่มีอะไรถูกเขียนเลย พอรีเฟรชจึงดูเหมือน "ข้อมูลหาย"
  const handleAddItem = async (data) => {
    await addItem(data)
    addLog(buildLogEntry({ activityType: 'RECURRING_CREATE', description: `สร้างรายการประจำ "${data.name}"` }))
    await generateEntries(month)
    setShowForm(false)
  }

  const handleUpdateItem = async (data) => {
    const id = editItem.id
    await updateItem(id, data)
    // เดือนนี้จริงๆ ไม่ใช่เดือนที่กำลังเปิดดู — ย้อนไปแก้บิลเดือนที่ผ่านมาแล้วไม่ได้
    const changed = await syncPendingEntries(id, localMonthStr())
    addLog(buildLogEntry({
      activityType: 'RECURRING_UPDATE',
      description: `แก้ไขรายการประจำ "${data.name}"` +
        (changed > 0 ? ` (ปรับรอบที่ยังไม่จ่าย ${changed} รอบให้ตรงกัน)` : ''),
    }))
    await generateEntries(month)
    setEditItem(null)
  }

  const handleDeleteItem = async () => {
    const it = items.find((i) => i.id === deleteItemId)
    await deleteItem(deleteItemId)
    addLog(buildLogEntry({ activityType: 'RECURRING_DELETE', description: `ลบรายการประจำ "${it?.name}"` }))
    setDeleteItemId(null)
  }

  const handlePay = (entry, item) => setPayTarget({ entry, item })

  const paidThisMonthFor = (itemId) =>
    entries.some((e) => e.recurringId === itemId && e.month === localMonthStr() && e.status === 'paid')

  const handlePause = async (months) => {
    const item = pauseTarget
    const { from, until } = await pauseItem(item.id, months)
    addLog(buildLogEntry({
      activityType: 'RECURRING_UPDATE',
      description: `พักการเรียกเก็บ "${item.name}" ${months} เดือน (ตั้งแต่ ${from} ถึงก่อน ${until})`,
      newValue: { recurringId: item.id, pausedFrom: from, pausedUntil: until, months },
    }))
    setPauseTarget(null)
  }

  const handleResume = async (item) => {
    await resumeItem(item.id)
    addLog(buildLogEntry({
      activityType: 'RECURRING_UPDATE',
      description: `ยกเลิกการพักเรียกเก็บ "${item.name}" กลับมาเรียกเก็บตามปกติ`,
    }))
    // พักอยู่แปลว่าเดือนนี้ไม่มีรอบ พอเลิกพักต้องสร้างรอบให้ใหม่ทันที
    await generateEntries(month)
  }

  /**
   * กดจ่ายรอบรายการประจำ
   *
   * จ่ายสด/โอน: บันทึกรายการ + ตัดเงิน + log จบใน RPC เดียว (post_transaction)
   * แล้วค่อยผูก entry กับรายการที่ได้ — ของเดิมเรียก addTransaction/deductWallet
   * โดยไม่ await ทำให้ tx.id เป็น undefined entry จึงไม่เคยผูกกับรายการ (ยกเลิกไม่ได้)
   * และเงินถูกตัดแยกอีกคำสั่ง ถ้าอันใดอันหนึ่งล้มยอดจะไม่ตรง
   */
  const executeMarkPaid = async (entry, item, amount, paidMethod, paidDate = format(new Date(), 'yyyy-MM-dd'), accountId = null, cardId = null, paidAt = null) => {
    if (busy) return
    // ด่านสุดท้ายกันจ่ายซ้ำ — ทุกเส้นทางที่ตัดเงินจริงผ่านฟังก์ชันนี้ ถ้ารอบนี้จ่ายไปแล้ว
    // การทำซ้ำคือสร้างรายการจ่ายใบที่สองและตัดเงินออกอีกรอบ ซึ่งตามเก็บทีหลังยาก
    // (เคยเกิดได้จริงตอนหัวข้อ "รอบถัดไป" แสดงปุ่มจ่ายค้างไว้ทั้งที่จ่ายแล้ว)
    const fresh = entries.find((e) => e.id === entry.id) ?? entry
    if (fresh.status !== 'pending') {
      setActionError(`"${item.name}" รอบนี้บันทึกว่า${fresh.status === 'paid' ? 'จ่ายแล้ว' : 'ข้ามแล้ว'} — ถ้าต้องการแก้ ให้กดยกเลิกการจ่ายก่อน`)
      setPayTarget(null)
      return
    }
    setBusy(true)
    setActionError('')
    try {
      let tx = null
      let pendingPaymentId = null

      if (paidMethod === 'pending') {
        const p = await addPending({
          description: item.name,
          itemName: item.name,
          amount,
          dueDate: entry.dueDate,
          category: item.category,
          vendor: item.vendor,
          note: item.note,
          recurringEntryId: entry.id,
          // พกวิธีจ่าย/บัญชีที่ตั้งไว้ไปด้วย เพื่อให้ตอนกดชำระใช้ได้ทันที
          // ยกเว้น 'card' — หน้าค้างชำระจ่ายได้แค่เงินสด/เงินโอน และไม่มีที่เก็บว่ารูดใบไหน
          // ถ้าส่งไปจะกลายเป็นวิธีจ่ายที่กดต่อไม่ได้จริง
          ...(item.defaultMethod && !['pending', 'card'].includes(item.defaultMethod)
            ? { defaultMethod: item.defaultMethod } : {}),
          ...(item.defaultTransferAccountId ? { defaultTransferAccountId: item.defaultTransferAccountId } : {}),
        })
        pendingPaymentId = p.id
      } else {
        const target = walletTarget(paidMethod, { transferAccountId: accountId, cardId })
        if (!target) throw new Error(paidMethod === 'card' ? 'กรุณาเลือกบัตรเครดิต' : 'กรุณาเลือกบัญชีเงินโอน')
        tx = await addTransaction({
          type: 'expense',
          date: paidDate,
          amount,
          category: item.category,
          method: paidMethod,
          ...(accountId ? { transferAccountId: accountId } : {}),
          ...(cardId ? { cardId } : {}),
          itemName: item.name,
          vendor: item.vendor,
          note: item.note,
          recurringEntryId: entry.id,
        }, {
          effect: { target, delta: -amount },
          log: buildLogEntry({
            activityType: 'RECURRING_PAID',
            description: `จ่ายรายการประจำ "${item.name}" ${amount.toLocaleString()} บาท`,
            walletEffect: { target: paidMethod, delta: -amount, transferAccountId: accountId, cardId },
            newValue: { recurringEntryId: entry.id, recurringId: item.id, amount, paidDate },
          }),
        })
        if (cardId) await useCreditCardStore.getState().refresh()
        else await refreshWallet()
      }

      await updateEntry(entry.id, {
        status: 'paid',
        amount,
        paidMethod,
        transferAccountId: accountId,
        cardId,
        // เวลาจากหน้าต่างจ่าย ถ้าไม่ได้ระบุใช้เที่ยงตรงของวันที่เลือกเหมือนเดิม
        paidAt: paidAt ?? new Date(`${paidDate}T12:00:00`).toISOString(),
        transactionId: tx?.id ?? null,
        pendingPaymentId,
      })

      setPayTarget(null)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handlePayConfirm = async (amount, paidMethod, paidDate, accountId = null, cardId = null, paidAt = null) => {
    const { entry, item } = payTarget
    // ด่านยอดเงิน — บัตรเครดิตกับค้างชำระไม่ได้ตัดเงินจากที่ไหน ด่านจะปล่อยผ่านเอง
    // ไม่ผ่าน (เงินไม่พอ / ผู้ใช้ไม่จ่ายต่อ) ก็คงหน้าต่างจ่ายไว้ ให้เปลี่ยนแหล่งเงินได้เลย
    if (!(await ensureCanPay({ method: paidMethod, amount, accountId }))) return
    executeMarkPaid(entry, item, amount, paidMethod, paidDate, accountId, cardId, paidAt)
  }

  const handleSaveEntryAmount = async (amount) => {
    const { entry, item } = payTarget
    setActionError('')
    try {
      await updateEntry(entry.id, { amount, amountUpdatedAt: new Date().toISOString() })
      addLog(buildLogEntry({
        activityType: 'RECURRING_UPDATE',
        description: `บันทึกยอดรายการประจำ "${item.name}" ${amount.toLocaleString()} บาท`,
        newValue: { recurringEntryId: entry.id, recurringId: item.id, amount },
      }))
      setPayTarget(null)
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleUndoPay = (entry) => setUndoTarget(entry)

  // pending ที่ผูกกับ entry — ใช้ทั้งตอนแสดงผลลัพธ์และตอนยกเลิกจริง
  const linkedPendingOf = (entry) =>
    entry?.pendingPaymentId ? pendingPayments.find((p) => p.id === entry.pendingPaymentId) : null

  const undoEffects = (entry) => {
    if (!entry) return []
    const lines = []
    const linked = linkedPendingOf(entry)
    if (entry.paidMethod && entry.paidMethod !== 'pending') {
      lines.push(`คืนเงิน ${entry.amount.toLocaleString()} บาท เข้า${methodLabel(entry.paidMethod)}`)
      if (entry.transactionId) lines.push('ลบรายการบันทึกที่เชื่อมโยง')
    }
    if (linked?.status === 'paid') {
      lines.push(`คืนเงิน ${linked.amount.toLocaleString()} บาท เข้า${methodLabel(linked.paidMethod)} (ชำระผ่านรายการค้างจ่าย)`)
      if (linked.transactionId) lines.push('ลบรายการบันทึกของการชำระ')
    }
    if (linked) lines.push('ลบรายการค้างจ่ายที่เชื่อมโยง')
    if (lines.length === 0) lines.push('ไม่มีผลต่อยอดเงิน')
    return lines
  }

  /**
   * รายการที่ผูกกับ entry อาจอยู่นอกช่วง 24 เดือนที่โหลดไว้ — ประกอบข้อมูลขั้นต่ำ
   * ที่ cancelTransaction ต้องใช้คำนวณเงินคืน (type/method/amount/บัญชี) จากตัว entry แทน
   */
  const txForCancel = (transactionId, { method, amount, transferAccountId, itemName, date }) =>
    transactions.find((t) => t.id === transactionId) ?? {
      id: transactionId, type: 'expense', method, amount, transferAccountId: transferAccountId ?? null,
      itemName, date,
    }

  /**
   * ยกเลิกการจ่าย — ทุกขั้นรอเซิร์ฟเวอร์ตอบตามลำดับ
   *
   * การคืนเงินใช้ RPC cancel_transaction (คืนเงินตาม effect + ลบรายการ + ลบรายการค้าง
   * ที่ผูก + ย้อน entry ในทรานแซกชันเดียว) ไม่ใช่ addToWallet แยกอีกคำสั่งแบบเดิม
   * ซึ่งยิงพร้อมกัน 4–5 คำสั่งแล้วแข่งกันเขียน entry เดียวกับที่ RPC ย้อนให้
   */
  const executeUndoPay = async () => {
    if (busy) return
    const entry = undoTarget
    const item = items.find((it) => it.id === entry.recurringId)
    setBusy(true)
    setActionError('')
    try {
      const linked = linkedPendingOf(entry)

      // 1. จ่ายสด/โอนโดยตรง → ยกเลิกรายการ = คืนเงิน + ย้อน entry ให้ที่ฐานข้อมูล
      if (entry.transactionId) {
        await cancelTransaction(txForCancel(entry.transactionId, {
          method: entry.paidMethod, amount: entry.amount, transferAccountId: entry.transferAccountId,
          itemName: item?.name, date: entry.dueDate,
        }))
      } else if (entry.paidMethod && entry.paidMethod !== 'pending' && entry.amount > 0) {
        // entry รุ่นเก่าที่ไม่ได้ผูกรายการไว้ — คืนเงินตรงๆ
        await addToWallet(entry.paidMethod, entry.amount, {
          activityType: 'RECURRING_UNPAID',
          description: `ยกเลิกการจ่าย "${item?.name}" คืนเงิน ${entry.amount.toLocaleString()} บาท`,
        }, entry.transferAccountId)
      }

      // 2. จ่ายผ่าน "ค้างชำระ" แล้วไปกดชำระที่หน้ารายการรอ — ต้องคืนเงินและลบรายการ
      //    ของการชำระด้วย ไม่งั้นเงินยังถูกหักอยู่แต่ entry กลับเป็น "รอจ่าย" → จ่ายซ้ำได้
      if (linked?.status === 'paid' && linked.transactionId) {
        // cancel_transaction ลบ pending_payments ที่ผูกกับรายการนั้นให้ด้วย
        await cancelTransaction(txForCancel(linked.transactionId, {
          method: linked.paidMethod, amount: linked.amount, transferAccountId: linked.transferAccountId,
          itemName: item?.name, date: entry.dueDate,
        }))
      } else if (linked) {
        if (linked.status === 'paid' && linked.paidMethod) {
          await addToWallet(linked.paidMethod, linked.amount, {
            activityType: 'RECURRING_UNPAID',
            description: `ยกเลิกการจ่าย "${item?.name}" คืนเงิน ${linked.amount.toLocaleString()} บาท (ชำระผ่านรายการค้างจ่าย)`,
          }, linked.transferAccountId)
        }
        await deletePending(linked.id)
      }

      // 3. ย้อน entry (RPC ย้อนให้แล้วถ้ามีรายการผูก แต่ต้องตั้งยอดคงที่และล้างการผูกให้ครบ)
      await updateEntry(entry.id, {
        status: 'pending',
        paidAt: null,
        paidMethod: null,
        transactionId: null,
        pendingPaymentId: null,
        transferAccountId: null,
        amount: item?.amountType === 'fixed' ? (item.fixedAmount ?? 0) : 0,
      })

      await Promise.all([refreshWallet(), refreshPending()])
      addLog(buildLogEntry({
        activityType: 'RECURRING_UNPAID',
        description: `ยกเลิกการจ่ายรายการประจำ "${item?.name}"`,
        newValue: { recurringEntryId: entry.id, recurringId: item?.id },
      }))
      setUndoTarget(null)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSkip = async (entryId) => {
    const e = entries.find((x) => x.id === entryId)
    setActionError('')
    try {
      if (e?.status === 'skipped') {
        await updateEntry(entryId, { status: 'pending' })
      } else {
        await markSkipped(entryId)
        addLog(buildLogEntry({ activityType: 'RECURRING_SKIPPED', description: `ข้ามรายการประจำเดือน ${month}` }))
      }
    } catch (err) {
      setActionError(err.message)
    }
  }

  /**
   * ไม่รอนับถอยหลัง — ย้ายบิลที่จ่ายแล้ว/ข้ามไปเป็นบิลของเดือนถัดไปทันที
   * ไม่แตะเงินและไม่แตะสถานะ แค่จำเวลาที่กดไว้ ประวัติการจ่ายของเดือนนี้จึงอยู่ครบเหมือนเดิม
   */
  const handleRoll = async (entry, item) => {
    setActionError('')
    try {
      await rollToNextMonth(entry.id)
      addLog(buildLogEntry({
        activityType: 'RECURRING_UPDATE',
        description: `ย้าย "${item.name}" ไปเป็นบิลเดือนถัดไปทันที (ไม่รอนับถอยหลัง)`,
        newValue: { recurringEntryId: entry.id, recurringId: item.id, month: entry.month },
      }))
    } catch (err) {
      setActionError(err.message)
    }
  }

  /**
   * "บิลนี้เป็นของเดือนก่อน" — ย้ายรอบที่จ่าย/ข้ามแล้วไปเดือนก่อนหน้า แล้วรอบเดือนนี้กลับเป็นรอจ่าย
   *
   * ต่างจากยกเลิกการจ่ายโดยสิ้นเชิง: ยกเลิก = คืนเงินเข้ากระเป๋า + ลบรายจ่าย ซึ่งผิดเมื่อเงินออกไป
   * แล้วจริง การย้ายรอบเปลี่ยนแค่ว่า "บิลใบนี้นับเป็นของเดือนไหน" เงินและรายจ่ายอยู่เหมือนเดิม
   */
  const handleMovePrev = async () => {
    const { entry, item } = movePrevTarget
    setActionError('')
    try {
      const from = entry.month
      await moveToPrevMonth(entry.id)
      addLog(buildLogEntry({
        activityType: 'RECURRING_UPDATE',
        description: `ย้ายรอบ "${item.name}" จาก ${monthName(from)} ไปเป็นของ ${monthName(addMonths(from, -1))} (ไม่แตะเงิน)`,
        newValue: { recurringEntryId: entry.id, recurringId: item.id, fromMonth: from, toMonth: addMonths(from, -1) },
      }))
    } catch (err) {
      setActionError(err.message)
    } finally {
      setMovePrevTarget(null)
    }
  }

  // แม่แบบที่ถูกซ่อน (ลบไปแล้วแต่ยังมีประวัติจ่าย) ไม่ต้องโผล่ในลิสต์จัดการ
  // แต่ยังต้องอยู่ใน items เพื่อให้รอบที่จ่ายแล้วของเดือนเก่าแสดงชื่อรายการได้
  const activeItems = useMemo(() => items.filter((it) => !it.deleted), [items])

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth()

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button className="btn btn-secondary w-8 h-8 p-0 flex items-center justify-center" onClick={() => navigateMonth(-1)}>‹</button>
          <span className="text-sm font-semibold text-gray-800 min-w-[120px] text-center">
            {THAI_MONTHS[viewMonth]} {viewYear + 543}
            {isCurrentMonth && <span className="ml-1 text-xs text-blue-500 font-normal">(เดือนนี้)</span>}
          </span>
          <button className="btn btn-secondary w-8 h-8 p-0 flex items-center justify-center" onClick={() => navigateMonth(1)}>›</button>
        </div>
        <div className="flex items-center gap-2">
          {/* สลับมุมมอง การ์ดเต็ม / บรรทัดเดียว */}
          <div className="inline-flex rounded-lg border border-hairline bg-white p-0.5" role="group" aria-label="มุมมองรายการ">
            <button
              type="button"
              onClick={() => changeView('card')}
              className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${view === 'card' ? 'bg-ink text-white' : 'text-gray-500 hover:bg-[#F6F5F1]'}`}
              title="การ์ดเต็ม"
            >
              ▤ เต็ม
            </button>
            <button
              type="button"
              onClick={() => changeView('compact')}
              className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${view === 'compact' ? 'bg-ink text-white' : 'text-gray-500 hover:bg-[#F6F5F1]'}`}
              title="บรรทัดเดียว"
            >
              ☰ ย่อ
            </button>
          </div>
          {/* บิลที่จ่ายแล้วอยู่ในหัวข้อที่ 2 นานแค่ไหน ก่อนเปลี่ยนเป็นรอบเดือนหน้า */}
          <div className="hidden lg:flex items-center gap-1.5 rounded-lg border border-hairline bg-white pl-2.5 p-0.5">
            <span className="text-[11px] text-muted whitespace-nowrap">เก็บบิลที่จ่ายแล้ว</span>
            <div className="inline-flex gap-0.5" role="group" aria-label="จำนวนวันที่เก็บบิลที่จ่ายแล้ว">
              {KEEP_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => changeKeepDays(n)}
                  title={`เก็บบิลที่จ่ายแล้วไว้ ${n} วัน แล้วเปลี่ยนเป็นรอบเดือนหน้า`}
                  className={`px-2 h-7 rounded-md text-xs font-semibold transition-colors ${
                    keepDays === n ? 'bg-ink text-white' : 'text-gray-500 hover:bg-[#F6F5F1]'
                  }`}
                >
                  {n} วัน
                </button>
              ))}
            </div>
          </div>
          {/* คำใบ้บอกกติกาสองข้อที่คนถามบ่อยที่สุด: รายการโผล่มาเองเมื่อไหร่ และจ่ายตรงนี้ไม่ซ้ำกับแท็บรายจ่าย */}
          <span className="flex-1 min-w-0 text-[11.5px] text-faint leading-snug hidden md:block">
            ระบบสร้างรายการประจำให้อัตโนมัติทุกวันที่ 1 เวลา 08:00 · กดจ่ายที่นี่แล้วจะไม่ต้องบันทึกซ้ำในแท็บรายจ่าย
          </span>
          <button
            className="flex-none h-9 px-3.5 rounded-[11px] bg-ink text-white text-[12.5px] font-semibold flex items-center gap-[7px] hover:bg-black"
            onClick={() => setShowForm(true)}
          >
            <UiIcon name="plus" tone="w" size={13} />
            เพิ่มรายการประจำ
          </button>
        </div>
      </div>

      {/* ผลลัพธ์ที่ล้ม ต้องเห็นบนหน้าจอ ไม่ใช่จมอยู่ใน console */}
      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          ทำรายการไม่สำเร็จ — {actionError}
        </p>
      )}

      {/* ไทล์สรุปตรงกับสามหัวข้อด้านล่างหนึ่งต่อหนึ่ง — ยอดรวมทั้งเดือนอยู่ที่กล่องสรุป
          ท้ายหน้าอยู่แล้ว ถ้าเอามาไว้ตรงนี้ด้วยจะกลายเป็นตัวเลขซ้ำที่ไม่ตรงกับก้อนไหนเลย */}
      {monthEntries.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-amber-50 rounded-xl p-3 text-center border border-amber-100">
            <p className="text-xs text-gray-500 mb-0.5">รอจ่าย · เดือนนี้</p>
            <p className="text-base font-bold text-amber-600">{sumOf(openEntries).toLocaleString('th-TH')}</p>
            <p className="text-xs text-amber-500">{openEntries.length} รายการ</p>
          </div>
          <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
            <p className="text-xs text-gray-500 mb-0.5">จ่ายแล้ว · เดือนนี้</p>
            <p className="text-base font-bold text-emerald-600">{summary.paidTotal.toLocaleString('th-TH')}</p>
            <p className="text-xs text-emerald-500">
              {summary.paidCount} รายการ{doneEntries.length !== summary.paidCount ? ` · แสดง ${doneEntries.length}` : ''}
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center border border-gray-200">
            <p className="text-xs text-gray-500 mb-0.5">เตรียมจ่าย · เดือนหน้า</p>
            <p className="text-base font-bold text-gray-800">{sumOf(nextEntries).toLocaleString('th-TH')}</p>
            <p className="text-xs text-gray-400">{nextEntries.length} รายการ</p>
          </div>
        </div>
      )}

      {/* Entry list */}
      {monthEntries.length === 0 && pausedThisMonth.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">🔁</p>
          <p className="text-sm">ยังไม่มีรายการประจำเดือนนี้</p>
          <p className="text-xs mt-1">กด "เพิ่มรายการ" เพื่อสร้างรายจ่ายประจำ</p>
        </div>
      ) : (
        <div className={view === 'compact' ? 'space-y-1' : 'space-y-2'}>
          <SectionHead
            dot="bg-pending"
            title="บิลที่รอจ่าย"
            month={`${THAI_MONTHS[viewMonth]} ${viewYear + 543}`}
            count={openEntries.length}
            total={sumOf(openEntries)}
            tone="text-pending"
            pill="bg-pending-soft text-pending"
          />
          {openEntries.length === 0 && (
            <p className="text-[12px] text-faint bg-white border border-dashed border-hairline rounded-[11px] py-3.5 text-center">
              จ่ายครบทุกรายการของเดือนนี้แล้ว
            </p>
          )}
          {openEntries.map(({ entry, item }) => {
            const Row = view === 'compact' ? RecurringEntryRow : RecurringEntryCard
            return (
              <Row
                key={entry.id}
                entry={entry}
                item={item}
                onPay={handlePay}
                onUndoPay={handleUndoPay}
                onSkip={handleSkip}
                onEdit={setEditItem}
                onDelete={(it) => setDeleteItemId(it.id)}
                onPause={setPauseTarget}
              />
            )
          })}

          <SectionHead
            dot="bg-income"
            title="จ่ายแล้ว / ข้าม"
            month={`${THAI_MONTHS[viewMonth]} ${viewYear + 543}`}
            count={doneEntries.length}
            total={sumOf(doneEntries.filter((x) => x.entry.status === 'paid'))}
            tone="text-income"
            pill="bg-income-soft text-income"
            note={`ขีดฆ่าไว้ในเดือนนี้ · นับถอยหลัง ${keepDays} วันจากวันที่จ่ายหรือวันที่กดข้าม · ครบแล้วไปเป็นบิลเดือนถัดไป · ไม่อยากรอ กด "ไป … เลย" (ย้อนดูได้ที่ "ประวัติการจ่าย")`}
          />
          {doneEntries.length === 0 && (
            <p className="text-[12px] text-faint bg-white border border-dashed border-hairline rounded-[11px] py-3.5 text-center">
              ยังไม่มีบิลที่จ่ายหรือข้ามในช่วง {keepDays} วันที่ผ่านมา
            </p>
          )}

          {doneEntries.map(({ entry, item, daysLeft }) => {
            const Row = view === 'compact' ? RecurringEntryRow : RecurringEntryCard
            return (
              <Row
                key={entry.id}
                entry={entry}
                item={item}
                daysLeft={daysLeft}
                onRoll={handleRoll}
                onMovePrev={(entry, item) => setMovePrevTarget({ entry, item })}
                onPay={handlePay}
                onUndoPay={handleUndoPay}
                onSkip={handleSkip}
                onEdit={setEditItem}
                onDelete={(it) => setDeleteItemId(it.id)}
                onPause={setPauseTarget}
              />
            )
          })}

          {/* หัวข้อที่ 3 — โผล่เฉพาะตอนมีบิลที่พ้นกำหนดเก็บแล้วจริง ถ้าไม่มีก็ไม่ต้อง
              เอาหัวข้อว่างมาถ่วงหน้าจอ */}
          {nextEntries.length > 0 && (
            <>
              <SectionHead
                dot="bg-[#A5A199]"
                title="บิลของเดือนถัดไป"
                month={nextMonthsLabel}
                count={nextEntries.length}
                total={sumOf(nextEntries)}
                tone="text-muted"
                pill="bg-paper text-muted"
                note="บิลที่นับถอยหลังครบแล้ว ย้ายมาเป็นบิลของเดือนถัดไป · จ่ายล่วงหน้าได้ถ้าบิลมาถึงก่อน"
              />
              {nextEntries.map(({ entry, item, daysLeft }) => {
                const Row = view === 'compact' ? RecurringEntryRow : RecurringEntryCard
                return (
                  <Row
                    key={entry.id}
                    entry={entry}
                    item={item}
                    // จ่ายไปแล้วต้องแสดงตามสถานะจริงและซ่อนปุ่มจ่าย — ไม่งั้นแถวหน้าตา
                    // เหมือนยังไม่จ่าย แล้วคนกดจ่ายซ้ำจนเงินออกสองรอบ
                    upcoming={entry.status === 'pending'}
                    daysLeft={daysLeft}
                    onRoll={handleRoll}
                    onPay={handlePay}
                    onUndoPay={handleUndoPay}
                    onSkip={handleSkip}
                    onEdit={setEditItem}
                    onDelete={(it) => setDeleteItemId(it.id)}
                    onPause={setPauseTarget}
                  />
                )
              })}
            </>
          )}

          {/* รายการที่พักอยู่ — ยังเห็นได้และบอกว่าเหลืออีกกี่เดือน แต่ไม่นับเป็นยอดรอจ่าย */}
          {pausedThisMonth.map(({ item, info }) => (
            <RecurringPausedCard
              key={`paused-${item.id}`}
              item={item}
              info={info}
              compact={view === 'compact'}
              onResume={handleResume}
              onEdit={setEditItem}
            />
          ))}
        </div>
      )}

      {/* Template list (collapsible) */}
      {activeItems.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <button
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
            onClick={() => setShowItemList((v) => !v)}
          >
            <span>{showItemList ? '▾' : '▸'}</span>
            <span>จัดการรายการทั้งหมด ({activeItems.length} รายการ)</span>
          </button>
      {/* ตัวเลขสรุปของเดือน — จ่ายแล้ว / รอจ่าย / รวมทั้งเดือน ตามแบบ */}
      <div className="grid grid-cols-3 gap-2.5 mb-3">
        <div className="rounded-[14px] border border-[#D9EBA0] bg-[#F4FBEE] px-3.5 py-[11px]">
          <div className="text-[11px] text-[#5C7A0F]">จ่ายแล้วเดือนนี้</div>
          <div className="tabular-nums text-[19px] font-bold text-[#0F6A50] mt-0.5">{summary.paidTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>
          <div className="text-[11px] text-faint">{summary.paidCount} รายการ</div>
        </div>
        <div className="rounded-[14px] border border-pending-line bg-pending-soft px-3.5 py-[11px]">
          <div className="text-[11px] text-[#8A6A15]">รอจ่าย</div>
          <div className="tabular-nums text-[19px] font-bold text-pending mt-0.5">{summary.pendingTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>
          <div className="text-[11px] text-faint">{summary.pendingCount} รายการ</div>
        </div>
        <div className="rounded-[14px] border border-hairline bg-white px-3.5 py-[11px]">
          <div className="text-[11px] text-muted">รวมทั้งเดือน</div>
          <div className="tabular-nums text-[19px] font-bold mt-0.5">{(summary.paidTotal + summary.pendingTotal).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>
          <div className="text-[11px] text-faint">{summary.paidCount + summary.pendingCount} รายการ</div>
        </div>
      </div>


          {showItemList && (
            <div className="mt-3 space-y-2">
              {activeItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white">
                  <AppIcon value={item.icon} size={19} fallback="event_repeat" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.enabled ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                      <span className="text-sm font-medium text-gray-800 truncate">{item.name}</span>
                      {pauseInfo(item, month) && (
                        <span className="text-[10px] font-medium px-1.5 rounded bg-gray-200 text-gray-600 flex-shrink-0">⏸ พัก</span>
                      )}
                      {isYearly(item) && (
                        <span className="text-[10px] font-medium px-1.5 rounded bg-violet-100 text-violet-700 flex-shrink-0">รายปี</span>
                      )}
                      {item.amountType === 'fixed' && (
                        <span className="text-xs text-gray-500 tabular-nums">{(item.fixedAmount ?? 0).toLocaleString('th-TH')} บาท</span>
                      )}
                      {item.amountType === 'variable' && (
                        <span className="text-xs text-gray-400 italic">ยอดเปลี่ยนแปลง</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 ml-4">
                      {scheduleLabel(item)}
                      {pauseInfo(item, month) && ` · ${pauseLabel(pauseInfo(item, month))}`}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => toggleItem(item.id)}
                      className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                        item.enabled
                          ? 'border-gray-200 text-gray-500 hover:border-gray-300'
                          : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      {item.enabled ? 'ปิด' : 'เปิด'}
                    </button>
                    <button
                      onClick={() => setEditItem(item)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-blue-500 hover:bg-blue-50"
                    >
                      แก้
                    </button>
                    <button
                      onClick={() => setDeleteItemId(item.id)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-red-400 hover:bg-red-50"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <RecurringItemForm onSave={handleAddItem} onClose={() => setShowForm(false)} />
      )}
      {editItem && (
        <RecurringItemForm item={editItem} onSave={handleUpdateItem} onClose={() => setEditItem(null)} />
      )}
      {pauseTarget && (
        <PausePopup
          item={pauseTarget}
          paidThisMonth={paidThisMonthFor(pauseTarget.id)}
          onConfirm={handlePause}
          onClose={() => setPauseTarget(null)}
        />
      )}
      {payTarget && (
        <PayEntryPopup
          entry={payTarget.entry}
          item={payTarget.item}
          onConfirm={handlePayConfirm}
          onSaveAmount={handleSaveEntryAmount}
          onClose={() => setPayTarget(null)}
        />
      )}
      <ConfirmPopup
        open={!!movePrevTarget}
        title="ย้ายรอบไปเดือนก่อน"
        message={movePrevTarget ? [
          `"${movePrevTarget.item.name}" ที่${movePrevTarget.entry.status === 'paid' ? 'จ่ายแล้ว' : 'ข้ามแล้ว'}นี้ จะนับเป็นของ ${monthName(addMonths(movePrevTarget.entry.month, -1))}`,
          `รอบ ${monthName(movePrevTarget.entry.month)} จะกลับมาเป็น "รอจ่าย" ใบใหม่`,
          'ไม่คืนเงิน ไม่ลบรายจ่าย — ยอดกระเป๋าและประวัติการจ่ายเหมือนเดิมทุกอย่าง',
        ].join('\n') : ''}
        onConfirm={handleMovePrev}
        onCancel={() => setMovePrevTarget(null)}
        confirmLabel="ย้ายรอบ"
      />
      <ConfirmPopup
        open={!!undoTarget}
        title="ยกเลิกการจ่าย"
        message={`ยกเลิกการจ่าย "${items.find((i) => i.id === undoTarget?.recurringId)?.name}"?\n\nผลที่จะเกิดขึ้น:\n${undoEffects(undoTarget).map((e) => `• ${e}`).join('\n')}`}
        onConfirm={executeUndoPay}
        onCancel={() => setUndoTarget(null)}
        confirmLabel="ยืนยัน"
        danger
      />
      <ConfirmPopup
        open={!!deleteItemId}
        title="ลบรายการประจำ"
        message={`ลบ "${items.find((i) => i.id === deleteItemId)?.name}"?\nรอบที่ยังไม่จ่ายจะถูกลบ ส่วนรอบที่จ่ายไปแล้วยังอยู่ในประวัติเดือนเก่าตามเดิม`}
        onConfirm={handleDeleteItem}
        onCancel={() => setDeleteItemId(null)}
        confirmLabel="ลบ"
        danger
      />
    </div>
  )
}
