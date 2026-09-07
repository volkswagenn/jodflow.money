import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useCreditCardStore from '../../store/useCreditCardStore'
import useWalletStore from '../../store/useWalletStore'
import useTransactionStore from '../../store/useTransactionStore'
import useCategoryStore from '../../store/useCategoryStore'
import usePendingStore from '../../store/usePendingStore'
import useAppStore from '../../store/useAppStore'
import useLogStore from '../../store/useLogStore'
import { buildLogEntry } from '../../lib/logBuilder'
import { walletTarget } from '../../lib/api/transactions'
import { formatCard } from '../../components/shared/CreditCardPicker'
import { nextClosingDate, formatThaiDate, formatIsoThai, formatIsoThaiShort, daysUntil, cyclePeriod, toDateString, clampedDate } from '../../lib/cardCycle'
import AppIcon from '../../components/shared/AppIcon'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import Icon from '../../components/shared/Icon'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import PayCardBillPopup from '../../components/shared/PayCardBillPopup'
import PayCardItemPopup from '../../components/shared/PayCardItemPopup'
import CardCashbackPopup from '../../components/shared/CardCashbackPopup'
import CardAdvancePopup from '../../components/shared/CardAdvancePopup'
import CardFeePopup from '../../components/shared/CardFeePopup'
import CardChargePopup from '../../components/shared/CardChargePopup'
import EditTransactionPopup from '../../components/shared/EditTransactionPopup'
import { cancelTransaction as cancelTx, describeTxCancelEffects } from '../../lib/transactionActions'
import PayInstallmentPopup from '../Recurring/PayInstallmentPopup'
import InstallmentFormPopup from '../../components/shared/InstallmentFormPopup'
import RowMenu from '../../components/shared/RowMenu'
import { MONTHS_TH } from '../Manage/CardFormPopup'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })
const CASHBACK_CATEGORY = 'เครดิตเงินคืนบัตร'
const FEE_CATEGORY = 'ค่าธรรมเนียมบัตร'
const FEE_PREFIX = 'ค่าธรรมเนียมรายปี'

/** ยอดที่ธนาคารจะหักตามที่ผูกไว้ */
export function autopayAmountOf(card, statement) {
  if (!card || !statement || card.autopayMode === 'off') return 0
  const remaining = Number(statement.amount) - Number(statement.paidAmount)
  if (remaining <= 0) return 0
  if (card.autopayMode === 'full') return remaining
  if (card.autopayMode === 'minimum') return Math.min(Number(statement.minimumAmount) || 0, remaining)
  return Math.min(Number(card.autopayAmount) || 0, remaining)
}

const AUTOPAY_LABEL = { full: '(เต็มจำนวน)', minimum: '(ขั้นต่ำ)', fixed: '(จำนวนคงที่)' }

/** ป้ายกำกับชนิดของรายการในบิล */
const TAG_TONE = {
  'รูดบัตร': 'bg-paper text-muted',
  'งวดผ่อน': 'bg-recurring-soft text-[#5A3C90]',
  // งวดของรอบก่อนที่บิลใบนี้กวาดมารวม — สีเข้มกว่าเพื่อให้เห็นว่าไม่ใช่งวดปกติของรอบ
  'งวดตกค้าง': 'bg-pending-soft text-[#8A6A15]',
  'กดเงินสด': 'bg-[#FBEFE4] text-[#B4571E]',
  'ค่าธรรมเนียม': 'bg-pending-soft text-[#8A6A15]',
  'เงินคืน': 'bg-income-soft text-income',
}

function Meta({ label, value }) {
  return (
    <div className="flex items-baseline gap-2.5 py-1.5 border-t border-[#F6F4EF]">
      <span className="flex-none w-[130px] text-[11.5px] text-faint">{label}</span>
      <span className="tabular-nums flex-1 min-w-0 text-xs font-medium text-right">{value}</span>
    </div>
  )
}

/**
 * สีป้ายงวด — สามสถานะที่ต้องแยกออกจากกันให้ได้ในแวบเดียว
 *   จ่ายแล้ว = เขียว · งวดของแถวนี้ = กล่องขาวขอบเข้ม · เข้าบิลแล้วรอจ่ายบิล = ชมพู
 *   ยังไม่ถึงรอบ = เทาจาง
 *
 * งวดที่กำลังถูกเก็บต้องเป็นกล่องขาว ไม่ใช่เทาแบบเดียวกับงวดที่ยังมาไม่ถึง
 * เพราะสองอย่างนี้คนละเรื่องกันโดยสิ้นเชิง อันหนึ่งต้องเตรียมเงินไว้เดี๋ยวนี้
 * อีกอันยังไม่ต้องทำอะไร ถ้าสีเหมือนกันก็ต้องไล่อ่านวันที่ทุกป้ายถึงจะรู้
 */
const PIP_TONE = {
  // จ่ายแล้วทันกำหนด
  paid:    'bg-lime border-[#A9CF3A] text-ink',
  prepaid: 'bg-lime border-[#A9CF3A] text-ink',
  // จ่ายแล้วแต่ช้ากว่าวันครบกำหนด — ข้างในเขียว (จ่ายแล้วจริง) กรอบแดง (ช้า)
  paidLate: 'bg-lime border-expense text-ink shadow-[0_0_0_1px_#C03A2D]',
  // งวดที่ค้างอยู่ตอนนี้ ยังไม่ถึงกำหนด
  current: 'bg-white border-ink text-ink shadow-[0_0_0_1px_#16181D]',
  // เลยวันครบกำหนดแล้วยังไม่จ่าย แต่ยังไม่ถึงวันตัดรอบถัดไป — กรอบแดง
  overdue: 'bg-white border-expense text-expense shadow-[0_0_0_1px_#C03A2D]',
  // ค้างข้ามวันตัดรอบถัดไปไปแล้ว — แดงทึบ ไม่มีข้อแก้ตัวแล้ว
  overdueHard: 'bg-expense border-expense text-white',
  // เข้าบิลไปแล้ว ยังไม่ถึงกำหนด และไม่ใช่งวดที่เน้น — ชมพูจาง
  billed:  'bg-expense-soft border-[#F0C4BE] text-[#A93A2E]',
  pending: 'bg-paper border-hairline text-faint',
}
const PIP_LABEL = {
  paid: 'จ่ายแล้ว',
  prepaid: 'จ่ายมาก่อนเริ่มใช้แอป',
  billed: 'เข้าบิลแล้ว รอจ่ายบิล',
  pending: 'ยังไม่ถึงกำหนด',
}

/**
 * ป้ายงวดผ่อนในแถวรายการ — งวดละหนึ่งป้าย พร้อมวันครบกำหนดของงวดนั้น
 *
 * ของเดิมเป็นจุดเปล่า ซึ่งบอกได้แค่ "จ่ายไปกี่งวดแล้ว" ซึ่งเป็นตัวเลขที่เขียนไว้เป็น
 * ตัวหนังสือข้างๆ อยู่แล้ว จุดจึงกินที่ไปเปล่าๆ คำถามที่แถวนี้ยังตอบไม่ได้สักทีคือ
 * "งวดไหนครบกำหนดวันไหน" วันที่จึงย้ายเข้ามาอยู่ในป้ายเลย
 *
 * ป้ายกว้างเท่าเนื้อหาพอดีและตัดบรรทัดเอง จึงลงในที่ว่างของแถวได้โดยไม่ดันคอลัมน์อื่น
 */
/** วันที่แบบ 'YYYY-MM-DD' ตามเวลาเครื่อง จากค่าที่อาจเป็น date หรือ timestamptz */
const dayOf = (v) => {
  if (!v) return null
  const s = String(v)
  if (!s.includes('T')) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : toDateString(d)
}

/**
 * @param paidViaBill id ของงวดที่จ่ายไปแล้ว "ผ่านบิลบัตร" — สถานะในฐานข้อมูลยังเป็น
 *   billed อยู่ (ตั้งใจ: กฎการลบ/ยกเลิกสัญญาผูกกับสถานะนี้ ถ้าเปลี่ยนเป็น paid
 *   การลบสัญญาจะคืนเงินซ้ำกับที่จ่ายบิลไปแล้ว) แต่ในสายตาคนใช้มันคือจ่ายแล้ว
 *   ป้ายจึงต้องเป็นสีเดียวกับงวดที่จ่ายแล้ว ไม่งั้นจ่ายบิลไปหน้าจอก็ยังเหมือนเดิม
 */
/** แถวนี้จ่ายจบแล้วหรือยัง — ใช้จัดลำดับให้ของที่เคลียร์แล้วลงไปอยู่ล่างสุด */
function rowSettled(r) {
  const total = Math.abs(Number(r.amount) || 0)
  if (r.prepaid && r.prepaid.amount >= total - 0.005) return true
  if (r.paidInBill && r.paidInBill.amount >= total - 0.005) return true
  return false
}

function EntryPips({ rows, currentSeq: currentSeqProp = null, closingDay = null, paidViaBill = null }) {
  const list = (rows ?? []).filter((r) => r.status !== 'cancelled')
  if (list.length === 0) return null
  const isPaid = (r) => r.status === 'paid' || r.status === 'prepaid' || !!paidViaBill?.has(r.id)
  // แสดงทุกงวดไม่ตัด — สัญญา 84 งวดก็ต้องเห็นครบ ป้ายตัดบรรทัดเองตามความกว้าง
  // (เคยตัดที่ 12 แล้วขึ้น "+72 งวด" ซึ่งซ่อนสิ่งที่คนเปิดหน้านี้มาดูพอดี)
  const shown = list
  const today = toDateString(new Date())
  // งวดที่เน้น = งวดที่ผู้ใช้ค้างอยู่จริงตอนนี้: งวดแรกที่ยังไม่จ่าย ไม่ว่าจะเข้าบิลแล้ว
  // (billed) หรือกำลังจะเข้า (pending) — ตามที่ธนาคารมอง งวดที่เข้าบิลแล้วแต่ยังไม่จ่าย
  // ยังเป็นภาระของงวดนั้น ไม่ได้ถูกเลื่อนไปงวดถัดไป ที่เรียกใช้ระบุมาแทนได้
  const currentSeq = currentSeqProp
    ?? list.find((r) => !isPaid(r))?.seq
    ?? null
  // วันตัดรอบถัดจากรอบของงวดนี้ — ค้างข้ามวันนี้ไปคือค้างจริงจัง ไม่ใช่แค่ช้าไม่กี่วัน
  // (รหัสรอบคือเดือนที่ตัด ใช้เป็นเลขเดือน 0-based ของเดือนถัดไปได้พอดี)
  const nextCutoffOf = (r) => {
    const [y, m] = String(r.cycle ?? '').split('-').map(Number)
    if (!y || !m || !closingDay) return null
    return toDateString(clampedDate(y, m, closingDay))
  }
  // สามคำถามเรียงตามลำดับ: จ่ายหรือยัง → จ่ายทันไหม / ค้างนานแค่ไหน → เป็นงวดที่เน้นไหม
  const toneOf = (r) => {
    if (r.status === 'prepaid') return PIP_TONE.prepaid
    if (r.status === 'paid' || paidViaBill?.has(r.id)) {
      const paidDay = dayOf(r.paidAt)
      return paidDay && r.dueDate && paidDay > r.dueDate ? PIP_TONE.paidLate : PIP_TONE.paid
    }
    if (r.dueDate && today > r.dueDate) {
      const cut = nextCutoffOf(r)
      return cut && today > cut ? PIP_TONE.overdueHard : PIP_TONE.overdue
    }
    if (r.seq === currentSeq) return PIP_TONE.current
    return r.status === 'billed' ? PIP_TONE.billed : PIP_TONE.pending
  }
  const labelOf = (r) => {
    if (r.status !== 'paid' && paidViaBill?.has(r.id)) return 'จ่ายแล้วผ่านบิลบัตร'
    if (r.status === 'paid') {
      const paidDay = dayOf(r.paidAt)
      return paidDay && r.dueDate && paidDay > r.dueDate ? `จ่ายแล้ว แต่ช้ากว่ากำหนด (${formatIsoThai(paidDay)})` : 'จ่ายแล้วทันกำหนด'
    }
    if (r.status !== 'prepaid' && r.dueDate && today > r.dueDate) {
      const cut = nextCutoffOf(r)
      return cut && today > cut ? 'ค้างข้ามวันตัดรอบถัดไปแล้ว' : 'เลยกำหนดแล้ว ยังไม่จ่าย'
    }
    if (r.seq === currentSeq && r.status === 'pending') return 'งวดที่ค้างอยู่ตอนนี้'
    return PIP_LABEL[r.status] ?? r.status
  }
  return (
    // เรียงต่อกันแล้วตัดบรรทัดเหมือนเดิม แต่ป้ายทุกใบกว้างเท่ากัน (กำหนดตายตัว ไม่ยืดตามช่อง)
    // ขอบป้ายจึงตรงกันเป็นคอลัมน์โดยไม่ต้องใช้ตาราง ซึ่งจะยืดป้ายให้เต็มแถวจนดูหนา
    // 86px คือความกว้างที่เคสยาวสุด "28 มี.ค. 69" (วันสองหลัก + เดือน 4 ตัวอักษร + ปี พ.ศ.)
    // ยังอยู่ครบในฟอนต์ 9.5px — แคบกว่านี้ปีจะถูกตัดเป็น … ซึ่งคือสิ่งที่ผู้ใช้ทักมา
    <span className="flex flex-wrap gap-1">
      {shown.map((r) => (
        <span
          key={r.seq}
          title={'งวดที่ ' + r.seq + ' จาก ' + list.length + ' · ครบกำหนด ' + formatIsoThai(r.dueDate)
            + ' · ' + fmt(r.amount) + ' บาท · '
            + labelOf(r)}
          className={'flex items-center gap-1 w-[86px] flex-none h-[17px] px-1.5 rounded-[5px] border text-[9.5px] leading-none tabular-nums whitespace-nowrap '
            + toneOf(r)}
        >
          {/* เลขงวดกว้างคงที่ชิดขวา เส้นคั่นทุกใบจึงอยู่ตำแหน่งเดียวกันทั้งคอลัมน์ */}
          <span className="font-bold w-[13px] text-right flex-none">{r.seq}</span>
          <span className="w-px h-[9px] bg-current opacity-30 flex-none" />
          <span className="opacity-80">{formatIsoThaiShort(r.dueDate)}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * หน้ารายละเอียดบัตรหนึ่งใบ — ตามแบบ mockup
 *
 * ซ้าย: หัวบัตร → แจ้งเตือน (หักบัญชี/ค่าธรรมเนียม/เครดิต) → บิลที่ต้องจ่าย →
 *       รอบถัดไปที่สะสมอยู่ → แถบวงเงิน → ปุ่มลัด → รายการในรอบบิล
 * ขวา: ข้อมูลบัตร · ผ่อนผ่านบัตรใบนี้ · บิลที่จ่ายแล้ว
 */
export default function CardDetailView({ cardId }) {
  const navigate = useNavigate()
  const card = useCreditCardStore((s) => s.getCard(cardId))
  const statements = useCreditCardStore((s) => s.getStatements(cardId))
  const current = useCreditCardStore((s) => s.getCurrentCycle(cardId))
  const advances = useCreditCardStore((s) => s.getAdvances(cardId))
  const usage = useCreditCardStore((s) => s.getCardLimitUsage(cardId))
  const installments = useCreditCardStore((s) => s.getActiveInstallments(cardId))
  const allEntries = useCreditCardStore((s) => s.entries)
  const rowMarks = useCreditCardStore((s) => s.rowMarks)
  const markRow = useCreditCardStore((s) => s.markRow)
  const unmarkRow = useCreditCardStore((s) => s.unmarkRow)
  const getInstallmentProgress = useCreditCardStore((s) => s.getInstallmentProgress)
  const getStatementBreakdown = useCreditCardStore((s) => s.getStatementBreakdown)
  const isPayableStatement = useCreditCardStore((s) => s.isPayableStatement)
  const getUncoveredTransactions = useCreditCardStore((s) => s.getUncoveredTransactions)
  const notifyDays = useAppStore((s) => s.notifyDaysBefore)
  const transactions = useTransactionStore((s) => s.transactions)
  const getCategoryName = useCategoryStore((s) => s.getCategoryName)
  const { pendingPayments, taxInvoices, pendingIncomes } = usePendingStore()

  const {
    ensureStatements, payStatement, undoPayment, cashAdvance, undoAdvance, payEntry,
    prepayTransaction, undoPrepayment, assignStatementPayment, unassignStatementPayment,
  } = useCreditCardStore()
  const statementPayments = useCreditCardStore((s) => s.statementPayments)
  const deleteInstallment = useCreditCardStore((s) => s.deleteInstallment)
  const cancelInstallment = useCreditCardStore((s) => s.cancelInstallment)
  const attachTxToStatement = useCreditCardStore((s) => s.attachTransactionToStatement)
  const detachTxFromStatement = useCreditCardStore((s) => s.detachTransactionFromStatement)
  const refreshCards = useCreditCardStore((s) => s.refresh)
  const refreshWallet = useWalletStore((s) => s.refresh)
  const refreshTransactions = useTransactionStore((s) => s.refresh)
  const addTransaction = useTransactionStore((s) => s.addTransaction)
  const categories = useCategoryStore((s) => s.categories)
  const addCategory = useCategoryStore((s) => s.addCategory)
  const { addLog } = useLogStore()

  const [payTarget, setPayTarget] = useState(null)
  // ยอดที่ตั้งไว้ให้ป๊อปอัปจ่ายบิล ตอนกด "จ่ายยอดนี้" ที่รายการเดียวในบิล — { amount, label }
  const [payPreset, setPayPreset] = useState(null)
  // จ่ายรายการรูดก่อนออกบิล — { tx, name, date, tag, amount, paid, remaining }
  const [prepayTarget, setPrepayTarget] = useState(null)
  const [undoPrepayTarget, setUndoPrepayTarget] = useState(null)
  const [undoTarget, setUndoTarget] = useState(null)
  const [cashbackTarget, setCashbackTarget] = useState(null)
  const [autopayTarget, setAutopayTarget] = useState(null)
  const [advanceTarget, setAdvanceTarget] = useState(null)
  const [undoAdvanceTarget, setUndoAdvanceTarget] = useState(null)
  const [feeTarget, setFeeTarget] = useState(null)
  const [payEntryTarget, setPayEntryTarget] = useState(null)
  // null = ปิดอยู่, { installment } = แก้ใบนั้น, { installment: null } = เพิ่มใหม่บนบัตรใบนี้
  const [insForm, setInsForm] = useState(null)
  const [insDeleteTarget, setInsDeleteTarget] = useState(null)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [cancelTxTarget, setCancelTxTarget] = useState(null)
  const [editingTx, setEditingTx] = useState(null)
  // ติ๊กรายแถวในบิล — { row, on } ; on = กำลังจะติ๊ก, false = กำลังจะเอาเครื่องหมายออก
  const [markTarget, setMarkTarget] = useState(null)
  const [showPaid, setShowPaid] = useState(false)
  // แท็บของตารางรายการ: 'this' = บิลที่ออกแล้วและยังไม่จ่าย · 'next' = รอบที่กำลังสะสม
  const [billTab, setBillTab] = useState('this')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // เผื่อกรณีเปิดหน้านี้ค้างไว้ข้ามวันสรุปยอด — เรียกซ้ำไม่เสียหาย
  useEffect(() => { ensureStatements() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ใบที่ยอดถูกยกไปรวมในบิลใบถัดไปแล้วไม่ใช่ "ยังค้าง" — เงินอยู่ในใบใหม่แล้ว
  const unpaid = useMemo(
    () => statements.filter((s) => isPayableStatement(s)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    [statements, isPayableStatement]
  )
  const bill = unpaid[0] ?? null

  /**
   * ยอดที่จ่ายบิลใบนี้ไปแล้ว แต่ยังไม่ได้ระบุว่าเป็นค่าของบรรทัดไหน
   *
   * บิลที่จ่ายไปก่อนระบบจะจำที่มาของเงิน (ก่อน card.sql ส่วนที่ 17) ทั้งก้อนอยู่ตรงนี้
   * ใช้ตัดสินว่าบรรทัดไหน "ทำเครื่องหมายว่าจ่ายแล้ว" ได้บ้างโดยไม่ต้องตัดเงินซ้ำ
   */
  const unassignedPaid = useMemo(() => {
    if (!bill) return 0
    const legs = statementPayments.filter((l) => l.statementId === bill.id)
    const all = legs.reduce((s, l) => s + Number(l.amount || 0), 0)
    const assigned = legs.filter((l) => l.transactionId).reduce((s, l) => s + Number(l.amount || 0), 0)
    return Math.round((all - assigned) * 100) / 100
  }, [bill, statementPayments])
  const paidHistory = useMemo(
    () => statements.filter((s) => s.status === 'paid').sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)),
    [statements]
  )

  /**
   * บิลที่เอารายการมาแสดงในแท็บ "รายการในรอบบิลนี้"
   *
   * จ่ายบิลครบแล้วรายการทั้งใบไม่ควรหายไปทันที — ของที่เพิ่งจ่ายคือสิ่งที่คนอยากเห็น
   * ที่สุดหลังกดจ่าย (ไล่เช็คกับสลิปว่าครบไหม) ให้ค้างไว้ทั้งใบโดยติดเครื่องหมายว่า
   * จ่ายแล้ว จนกว่าจะตัดรอบใหม่ แล้วบิลใบใหม่ค่อยมาแทนที่
   *
   * ใช้กับ "รายการที่แสดง" เท่านั้น ปุ่มจ่าย/ย้ายรอบยังผูกกับ bill (ใบที่ยังค้างจริง)
   * ตามเดิม — ใบที่จ่ายจบแล้วแก้อะไรไม่ได้อยู่แล้วในฝั่งฐานข้อมูล
   */
  const displayBill = bill ?? paidHistory[0] ?? null
  const unbilledAdvances = advances.filter((a) => !a.statementId)

  // ยอดที่โอนจ่ายให้รายการทีละรายการไว้ก่อนออกบิล (card.sql ส่วนที่ 16) แยกตามรายการ
  // เฉพาะขาที่ยังไม่ถูกรวมเข้าใบ — พอบิลออก ขาจะย้ายไปเป็นยอดจ่ายของใบนั้นแทน
  const prepaidByTx = useMemo(() => {
    const m = new Map()
    for (const l of statementPayments) {
      if (l.statementId || !l.transactionId || l.cardId !== cardId) continue
      const cur = m.get(l.transactionId) ?? { amount: 0, legs: [] }
      cur.amount += Number(l.amount || 0)
      cur.legs.push(l)
      m.set(l.transactionId, cur)
    }
    return m
  }, [statementPayments, cardId])

  // ยอดที่จ่ายบิลไปแล้วโดยระบุว่าเป็นของรายการไหน (ปุ่ม "จ่ายยอดนี้" ในบิลที่ออกแล้ว)
  // ต่างจาก prepaidByTx ตรงที่ขาพวกนี้ผูกกับใบแจ้งยอดแล้ว — เงินเข้าบิลใบนั้นจริง
  // มีไว้เพื่อให้บรรทัดที่จ่ายไปแล้วดูออกทันทีว่าจ่ายแล้ว ไม่ใช่รู้แค่ว่ายอดบิลลดลง
  const paidInBillByTx = useMemo(() => {
    const m = new Map()
    for (const l of statementPayments) {
      if (!l.statementId || !l.transactionId) continue
      const cur = m.get(l.transactionId) ?? { amount: 0, legs: [] }
      cur.amount += Number(l.amount || 0)
      cur.legs.push(l)
      m.set(l.transactionId, cur)
    }
    return m
  }, [statementPayments])

  /**
   * งวดผ่อนที่ "จ่ายไปแล้วผ่านบิลบัตร" — id ของงวด
   *
   * งวดที่เข้าบิลแล้วจ่ายไม่ได้ทีละงวด (pay_installment_entry ปฏิเสธ) เงินของมันออกไป
   * ตอนจ่ายบิล สถานะในฐานข้อมูลจึงยังเป็น billed อยู่ ซึ่งถูกแล้วสำหรับกฎการลบสัญญา
   * แต่หน้าจอต้องบอกว่าจ่ายแล้ว ไม่งั้นจ่ายบิลไปงวดก็ยังขึ้นเหมือนยังไม่ได้จ่าย
   *
   * นับสองทาง: บิลที่จ่ายครบทั้งใบ = ทุกงวดในใบจ่ายแล้ว · หรือจ่ายด้วยยอดของบรรทัดนั้น
   * จนเต็มยอด (ปุ่ม "จ่ายยอดนี้")
   */
  const entryPaidViaBill = useMemo(() => {
    const paidStmts = statements.filter((s) => s.status === 'paid')
    const inPaidStatement = (t) => paidStmts.some((s) => (
      t.cardStatementId ? t.cardStatementId === s.id : (t.date >= s.periodStart && t.date <= s.periodEnd)
    ))
    const out = new Set()
    for (const t of transactions) {
      if (!t.installmentEntryId || t.cardId !== cardId) continue
      const leg = paidInBillByTx.get(t.id)
      const covered = leg && leg.amount >= Math.abs(Number(t.amount || 0)) - 0.005
      if (covered || inPaidStatement(t)) out.add(t.installmentEntryId)
    }
    return out
  }, [transactions, cardId, paidInBillByTx, statements])

  // วันนี้แบบ 'YYYY-MM-DD' ตามเวลาเครื่อง — ใช้ตัดสินว่างวดที่ค้างเลยกำหนดหรือยัง
  const todayStr = toDateString(new Date())

  // งวดผ่อนของรอบหน้าค่อยโผล่ในรายการหลังพ้นกำหนดชำระบิลใบปัจจุบัน (หรือจ่ายแล้ว)
  // ก่อนหน้านั้นคนกำลังไล่บิลใบที่ต้องจ่าย ถ้าเห็นงวดถัดไปโผล่มาพร้อมกัน
  // จะสับสนว่าต้องจ่ายงวดไหนกันแน่ (ยอดเงินยังนับรวมในกล่องสรุปตามเดิม)
  const upcomingVisible = !bill || bill.dueDate < todayStr

  // รายการในรอบบิลที่กำลังเดินอยู่ — รวมยอดรูด เงินคืน และเงินสดที่กดจากบัตร
  const cycleRows = useMemo(() => {
    if (!card) return []
    const p = cyclePeriod(card.closingDay, card.dueDay)
    const to = toDateString(p.end)
    // ทุกรายการที่ยังไม่มีใบไหนครอบ — กฎเดียวกับตอนออกบิลจริง (ดู getUncoveredTransactions)
    // รายการที่ลงวันที่ย้อนหลังเข้ารอบที่ปิดไปแล้วจึงยังเห็นได้ว่ามันจะไปอยู่บิลใบนี้
    const rows = getUncoveredTransactions(cardId, to)
      .map((t) => ({
        key: `t-${t.id}`, tx: t, date: t.date, name: t.itemName || '(ไม่ระบุชื่อ)',
        cat: getCategoryName(t.category),
        tag: t.installmentEntryId ? 'งวดผ่อน'
          : String(t.itemName ?? '').startsWith(FEE_PREFIX) ? 'ค่าธรรมเนียม'
          : t.type === 'income' ? 'เงินคืน' : 'รูดบัตร',
        amount: t.type === 'income' ? -Number(t.amount || 0) : Number(t.amount || 0),
        // จ่ายก่อนออกบิลได้เฉพาะรายการรูดจ่ายธรรมดา (ค่างวดมีปุ่มจ่ายค่างวดของมันเอง)
        prepayable: t.type === 'expense' && !t.installmentEntryId,
        prepaid: prepaidByTx.get(t.id) ?? null,
      }))
    for (const a of advances) {
      if (a.statementId || a.date > to) continue
      rows.push({
        key: `a-${a.id}`, tx: null, advance: a, date: a.date, name: 'กดเงินสดจากบัตร',
        cat: Number(a.fee) > 0 ? `ค่าธรรมเนียม ${fmt(a.fee)}` : 'ไม่มีค่าธรรมเนียม',
        tag: 'กดเงินสด', amount: Number(a.amount || 0) + Number(a.fee || 0),
      })
    }
    // งวดผ่อนของรอบนี้ที่ยังไม่ถูกเรียกเก็บ — ยังไม่มีรายจ่ายจริงจนกว่าจะปิดรอบ
    // (ดู close_card_statement ใน supabase/card.sql) แต่ต้องเห็นในบิลนี้ เพราะ
    // ธนาคารจะเก็บมันรวมมากับบิลใบเดียวกัน
    const billedIds = new Set(rows.map((r) => r.tx?.installmentEntryId).filter(Boolean))
    for (const ins of installments) {
      for (const e of allEntries) {
        if (e.installmentId !== ins.id) continue
        // รวมงวดตกค้างจากรอบก่อนที่ยังไม่ถูกเก็บด้วย — บิลใบนี้จะกวาดมันมาเก็บ
        if (e.status !== 'pending' || e.cycle > p.cycle) continue
        if (billedIds.has(e.id)) continue
        // งวดของรอบนี้เอง รอให้พ้นกำหนดชำระบิลใบก่อนค่อยแสดง — งวดตกค้างจากรอบก่อน
        // ยังแสดงเสมอ เพราะเป็นของที่ค้างจริงและควรเห็นทันที
        if (!upcomingVisible && e.cycle === p.cycle) continue

        // งวดของสัญญานี้ที่ "เข้าบิลไปแล้วแต่ยังไม่ได้จ่าย" (อยู่ในใบก่อนหน้า) — ถ้ามี
        // นั่นคืองวดที่ผู้ใช้ค้างอยู่จริง หัวแถวต้องพูดถึงงวดนั้น ไม่ใช่งวดที่กำลังจะเข้าบิลนี้
        // ธนาคารไม่ได้ "เลื่อน" งวดที่ค้าง มันยังอยู่ในใบเดิม แค่ยอดถูกยกมา (ยอดยกมา)
        const owed = allEntries
          .filter((x) => x.installmentId === ins.id && x.status === 'billed')
          .sort((a, b) => a.seq - b.seq)[0] ?? null
        const owedStmt = owed ? statements.find((s) => s.id === owed.statementId) : null
        const owedDue = owedStmt?.dueDate ?? owed?.dueDate ?? null
        const owedOverdue = !!owedDue && owedDue < todayStr

        // งวดของรอบก่อนที่ไม่มีบิลใบไหนเก็บไป บิลใบนี้จะกวาดมารวม — สัญญาเดียวจึงมี
        // ได้สองแถวในรอบเดียว (งวดตกค้าง + งวดของรอบนี้) ต้องเขียนให้อ่านออกว่าทำไม
        // ไม่งั้นดูเหมือนระบบสร้างรายการซ้ำ ซึ่งเป็นสิ่งแรกที่คนคิดเมื่อเห็นชื่อเดียวกันสองบรรทัด
        const carried = e.cycle < p.cycle

        rows.push({
          key: `ie-${e.id}`, tx: null, date: to, upcoming: true, installment: ins,
          // งวดที่ค้างอยู่ขึ้นก่อน (ถ้ามี) ไม่งั้นก็งวดที่จะเข้าบิลนี้
          name: owed
            ? `${ins.name} — งวดที่ ${owed.seq}/${ins.months} ${owedOverdue ? 'เกินกำหนด' : 'รอจ่ายบิล'} ${formatIsoThai(owedDue)}`
            : `${ins.name} — งวดที่ ${e.seq}/${ins.months}${carried ? ' (ตกค้างจากรอบก่อน)' : ''}`,
          // งวด "เข้าบิล" ตอนตัดรอบ ไม่ใช่ตอนครบกำหนด — สองวันนี้คนละความหมาย
          // ตัดรอบ = ธนาคารบันทึกงวดลงใบ · ครบกำหนด = วันสุดท้ายที่ต้องจ่ายใบนั้น
          cat: carried
            ? `งวด ${e.seq} เป็นของรอบ ${e.cycle} ที่ไม่มีบิลเก็บไว้ บิลใบนี้จึงกวาดมารวม · ชำระภายใน ${formatThaiDate(p.due)}`
            : `งวด ${e.seq} เข้าบิลนี้ตอนตัดรอบ ${formatThaiDate(p.end)} · ชำระภายใน ${formatThaiDate(p.due)}`,
          tag: carried ? 'งวดตกค้าง' : 'งวดผ่อน', amount: Number(e.amount || 0), entry: e,
          owed, owedOverdue,
        })
      }
    }

    // จ่ายแล้วลงไปอยู่ล่างสุด — ของที่ยังต้องจัดการอยู่ต้องอยู่บนสุดเสมอ
    // ไม่ใช่ให้ต้องเลื่อนหาในกองที่เคลียร์ไปแล้ว (ในกลุ่มเดียวกันยังเรียงตามวันที่เหมือนเดิม)
    return rows.sort((x, y) =>
      (rowSettled(x) ? 1 : 0) - (rowSettled(y) ? 1 : 0)
      || String(x.date).localeCompare(String(y.date))
    )
  }, [transactions, statements, advances, card, cardId, getCategoryName, installments, allEntries, getUncoveredTransactions, todayStr, upcomingVisible, prepaidByTx])

  /**
   * รายการของบิลใบที่ออกไปแล้วและยังไม่จ่าย (แท็บ "รอบบิลนี้") — มาจากสามที่
   *   • รายจ่ายที่ผูกใบตรงๆ (card_statement_id) = ที่ผู้ใช้ย้ายเข้ามาหลังออกบิล ย้ายกลับได้
   *   • รายจ่ายที่วันที่รูดอยู่ในช่วงของใบและไม่ได้ผูกใบอื่น = ของเดิมของรอบนั้น
   *     (รวมค่างวดที่ถูกแปลงเป็นรายจ่ายตอนปิดรอบ) ธนาคารเก็บในใบนี้อยู่แล้ว ย้ายไม่ได้
   *   • เงินสดที่กดจากบัตรซึ่งถูกเก็บในใบนี้
   */
  const billRows = useMemo(() => {
    if (!displayBill) return []
    const rows = transactions
      .filter((t) => t.cardId === cardId && (
        t.cardStatementId
          ? t.cardStatementId === displayBill.id
          : (t.date >= displayBill.periodStart && t.date <= displayBill.periodEnd)
      ))
      .map((t) => ({
        key: `t-${t.id}`, tx: t, date: t.date, name: t.itemName || '(ไม่ระบุชื่อ)',
        cat: getCategoryName(t.category),
        tag: t.installmentEntryId ? 'งวดผ่อน'
          : String(t.itemName ?? '').startsWith(FEE_PREFIX) ? 'ค่าธรรมเนียม'
          : t.type === 'income' ? 'เงินคืน' : 'รูดบัตร',
        amount: t.type === 'income' ? -Number(t.amount || 0) : Number(t.amount || 0),
        movable: !!t.cardStatementId,
        // ในบิลที่ออกแล้ว "จ่ายยอดนี้" = จ่ายบิลด้วยยอดของรายการ (ไม่ใช่ขาจ่ายล่วงหน้า)
        // ค่างวดผ่อนก็จ่ายแบบนี้ได้ ต่างจากรอบที่ยังไม่ออกบิลซึ่งงวดยังไม่เป็นรายจ่าย
        // และมีปุ่มจ่ายค่างวดของตัวเองอยู่แล้ว — พองวดเข้าบิลไปแล้วมันคือยอดหนึ่งบรรทัด
        // ในบิลเหมือนรายการอื่น จ่ายเฉพาะบรรทัดนั้นได้ ที่เหลือของบิลยังค้างต่อไป
        prepayable: t.type === 'expense',
        // จ่ายบรรทัดนี้ไปแล้วเท่าไร — จ่ายทั้งใบไปแล้วก็ถือว่าทุกบรรทัดจ่ายครบ
        paidInBill: displayBill.status === 'paid'
          ? { amount: Math.abs(Number(t.amount || 0)), whole: true, legs: [] }
          : paidInBillByTx.get(t.id) ?? null,
      }))
    for (const a of advances) {
      if (a.statementId !== displayBill.id) continue
      rows.push({
        key: `a-${a.id}`, tx: null, advance: a, date: a.date, name: 'กดเงินสดจากบัตร',
        cat: Number(a.fee) > 0 ? `ค่าธรรมเนียม ${fmt(a.fee)}` : 'ไม่มีค่าธรรมเนียม',
        tag: 'กดเงินสด', amount: Number(a.amount || 0) + Number(a.fee || 0),
      })
    }
    // จ่ายแล้วลงไปอยู่ล่างสุด — ของที่ยังต้องจัดการอยู่ต้องอยู่บนสุดเสมอ
    // ไม่ใช่ให้ต้องเลื่อนหาในกองที่เคลียร์ไปแล้ว (ในกลุ่มเดียวกันยังเรียงตามวันที่เหมือนเดิม)
    return rows.sort((x, y) =>
      (rowSettled(x) ? 1 : 0) - (rowSettled(y) ? 1 : 0)
      || String(x.date).localeCompare(String(y.date))
    )
  }, [displayBill, transactions, advances, cardId, getCategoryName, paidInBillByTx])

  /**
   * สองแท็บมีเสมอทุกใบ ไม่ว่าจะมีบิลค้างหรือไม่
   *
   * ของเดิมซ่อนแท็บทิ้งเมื่อไม่มีบิลค้าง แล้วโชว์รายการก้อนเดียวโดยพาดหัวว่า
   * "รายการในรอบบิลนี้" — ซึ่งเป็นคนละความหมายกับแท็บชื่อเดียวกันของบัตรที่มีบิลค้าง
   * (ที่นั่นหมายถึงบิลที่ออกแล้ว ที่นี่หมายถึงรอบที่ยังสะสมอยู่) บัตรแต่ละใบจึงหน้าตา
   * ไม่เหมือนกัน และคำเดียวกันแปลได้สองอย่าง คนอ่านเลยนึกว่าบัตรใบอื่นไม่มีรอบบิลหน้า
   *
   * ให้โครงเหมือนกันทุกใบแทน: แท็บซ้าย = บิลที่ออกแล้ว (ไม่มีก็บอกว่าไม่มีบิลค้าง)
   * แท็บขวา = รอบที่กำลังสะสม ซึ่งมีอยู่ทุกใบเสมอ
   */
  const hasBill = !!bill
  const shownRows = billTab === 'this' ? billRows : cycleRows

  // ไม่มีบิลให้ดูเลยค่อยเด้งไปแท็บรอบบิลหน้า — บิลที่จ่ายครบแล้วยังมีของให้ไล่เช็ค
  // จึงยังเปิดค้างที่แท็บนี้ ผูก dependency กับ "มี/ไม่มีบิลให้แสดง" อย่างเดียว
  // กดสลับแท็บเองทีหลังจึงไม่ถูกดีดกลับ
  const hasDisplayBill = !!displayBill
  useEffect(() => { if (!hasDisplayBill) setBillTab('next') }, [hasDisplayBill])

  // สรุปงวดผ่อน: ที่รวมอยู่ในบิลรอบนี้ กับที่เหลือไปรอบถัดๆ ไป
  const installmentOutlook = useMemo(() => {
    const ids = new Set(installments.map((i) => i.id))
    const pending = allEntries.filter((e) => ids.has(e.installmentId) && e.status === 'pending')
    // <= ไม่ใช่ = : งวดที่ตกค้างจากรอบก่อน (รอบที่ยังไม่มีใบแจ้งยอด) จะถูกกวาดมา
    // เก็บในบิลใบถัดไปด้วย ต้องนับเป็น "รอบนี้" ให้ตรงกับรายการที่แสดงข้างบน
    // ไม่งั้นกล่องสรุปจะบอกจำนวนงวดไม่ตรงกับที่เห็นในรายการ
    const cycle = current?.cycle
    const inThis = pending.filter((e) => e.cycle <= cycle)
    const later = pending.filter((e) => e.cycle > cycle)
    const sum = (list) => list.reduce((t, e) => t + Number(e.amount || 0), 0)
    return {
      thisCount: inThis.length, thisAmount: sum(inThis),
      laterCount: later.length, laterAmount: sum(later),
    }
  }, [installments, allEntries, current])

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  // หมวดหมู่พิเศษของบัตร แยกไว้ไม่ให้ปนกับรายรับ/รายจ่ายจริงตอนดูรายงาน
  const ensureCategory = async (name, type) => {
    const found = categories.find((c) => c.type === type && c.name === name && !c.deleted)
    if (found) return found.id
    return (await addCategory(name, type))?.id ?? null
  }

  if (!card) return <p className="text-center text-sm text-faint py-10">ไม่พบบัตรใบนี้</p>

  const debt = Number(card.outstanding) || 0
  const credit = debt < 0 ? -debt : 0
  const used = Math.max(0, usage?.used ?? debt)
  const limit = usage?.limit ?? 0
  const pct = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0
  const overLimit = usage?.over ?? false
  const closing = nextClosingDate(card.closingDay)
  const daysToClosing = daysUntil(closing)
  const billLeft = bill ? Number(bill.amount) - Number(bill.paidAmount) : 0
  const billBreakdown = bill ? getStatementBreakdown(bill.id) : null

  // กระทบยอดหนี้: บิลที่ยังไม่จ่าย + ของที่ยังไม่เข้าบิล + ส่วนที่ไม่ได้มาจากรายการเลย
  // ค่างวดผ่อนที่ยังไม่เข้าบิลไม่นับ เพราะยังไม่เคยเป็นหนี้บัตร (ดู close_card_statement)
  const billedUnpaidTotal = unpaid.reduce((n, s) => n + (Number(s.amount) - Number(s.paidAmount)), 0)
  const uncoveredCharges = current
    ? Number(current.spend || 0) + Number(current.advance || 0) - Number(current.credit || 0)
    : 0
  const unbilledDebt = Math.round((debt - billedUnpaidTotal - uncoveredCharges) * 100) / 100
  const billDays = bill ? daysUntil(new Date(bill.dueDate + 'T00:00:00')) : null
  const billAlert = billDays == null ? '' : billDays < 0 ? `เกินกำหนด ${-billDays} วัน` : billDays === 0 ? 'ครบกำหนดวันนี้' : `อีก ${billDays} วัน`

  const autopayDue = bill && billDays <= notifyDays ? autopayAmountOf(card, bill) : 0

  const estCashback = Number(card.cashbackRate) > 0 && current?.spend > 0
    ? (current.spend * Number(card.cashbackRate)) / 100
    : 0

  const thisYear = String(new Date().getFullYear())
  const feeRecorded = transactions.some((t) =>
    t.cardId === card.id && t.type === 'expense'
    && String(t.date ?? '').startsWith(thisYear)
    && String(t.itemName ?? '').startsWith(FEE_PREFIX)
  )
  const hasFee = Number(card.annualFee) > 0
  const feeDue = hasFee && Number(card.annualFeeMonth) === new Date().getMonth() + 1 && !feeRecorded

  // ── การกระทำทั้งหมด (ยกมาจากหน้ากระเป๋าเงินเดิม ตรรกะเงินไม่เปลี่ยน) ──────
  const handlePay = ({ method, accountId, amount, date }) => run(async () => {
    const statement = payTarget
    const remaining = Number(statement.amount) - Number(statement.paidAmount)
    // เปิดมาจากปุ่ม "จ่ายยอดนี้" ของบรรทัดไหน ผูกขาที่จ่ายไว้กับรายการนั้น
    // ไม่งั้นยอดบิลลดลงเฉยๆ แต่บรรทัดที่จ่ายไปแล้วหน้าตาเหมือนเดิมทุกอย่าง
    const payingTx = payPreset?.transactionId ?? null
    await payStatement(statement.id, {
      method, accountId, amount, date, transactionId: payingTx,
      log: buildLogEntry({
        activityType: 'CARD_PAYMENT',
        description:
          `จ่ายบิลบัตร "${formatCard(card)}" รอบ ${statement.cycle} ${fmt(amount)} บาท ` +
          `จาก${method === 'cash' ? 'เงินสด' : 'เงินโอน'}` +
          (payPreset?.label ? ` — เฉพาะรายการ "${payPreset.label}"` : '') +
          (amount > remaining ? ` (จ่ายเกิน ${fmt(amount - remaining)} เป็นเครดิตในบัตร)` : ''),
        walletEffect: { target: method, delta: -amount, transferAccountId: accountId },
        newValue: { statementId: statement.id, cardId: card.id, amount, date, method, transactionId: payingTx },
      }),
    })
    await refreshWallet()
    setPayTarget(null)
  })

  const handleCashback = ({ kind, amount, date, note }) => run(async () => {
    const categoryId = await ensureCategory(CASHBACK_CATEGORY, 'income')
    const label = kind === 'refund' ? 'คืนสินค้าเข้าบัตร' : 'เครดิตเงินคืน'
    await addTransaction({
      date, type: 'income', amount, method: 'card', cardId: card.id, category: categoryId,
      itemName: `${label} — ${formatCard(card)}`, otherIncomeType: label, note: note || null,
    }, {
      effect: { target: walletTarget('card', { cardId: card.id }), delta: +amount },
      log: buildLogEntry({
        activityType: 'CARD_CASHBACK',
        description: `${label} ${fmt(amount)} บาท เข้าบัตร "${formatCard(card)}"`,
        walletEffect: { target: 'card', delta: +amount, cardId: card.id },
        newValue: { cardId: card.id, amount, date, kind },
      }),
    })
    await refreshCards()
    setCashbackTarget(null)
  })

  const handleFee = ({ amount, date, note }) => run(async () => {
    const categoryId = await ensureCategory(FEE_CATEGORY, 'expense')
    await addTransaction({
      date, type: 'expense', amount, method: 'card', cardId: card.id, category: categoryId,
      itemName: `${FEE_PREFIX} — ${formatCard(card)}`, note: note || null,
    }, {
      effect: { target: walletTarget('card', { cardId: card.id }), delta: -amount },
      log: buildLogEntry({
        activityType: 'CARD_FEE',
        description: `ค่าธรรมเนียมรายปี ${fmt(amount)} บาท บัตร "${formatCard(card)}"`,
        walletEffect: { target: 'card', delta: -amount, cardId: card.id },
        newValue: { cardId: card.id, amount, date },
      }),
    })
    await refreshCards()
    setFeeTarget(null)
  })

  /**
   * ย้ายรายการระหว่างรอบบิล
   * เข้าบิลที่ออกแล้ว = ธนาคารเก็บในใบนั้น (คีย์ตามบิลจริงหลังวันสรุปยอด)
   * กลับไปรอบบิลหน้า = ปล่อยให้บิลรอบถัดไปเก็บตามวันที่รูดเหมือนเดิม
   */
  const moveToBill = async (r, s) => {
    await attachTxToStatement(r.tx.id, s.id)
    await addLog(buildLogEntry({
      activityType: 'CARD_STATEMENT_ATTACH',
      description: `ย้าย "${r.name}" ${fmt(Math.abs(r.amount))} บาท เข้าบิลที่ครบกำหนด ${formatIsoThai(s.dueDate)} ของบัตร "${formatCard(card)}"`,
      newValue: { transactionId: r.tx.id, statementId: s.id, cardId: card.id },
    }))
  }
  const moveToNext = async (r) => {
    await detachTxFromStatement(r.tx.id)
    await addLog(buildLogEntry({
      activityType: 'CARD_STATEMENT_DETACH',
      description: `ย้าย "${r.name}" ${fmt(Math.abs(r.amount))} บาท ออกจากบิลไปรอบบิลหน้า ของบัตร "${formatCard(card)}"`,
      oldValue: { transactionId: r.tx.id, statementId: r.tx.cardStatementId, cardId: card.id },
    }))
  }

  /**
   * เมนูท้ายแถวของบิล — เปลี่ยนตามชนิดของแถว
   * แถวในบิลมาจากสามที่ (รายจ่ายจริง / ยอดกดเงินสด / งวดผ่อนที่รอเรียกเก็บ)
   * ซึ่งย้อนคนละวิธีกัน จึงต้องแยกเมนู ไม่ใช่โชว์ปุ่มแก้ไขอันเดียวแล้วซ่อนที่เหลือ
   */
  const rowMenuItems = (r, ins) => {
    if (r.tx) {
      // อยู่ในมุมมองบิลที่ออกแล้ว (รวมใบที่จ่ายจบแล้วซึ่งยังแสดงค้างไว้)
      // ต้องเช็คด้วย displayBill ไม่ใช่ hasBill ไม่งั้นพอบิลจ่ายครบ รายการในใบจะไปโผล่
      // เมนู "จ่ายรายการนี้ก่อนออกบิล" ทั้งที่จ่ายผ่านบิลไปแล้ว = จ่ายซ้ำ
      const inIssuedBill = !!displayBill && billTab === 'this'
      const prepaidLeft = r.prepayable ? Math.abs(r.amount) - (r.prepaid?.amount ?? 0) : 0
      // จ่ายบรรทัดนี้ในบิลไปแล้วเท่าไร เหลือเท่าไร (ใช้ทั้งปุ่มจ่ายและปุ่มทำเครื่องหมาย)
      const paidHereLeft = Math.abs(r.amount) - (r.paidInBill?.amount ?? 0)
      const paidHere = paidHereLeft <= 0.005
      return [
        // จ่ายเฉพาะรายการนี้ — รูดแล้วโอนคืนทันทีไม่รอบิล (วิธีที่คนใช้บัตรจำนวนมากทำ)
        // รายการในรอบที่ยังไม่ออกบิล = ขาจ่ายล่วงหน้า · รายการในบิลที่ออกแล้ว = จ่ายบิล
        // ด้วยยอดเฉพาะรายการ (บิลรับยอดบางส่วนอยู่แล้ว ไม่ต้องมีทางพิเศษ)
        ...(inIssuedBill && r.prepayable && bill && !paidHere ? [{
          icon: 'payments',
          label: `จ่ายบิลเฉพาะยอดนี้ ${fmt(paidHereLeft)}`,
          desc: 'เปิดหน้าจ่ายบิลโดยใส่ยอดของรายการนี้ให้ ส่วนที่เหลือของบิลยังค้างอยู่',
          onClick: () => openPayItemInBill(r),
        }] : []),
        // จ่ายไปแล้วจริงแต่ระบบไม่รู้ว่าเงินก้อนไหนเป็นของบรรทัดไหน (จ่ายก่อนมีระบบนี้)
        // ให้ติ๊กเองได้ โดยผูกกับยอดที่จ่ายบิลไว้แล้ว ไม่ตัดเงินเพิ่มแม้แต่บาทเดียว
        ...(inIssuedBill && r.prepayable && bill && !paidHere && unassignedPaid >= paidHereLeft - 0.005 ? [{
          icon: 'check_circle',
          label: 'ทำเครื่องหมายว่าจ่ายแล้ว',
          desc: `ยอดนี้ถูกตัดไปแล้วตอนจ่ายบิล (บิลใบนี้มียอดที่ยังไม่ระบุว่าเป็นของบรรทัดไหน ${fmt(unassignedPaid)}) — ไม่ตัดเงินเพิ่ม`,
          onClick: () => markRowPaid(r),
        }] : []),
        ...(inIssuedBill && r.paidInBill && !r.paidInBill.whole ? [{
          icon: 'undo',
          label: 'เอาเครื่องหมายจ่ายแล้วออก',
          desc: 'ยอดที่จ่ายกลับไปเป็นยอดจ่ายรวมของบิล เงินไม่ขยับ',
          onClick: () => unmarkRowPaid(r),
        }] : []),
        ...(!inIssuedBill && r.prepayable && prepaidLeft > 0.005 ? [{
          icon: 'payments',
          label: r.prepaid ? `จ่ายส่วนที่เหลือ ${fmt(prepaidLeft)}` : 'จ่ายรายการนี้ก่อนออกบิล',
          desc: 'โอนจ่ายเฉพาะยอดนี้ตอนนี้ ยอดจะถูกหักออกจากบิลรอบที่กำลังมาถึง',
          onClick: () => openPrepay(r),
        }] : []),
        ...(r.prepaid ? [{
          icon: 'undo',
          label: `ย้อนการจ่าย ${fmt(r.prepaid.amount)} ของรายการนี้`,
          desc: 'คืนเงินเข้ากระเป๋าที่ตัดไป และยอดกลับเข้าบิลรอบที่กำลังมาถึง',
          danger: true,
          onClick: () => setUndoPrepayTarget(r),
        }] : []),
        {
          icon: 'edit_note',
          label: 'แก้ไขรายการ',
          desc: 'แก้ยอด วันที่ หมวดหมู่ หรือย้ายไปช่องทางอื่น',
          onClick: () => setEditingTx(r.tx),
        },
        // ย้ายรอบบิล — งวดผ่อนย้ายไม่ได้ (ตารางงวดกำหนดเอง) · ที่ผูกใบอยู่ย้ายกลับได้
        ...(r.tx.installmentEntryId ? []
          : r.tx.cardStatementId ? [{
            icon: 'undo',
            label: 'ย้ายไปรอบบิลหน้า',
            desc: 'เอาออกจากบิลที่ออกแล้ว ไปรวมกับบิลรอบถัดไปตามวันที่รูด',
            onClick: () => run(() => moveToNext(r)),
          }]
          : unpaid.map((s) => ({
            icon: 'receipt_long',
            label: `ย้ายไปรอบบิลนี้ (ครบกำหนด ${formatIsoThai(s.dueDate)})`,
            desc: `ปิดรอบ ${formatIsoThai(s.periodEnd)} · ยอดบิลจะเพิ่มเป็น ${fmt(Number(s.amount) - Number(s.paidAmount) + Math.abs(r.amount))}`,
            onClick: () => run(() => moveToBill(r, s)),
          }))),
        {
          icon: 'delete',
          label: 'ลบรายการนี้',
          desc: 'คืนยอดกลับให้บัตร และลบรายการออกจากประวัติ',
          danger: true,
          onClick: () => setCancelTxTarget(r.tx),
        },
      ]
    }
    if (r.advance) {
      return [
        {
          icon: 'undo',
          label: 'ย้อนการกดเงินสด',
          desc: 'คืนเงินออกจากกระเป๋าปลายทางและลดหนี้บัตรกลับ',
          danger: true,
          onClick: () => setUndoAdvanceTarget(r.advance),
        },
      ]
    }
    if (ins) {
      const next = r.entry
      return [
        next && {
          icon: 'payments',
          label: `จ่ายค่างวดที่ ${next.seq}`,
          desc: 'ตัดเงินจากเงินสด/บัญชี โดยไม่รอบิลบัตร',
          onClick: () => setPayEntryTarget({ installment: ins, entry: next }),
        },
        {
          icon: 'edit_note',
          label: 'แก้ไขรายการผ่อน',
          desc: 'แก้ยอด จำนวนงวด วันที่ หรือบัตรที่ใช้ผ่อน',
          onClick: () => setInsForm({ installment: ins }),
        },
        {
          icon: 'delete',
          label: 'ลบรายการผ่อนทิ้ง',
          desc: 'ใช้เมื่อบันทึกผิด — คืนเงินงวดที่จ่ายไปแล้วให้ด้วย',
          danger: true,
          onClick: () => setInsDeleteTarget({
            installment: ins, progress: getInstallmentProgress(ins.id), mode: 'delete',
          }),
        },
      ].filter(Boolean)
    }
    return [{ icon: 'info', label: 'รายการนี้จัดการที่อื่น', desc: 'ดูรายละเอียดได้ที่หน้าประวัติทั้งหมด', onClick: () => {} }]
  }

  // ── จ่ายเฉพาะรายการเดียว ────────────────────────────────────────────────
  const openPrepay = (r) => {
    const paid = r.prepaid?.amount ?? 0
    setPrepayTarget({
      tx: r.tx, name: r.name, date: r.date, tag: r.tag,
      amount: Math.abs(r.amount), paid, remaining: Math.abs(r.amount) - paid,
    })
  }
  const openPayItemInBill = (r) => {
    setPayPreset({ amount: Math.abs(r.amount), label: r.name, transactionId: r.tx?.id ?? null })
    setPayTarget(bill)
  }

  /**
   * ทำเครื่องหมายว่าบรรทัดนี้จ่ายไปแล้ว โดยไม่ตัดเงินซ้ำ
   *
   * ใช้กับของที่จ่ายไปก่อนระบบจะจำได้ว่าเงินก้อนนั้นเป็นของบรรทัดไหน เงินออกไปแล้ว
   * และยอดบิลลดไปแล้วจริง ขาดแค่ป้ายบอกว่ามันคือค่าของรายการไหน (card.sql ส่วนที่ 17)
   */
  const markRowPaid = (r) => run(async () => {
    await assignStatementPayment(r.tx.id, buildLogEntry({
      activityType: 'CARD_PAYMENT_ASSIGN',
      description:
        `ทำเครื่องหมายว่า "${r.name}" ${fmt(Math.abs(r.amount))} บาท จ่ายไปแล้ว ` +
        `จากยอดที่จ่ายบิลบัตร "${formatCard(card)}" ไว้แล้ว (ไม่ตัดเงินเพิ่ม)`,
      newValue: { transactionId: r.tx.id, cardId: card.id, amount: Math.abs(r.amount) },
    }))
    await refreshWallet()
  })

  const unmarkRowPaid = (r) => run(async () => {
    await unassignStatementPayment(r.tx.id, buildLogEntry({
      activityType: 'CARD_PAYMENT_UNASSIGN',
      description: `เอาเครื่องหมายจ่ายแล้วออกจาก "${r.name}" ของบัตร "${formatCard(card)}" (เงินไม่ขยับ)`,
      oldValue: { transactionId: r.tx.id, cardId: card.id },
    }))
    await refreshWallet()
  })
  const closePayBill = () => { setPayTarget(null); setPayPreset(null) }

  const handlePrepay = ({ method, accountId, amount, date }) => run(async () => {
    const { tx, name } = prepayTarget
    await prepayTransaction(tx.id, {
      method, accountId, amount, date,
      log: buildLogEntry({
        activityType: 'CARD_PREPAY',
        description:
          `จ่ายรายการ "${name}" ${fmt(amount)} บาท ของบัตร "${formatCard(card)}" ก่อนออกบิล ` +
          `จาก${method === 'cash' ? 'เงินสด' : 'เงินโอน'}`,
        walletEffect: { target: method, delta: -amount, transferAccountId: accountId },
        newValue: { transactionId: tx.id, cardId: card.id, amount, date, method },
      }),
    })
    await refreshWallet()
    setPrepayTarget(null)
  })

  // ย้อนทุกขาของรายการนั้น (จ่ายบางส่วนหลายครั้งได้) ขาไหนย้อนไม่ได้จะ throw ทั้งก้อน
  const handleUndoPrepay = () => run(async () => {
    const r = undoPrepayTarget
    for (const leg of r.prepaid.legs) {
      await undoPrepayment(leg.id, buildLogEntry({
        activityType: 'CARD_PREPAY_UNDO',
        description: `ย้อนการจ่ายรายการ "${r.name}" ${fmt(leg.amount)} บาท ของบัตร "${formatCard(card)}" ที่จ่ายไว้ก่อนออกบิล`,
        walletEffect: { target: leg.method, delta: +Number(leg.amount), transferAccountId: leg.transferAccountId },
        oldValue: { legId: leg.id, transactionId: r.tx.id, cardId: card.id, amount: leg.amount, paidAt: leg.paidAt },
      }))
    }
    await refreshWallet()
    setUndoPrepayTarget(null)
  })

  const handleAdvance = ({ amount, fee, target, date, note }) => run(async () => {
    const toCash = target === 'cash'
    await cashAdvance(card.id, {
      amount, fee, target, date, note,
      log: buildLogEntry({
        activityType: 'CARD_ADVANCE',
        description:
          `กดเงินสด ${fmt(amount)} บาท จากบัตร "${formatCard(card)}"` +
          (fee > 0 ? ` ค่าธรรมเนียม ${fmt(fee)} บาท` : '') +
          ` เข้า${toCash ? 'เงินสด' : 'บัญชีเงินโอน'}`,
        walletEffect: {
          target: toCash ? 'cash' : 'transfer', delta: +amount,
          transferAccountId: toCash ? null : target.split(':')[1],
        },
        newValue: { cardId: card.id, amount, fee, target, date },
      }),
    })
    await Promise.all([refreshWallet(), refreshTransactions()])
    setAdvanceTarget(null)
  })

  const handleUndoAdvance = () => run(async () => {
    const a = undoAdvanceTarget
    await undoAdvance(a.id, buildLogEntry({
      activityType: 'CARD_ADVANCE_UNDO',
      description: `ย้อนการกดเงินสด ${fmt(a.amount)} บาท จากบัตร "${formatCard(card)}"`,
      oldValue: a,
    }))
    await Promise.all([refreshWallet(), refreshTransactions()])
    setUndoAdvanceTarget(null)
  })

  const handleAutopayConfirm = () => run(async () => {
    const { statement, amount } = autopayTarget
    await payStatement(statement.id, {
      method: 'transfer', accountId: card.autopayAccountId, amount, date: statement.dueDate,
      log: buildLogEntry({
        activityType: 'CARD_AUTOPAY',
        description: `ยืนยันหักบัญชีอัตโนมัติ บัตร "${formatCard(card)}" รอบ ${statement.cycle} ${fmt(amount)} บาท`,
        walletEffect: { target: 'transfer', delta: -amount, transferAccountId: card.autopayAccountId },
        newValue: { statementId: statement.id, cardId: card.id, amount, mode: card.autopayMode },
      }),
    })
    await refreshWallet()
    setAutopayTarget(null)
  })

  const handleUndoPay = () => run(async () => {
    const statement = undoTarget
    const amount = Number(statement.paidAmount)
    await undoPayment(statement.id, amount, buildLogEntry({
      activityType: 'CARD_PAYMENT_UNDO',
      description: `ย้อนการจ่ายบิลบัตร "${formatCard(card)}" รอบ ${statement.cycle} ${fmt(amount)} บาท`,
      oldValue: statement,
      newValue: { statementId: statement.id, cardId: card.id, amount },
    }))
    await refreshWallet()
    setUndoTarget(null)
  })

  const handlePayEntry = ({ method, accountId, amount, date }) => run(async () => {
    const { installment, entry } = payEntryTarget
    await payEntry(entry.id, {
      method, accountId, amount, date,
      log: buildLogEntry({
        activityType: 'INSTALLMENT_PAY',
        description: `จ่ายค่างวดที่ ${entry.seq}/${installment.months} "${installment.name}" ${fmt(amount)} บาท`,
        walletEffect: { target: method, delta: -amount, transferAccountId: accountId },
        newValue: { installmentId: installment.id, entryId: entry.id, amount, date },
      }),
    })
    await Promise.all([refreshWallet(), refreshCards()])
    setPayEntryTarget(null)
  })

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_336px] gap-3 items-start">
      {/* ── คอลัมน์ซ้าย ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 min-w-0">
        {error && (
          <p className="text-[12.5px] text-expense bg-expense-soft border border-[#F0C4BE] rounded-ctl px-3.5 py-2">
            ทำรายการไม่สำเร็จ — {error}
          </p>
        )}

        {/* ── หัวบัตร + สามคอลัมน์สรุป (ตามแบบ) ────────────────────────────────
            บิลที่ต้องจ่าย · รอบที่กำลังสะสม · ยอดหนี้กับวงเงิน คือสามคำถามที่คนเปิด
            หน้าบัตรมาถามพร้อมกันเสมอ ("ต้องจ่ายเท่าไร · ก่อหนี้ไปอีกเท่าไรแล้ว ·
            เหลือวงเงินไหม") ของเดิมวางเรียงลงมาเป็นสามกล่อง ต้องเลื่อนจอถึงจะครบ
            ทั้งที่ทั้งสามอันสั้นมาก จอกว้างจึงวางเรียงกันในกล่องเดียว จอแคบค่อยเรียงลงมา */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EFEDE7] flex-wrap">
            <span className="w-10 h-10 flex-none rounded-[11px] bg-paper flex items-center justify-center">
              <AppIcon value={card.icon} size={22} fallback={DEFAULT_ICONS.card} />
            </span>
            {/* min-w กันชื่อบัตรถูกปุ่มบีบจนเหลือ "บัตรก…" บนจอแคบ — ปุ่มตกบรรทัดใหม่ได้
                แต่ชื่อบัตรที่อ่านไม่ออกทำให้ไม่รู้ว่ากำลังดูใบไหนอยู่ */}
            <span className="min-w-[168px] flex-1">
              <span className="block text-[14.5px] font-semibold truncate">{formatCard(card)}</span>
              <span className="block text-[11.5px] text-faint truncate">
                {card.bankName} · สรุปยอดทุกวันที่ {card.closingDay} · ครบกำหนดวันที่ {card.dueDay}
              </span>
            </span>
            <button
              className="flex-none h-8 px-3 rounded-[9px] border border-hairline bg-white text-xs flex items-center gap-1.5 hover:bg-paper"
              onClick={() => setAdvanceTarget(card)}
            >
              <Icon name="payments" size={15} className="text-muted" />กดเงินสด
            </button>
            <button
              className="flex-none h-8 px-3 rounded-[9px] border border-hairline bg-white text-xs hover:bg-paper"
              onClick={() => setCashbackTarget({ estimate: estCashback })}
            >
              บันทึกเงินคืน
            </button>
            {/* งานที่ทำบ่อยที่สุดของหน้านี้ จึงเป็นปุ่มทึบและอยู่ก่อนเมนูสามจุด */}
            <button
              className="flex-none h-8 px-3 rounded-[9px] bg-ink text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-black"
              onClick={() => setChargeOpen(true)}
            >
              <Icon name="add" size={15} />
              เพิ่มรายการรูดบัตร
            </button>
            <RowMenu
              compact
              title={formatCard(card)}
              sub={`${card.bankName} · สรุปยอดทุกวันที่ ${card.closingDay} · ครบกำหนดวันที่ ${card.dueDay}`}
              icon="credit_card"
              items={[
                ...(hasFee && !feeDue ? [{
                  icon: 'payments', label: 'บันทึกค่าธรรมเนียมรายปี',
                  desc: 'ลงเป็นรายจ่ายบนบัตรใบนี้ และเข้าบิลรอบที่วันที่นั้นตกอยู่',
                  onClick: () => setFeeTarget(card),
                }] : []),
                ...(paidHistory.length > 0 ? [{
                  icon: 'history',
                  label: showPaid ? 'ซ่อนบิลที่จ่ายแล้ว' : `ดูบิลที่จ่ายแล้ว ${paidHistory.length} รอบ`,
                  desc: 'ย้อนดูใบที่ปิดยอดไปแล้วของบัตรใบนี้',
                  onClick: () => setShowPaid((v) => !v),
                }] : []),
                {
                  icon: 'tune', label: 'แก้ไขบัตรนี้',
                  desc: 'ชื่อ วันสรุปยอด วันครบกำหนด วงเงิน เงินคืน',
                  onClick: () => navigate('/manage/cards'),
                },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
            {/* คอลัมน์ 1 — บิลที่ปิดรอบแล้วและต้องจ่าย */}
            <div className={`px-4 py-3.5 flex flex-col gap-2.5 min-w-0 ${bill ? 'bg-expense-soft' : ''}`}>
              {bill ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11.5px] font-semibold text-[#A93A2E]">ยอดที่ต้องชำระ</span>
                    {unpaid.length > 1 && (
                      <span className="tabular-nums flex-none text-[11px] font-bold bg-white border border-[#F0C4BE] text-[#A93A2E] rounded-full px-2">
                        ค้างอีก {unpaid.length - 1} รอบ
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="tabular-nums text-[34px] font-semibold tracking-[-0.03em] text-[#C03A2D] leading-[1.05]">
                      {fmt(billLeft)}
                    </div>
                    <div className="text-[11.5px] text-[#7A5B56] mt-[3px] leading-[1.45]">
                      ครบกำหนด {formatIsoThai(bill.dueDate)} · {billAlert}
                    </div>
                    <div className="text-[11px] text-[#8A7A76] mt-0.5 leading-[1.45]">
                      ขั้นต่ำ {fmt(bill.minimumAmount)}
                      {Number(bill.paidAmount) > 0 && ` · จ่ายไปแล้ว ${fmt(bill.paidAmount)}`}
                      {Number(bill.previousBalance) > 0 && ` · ยกมา ${fmt(bill.previousBalance)}`}
                      {Number(bill.previousBalance) < 0 && ` · หักเครดิต ${fmt(-bill.previousBalance)}`}
                    </div>
                    {/* บิลใบเดียวมีของสองแบบปนกัน — รูดเต็มจำนวนกับค่างวดผ่อน — ต้องแยกให้เห็น
                        ไม่งั้นคนที่รู้ว่าเดือนนี้ไม่ได้รูดอะไรเลยจะงงว่ายอดมาจากไหน */}
                    {billBreakdown && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#8A7A76] mt-1">
                        {billBreakdown.full > 0 && <span>รูดเต็มจำนวน <b className="tabular-nums">{fmt(billBreakdown.full)}</b></span>}
                        {billBreakdown.installment > 0 && (
                          <span>ค่างวดผ่อน {billBreakdown.installmentCount} งวด <b className="tabular-nums">{fmt(billBreakdown.installment)}</b></span>
                        )}
                        {billBreakdown.advance > 0 && <span>กดเงินสด <b className="tabular-nums">{fmt(billBreakdown.advance)}</b></span>}
                        {billBreakdown.credit > 0 && <span>เงินคืน <b className="tabular-nums">−{fmt(billBreakdown.credit)}</b></span>}
                      </div>
                    )}
                  </div>
                  <button
                    className="h-10 rounded-[11px] bg-ink text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5 hover:bg-black"
                    onClick={() => setPayTarget(bill)}
                  >
                    <Icon name="credit_card" size={18} />
                    จ่ายบิล
                  </button>
                  <span className="text-[11px] text-[#8A6A15] leading-[1.45]">
                    ปิดรอบแล้ว ยอดนิ่ง · จ่ายขั้นต่ำได้ แต่ระยะปลอดดอกเบี้ยจะหายไป
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[11.5px] font-semibold text-muted">ยอดที่ต้องชำระ</span>
                  <div>
                    <div className="tabular-nums text-[34px] font-semibold tracking-[-0.03em] text-[#3F444C] leading-[1.05]">
                      {fmt(0)}
                    </div>
                    <div className="text-[11.5px] text-faint mt-[3px] leading-[1.45]">
                      ไม่มีบิลที่ต้องจ่าย
                      {current ? ` — รอบที่กำลังสะสมจะครบกำหนด ${formatThaiDate(current.due)}` : ''}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* คอลัมน์ 2 — รอบที่ยังไม่ปิด */}
            <div className="px-4 py-3.5 flex flex-col gap-2.5 min-w-0 border-t lg:border-t-0 lg:border-l border-[#EFEDE7]">
              <span className="text-[11.5px] font-semibold text-muted">รอบถัดไปสะสมแล้ว</span>
              {current ? (
                <>
                  <div>
                    <div className="tabular-nums text-[22px] font-semibold text-[#3F444C] tracking-[-0.02em] leading-[1.1]">
                      {fmt(current.net)}
                    </div>
                    <div className="text-[11.5px] text-faint mt-[3px] leading-[1.45]">
                      ครบกำหนด {formatThaiDate(current.due)}
                      {daysToClosing >= 0 && ` · สรุปยอดอีก ${daysToClosing} วัน`}
                    </div>
                    <div className="text-[11px] text-[#A5A199] mt-0.5 leading-[1.45]">
                      {current.count} รายการ
                      {current.spend > 0 && ` · รูดเต็มจำนวน ${fmt(current.spend)}`}
                      {current.installmentCount > 0 && ` · ค่างวดผ่อน ${current.installmentCount} งวด ${fmt(current.installment)}`}
                      {current.advance > 0 && ` · กดเงินสด ${fmt(current.advance)}`}
                      {current.credit > 0 && ` · เงินคืน −${fmt(current.credit)}`}
                      {current.prepaid > 0 && ` · จ่ายล่วงหน้าแล้ว −${fmt(current.prepaid)}`}
                    </div>
                  </div>
                  {estCashback > 0 && (
                    <div className="text-[11px] text-income leading-[1.45]">
                      เงินคืนโดยประมาณ <span className="tabular-nums">≈ {fmt(estCashback)}</span>
                    </div>
                  )}
                  {unbilledAdvances.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 border-t border-[#F2F0EA] pt-2 text-[11px]">
                      <span className="flex-1 min-w-0 text-muted leading-[1.4]">
                        กดเงินสด {formatIsoThai(a.date)}
                        {Number(a.fee) > 0 && ` · ค่าธรรมเนียม ${fmt(a.fee)}`}
                      </span>
                      <span className="tabular-nums flex-none text-[#3F444C]">{fmt(a.amount)}</span>
                      <button className="flex-none text-faint hover:text-expense" onClick={() => setUndoAdvanceTarget(a)}>
                        ย้อน
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <div className="text-[11.5px] text-faint">ยังไม่มีรอบที่กำลังสะสม</div>
              )}
            </div>

            {/* คอลัมน์ 3 — ยอดหนี้รวมกับวงเงิน */}
            <div className="px-4 py-3.5 flex flex-col gap-2.5 min-w-0 border-t lg:border-t-0 lg:border-l border-[#EFEDE7]">
              <span className="text-[11.5px] font-semibold text-muted">
                {credit > 0 ? 'เครดิตคงเหลือ' : 'ยอดหนี้รวม'}
              </span>
              <div>
                <div className={`tabular-nums text-[22px] font-semibold tracking-[-0.02em] leading-[1.1] ${
                  debt > 0 ? 'text-expense' : credit > 0 ? 'text-income' : 'text-muted'
                }`}>
                  {fmt(Math.abs(debt))}
                </div>
                {usage?.unbilled > 0 && (
                  <div className="text-[11px] text-[#A5A199] mt-[3px] leading-[1.45]">
                    รวมยอดผ่อนที่ยังไม่ถูกเรียกเก็บ {fmt(usage.unbilled)} ซึ่งธนาคารกันวงเงินไว้แล้ว
                  </div>
                )}
              </div>
              {limit > 0 && (
                <div>
                  <div className="h-1.5 bg-[#EFEDE7] rounded-[3px] overflow-hidden">
                    <div className={`h-full rounded-[3px] ${overLimit ? 'bg-expense' : 'bg-[#E48A80]'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between gap-1.5 text-[11px] text-muted mt-1.5">
                    <span>ใช้ไป <b className="tabular-nums text-ink">{fmt(used)}</b></span>
                    <span>
                      {overLimit ? 'เกินวงเงิน' : 'เหลือ'}{' '}
                      <b className={`tabular-nums ${overLimit ? 'text-expense' : 'text-income'}`}>{fmt(Math.abs(limit - used))}</b>
                    </span>
                  </div>
                  <div className="text-[11px] text-faint mt-[3px]">
                    วงเงิน <b className="tabular-nums text-ink">{fmt(limit)}</b>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {credit > 0 && (
          <div className="bg-income-soft border border-[#BFE0D2] rounded-[13px] px-3.5 py-2.5 text-[11.5px] text-[#0F6A50] leading-relaxed">
            มีเครดิตในบัตร <b className="tabular-nums">{fmt(credit)}</b> บาท จากการจ่ายเกินหรือเงินคืน
            ระบบจะหักออกจากบิลรอบถัดไปให้เอง
          </div>
        )}

        {/* กระทบยอด — พิสูจน์ว่ายอดหนี้มาจากไหนบ้าง
            ยอดหนี้เพิ่มทุกครั้งที่รูด แต่บิลเก็บเฉพาะของที่อยู่ในรอบ ส่วนต่างที่เหลือคือ
            ยอดยกมาตอนเพิ่มบัตรกับการปรับยอดด้วยมือ ซึ่งไม่เคยขึ้นบิลเลยและไม่มีที่ไหนบอก
            ถ้าไม่แสดงไว้ ผู้ใช้จะเจอยอดหนี้ที่จ่ายบิลครบทุกใบแล้วก็ยังไม่เป็นศูนย์ */}
        {Math.abs(unbilledDebt) >= 0.01 && (
          <div className="bg-paper border border-hairline rounded-[13px] px-3.5 py-2.5 text-[11.5px] text-muted leading-relaxed">
            ยอดหนี้ {fmt(debt)} = บิลที่ยังไม่จ่าย <b className="tabular-nums">{fmt(billedUnpaidTotal)}</b>
            {' '}+ ที่ยังไม่เข้าบิล <b className="tabular-nums">{fmt(uncoveredCharges)}</b>
            {' '}+ <b className="tabular-nums">{fmt(unbilledDebt)}</b> ที่มาจากยอดยกมาตอนเพิ่มบัตรหรือการปรับยอดด้วยมือ
            {' '}— ก้อนสุดท้ายจะไม่ถูกเรียกเก็บผ่านบิลใบไหน ต้องจ่ายแล้วปรับยอดเอง
          </div>
        )}

        {bill && autopayDue > 0 && (
          <div className="bg-transfer-soft border border-[#C9D0F2] rounded-[13px] px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-[220px] text-[11.5px] text-[#2E44A6] leading-relaxed">
              ธนาคารจะหัก <b className="tabular-nums">{fmt(autopayDue)}</b> บาท {AUTOPAY_LABEL[card.autopayMode] ?? ''}
              {' '}จากบัญชีที่ผูกไว้ ในวันที่ {formatIsoThai(bill.dueDate)}
            </span>
            <button
              className="flex-none h-8 px-3.5 rounded-[9px] bg-transfer text-white text-xs font-semibold hover:brightness-95"
              onClick={() => setAutopayTarget({ statement: bill, amount: autopayDue })}
            >
              ยืนยันว่าถูกหักแล้ว
            </button>
          </div>
        )}

        {feeDue && (
          <div className="bg-pending-soft border border-pending-line rounded-[13px] px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-[220px] text-[11.5px] text-[#8A6A15] leading-relaxed">
              เดือน {MONTHS_TH[card.annualFeeMonth - 1]} ธนาคารเรียกเก็บค่าธรรมเนียมรายปี{' '}
              <b className="tabular-nums">{fmt(card.annualFee)}</b> บาท ถ้าได้รับการยกเว้นก็ไม่ต้องกด
            </span>
            <button
              className="flex-none h-8 px-3.5 rounded-[9px] bg-pending text-white text-xs font-semibold hover:brightness-95"
              onClick={() => setFeeTarget(card)}
            >
              บันทึกค่าธรรมเนียม
            </button>
          </div>
        )}

        <div className="card flex flex-col overflow-hidden">
          {/* สองแท็บ = สองบิล รายการอยู่แท็บไหนถูกเรียกเก็บในบิลนั้น
              รูดหลังวันสรุปยอดมาลง "รอบบิลหน้า" เอง ถ้าธนาคารเก็บในใบที่ออกแล้วก็กดย้าย
              แท็บแบบแฟ้ม: แถบเข้มด้านบน แท็บที่เลือกเป็นสีขาวเชื่อมกับเนื้อหาข้างล่าง */}
          <div className="flex items-end gap-1 px-3 pt-2 bg-ink flex-none">
              {[
                { k: 'this',
                  t: 'รายการในรอบบิลนี้',
                  s: bill
                    ? `ครบกำหนด ${formatIsoThai(bill.dueDate)} · ออกบิลแล้ว`
                    : displayBill
                      ? `จ่ายครบแล้ว · ครบกำหนด ${formatIsoThai(displayBill.dueDate)}`
                      : 'ไม่มีบิลค้าง',
                  n: billRows.length },
                { k: 'next', t: 'รายการในรอบบิลหน้า', s: current ? `ตัดรอบ ${formatThaiDate(current.end)} · ครบกำหนด ${formatThaiDate(current.due)}` : '', n: cycleRows.length },
              ].map((tab) => {
                const on = billTab === tab.k
                return (
                  <button
                    key={tab.k}
                    onClick={() => setBillTab(tab.k)}
                    className={`folder-tab ${on ? 'is-active' : ''} h-10 px-4 rounded-t-[12px] flex items-center gap-2 transition-colors ${
                      on ? 'bg-white text-ink' : 'text-white/75 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span className="text-[12.5px] font-semibold whitespace-nowrap">{tab.t}</span>
                    <span className={`hidden md:inline text-[10.5px] whitespace-nowrap ${on ? 'text-faint' : 'text-white/55'}`}>{tab.s}</span>
                    <span className={`tabular-nums text-[10.5px] font-semibold rounded-full px-1.5 py-px ${
                      on ? 'bg-ink text-white' : 'bg-white/20 text-white'
                    }`}>
                      {tab.n}
                    </span>
                  </button>
                )
              })}
          </div>
          <div className="px-4 pb-1 pt-2.5 text-[11px] text-faint">
            {billTab === 'this'
              ? (hasBill
                ? 'รายการที่ธนาคารเก็บในบิลใบนี้ · กด "จ่ายยอดนี้" เพื่อจ่ายบิลเฉพาะรายการนั้น (จ่ายแล้วจะขึ้นถูกสีเขียวหน้าแถว) · จ่ายไปแล้วก่อนหน้านี้แต่ระบบยังไม่รู้ว่าเป็นของบรรทัดไหน กด "ติ๊กว่าจ่ายแล้ว" ได้เลย ไม่ตัดเงินเพิ่ม · รายการที่ย้ายเข้ามาหลังออกบิลมีปุ่ม "ย้ายไปรอบบิลหน้า" ส่วนของเดิมตามวันที่รูดย้ายไม่ได้ · ติ๊กหน้าแถวเองคือทำเครื่องหมายว่าตรวจกับสลิปแล้ว (ไม่ตัดเงิน)'
                : displayBill
                  ? 'บิลใบนี้จ่ายครบแล้ว — รายการยังอยู่ให้ไล่เช็คกับสลิปได้ ทุกบรรทัดติดเครื่องหมายว่าจ่ายแล้ว · พอถึงวันสรุปยอดรอบถัดไป รายการจากแท็บ "รอบบิลหน้า" จะมาแทนที่ตรงนี้'
                  : 'บัตรใบนี้ไม่มีบิลที่ต้องจ่าย · บิลใบถัดไปจะออกเองตอนสรุปยอด แล้วรายการจากแท็บ "รอบบิลหน้า" จะย้ายมาอยู่ที่นี่')
              : (hasBill ? 'รายการที่รูดหลังวันสรุปยอดมาอยู่ที่นี่ จะถูกเรียกเก็บในบิลรอบถัดไป · ถ้าธนาคารเก็บในบิลใบที่ออกแล้ว กด "ย้ายไปรอบบิลนี้" · ' : 'ทุกรายการที่รูดในรอบนี้อยู่ที่นี่ และจะกลายเป็นบิลใบถัดไปตอนสรุปยอด · ')
                + 'รูดแล้วโอนคืนทันที กด "จ่ายรายการนี้" ยอดจะถูกหักออกจากบิลรอบที่กำลังมาถึง · กดปุ่ม ⋮ ท้ายแถวเพื่อจัดการรายการนั้น · ติ๊กหน้าแถวเพื่อทำเครื่องหมายว่าตรวจกับสลิปแล้ว (ไม่ตัดเงิน) · งวดผ่อนที่ติดป้าย "รอเรียกเก็บ" คือค่างวดของรอบนี้ที่ธนาคารจะรวมมากับบิลใบนี้ตอนสรุปยอด'}
          </div>
          <div className="px-4 pb-3 overflow-x-auto">
            {shownRows.length === 0 ? (
              <p className="text-center text-[12.5px] text-faint py-8">
                {billTab === 'this'
                  ? (displayBill
                    ? 'บิลใบนี้ไม่มีรายการ'
                    : `ไม่มีบิลที่ต้องจ่าย — บิลใบถัดไปจะออกตอนสรุปยอด${current ? ` ${formatThaiDate(current.end)}` : ''}`)
                  : 'ยังไม่มีรายการในรอบนี้'}
              </p>
            ) : shownRows.map((r) => {
              const insEntry = r.upcoming
                ? { i: r.installment }
                : r.tx?.installmentEntryId
                  ? installments
                    .map((i) => ({ i, e: getInstallmentProgress(i.id)?.rows?.find((x) => x.id === r.tx.installmentEntryId) }))
                    .find((x) => x.e)
                  : null
              const prog = insEntry ? getInstallmentProgress(insEntry.i.id) : null
              const marked = rowMarks.includes(r.key)
              // จ่ายให้รายการนี้ไว้ก่อนออกบิลแล้วเท่าไร เหลือเท่าไร (เฉพาะรอบที่ยังไม่ออกบิล)
              const prepaidLeft = r.prepaid ? Math.abs(r.amount) - r.prepaid.amount : null
              const fullyPrepaid = prepaidLeft !== null && prepaidLeft <= 0.005
              const lastPrepaidAt = r.prepaid
                ? r.prepaid.legs.map((l) => l.paidAt).sort().at(-1)
                : null
              // จ่ายบรรทัดนี้ในบิลที่ออกแล้วไปเท่าไร เหลือเท่าไร
              const paidInBillLeft = r.paidInBill ? Math.abs(r.amount) - r.paidInBill.amount : null
              const fullyPaidInBill = paidInBillLeft !== null && paidInBillLeft <= 0.005
              // จ่ายทั้งใบ = ไม่มีขาที่ผูกกับบรรทัด ใช้วันที่จ่ายบิลของใบนั้นแทน
              const lastPaidAt = r.paidInBill?.legs?.map((l) => l.paidAt).sort().at(-1)
                ?? (r.paidInBill?.whole ? displayBill?.paidAt ?? null : null)
              // บรรทัดนี้ "จ่ายแล้ว" จริง ไม่ว่าจะจ่ายก่อนออกบิลหรือจ่ายตอนบิลออกแล้ว
              const rowPaid = fullyPrepaid || fullyPaidInBill
              return (
                <div key={r.key} className="grid grid-cols-[22px_64px_minmax(0,1fr)_96px_110px_30px] gap-2.5 items-center py-2 border-t border-[#F2F0EA]">
                  {/* ติ๊กว่าไล่เช็คบรรทัดนี้กับสลิปแล้ว — ไม่ตัดเงิน เพราะธนาคารเก็บบิลทั้งใบ
                      ไม่ได้เก็บทีละบรรทัด (ดูหมายเหตุใน supabase/card.sql ส่วน 11) */}
                  {r.upcoming ? <span /> : rowPaid ? (
                    // จ่ายบรรทัดนี้ไปแล้วจริง — ติ๊กถูกให้เลย ไม่ต้องรอให้ผู้ใช้มาติ๊กเอง
                    // สีเขียว (ไม่ใช่สีมะนาวของเครื่องหมายตรวจสลิป) เพราะคนละความหมาย:
                    // อันนี้คือเงินออกไปแล้ว ส่วนอีกอันคือแค่ไล่เช็คกับสลิปแล้ว
                    <span
                      title={`จ่ายรายการนี้แล้ว${lastPaidAt || lastPrepaidAt ? ` เมื่อ ${formatIsoThaiShort(lastPaidAt ?? lastPrepaidAt)}` : ''}`}
                      className="w-[19px] h-[19px] rounded-[6px] bg-income border border-income text-white flex items-center justify-center"
                    >
                      <Icon name="check" size={14} />
                    </span>
                  ) : (
                  <button
                    onClick={() => setMarkTarget({ row: r, on: !marked })}
                    disabled={busy}
                    title={marked ? 'เอาเครื่องหมายถูกออก' : 'ทำเครื่องหมายว่าตรวจแล้ว'}
                    className={`w-[19px] h-[19px] rounded-[6px] border flex items-center justify-center transition disabled:opacity-50 ${
                      marked ? 'bg-lime border-lime text-ink' : 'bg-white border-[#D8D4C9] hover:border-ink'
                    }`}
                  >
                    {marked && <Icon name="check" size={14} />}
                  </button>
                  )}
                  <span className="tabular-nums text-[11.5px] text-faint">{formatIsoThai(r.date)}</span>
                  <span className="min-w-0">
                    <span className={`block text-[12.5px] font-medium truncate ${marked || rowPaid ? 'text-muted line-through' : ''}`}>{r.name}</span>
                    <span className="block text-[11px] text-faint truncate">{r.cat}</span>
                    {prog && (
                      <span className="flex items-center gap-2 mt-1 flex-wrap">
                        {/* เน้นงวดที่ "แถวนี้" พูดถึง ไม่ใช่งวดแรกที่ยังไม่จ่ายของทั้งสัญญา
                            สองอันนี้ต่างกันได้ เช่นงวดก่อนหน้าเข้าบิลใบที่แล้วแต่ยังไม่ได้จ่ายบิล
                            ถ้าเน้นผิดตัว หัวแถวจะบอกงวดหนึ่งแต่กรอบขาวไปอยู่อีกงวด */}
                        <EntryPips
                          rows={prog.rows}
                          currentSeq={r.owed?.seq ?? insEntry.e?.seq ?? r.entry?.seq}
                          closingDay={card.closingDay}
                          paidViaBill={entryPaidViaBill}
                        />
                        <span className="text-[10.5px] text-faint">
                          {/* งวดที่จ่ายผ่านบิลไปแล้วต้องนับด้วย ไม่งั้นเลขนี้กับสีของป้ายจะขัดกันเอง */}
                          จ่ายแล้ว {prog.paidCount + prog.prepaidCount + prog.rows.filter(
                            (x) => x.status !== 'paid' && x.status !== 'prepaid' && entryPaidViaBill.has(x.id)
                          ).length} จาก {insEntry.i.months} งวด
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="justify-self-start flex flex-col items-start gap-0.5">
                    <span className={`text-[10.5px] rounded-full px-2 py-0.5 ${TAG_TONE[r.tag] ?? TAG_TONE['รูดบัตร']}`}>
                      {r.tag}
                    </span>
                    {r.upcoming && <span className="text-[10px] text-faint">รอเรียกเก็บ</span>}
                    {/* ปุ่มจ่ายเฉพาะรายการนี้ — ต้องเห็นได้เลยไม่ต้องเปิดเมนู เพราะ "รูดแล้ว
                        โอนคืนทันที" คือวิธีใช้บัตรประจำวันของคนจำนวนมาก
                        รอบที่ยังไม่ออกบิล = จ่ายล่วงหน้า (ยอดหายจากรอบสะสมทันที)
                        บิลที่ออกแล้ว = จ่ายบิลด้วยยอดของรายการนี้ */}
                    {r.prepayable && (
                      // ใช้ displayBill ไม่ใช่ hasBill — บิลที่จ่ายจบแล้วยังแสดงรายการค้างไว้
                      // ถ้าเช็คด้วย hasBill แถวพวกนั้นจะได้ปุ่ม "จ่ายรายการนี้" ของรอบที่ยัง
                      // ไม่ออกบิล ซึ่งกดแล้วเท่ากับจ่ายซ้ำทั้งที่จ่ายผ่านบิลไปแล้ว
                      displayBill && billTab === 'this' ? (
                        fullyPaidInBill || !bill ? (
                          <span
                            className="text-[10px] text-income font-semibold whitespace-nowrap"
                            title={r.paidInBill?.whole || !bill
                              ? 'บิลใบนี้จ่ายครบแล้ว ทุกรายการในใบจึงถือว่าจ่ายแล้ว'
                              : 'จ่ายบิลด้วยยอดของรายการนี้ไปแล้ว · ย้อนได้ที่ปุ่มย้อนการจ่ายของบิล'}
                          >
                            ✓ จ่ายแล้ว {lastPaidAt ? formatIsoThaiShort(lastPaidAt) : ''}
                          </span>
                        ) : (
                        <>
                        <button
                          disabled={busy}
                          onClick={() => openPayItemInBill(r)}
                          className="text-[10.5px] text-income underline hover:no-underline whitespace-nowrap disabled:opacity-50"
                          title="เปิดหน้าจ่ายบิลโดยใส่ยอดของรายการนี้ให้ — ส่วนที่เหลือของบิลยังค้างอยู่"
                        >
                          {r.paidInBill ? 'จ่ายส่วนที่เหลือ' : 'จ่ายยอดนี้'}
                        </button>
                        {/* จ่ายไปแล้วจริงแต่ระบบไม่รู้ว่าเงินก้อนไหนเป็นของบรรทัดไหน (จ่ายก่อนมีระบบนี้)
                            ให้ติ๊กเองได้เมื่อบิลใบนี้ยังมียอดที่จ่ายแล้วเหลือพอ — ไม่ตัดเงินเพิ่ม */}
                        {unassignedPaid >= Math.abs(r.amount) - (r.paidInBill?.amount ?? 0) - 0.005 && (
                          <button
                            disabled={busy}
                            onClick={() => markRowPaid(r)}
                            className="text-[10.5px] text-muted underline hover:no-underline hover:text-income whitespace-nowrap disabled:opacity-50"
                            title={`ยอดนี้ถูกตัดไปแล้วตอนจ่ายบิล — ผูกกับยอดที่จ่ายไว้แล้ว ${fmt(unassignedPaid)} บาท ไม่ตัดเงินเพิ่ม`}
                          >
                            ติ๊กว่าจ่ายแล้ว
                          </button>
                        )}
                        </>
                        )
                      ) : fullyPrepaid ? (
                        <span
                          className="text-[10px] text-income font-semibold whitespace-nowrap"
                          title="โอนจ่ายรายการนี้ไปแล้ว ยอดถูกหักออกจากบิลรอบที่กำลังมาถึง · ย้อนได้ที่เมนู ⋮"
                        >
                          ✓ จ่ายแล้ว {lastPrepaidAt ? formatIsoThaiShort(lastPrepaidAt) : ''}
                        </span>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => openPrepay(r)}
                          className="text-[10.5px] text-income underline hover:no-underline whitespace-nowrap disabled:opacity-50"
                          title="โอนจ่ายเฉพาะยอดนี้ตอนนี้ ยอดจะถูกหักออกจากบิลรอบที่กำลังมาถึง"
                        >
                          {r.prepaid ? 'จ่ายส่วนที่เหลือ' : 'จ่ายรายการนี้'}
                        </button>
                      )
                    )}
                    {/* ปุ่มย้ายรอบบิล — เห็นได้เลยไม่ต้องเปิดเมนู เพราะเป็นงานที่ทำตอนไล่บิล
                        ทีละบรรทัด งวดผ่อนไม่มีปุ่ม (ตารางงวดกำหนดเอง) */}
                    {hasBill && r.tx && !r.tx.installmentEntryId && (
                      billTab === 'next' ? (
                        <button
                          disabled={busy}
                          onClick={() => run(() => moveToBill(r, bill))}
                          className="text-[10.5px] text-[#A93A2E] underline hover:no-underline whitespace-nowrap disabled:opacity-50"
                          title={`ธนาคารเก็บรายการนี้ในบิลที่ครบกำหนด ${formatIsoThai(bill.dueDate)} — ย้ายเข้าไปให้ยอดบิลตรง`}
                        >
                          ย้ายไปรอบบิลนี้
                        </button>
                      ) : r.movable ? (
                        <button
                          disabled={busy}
                          onClick={() => run(() => moveToNext(r))}
                          className="text-[10.5px] text-[#A93A2E] underline hover:no-underline whitespace-nowrap disabled:opacity-50"
                          title="เอาออกจากบิลใบนี้ ไปรวมกับบิลรอบถัดไปตามวันที่รูด"
                        >
                          ย้ายไปรอบบิลหน้า
                        </button>
                      ) : (
                        <span className="text-[10px] text-faint whitespace-nowrap" title="วันที่รูดอยู่ในช่วงของบิลใบนี้ ธนาคารเก็บในใบนี้อยู่แล้ว">
                          ตามวันที่รูด
                        </span>
                      )
                    )}
                  </span>
                  <span className={`tabular-nums text-right text-[13px] font-semibold ${
                    r.amount < 0 ? 'text-income' : r.upcoming ? 'text-muted' : 'text-ink'
                  }`}>
                    {/* จ่ายไปแล้ว = ขีดฆ่ายอดเดิม จ่ายบางส่วน = บอกยอดที่ยังจะเข้าบิล */}
                    <span className={rowPaid ? 'line-through text-faint font-normal' : ''}>
                      {r.amount < 0 ? `−${fmt(-r.amount)}` : fmt(r.amount)}
                    </span>
                    {r.prepaid && !fullyPrepaid && (
                      <span className="block text-[10px] text-income font-normal whitespace-nowrap">
                        จ่ายแล้ว {fmt(r.prepaid.amount)} · เหลือ {fmt(prepaidLeft)}
                      </span>
                    )}
                    {r.paidInBill && !fullyPaidInBill && (
                      <span className="block text-[10px] text-income font-normal whitespace-nowrap">
                        จ่ายแล้ว {fmt(r.paidInBill.amount)} · เหลือ {fmt(paidInBillLeft)}
                      </span>
                    )}
                  </span>
                  {/* ทุกแถวต้องจัดการได้ ไม่ใช่เฉพาะแถวที่เป็นรายจ่ายจริง —
                      งวดผ่อนที่รอเรียกเก็บกับยอดกดเงินสดก็คือของที่ผู้ใช้บันทึกไว้เหมือนกัน
                      เมนูจึงเปลี่ยนตามชนิดของแถว แทนที่จะซ่อนปุ่มไปเฉยๆ */}
                  <span className="justify-self-end">
                    <RowMenu
                      compact
                      title={r.name}
                      sub={`${formatIsoThai(r.date)} · ${r.tag} · ${fmt(Math.abs(r.amount))} บาท`}
                      icon="credit_card"
                      items={rowMenuItems(r, insEntry?.i ?? null)}
                    />
                  </span>
                </div>
              )
            })}
          </div>
          {billTab === 'next' && (installmentOutlook.thisCount > 0 || installmentOutlook.laterCount > 0) && (
            <div className="mx-4 mb-3 bg-recurring-soft rounded-[9px] px-2.5 py-2 text-[11px] text-[#5A3C90] leading-relaxed">
              {installmentOutlook.thisCount > 0 && (
                <div>
                  งวดผ่อนที่จะรวมมากับบิลรอบนี้ <b className="tabular-nums">{installmentOutlook.thisCount}</b> งวด
                  รวม <b className="tabular-nums">{fmt(installmentOutlook.thisAmount)}</b> บาท
                  {!upcomingVisible && bill && (
                    <> — จะขึ้นเป็นรายการหลังพ้นกำหนดชำระบิลใบปัจจุบัน ({formatIsoThai(bill.dueDate)}) หรือเมื่อจ่ายบิลแล้ว</>
                  )}
                </div>
              )}
              {installmentOutlook.laterCount > 0 && (
                <div>
                  ที่เหลือหลังรอบนี้อีก <b className="tabular-nums">{installmentOutlook.laterCount}</b> งวด
                  รวม <b className="tabular-nums">{fmt(installmentOutlook.laterAmount)}</b> บาท (ทยอยเข้าบิลรอบถัดๆ ไป)
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── คอลัมน์ขวา ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 min-w-0">
        <div className="card px-[15px] py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">ข้อมูลบัตร</span>
            <Link to="/manage/cards" className="ml-auto text-xs font-semibold text-income hover:underline">แก้ไข</Link>
          </div>
          <Meta label="ธนาคาร / ผู้ออกบัตร" value={card.bankName || '—'} />
          <Meta label="ชื่อเรียกบัตร" value={card.name} />
          <Meta label="4 ตัวท้าย" value={card.last4 || '—'} />
          <Meta label="วันสรุปยอด" value={`ทุกวันที่ ${card.closingDay}`} />
          <Meta label="วันครบกำหนดชำระ" value={`ทุกวันที่ ${card.dueDay}`} />
          <Meta label="วงเงิน" value={fmt(card.creditLimit)} />
          <Meta label="อัตราเงินคืน" value={Number(card.cashbackRate) > 0 ? `${card.cashbackRate}%` : 'ไม่มี'} />
          <Meta
            label="ค่าธรรมเนียมรายปี"
            value={hasFee
              ? `${fmt(card.annualFee)} (${MONTHS_TH[(card.annualFeeMonth || 1) - 1]})${feeRecorded ? ' · บันทึกแล้วปีนี้' : ''}`
              : 'ไม่มี'}
          />
          <Meta
            label="ผูกหักบัญชีอัตโนมัติ"
            value={card.autopayMode && card.autopayMode !== 'off' ? (AUTOPAY_LABEL[card.autopayMode] ?? '').replace(/[()]/g, '') : 'ไม่ได้ผูก'}
          />
          <Meta label="ยอดหนี้คงค้าง" value={fmt(debt)} />
          <div className="mt-2.5 bg-paper rounded-[9px] px-2.5 py-2 text-[11px] text-muted leading-relaxed">
            รูดวันนี้จะไปอยู่ในบิลที่ครบกำหนด <b>{current ? formatThaiDate(current.due) : '—'}</b>
          </div>
        </div>

        <div className="card px-[15px] py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">ผ่อนผ่านบัตรใบนี้</span>
            <span className="tabular-nums text-[11px] font-semibold bg-recurring-soft text-[#5A3C90] rounded-full px-2 py-0.5">
              {installments.length} รายการ
            </span>
            {/* เพิ่มจากตรงนี้ได้เลย ไม่ต้องอ้อมไปหน้าบันทึกรายจ่าย —
                คนที่มาบันทึกสัญญาที่ผ่อนอยู่ก่อนแล้วไม่ได้กำลังจะรูดอะไรวันนี้ */}
            <button
              className="ml-auto flex-none h-[28px] px-2.5 rounded-lg border border-hairline bg-white text-[11.5px] font-semibold hover:bg-paper flex items-center gap-1"
              onClick={() => setInsForm({ installment: null })}
            >
              <Icon name="add" size={16} />
              เพิ่มรายการผ่อน
            </button>
          </div>
          {installments.length === 0 ? (
            <p className="text-[11.5px] text-faint mt-2">ยังไม่มีรายการผ่อนบนบัตรใบนี้</p>
          ) : installments.map((i) => {
            const p = getInstallmentProgress(i.id)
            if (!p) return null
            // งวดที่จ่ายผ่านบิลไปแล้วนับเป็นจ่ายแล้วด้วย (สถานะยังเป็น billed ตามกฎการลบสัญญา)
            const doneViaBill = p.rows.filter(
              (r) => r.status !== 'paid' && r.status !== 'prepaid' && entryPaidViaBill.has(r.id)
            ).length
            const done = p.paidCount + p.prepaidCount + doneViaBill
            const next = p.rows.find(
              (r) => (r.status === 'pending' || r.status === 'billed') && !entryPaidViaBill.has(r.id)
            )
            return (
              <div key={i.id} className="border-t border-[#F6F4EF] pt-2.5 mt-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{i.name}</span>
                  {/* คงเหลือ = ที่ยังไม่ได้จ่ายจริง รวมงวดที่เข้าบิลแล้วแต่ยังไม่ได้จ่ายบิล */}
                  <span className="tabular-nums flex-none text-[12.5px] font-semibold text-expense">{fmt(p.unpaidAmount)}</span>
                  <span className="flex-none self-center">
                    <RowMenu
                      compact
                      title={i.name}
                      sub={`ผ่อน ${i.months} งวด · เหลือ ${fmt(p.unpaidAmount)} บาท`}
                      icon="credit_card"
                      items={[
                        {
                          icon: 'edit_note',
                          label: 'แก้ไขรายการผ่อน',
                          desc: p.billedCount + p.paidCount > 0
                            ? 'มีงวดที่เกิดขึ้นแล้ว แก้ได้เฉพาะรายละเอียด'
                            : 'แก้ยอด จำนวนงวด วันที่ และบัตรได้',
                          onClick: () => setInsForm({ installment: i }),
                        },
                        {
                          icon: 'cancel',
                          label: 'ยกเลิกสัญญา',
                          desc: 'หยุดงวดที่เหลือ เก็บงวดที่เกิดไปแล้วไว้เป็นประวัติ',
                          onClick: () => setInsDeleteTarget({ installment: i, progress: p, mode: 'cancel' }),
                        },
                        {
                          icon: 'delete',
                          label: 'ลบทิ้งทั้งรายการ',
                          desc: 'ใช้เมื่อบันทึกผิด — คืนเงินงวดที่จ่ายไปแล้วให้ด้วย',
                          danger: true,
                          onClick: () => setInsDeleteTarget({ installment: i, progress: p, mode: 'delete' }),
                        },
                      ]}
                    />
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[11px] text-faint mt-0.5">
                  <span>งวดละ {fmt(next?.amount ?? 0)}</span>
                  <span className="tabular-nums">งวด {done} จาก {i.months}</span>
                </div>
                {/* แถบเดียวบอกได้แค่สัดส่วน ซึ่งข้อความ "งวด x จาก y" บรรทัดบนบอกไปแล้ว
                    ป้ายรายงวดบอกต่อได้ว่างวดไหนครบกำหนดวันไหนและงวดไหนกำลังจะถูกเก็บ */}
                <div className="mt-1.5">
                  <EntryPips rows={p.rows} closingDay={card.closingDay} paidViaBill={entryPaidViaBill} />
                </div>
                {next && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="flex-1 min-w-0 text-[11px] text-muted">
                      งวดถัดไป งวดที่ {next.seq} · {fmt(next.amount)} · ครบกำหนด {formatIsoThai(next.dueDate)}
                    </span>
                    <button
                      className="flex-none h-[30px] px-2.5 rounded-lg bg-ink text-white text-[11.5px] font-semibold hover:bg-black"
                      onClick={() => setPayEntryTarget({ installment: i, entry: next })}
                    >
                      จ่ายค่างวด
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="card px-[15px] py-3.5">
          <div className="text-[13px] font-semibold">บิลที่จ่ายแล้ว</div>
          {paidHistory.length === 0 ? (
            <p className="text-[11.5px] text-faint mt-2">ยังไม่มีบิลที่จ่ายแล้ว</p>
          ) : paidHistory.slice(0, showPaid ? undefined : 3).map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 border-t border-[#F6F4EF] py-2">
              <span className="flex-1 min-w-0">
                <span className="block text-[11.5px] text-muted">รอบ {s.cycle} · ครบกำหนด {formatIsoThai(s.dueDate)}</span>
                <span className="block text-[11px] text-income">
                  {s.paidAt ? `จ่าย ${formatIsoThai(s.paidAt)}` : 'จ่ายแล้ว'}
                  {Number(s.paidAmount) > Number(s.amount)
                    ? ` · จ่ายเกิน ${fmt(Number(s.paidAmount) - Number(s.amount))}`
                    : ' · เต็มจำนวน'}
                </span>
              </span>
              <span className="tabular-nums flex-none text-xs font-medium">{fmt(s.amount)}</span>
              {Number(s.paidAmount) > 0 && (
                <button className="flex-none text-[11.5px] text-faint hover:text-expense" onClick={() => setUndoTarget(s)}>
                  ย้อน
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── ป๊อปอัป ─────────────────────────────────────────────────────── */}
      {payTarget && (
        <PayCardBillPopup statement={payTarget} cardLabel={formatCard(card)} preset={payPreset} onConfirm={handlePay} onCancel={closePayBill} busy={busy} />
      )}
      {prepayTarget && (
        <PayCardItemPopup item={prepayTarget} cardLabel={formatCard(card)} onConfirm={handlePrepay} onCancel={() => setPrepayTarget(null)} busy={busy} />
      )}
      <ConfirmPopup
        open={!!undoPrepayTarget}
        danger
        title="ย้อนการจ่ายรายการนี้"
        message={undoPrepayTarget
          ? `คืนเงิน ${fmt(undoPrepayTarget.prepaid.amount)} บาท ที่จ่ายให้ "${undoPrepayTarget.name}" ไว้ก่อนออกบิล กลับเข้ากระเป๋าที่ตัดไป?\n\nยอดของรายการนี้จะกลับไปรวมในบิลรอบที่กำลังมาถึงเท่าเดิม ระบบจะบันทึกการยกเลิกไว้ในประวัติทั้งหมด`
          : ''}
        confirmLabel="ย้อนการจ่าย"
        onConfirm={handleUndoPrepay}
        onCancel={() => setUndoPrepayTarget(null)}
      />
      {/* ปุ่มติ๊กในบิลใบที่ออกแล้ว — ตรวจกับสลิป ไม่ตัดเงิน */}
      {cashbackTarget && (
        <CardCashbackPopup card={card} estimate={cashbackTarget.estimate} onConfirm={handleCashback} onCancel={() => setCashbackTarget(null)} busy={busy} />
      )}
      {advanceTarget && (
        <CardAdvancePopup card={advanceTarget} onConfirm={handleAdvance} onCancel={() => setAdvanceTarget(null)} busy={busy} />
      )}
      {feeTarget && (
        <CardFeePopup card={feeTarget} onConfirm={handleFee} onCancel={() => setFeeTarget(null)} busy={busy} />
      )}
      {payEntryTarget && (
        <PayInstallmentPopup
          installment={payEntryTarget.installment}
          entry={payEntryTarget.entry}
          card={card}
          onConfirm={handlePayEntry}
          onCancel={() => setPayEntryTarget(null)}
          busy={busy}
        />
      )}
      {editingTx && <EditTransactionPopup transaction={editingTx} onClose={() => setEditingTx(null)} />}

      {insForm && (
        <InstallmentFormPopup
          installment={insForm.installment}
          cardId={cardId}
          onClose={() => setInsForm(null)}
        />
      )}

      {chargeOpen && (
        <CardChargePopup
          card={card}
          onClose={() => setChargeOpen(false)}
          onSaved={() => { refreshCards(); refreshTransactions() }}
        />
      )}

      {/* ลบรายจ่ายบนบัตร — บอกให้ครบว่าอะไรจะย้อนตามไปบ้าง ไม่ใช่แค่ "ลบไหม" */}
      <ConfirmPopup
        open={!!cancelTxTarget}
        danger
        title="ลบรายการนี้"
        message={cancelTxTarget
          ? `"${cancelTxTarget.itemName}" ${fmt(cancelTxTarget.amount)} บาท (${formatIsoThai(cancelTxTarget.date)})\n\n` +
            describeTxCancelEffects(cancelTxTarget, { pendingPayments, taxInvoices, pendingIncomes })
              .map((t) => `· ${t}`).join('\n') +
            // เงินที่โอนจ่ายให้รายการนี้ไว้ไม่ได้คืน — กลายเป็นเครดิตในบัตร (ธนาคารก็ทำแบบนี้)
            (prepaidByTx.get(cancelTxTarget.id)
              ? `\n· ยอด ${fmt(prepaidByTx.get(cancelTxTarget.id).amount)} บาท ที่จ่ายให้รายการนี้ไว้ก่อนออกบิล จะกลายเป็นเครดิตในบัตร หักจากบิลรอบหน้า (ถ้าอยากได้เงินคืนเข้ากระเป๋า ให้ "ย้อนการจ่าย" ที่รายการก่อนลบ)`
              : '')
          : ''}
        confirmLabel="ลบรายการ"
        onCancel={() => setCancelTxTarget(null)}
        onConfirm={() => run(async () => {
          await cancelTx(cancelTxTarget)
          setCancelTxTarget(null)
        })}
      />

      {/* ยกเลิก = หยุดงวดที่เหลือ เก็บของที่เกิดไปแล้วไว้ · ลบ = ไม่ควรมีรายการนี้ตั้งแต่แรก
          สองอย่างนี้ต่างกันที่ปลายทางของเงิน จึงต้องบอกให้ชัดก่อนกดยืนยัน */}
      <ConfirmPopup
        open={!!insDeleteTarget}
        danger
        title={insDeleteTarget?.mode === 'delete' ? 'ลบรายการผ่อนทิ้ง' : 'ยกเลิกสัญญาผ่อน'}
        message={insDeleteTarget
          ? insDeleteTarget.mode === 'delete'
            ? `"${insDeleteTarget.installment.name}"\n` +
              `จะถูกลบออกทั้งรายการ พร้อมตารางงวดทั้งหมด\n` +
              (insDeleteTarget.progress.paidCount > 0
                ? `เงินของงวดที่จ่ายผ่านแอปไปแล้ว ${insDeleteTarget.progress.paidCount} งวด จะถูกคืนเข้ากระเป๋าต้นทางให้\n`
                : '') +
              `\nถ้ามีงวดที่เข้าบิลบัตรไปแล้ว จะลบไม่ได้ ให้ใช้ "ยกเลิกสัญญา" แทน`
            : `"${insDeleteTarget.installment.name}"\n` +
              `งวดที่เหลืออีก ${insDeleteTarget.progress.remainingCount} งวด (${fmt(insDeleteTarget.progress.remainingAmount)} บาท) จะถูกยกเลิก\n` +
              `งวดที่เรียกเก็บหรือจ่ายไปแล้วยังอยู่ตามเดิม เพราะเกิดขึ้นจริงแล้ว`
          : ''}
        confirmLabel={insDeleteTarget?.mode === 'delete' ? 'ลบทิ้ง' : 'ยกเลิกสัญญา'}
        onCancel={() => setInsDeleteTarget(null)}
        onConfirm={() => run(async () => {
          const { installment: ins, progress, mode } = insDeleteTarget
          if (mode === 'delete') {
            await deleteInstallment(ins.id, buildLogEntry({
              activityType: 'INSTALLMENT_DELETE',
              description:
                `ลบรายการผ่อน "${ins.name}" ${ins.months} งวด รวม ${fmt(ins.totalAmount)} บาท` +
                (progress.paidCount > 0 ? ` · คืนเงินงวดที่จ่ายไปแล้ว ${progress.paidCount} งวด` : ''),
              oldValue: ins,
            }))
          } else {
            await cancelInstallment(ins.id, buildLogEntry({
              activityType: 'INSTALLMENT_CANCEL',
              description: `ยกเลิกการผ่อน "${ins.name}" · เหลือ ${progress.remainingCount} งวด ${fmt(progress.remainingAmount)} บาท`,
              oldValue: ins,
            }))
          }
          await refreshWallet()
          setInsDeleteTarget(null)
        })}
      />

      {/* ติ๊ก/ถอนเครื่องหมายรายแถว — ถามก่อนทั้งสองทาง ตามที่แบบกำหนดไว้
          ข้อความบอกชัดว่าไม่ตัดเงิน เพราะปุ่มติ๊กในบิลชวนให้เข้าใจว่าเป็นการจ่าย */}
      <ConfirmPopup
        open={!!markTarget}
        title={markTarget?.on ? 'ทำเครื่องหมายว่าตรวจแล้ว' : 'เอาเครื่องหมายถูกออก'}
        message={markTarget
          ? markTarget.on
            ? `"${markTarget.row.name}" ${fmt(Math.abs(markTarget.row.amount))} บาท · รายการนี้จะขึ้นเครื่องหมายถูก ยกเลิกทีหลังได้\n\nไม่ตัดเงินจากกระเป๋า — บิลบัตรจ่ายทั้งใบที่ปุ่ม "จ่ายบิล" เหมือนเดิม`
            : `"${markTarget.row.name}" · เครื่องหมายถูกของรายการนี้จะถูกเอาออก`
          : ''}
        onConfirm={() => run(async () => {
          const { row, on } = markTarget
          if (on) await markRow({ cardId, cycle: current?.cycle ?? null, rowKey: row.key })
          else await unmarkRow(row.key)
          setMarkTarget(null)
        })}
        onCancel={() => setMarkTarget(null)}
        confirmLabel={markTarget?.on ? 'ทำเครื่องหมาย' : 'เอาออก'}
      />
      <ConfirmPopup
        open={!!autopayTarget}
        title="ยืนยันว่าธนาคารหักบัญชีแล้ว"
        message={autopayTarget
          ? `บันทึกว่าธนาคารหัก ${fmt(autopayTarget.amount)} บาท จากบัญชีที่ผูกไว้ สำหรับบิลรอบ ${autopayTarget.statement.cycle}?\n\nเงินจะถูกตัดจากบัญชีในระบบทันที`
          : ''}
        onConfirm={handleAutopayConfirm}
        onCancel={() => setAutopayTarget(null)}
        confirmLabel="ยืนยัน"
      />
      <ConfirmPopup
        open={!!undoTarget}
        title="ย้อนการจ่ายบิล"
        message={undoTarget
          ? `คืนเงิน ${fmt(undoTarget.paidAmount)} บาท กลับเข้ากระเป๋า และเปลี่ยนบิลรอบ ${undoTarget.cycle} กลับเป็นยังไม่จ่าย?\nใช้เมื่อกดจ่ายผิดรายการ หรือโอนไม่สำเร็จ ระบบจะบันทึกการยกเลิกไว้ในประวัติทั้งหมด`
          : ''}
        onConfirm={handleUndoPay}
        onCancel={() => setUndoTarget(null)}
        confirmLabel="ย้อนรายการ"
        danger
      />
      <ConfirmPopup
        open={!!undoAdvanceTarget}
        title="ย้อนการกดเงินสด"
        message={undoAdvanceTarget
          ? `ย้อนการกดเงินสด ${fmt(undoAdvanceTarget.amount)} บาท — เงินจะถูกหักคืนจากกระเป๋าและยอดหนี้บัตรลดลง`
          : ''}
        onConfirm={handleUndoAdvance}
        onCancel={() => setUndoAdvanceTarget(null)}
        confirmLabel="ย้อนรายการ"
        danger
      />
    </div>
  )
}
