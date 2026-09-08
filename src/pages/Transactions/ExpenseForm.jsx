import { useState, useMemo, useRef, useEffect } from 'react'
import AmountInput from '../../components/shared/AmountInput'
import { format } from 'date-fns'
import { Link, useNavigate } from 'react-router-dom'
import DateNavigator from '../../components/shared/DateNavigator'
import DatePicker from '../../components/shared/DatePicker'
import EditableDropdown from '../../components/shared/EditableDropdown'
import CategorySelect from '../../components/shared/CategorySelect'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import FileUploadPopup from '../../components/shared/FileUploadPopup'
import TransferAccountPicker from '../../components/shared/TransferAccountPicker'
import CreditCardPicker, { formatCard } from '../../components/shared/CreditCardPicker'
import AppIcon from '../../components/shared/AppIcon'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import PayFromPicker from '../../components/shared/PayFromPicker'
import Icon from '../../components/shared/Icon'
import StepHeading from '../../components/shared/StepHeading'
import DebtFields, { EMPTY_DEBT, computeDebt, validateDebt } from '../../components/shared/DebtFields'
import useDebtStore from '../../store/useDebtStore'
import useWalletStore from '../../store/useWalletStore'
import useCreditCardStore from '../../store/useCreditCardStore'
import {
  nextDueDate, formatThaiDate, installmentSchedule, installmentTotal,
  tieredSchedule, scheduleTotal, validateTiers, normalizedTiers, tiersTotal, fitTiersToTotal,
  tiersFromAmounts, amountsFromTiers, maxPrepaidCount, latestPurchaseDateFor, toDateString,
} from '../../lib/cardCycle'
import InstallmentPips from '../../components/shared/InstallmentPips'
import PerInstallmentPopup from '../../components/shared/PerInstallmentPopup'
import BillTargetPopup from '../../components/shared/BillTargetPopup'
import useTransactionStore from '../../store/useTransactionStore'
import usePendingStore from '../../store/usePendingStore'
import useCategoryStore from '../../store/useCategoryStore'
import useRecurringStore from '../../store/useRecurringStore'
import { walletTarget } from '../../lib/api/transactions'
import { buildLogEntry } from '../../lib/logBuilder'
import useLogStore from '../../store/useLogStore'
import { useNegativeConfirm } from '../../hooks/useNegativeConfirm'
import { useFormDraft, DraftBanner } from '../../hooks/useFormDraft'
import { focusNextField } from '../../lib/formUx'
import useFormDefaults from '../../hooks/useFormDefaults'
import UiIcon from '../../components/shared/UiIcon'
import AmountNumpadPopup from '../../components/shared/AmountNumpadPopup'
import RecentItemsPopup from '../../components/shared/RecentItemsPopup'

// ปุ่มบวกยอดด่วน — เลขกลมที่ร้านค้าใช้บ่อย กดต่อกันได้ (100 + 100 = 200)
// สามค่าตามแบบ ของเดิมมีห้าค่าจนกินที่จนช่องยอดถูกบีบ
const QUICK_AMOUNTS = [100, 500, 1000]
// แป้นตัวเลขในตัวของจอมือถือ — เรียงตามแบบ (จุดทศนิยมกับลบอยู่แถวล่าง)
const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']

const EMPTY = {
  itemName: '', category: '', amount: '', method: 'cash', transferAccountId: '', pendingAccountId: '',
  cardId: '', installment: false, installmentMonths: '6', installmentRate: '0',
  // 'even' = หารเท่ากันทุกงวด, 'tiered' = ค่างวดตามโปรโมชั่น (ขั้นบันได)
  installmentMode: 'even',
  // เริ่มด้วยช่วงเดียวที่กินทุกงวด ผู้ใช้ค่อยกด "เพิ่มช่วงราคา" แบ่งเองตามโปรของบัตร
  installmentTiers: [{ from: 1, to: 6, amount: '' }],
  installmentPrepaid: false, installmentPrepaidCount: '',
  debt: { ...EMPTY_DEBT },
  vendor: '', receiptNo: '', taxStatus: 'none', dueDate: '', taxDueDate: '', note: ''
}

const MONTH_PRESETS = [3, 6, 10, 12]

const fmtBaht = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * ฟอร์มบันทึกรายจ่าย
 *
 * @param lockCardId ถ้าส่งมา = ฟอร์มนี้ถูกเปิดจากหน้าบัตร ช่องทางจ่ายถูกล็อกเป็น
 *                   บัตรใบนั้นและเลือกช่องทางอื่นไม่ได้ ที่เหลือ (ยอด หมวดหมู่ ผ่อน
 *                   ใบกำกับ ไฟล์แนบ) ทำงานเหมือนกันทุกอย่าง จะได้ไม่ต้องมีฟอร์มย่อ
 *                   อีกชุดที่ทำได้ไม่ครบแล้วต้องตามแก้สองที่ตลอดไป
 * @param onSaved    เรียกเมื่อบันทึกสำเร็จ (หน้าบัตรใช้ปิดป๊อปอัป)
 */
export default function ExpenseForm({ onPreviewChange, lockCardId = null, onSaved }) {
  const navigate = useNavigate()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  // ช่องทางจ่ายเริ่มต้นมาจากค่าที่ผู้ใช้ตั้งไว้ในหน้าตั้งค่า (เก็บในเครื่อง)
  const formDefaults = useFormDefaults()
  // แยกร่างของฟอร์มที่เปิดจากหน้าบัตรออกจากร่างของหน้าบันทึกรายการ
  // ไม่งั้นการเปิดป๊อปอัปจากหน้าบัตรจะทับสิ่งที่ผู้ใช้กรอกค้างไว้ในหน้าหลัก
  const [form, setForm, clearDraft, hasDraft] = useFormDraft(
    lockCardId ? `expense:card:${lockCardId}` : 'expense',
    lockCardId
      ? { ...EMPTY, method: 'card', cardId: lockCardId }
      : { ...EMPTY, method: formDefaults.method },
  )
  const [saved, setSaved] = useState(false)
  // ข้อความต่อท้าย "บันทึกสำเร็จ" เมื่อรายการถูกใส่เข้าบิลใบที่ออกไปแล้ว — รายการจะไม่โผล่
  // ในรอบบิลปัจจุบัน ถ้าไม่บอกว่าไปอยู่ไหน ผู้ใช้จะนึกว่ามันหาย
  const [savedNote, setSavedNote] = useState('')
  const [errMsg, setErrMsg] = useState('')
  // ระบบออนไลน์อย่างเดียว การบันทึกต้องรอผลจริงจากเซิร์ฟเวอร์ จึงต้องกันกดซ้ำระหว่างรอ
  const [saving, setSaving] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [numpadOpen, setNumpadOpen] = useState(false)
  const [tierEditOpen, setTierEditOpen] = useState(false)
  // ป๊อปอัปเลือกบิลปลายทางของยอดรูด — ขึ้นเมื่อบัตรมีบิลที่ปิดรอบแล้วแต่ยังไม่จ่าย
  // null = ปิด · { statements } = เปิดพร้อมรายการบิลให้เลือก
  const [billPick, setBillPick] = useState(null)
  // undefined = ยังไม่ได้ถาม · null = บิลรอบถัดไปตามปกติ · string = id ของบิลใบที่เลือก
  const billChoiceRef = useRef(undefined)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [attachments, setAttachments] = useState([])
  const { warning, check, proceed, cancel } = useNegativeConfirm()

  const { addTransaction } = useTransactionStore()
  const { addPending, addTaxInvoice } = usePendingStore()
  const {
    addVendor, updateVendor, softDeleteVendor, setVendorIcon,
    addQuickItem, updateQuickItem, softDeleteQuickItem,
    getVendors, getQuickItems, getCategoryFilterIds,
  } = useCategoryStore()
  const { addLog } = useLogStore()
  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)
  const refreshWallet = useWalletStore((s) => s.refresh)
  const resolveCard = useCreditCardStore((s) => s.resolveCardId)
  const refreshCards = useCreditCardStore((s) => s.refresh)
  const createInstallment = useCreditCardStore((s) => s.createInstallment)
  const cards = useCreditCardStore((s) => s.cards)
  const getUnpaidStatements = useCreditCardStore((s) => s.getUnpaidStatements)
  const attachTxToStatement = useCreditCardStore((s) => s.attachTransactionToStatement)
  const createDebt = useDebtStore((s) => s.createDebt)

  // สิ่งที่บันทึกลงเซิร์ฟเวอร์สำเร็จแล้วในรอบนี้ (รายการ / รายการค้าง) — ถ้าขั้นถัดไปล้ม
  // (เช่นสร้างการ์ดรอใบกำกับภาษีไม่สำเร็จ) ผู้ใช้กดบันทึกซ้ำได้โดยไม่สร้างรายการ
  // และตัดเงินซ้ำอีกรอบ ล้างเมื่อสำเร็จครบหรือเมื่อแก้ฟอร์ม
  const savedRef = useRef({ tx: null, pending: null, installment: null })

  const set = (k, v) => {
    savedRef.current = { tx: null, pending: null, installment: null }
    setForm((f) => ({ ...f, [k]: v }))
  }
  const setMany = (patch) => {
    savedRef.current = { tx: null, pending: null, installment: null }
    setForm((f) => ({ ...f, ...patch }))
  }

  // ร่างเก่าที่ค้างใน sessionStorage อาจถูกบันทึกไว้ตอนที่ยังไม่มีการล็อกบัตร
  // ถ้าปล่อยไว้ ฟอร์มจะโชว์ว่ารูดบัตรใบนี้แต่บันทึกจริงไปอีกช่องทาง
  useEffect(() => {
    if (!lockCardId) return
    if (form.method !== 'card' || form.cardId !== lockCardId) {
      setForm((f) => ({ ...f, method: 'card', cardId: lockCardId }))
    }
  }, [lockCardId, form.method, form.cardId]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * เปลี่ยนจำนวนงวดทั้งหมด แล้วตัดช่วงราคาที่เลยออกไปทิ้งทันที
   *
   * ถ้าไม่ตัดตรงนี้ ช่องเลขงวดจะยังค้างเลขเก่าที่เกินจำนวนงวดใหม่อยู่
   * (ตั้ง 12 งวดแล้วแบ่ง 1–6 / 7–12 พอลดเหลือ 6 งวด ช่องแรกยังเขียนว่า 6
   * แต่ช่วงหลังหายไปเงียบๆ) ผู้ใช้จะอ่านไม่ออกว่าตกลงระบบใช้ค่าไหน
   */
  const setInstallmentMonths = (v) => {
    savedRef.current = { tx: null, pending: null, installment: null }
    const m = Math.round(Number(v) || 0)
    setForm((f) => {
      const next = {
        ...f,
        installmentMonths: v,
        installmentTiers: m >= 1
          ? normalizedTiers(f.installmentTiers, m).map((t) => ({ ...t, to: String(t.to) }))
          : f.installmentTiers,
      }
      // เปลี่ยนจำนวนงวด = จำนวนงวดในแต่ละช่วงเปลี่ยน ยอดรวมจึงเปลี่ยนตามทันที
      return withTierSync(next, m)
    })
  }

  /**
   * ผูกช่องยอดเงินเข้ากับค่างวดขั้นบันได (ทิศทาง ค่างวด → ยอดรวม)
   *
   * โหมดนี้ยอดรวมเกิดจากค่างวด ไม่ใช่หารจากยอดรวม ช่องยอดเงินจึงต้องเป็น
   * ผลรวมของค่างวดเสมอ ไม่งั้นหน้าจอจะบอกสองยอดที่ขัดกันเอง (เคยเป็น: กรอก
   * ค่างวดครบแล้วแต่ช่องยอดยังเป็น 0 จนกดบันทึกไม่ผ่านเพราะ "กรุณาใส่จำนวนเงิน")
   *
   * เขียนทับให้เฉพาะตอนที่ค่างวดครบทุกช่วงแล้วเท่านั้น ระหว่างที่ยังกรอกไม่ครบ
   * ยอดที่ผู้ใช้พิมพ์ไว้ก่อนต้องอยู่เดิม เพราะเป็นตัวตั้งของการเกลี่ยกลับ
   */
  const withTierSync = (f, months) => {
    if (!f.installment || f.installmentMode !== 'tiered') return f
    const m = Math.max(1, Math.round(Number(months ?? f.installmentMonths) || 1))
    const rows = normalizedTiers(f.installmentTiers, m)
    if (rows.length === 0 || !rows.every((t) => Number(t.amount) > 0)) return f
    const total = tiersTotal(rows, m)
    return total > 0 ? { ...f, amount: String(total) } : f
  }

  const setTiers = (next) => {
    savedRef.current = { tx: null, pending: null, installment: null }
    setForm((f) => withTierSync({ ...f, installmentTiers: next }))
  }

  /** เกลี่ยยอดที่กรอกไว้ลงค่างวด (ทิศทาง ยอดรวม → ค่างวด) แล้วซิงค์ยอดกลับ */
  const spreadAmountToTiers = () => {
    savedRef.current = { tx: null, pending: null, installment: null }
    setForm((f) => {
      const m = Math.max(1, Math.round(Number(f.installmentMonths) || 1))
      const fitted = fitTiersToTotal(f.installmentTiers, m, Number(f.amount) || 0)
      if (!fitted) return f
      // ค่างวดต่องวดในช่วงเดียวกันต้องเท่ากัน ผลรวมหลังปัดจึงอาจต่างจากยอดที่กรอก
      // ไม่กี่สตางค์ — ยึดผลรวมจากค่างวดเป็นยอดจริง ช่องยอดเงินตามมาให้ตรงกัน
      return withTierSync({ ...f, installmentTiers: fitted.map((t) => ({ ...t, to: String(t.to) })) }, m)
    })
  }

  const logVendorAdd = async (name) => {
    const item = await addVendor(name)
    await addLog(buildLogEntry({ activityType: 'VENDOR_CREATE', description: `สร้างผู้ขาย "${name}"`, newValue: item }))
    return item
  }

  const logVendorUpdate = async (id, name) => {
    const oldItem = getVendors().find((item) => item.id === id)
    await updateVendor(id, name)
    await addLog(buildLogEntry({ activityType: 'VENDOR_UPDATE', description: `แก้ไขผู้ขาย "${oldItem?.name ?? id}" → "${name}"`, oldValue: oldItem, newValue: { id, name } }))
  }

  const logVendorDelete = async (id) => {
    const oldItem = getVendors().find((item) => item.id === id)
    await softDeleteVendor(id)
    await addLog(buildLogEntry({ activityType: 'VENDOR_DELETE', description: `ลบผู้ขาย "${oldItem?.name ?? id}"`, oldValue: oldItem }))
  }

  const logQuickItemAdd = async (name, categoryId) => {
    const item = await addQuickItem(name, categoryId)
    await addLog(buildLogEntry({ activityType: 'QUICK_ITEM_CREATE', description: `สร้างรายการด่วน "${name}"`, newValue: item }))
    return item
  }

  const logQuickItemUpdate = async (id, changes) => {
    const oldItem = getQuickItems().find((item) => item.id === id)
    await updateQuickItem(id, changes)
    await addLog(buildLogEntry({ activityType: 'QUICK_ITEM_UPDATE', description: `แก้ไขรายการด่วน "${oldItem?.name ?? id}"`, oldValue: oldItem, newValue: { ...oldItem, ...changes } }))
  }

  const logQuickItemDelete = async (id) => {
    const oldItem = getQuickItems().find((item) => item.id === id)
    await softDeleteQuickItem(id)
    await addLog(buildLogEntry({ activityType: 'QUICK_ITEM_DELETE', description: `ลบรายการด่วน "${oldItem?.name ?? id}"`, oldValue: oldItem }))
  }

  const execute = async () => {
    if (saving) return
    const amt = Number(form.amount)
    const accountId = form.method === 'transfer' ? resolveAccount(form.transferAccountId) : null
    const cardId = form.method === 'card' ? resolveCard(form.cardId) : null
    const months = Math.max(1, Math.round(Number(form.installmentMonths) || 0))
    const isInstallment = form.method === 'card' && form.installment && !!selectedCard
    let tx = null

    setSaving(true)
    setErrMsg('')
    try {
    if (form.method === 'pending' && savedRef.current.pending) {
      // รายการค้างถูกสร้างไปแล้วในรอบก่อน (ล้มที่ขั้นถัดไป) — ข้ามไปทำขั้นที่เหลือ
    } else if (form.method === 'pending') {
      const missingDueDateNote = form.dueDate ? '' : 'ไม่ได้ลงกำหนดชำระเงิน'
      const pending = await addPending({
        amount: amt,
        dueDate: form.dueDate || date,
        description: form.itemName,
        itemName: form.itemName,
        category: form.category,
        vendor: form.vendor,
        receiptNo: form.receiptNo,
        taxStatus: form.taxStatus,
        openDate: date,
        note: [form.note, missingDueDateNote].filter(Boolean).join('\n'),
        missingDueDate: !form.dueDate,
        // ผูกบัญชีไว้ล่วงหน้า เวลากดชำระจะตัดจากบัญชีนี้ทันที
        ...(form.pendingAccountId ? { defaultTransferAccountId: form.pendingAccountId } : {}),
        ...(attachments.length > 0 ? {
          attachments,
          documentPath: attachments[0].path,
          documentType: attachments[0].type,
          documentLabel: attachments[0].label,
        } : {}),
      })
      await addLog(buildLogEntry({
        activityType: 'OPEN_BILL',
        description: `เปิดบิลรอจ่ายเงิน: "${form.itemName}" ${amt.toLocaleString()} บาท (วันที่เปิด: ${date}) ครบกำหนด: ${form.dueDate || date}${missingDueDateNote ? ` (${missingDueDateNote})` : ''}`,
        newValue: { pendingId: pending.id, itemName: form.itemName, amount: amt, dueDate: form.dueDate || date, openDate: date, missingDueDate: !form.dueDate },
        walletEffect: null,
      }))
      savedRef.current.pending = pending
    } else if (form.method === 'debt' && savedRef.current.installment) {
      // หนี้สินถูกสร้างไปแล้วในรอบก่อน — ห้ามสร้างซ้ำ
    } else if (form.method === 'debt') {
      // กู้ยืม: บันทึกเป็นหนี้สินที่มีตารางงวด ยังไม่สร้างรายจ่ายและยังไม่ขยับเงิน
      // เงินจะขยับตอนกดจ่ายทีละงวด ซึ่งตอนนั้นค่อยเป็นรายจ่ายจริง
      const v = { ...form.debt, name: form.itemName }
      const calc = computeDebt(v)
      if (!calc) throw new Error('ข้อมูลหนี้สินยังไม่ครบ')
      const isRecv = v.direction === 'receivable'
      const debt = await createDebt({
        direction: v.direction, name: form.itemName, counterparty: v.counterparty.trim(),
        categoryId: form.category || null, note: form.note,
        principalAmount: calc.principal, totalAmount: calc.total, months: calc.months,
        monthlyAmount: calc.monthly, interestRate: v.mode === 'calc' ? Number(v.rate) || 0 : 0,
        prepaidCount: calc.prepaidCount, firstDue: toDateString(calc.firstDue), dueDay: calc.dueDay, term: calc.term,
        defaultMethod: v.method, defaultAccountId: v.method === 'transfer' ? v.accountId : null,
      }, calc.rows, buildLogEntry({
        activityType: 'DEBT_CREATE',
        description:
          `${isRecv ? 'ให้ยืม' : 'เพิ่มหนี้'} "${form.itemName}" ${calc.total.toLocaleString()} บาท ${calc.months} งวด งวดละ ${calc.monthly.toLocaleString()}` +
          (calc.prepaidCount ? ` · ผ่อนมาแล้ว ${calc.prepaidCount} งวด` : ''),
        newValue: { debtId: debt.id, name: form.itemName, direction: v.direction, total: calc.total, months: calc.months },
      }))
      savedRef.current.installment = debt
    } else if (isInstallment && savedRef.current.installment) {
      // สัญญาผ่อนถูกสร้างไปแล้วในรอบก่อน — ห้ามสร้างซ้ำ
    } else if (isInstallment) {
      // ผ่อน: ยังไม่สร้างรายจ่ายและยังไม่ขยับหนี้ บันทึกแค่สัญญากับตารางงวด
      // งวดจะกลายเป็นรายจ่ายทีละงวดตอนปิดรอบ เพราะเงินไหลออกจริงทีละงวด
      //
      // ช่องจำนวนเงินคือราคาสินค้า ส่วนยอดที่ผ่อนจริงคือราคาบวกดอกเบี้ยแบบคงที่
      // ผลรวมของทุกงวดจึงเท่ากับ total ไม่ใช่ราคาสินค้า ซึ่งตรงกับเงินที่ไหลออกจริง
      //
      // โหมดขั้นบันได ยอดรวมถูกกำหนดโดยค่างวดที่กรอก ไม่ได้หารจากราคาสินค้า
      const buyDate = new Date(date + 'T00:00:00')
      const tiers = form.installmentMode === 'tiered'
        ? normalizedTiers(form.installmentTiers, months).map((t) => ({ ...t, amount: Number(t.amount) || 0 }))
        : null
      const schedule = tiers
        ? tieredSchedule(selectedCard, buyDate, months, tiers)
        : installmentSchedule(selectedCard, buyDate, months, installmentTotal(amt, months, Number(form.installmentRate) || 0).total)
      const money = tiers
        ? { principal: scheduleTotal(schedule), interest: 0, total: scheduleTotal(schedule), ratePerMonth: 0 }
        : installmentTotal(amt, months, Number(form.installmentRate) || 0)
      const prepaidCount = installmentPreview?.prepaidCount ?? 0

      const ins = await createInstallment(cardId, {
        name: form.itemName,
        vendor: form.vendor,
        categoryId: form.category || null,
        note: form.note,
        principalAmount: money.principal,
        totalAmount: money.total,
        months,
        monthlyAmount: schedule[prepaidCount]?.amount ?? schedule[0].amount,
        interestRate: money.ratePerMonth,
        tiers,
        prepaidCount,
        purchaseDate: date,
      }, schedule, buildLogEntry({
        activityType: 'INSTALLMENT_CREATE',
        description:
          `ผ่อน "${form.itemName}" ${months} งวด รวม ${money.total.toLocaleString()} บาท ` +
          (tiers
            ? `แบบขั้นบันได ${tiers.length} ช่วง (${tiers.map((t) => `งวด ${t.from}-${t.to} ละ ${t.amount.toLocaleString()}`).join(', ')})`
            : money.interest > 0
              ? `ดอกเบี้ย ${money.ratePerMonth}% ต่อเดือน งวดละ ${schedule[0].amount.toLocaleString()} บาท`
              : `ผ่อน 0% งวดละ ${schedule[0].amount.toLocaleString()} บาท`) +
          (prepaidCount > 0 ? ` · ผ่อนมาก่อนแล้ว ${prepaidCount} งวด` : ''),
        newValue: {
          itemName: form.itemName,
          principal: money.principal,
          interest: money.interest,
          total: money.total,
          ratePerMonth: money.ratePerMonth,
          tiers, prepaidCount,
          months, cardId, date,
        },
      }))
      savedRef.current.installment = ins
      await refreshCards()
    } else if (savedRef.current.tx) {
      // รายการถูกบันทึกและตัดเงินไปแล้วในรอบก่อน — ห้ามสร้างซ้ำ
      tx = savedRef.current.tx
    } else {
      // บันทึกรายการ + ตัดเงิน + เขียน log จบในคำสั่งเดียวที่ฐานข้อมูล
      // ถ้าแยกยิงแล้วเน็ตหลุดกลางทาง จะได้รายการที่ไม่ตัดเงิน หรือเงินหายโดยไม่มีรายการ
      const target = walletTarget(form.method, { transferAccountId: accountId, cardId })
      tx = await addTransaction({
        date, type: 'expense', amount: amt,
        method: form.method, category: form.category, itemName: form.itemName,
        ...(accountId ? { transferAccountId: accountId } : {}),
        ...(cardId ? { cardId } : {}),
        vendor: form.vendor, receiptNo: form.receiptNo, taxStatus: form.taxStatus,
        dueDate: null, note: form.note,
        ...(attachments.length > 0 ? {
          attachments,
          documentPath: attachments[0].path,
          documentType: attachments[0].type,
          documentLabel: attachments[0].label,
        } : {}),
      }, {
        effect: target ? { target, delta: -amt } : null,
        log: buildLogEntry({
          activityType: 'ADD_EXPENSE',
          description: `จ่าย "${form.itemName}" ${amt.toLocaleString()} บาท`,
          walletEffect: target ? { target: form.method, delta: -amt, transferAccountId: accountId, cardId } : null,
          newValue: { itemName: form.itemName, amount: amt, method: form.method, date, ...(cardId ? { cardId } : {}) },
        }),
      })
      savedRef.current.tx = tx
      // ยอดถูกแก้ที่เซิร์ฟเวอร์ ต้องดึงค่าจริงมาแสดง ไม่คำนวณเองเพราะอาจมีคนอื่นแก้พร้อมกัน
      // รูดบัตรไม่แตะเงินสด/เงินโอน แต่ไปเพิ่มหนี้ในบัตร จึงต้องดึงคนละชุดกัน
      if (cardId) await refreshCards()
      else await refreshWallet()
    }

    // ผู้ใช้บอกว่ารายการนี้อยู่ในบิลใบที่ออกไปแล้ว — ใส่เข้าใบนั้น ยอดบิลบวกเพิ่มทันที
    // ทำหลังบันทึกรายการเสร็จ ถ้าล้มตรงนี้ รายการยังอยู่ (savedRef) กดบันทึกซ้ำจะมาต่อที่นี่
    if (tx && cardId && billChoiceRef.current) {
      const target = getUnpaidStatements().find((s) => s.id === billChoiceRef.current)
      await attachTxToStatement(tx.id, billChoiceRef.current)
      setSavedNote(
        target
          ? `ใส่เข้าบิลที่ครบกำหนด ${formatThaiDate(new Date(`${target.dueDate}T00:00:00`))} แล้ว — ดูได้ในกล่อง "ยอดที่ต้องชำระ" ของหน้าบัตร ไม่อยู่ในรอบบิลปัจจุบัน`
          : 'ใส่เข้าบิลที่ออกไปแล้วเรียบร้อย'
      )
      await addLog(buildLogEntry({
        activityType: 'CARD_STATEMENT_ATTACH',
        description: `ใส่ "${form.itemName}" ${amt.toLocaleString()} บาท เข้าบิลที่ออกไปแล้วของบัตร`,
        newValue: { transactionId: tx.id, statementId: billChoiceRef.current, cardId },
      }))
    }

    if (form.taxStatus === 'waiting') {
      const tax = await addTaxInvoice({
        ...(tx ? { transactionId: tx.id } : {}),
        itemName: form.itemName,
        receiptNo: form.receiptNo,
        amount: amt,
        dueDate: form.taxDueDate || null,
        createdAt: new Date(date + 'T00:00:00').toISOString(),
      })
      await addLog(buildLogEntry({
        activityType: 'CREATE_TAX_INVOICE',
        description: `สร้างรายการรอใบกำกับภาษี "${form.itemName}" ${amt.toLocaleString()} บาท`,
        newValue: { ...tax, ...(tx ? { transactionId: tx.id } : {}) },
      }))
    }

    savedRef.current = { tx: null, pending: null, installment: null }
    // "บันทึกแล้วเปิดฟอร์มใหม่" ปิดอยู่ = เก็บสิ่งที่เพิ่งกรอกค้างไว้ให้ดู
    // เปิดอยู่ = ล้างฟอร์มให้กรอกรายการถัดไปต่อได้เลย (ค่าตั้งต้นคือเปิด)
    if (formDefaults.reopenAfterSave) clearDraft()
    setSaved(true)
    // รายการถัดไปต้องถูกถามใหม่ ไม่ใช่จำคำตอบของรายการก่อน
    billChoiceRef.current = undefined
    onSaved?.()
    setUploadStatus(null)
    setAttachments([])
    // ข้อความบอกว่ารายการไปอยู่บิลใบไหน ต้องอยู่นานพอให้อ่าน ไม่ใช่วูบเดียวเหมือนติ๊กถูก
    setTimeout(() => setSaved(false), 2000)
    setTimeout(() => setSavedNote(''), 8000)
    } catch (err) {
      // ยังไม่ล้างฟอร์ม ผู้ใช้จะได้กดบันทึกซ้ำได้โดยไม่ต้องกรอกใหม่
      // (ขั้นที่สำเร็จไปแล้วจะถูกข้าม ไม่สร้างรายการหรือตัดเงินซ้ำ)
      setErrMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => {
    if (!form.itemName) return setErrMsg('กรุณาใส่รายการจ่าย')
    // กู้ยืมไม่ใช้ช่องจำนวนเงินของฟอร์ม ยอดอยู่ในส่วนหนี้สิน และไม่ต้องเช็คยอดติดลบ
    if (form.method === 'debt') {
      const v = { ...form.debt, name: form.itemName }
      const err = validateDebt(v, computeDebt(v))
      if (err) return setErrMsg(err)
      setErrMsg('')
      execute()
      return
    }
    // โหมดค่างวดตามโปรฯ ยอดเงินมาจากค่างวด ช่องยอดว่างแปลว่าค่างวดยังกรอกไม่ครบ
    // บอกให้ไปกรอกค่างวด ไม่ใช่ไล่ให้กรอกช่องที่ระบบเป็นคนเติมเอง
    if (!form.amount || Number(form.amount) <= 0) {
      return setErrMsg(tieredSync ? 'กรอกยอดต่องวดให้ครบทุกช่วง ระบบจะรวมเป็นยอดเงินให้เอง' : 'กรุณาใส่จำนวนเงิน')
    }
    if (form.method === 'transfer' && !resolveAccount(form.transferAccountId)) {
      return setErrMsg('กรุณาเลือกบัญชีที่จะจ่ายเงินโอน')
    }
    if (form.method === 'card' && !resolveCard(form.cardId)) {
      return setErrMsg('กรุณาเลือกบัตรเครดิตที่ใช้รูด')
    }
    if (form.method === 'card' && form.installment) {
      const m = Math.round(Number(form.installmentMonths) || 0)
      if (!(m >= 1) || m > 120) return setErrMsg('จำนวนงวดต้องอยู่ระหว่าง 1 ถึง 120')
      if (form.installmentMode === 'tiered') {
        const tiers = normalizedTiers(form.installmentTiers, m)
        const err = validateTiers(tiers, m)
        if (err) return setErrMsg(err)
        if (!tiers.every((t) => Number(t.amount) > 0)) return setErrMsg('กรอกยอดต่องวดให้ครบทุกช่วงราคา')
        // ยอดบนหัวรายการกับผลรวมค่างวดต้องเป็นตัวเลขเดียวกัน ไม่งั้นใบเดียวกัน
        // จะอ่านได้สองยอด ปกติซิงค์ให้อัตโนมัติอยู่แล้ว จะไม่ตรงได้ก็ต่อเมื่อ
        // ผู้ใช้มาแก้ช่องยอดเงินทีหลัง — ให้เลือกเองว่าจะยึดฝั่งไหน
        if (tieredSync && !tieredSync.matched) {
          return setErrMsg(
            `ยอดเงินยังไม่ตรงกับค่างวด — ช่องยอดเงิน ${fmtBaht(tieredSync.amount)} แต่ค่างวดรวมได้ ` +
            `${fmtBaht(tieredSync.total)} บาท กดปุ่มซิงค์ในส่วนผ่อนชำระก่อน`
          )
        }
      }
      // งวดที่บอกว่าจ่ายมาแล้วต้องครบกำหนดไปแล้วจริง ไม่งั้นยอดคงเหลือจะผิดตั้งแต่ต้น
      if (installmentPreview?.prepaidOver) {
        return setErrMsg(
          `วันเปิดบิลย้อนหลังไม่พอ ระบุว่าจ่ายมาแล้วได้มากสุด ${installmentPreview.maxPrepaid} งวด` +
          (installmentPreview.suggestDate
            ? ` — เลือกวันเปิดบิลไม่เกิน ${formatThaiDate(installmentPreview.suggestDate)}`
            : '')
        )
      }
    }
    setErrMsg('')

    // รูดบัตรตอนที่บัตรมีบิลปิดรอบแล้วแต่ยังไม่จ่าย → ถามก่อนว่ารายการนี้อยู่ในบิลใบไหน
    // (คนที่เปิดบิลจริงมาคีย์ตาม จะได้ใส่เข้าใบที่กำลังจะจ่าย ไม่ใช่ไหลไปรอบหน้าเงียบๆ)
    // ยอดผ่อนไม่ถาม เพราะงวดถูกวางลงบิลตามตารางของมันเองอยู่แล้ว
    if (form.method === 'card' && !form.installment && billChoiceRef.current === undefined) {
      const cid = resolveCard(form.cardId)
      const issued = getUnpaidStatements().filter((s) => s.cardId === cid)
      if (issued.length > 0) return setBillPick({ statements: issued })
    }

    // บัตรเครดิตไม่ต้องเช็คยอดติดลบ — เป็นหนี้อยู่แล้วโดยธรรมชาติ และไม่บล็อกเรื่องวงเงิน
    if (form.method === 'pending' || form.method === 'card') {
      execute()
    } else {
      check({
        method: form.method,
        amount: Number(form.amount),
        accountId: form.transferAccountId,
        onConfirm: execute,
      })
    }
  }

  const vendorList = getVendors()
  const quickList = getQuickItems()

  // บัตรที่จะถูกใช้จริง — เผื่อกรณีมีใบเดียวแล้ว picker ยังไม่ทันเซ็ตค่าให้
  const selectedCard = form.method === 'card'
    ? cards.find((c) => c.id === resolveCard(form.cardId)) ?? null
    : null

  // ตัวอย่างตารางผ่อน คำนวณสดขณะพิมพ์ ผู้ใช้จะได้เห็นยอดต่องวดก่อนกดบันทึก
  // ช่องจำนวนเงินคือ "ราคาสินค้า" ส่วนยอดที่ผ่อนจริงคือราคาบวกดอกเบี้ย
  const installmentPreview = (() => {
    if (!form.installment || !selectedCard) return null
    const m = Math.round(Number(form.installmentMonths) || 0)
    if (!(m >= 1) || m > 120) return null
    const buyDate = new Date(date + 'T00:00:00')

    let rows, money, tierError = null
    if (form.installmentMode === 'tiered') {
      // ยอดรวมถูกกำหนดโดยค่างวด ไม่ใช่หารจากยอดรวม จึงไม่มีเศษให้ปัด
      const tiers = normalizedTiers(form.installmentTiers, m)
      tierError = validateTiers(tiers, m)
      if (tierError) return { invalid: true, months: m, tierError }
      if (!tiers.every((t) => Number(t.amount) > 0)) return null
      rows = tieredSchedule(selectedCard, buyDate, m, tiers)
      const total = scheduleTotal(rows)
      money = { principal: total, interest: 0, total, ratePerMonth: 0, months: m }
    } else {
      const principal = Number(form.amount)
      const rate = Number(form.installmentRate) || 0
      if (!(principal > 0) || rate < 0) return null
      money = installmentTotal(principal, m, rate)
      rows = installmentSchedule(selectedCard, buyDate, m, money.total)
    }

    const first = rows[0]
    const last = rows[rows.length - 1]

    // งวดที่บอกว่าจ่ายมาแล้ว ต้องเป็นงวดที่ครบกำหนดไปแล้วจริงเมื่อนับจากวันเปิดบิล
    const maxPrepaid = Math.min(maxPrepaidCount(selectedCard, buyDate), m)
    const wantPrepaid = form.installmentPrepaid
      ? Math.max(0, Math.round(Number(form.installmentPrepaidCount) || 0))
      : 0
    const prepaidOver = wantPrepaid > maxPrepaid
    const suggestDate = prepaidOver ? latestPurchaseDateFor(selectedCard, wantPrepaid) : null
    const prepaidCount = prepaidOver ? 0 : wantPrepaid

    const remainingRows = rows.slice(prepaidCount)
    return {
      ...money,
      rows, first, last,
      hasRemainder: rows.length > 1 && last.amount !== first.amount,
      maxPrepaid, wantPrepaid, prepaidOver, suggestDate, prepaidCount,
      paidAlready: scheduleTotal(rows.slice(0, prepaidCount)),
      remainingTotal: scheduleTotal(remainingRows),
      nextRow: remainingRows[0] ?? null,
      tierError,
    }
  })()

  /**
   * สถานะการซิงค์ระหว่างช่องยอดเงินกับค่างวดขั้นบันได
   *
   * ไม่ต้องรอเลือกบัตรเหมือน installmentPreview เพราะช่องยอดเงินอยู่ขั้นที่ 1
   * ส่วนช่องบัตรอยู่ขั้นที่ 3 ถ้ารอบัตร ผู้ใช้จะกรอกค่างวดแล้วไม่เห็นยอดรวมเลย
   */
  const tieredSync = (() => {
    if (!form.installment || form.installmentMode !== 'tiered') return null
    const months = Math.max(1, Math.round(Number(form.installmentMonths) || 1))
    const rows = normalizedTiers(form.installmentTiers, months)
    const filled = rows.length > 0 && rows.every((t) => Number(t.amount) > 0)
    const total = tiersTotal(rows, months)
    const amount = Number(form.amount) || 0
    const diff = Math.round((amount - total) * 100) / 100
    return {
      months, rows, filled, total, amount, diff,
      // ต่างกันไม่ถึงครึ่งสตางค์ = ตรงกันแล้ว (เศษจากการปัดค่างวด)
      matched: filled && Math.abs(diff) < 0.005,
      canSpread: amount > 0 && !!fitTiersToTotal(form.installmentTiers, months, amount),
    }
  })()

  /**
   * วันครบกำหนดของทุกงวด คิดจากบัตรกับวันเปิดบิลอย่างเดียว
   *
   * installmentPreview ต้องรอค่างวดครบก่อนถึงจะมีตารางให้ดู แต่ช่วงที่ยังกรอกอยู่
   * คือช่วงที่อยากเห็นวันที่มากที่สุด (จะได้รู้ว่างวดถัดไปตกเดือนไหน) จึงคิดแยก
   */
  const installmentDates = (() => {
    if (!form.installment || !selectedCard) return null
    const m = Math.round(Number(form.installmentMonths) || 0)
    if (!(m >= 1) || m > 120) return null
    const buyDate = new Date(date + 'T00:00:00')
    return {
      rows: tieredSchedule(selectedCard, buyDate, m, [{ from: 1, to: m, amount: 0 }]),
      maxPaid: Math.min(maxPrepaidCount(selectedCard, buyDate), m),
    }
  })()

  const recurringAllItems = useRecurringStore((s) => s.items)
  const recurringEntries = useRecurringStore((s) => s.entries)
  const currentMonth = format(new Date(), 'yyyy-MM')
  const matchingRecurring = useMemo(() => {
    if (!form.category) return null
    // เลือกหมวดหมู่หลัก → เตือนถึงรายการประจำที่อยู่ในหมวดหมู่ย่อยข้างในด้วย
    const scope = new Set(getCategoryFilterIds(form.category))
    const pendingThisMonth = recurringEntries.filter(
      (e) => e.month === currentMonth && e.status === 'pending'
    )
    for (const entry of pendingThisMonth) {
      const item = recurringAllItems.find((it) => it.id === entry.recurringId && scope.has(it.category))
      if (item) return item
    }
    return null
  }, [form.category, recurringAllItems, recurringEntries, currentMonth])

  // ส่งสถานะฟอร์มให้แผง "ก่อนกดบันทึก" ข้างขวารู้ว่ากดแล้วยอดไหนจะขยับเท่าไร
  useEffect(() => {
    onPreviewChange?.({
      type: 'expense',
      method: form.method,
      amount: Number(form.amount) || 0,
      accountId: form.transferAccountId,
      cardId: form.cardId,
      recurringName: matchingRecurring?.name ?? null,
    })
  }, [form.method, form.amount, form.transferAccountId, form.cardId, matchingRecurring, onPreviewChange])

  // ทุก taxStatus → upload ใบเสร็จ ยกเว้น 'received' → upload ใบกำกับภาษี
  const isTaxUpload = form.taxStatus === 'received'

  // กางส่วนรายละเอียดให้เองเมื่อมีค่ากรอกไว้แล้ว (เช่นกู้ร่างเดิมกลับมา)
  const hasMoreValues = !!(form.vendor || form.receiptNo || form.note || attachments.length > 0
    || (form.taxStatus && form.taxStatus !== 'none'))
  const [moreOpen, setMoreOpen] = useState(hasMoreValues)
  const [recentsOpen, setRecentsOpen] = useState(false)
  const moreSummary = [
    form.vendor && 'ผู้ขาย',
    form.receiptNo && 'เลขที่ใบเสร็จ',
    form.taxStatus && form.taxStatus !== 'none' && 'ใบกำกับภาษี',
    attachments.length > 0 && `${attachments.length} ไฟล์`,
    form.note && 'หมายเหตุ',
  ].filter(Boolean).join(' · ') || 'ไม่ได้กรอก 5 ช่อง — ไม่กรอกก็บันทึกได้'

  // สถานะของแต่ละขั้นตอน — ช่องทางจ่ายบางแบบยังต้องเลือกต่อ (บัญชีไหน บัตรใบไหน)
  // จึงยังไม่นับว่าเสร็จจนกว่าจะเลือกครบ
  const payReady = form.method === 'transfer' ? !!resolveAccount(form.transferAccountId)
    : form.method === 'card' ? !!resolveCard(form.cardId)
    : form.method === 'debt' ? !!(form.debt?.months && form.debt?.monthly)
    : true
  const stepDone = [
    Number(form.amount) > 0 || form.method === 'debt',
    !!form.itemName.trim(),
    payReady,
    hasMoreValues,
  ]
  const nextStep = stepDone.findIndex((d, i) => !d && i < 3)

  const handleUploadDone = (savedPath) => {
    setUploadOpen(false)
    if (savedPath) {
      const paths = Array.isArray(savedPath) ? savedPath : [savedPath]
      const nextAttachments = paths.map((path, index) => ({
        path,
        type: isTaxUpload ? 'taxinvoice' : 'receipt',
        label: `${isTaxUpload ? 'ใบกำกับภาษี' : 'ใบเสร็จ'}${paths.length > 1 ? ` ${index + 1}` : ''}`,
        uploadedAt: new Date().toISOString(),
      }))
      setAttachments(nextAttachments)
      setUploadStatus(`✓ อัปโหลดเสร็จสิ้น — ${paths.length > 1 ? `${paths.length} ไฟล์` : paths[0]}`)
      addLog(buildLogEntry({
        activityType: isTaxUpload ? 'UPLOAD_TAX_INVOICE_FILE' : 'UPLOAD_RECEIPT',
        description: `อัปโหลด${isTaxUpload ? 'ไฟล์ใบกำกับภาษี' : 'ใบเสร็จ'}สำหรับรายจ่าย "${form.itemName || 'ยังไม่ระบุ'}"`,
        newValue: { savedPath: paths[0], savedPaths: paths, itemName: form.itemName, date, docType: isTaxUpload ? 'taxinvoice' : 'receipt' },
      }))
    }
  }

  /**
   * แป้นตัวเลขบนมือถือ — โผล่จากขอบล่างเหมือนคีย์บอร์ดของเครื่อง ไม่ต้องเปิดป๊อปอัป
   * เปิดไว้ตั้งแต่แรกเพราะยอดเงินคือช่องแรกที่กรอกเสมอ กด Enter บนแป้น (หรือปุ่มแป้นในช่องยอด) เพื่อพับเก็บ
   */
  // ในป๊อปอัปจากหน้าบัตรพื้นที่จำกัด แป้นสูงเกือบ 300px จะกินครึ่งจอจนไม่เห็นฟอร์ม
  // เปิดเองได้จากปุ่มแป้นในช่องยอด — บนหน้าบันทึกรายการเต็มหน้าเปิดไว้เหมือนเดิม
  const [padOpen, setPadOpen] = useState(!lockCardId)
  const isMobile = () => window.matchMedia('(max-width: 1023px)').matches
  const pressPad = (k) => {
    const cur = String(form.amount ?? '')
    if (k === '⌫') return set('amount', cur.slice(0, -1))
    if (k === '.') return cur.includes('.') ? undefined : set('amount', (cur || '0') + '.')
    if (cur.includes('.') && cur.split('.')[1].length >= 2) return
    set('amount', cur === '0' ? k : cur + k)
  }
  const amountLabel = Number(form.amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ข้อความหลังกดบันทึก — ใช้ทั้งใต้ปุ่มบันทึกมือถือและในแถบบันทึกจอใหญ่
  const saveStatus = (
    <>
      {saved && <span className="text-income text-sm font-medium">✓ บันทึกสำเร็จ</span>}
      {savedNote && (
        <span className="block w-full text-[12px] text-[#A93A2E] bg-expense-soft border border-[#F0C4BE] rounded-ctl px-3 py-1.5">
          {savedNote}
        </span>
      )}
      {errMsg && <span className="block text-expense text-sm">{errMsg}</span>}
    </>
  )

  return (
    <>
      {/* data-form-scope = ขอบเขตของ "ช่องถัดไป" ตอนกด Enter (ดู focusNextField) */}
      <div data-form-scope className="p-4 sm:p-5 space-y-4">
        <DraftBanner hasDraft={hasDraft} onClear={clearDraft} />
        <DateNavigator date={date} onChange={setDate} />

        {/* ยอดเงินอยู่บนสุดและตัวใหญ่ที่สุด — เป็นค่าที่ต้องกรอกเสมอและกรอกก่อนเพื่อนจริง
            ปุ่มยอดด่วนไว้สำหรับรายจ่ายซ้ำๆ ที่เป็นเลขกลม จะได้ไม่ต้องพิมพ์ทุกครั้ง */}
        {form.method !== 'debt' && (
          <div>
            <StepHeading
              n={1}
              title="ใส่จำนวนเงิน"
              hint="กดปุ่มยอดด่วนหรือแป้นตัวเลขก็ได้"
              done={stepDone[0]}
              current={nextStep === 0}
            />
          <div className="flex items-end gap-3.5 flex-wrap">
            <div className="flex-none w-full sm:w-[262px]">
              <label className="sr-only">จำนวนเงิน (บาท)</label>
              {/* ขีดสีมะนาวคั่นระหว่างตัวเลขกับหน่วย ทำให้ตาแยกยอดออกจากคำว่า "บาท" ได้ทันที
                  ปุ่มแป้นตัวเลขอยู่ในช่องเลย เพราะเป็นทางที่คนกรอกยอดหลายใบเสร็จใช้บ่อย
                  (มือถือปุ่มนี้พับ/กางแป้นในแถบล่าง จอใหญ่เปิดป๊อปอัป) */}
              <div className="h-[54px] lg:h-[46px] border border-ink shadow-[0_0_0_1px_#16181D] rounded-ctl bg-white flex items-center gap-[7px] pl-3.5 pr-1.5">
                {/* เปิดหน้ามาแล้วพิมพ์ยอดได้เลย ไม่ต้องคลิกก่อน — ยอดเงินคือช่องแรกเสมอ
                    เฉพาะจอใหญ่ เพราะบนมือถือการโฟกัสจะดันคีย์บอร์ดของเครื่องขึ้นมา
                    ทับแป้นตัวเลขของแอปที่กางอยู่แล้ว กลายเป็นแป้นซ้อนแป้น
                    Enter = ไปช่องถัดไป (ชื่อรายการ) พิมพ์รวดเดียวจบไม่ต้องละมือไปจับเมาส์ */}
                <AmountInput
                  className="flex-1 min-w-0 border-none outline-none bg-transparent text-[26px] lg:text-[21px] font-semibold tabular-nums tracking-[-0.01em] p-0 h-auto"
                  value={form.amount}
                  onChange={(e) => set('amount', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey) return
                    e.preventDefault()
                    focusNextField(e.currentTarget)
                  }}
                  autoFocus={!isMobile()}
                  placeholder="0"
                />
                <span className="w-0.5 h-5 bg-lime block flex-none" />
                <span className="flex-none text-[12.5px] text-faint">บาท</span>
                <button
                  type="button"
                  onClick={() => (isMobile() ? setPadOpen((v) => !v) : setNumpadOpen(true))}
                  title="เปิดแป้นตัวเลข"
                  className={`flex-none w-[38px] h-[38px] lg:w-[34px] lg:h-[34px] rounded-[9px] flex items-center justify-center hover:bg-hairline ${
                    padOpen ? 'bg-lime lg:bg-paper' : 'bg-paper'
                  }`}
                >
                  <UiIcon name="numpad" size={17} />
                </button>
              </div>
              {/* ผ่อนแบบค่างวดตามโปรฯ ยอดนี้ไม่ได้พิมพ์เอง แต่รวมมาจากค่างวดข้างล่าง
                  ถ้าไม่บอกไว้ ผู้ใช้จะงงว่าเลขเปลี่ยนเองตอนแก้ค่างวด */}
              {tieredSync?.filled && (
                <p className={`mt-1 text-[11.5px] ${tieredSync.matched ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {tieredSync.matched
                    ? `รวมจากค่างวดผ่อน ${tieredSync.rows.length} ช่วง ${tieredSync.months} งวดให้อัตโนมัติ`
                    : `⚠️ ค่างวดผ่อนรวมได้ ${fmtBaht(tieredSync.total)} บาท ไม่ตรงกับยอดนี้`}
                </p>
              )}
            </div>
            <div className="flex gap-1.5 pb-1.5 flex-wrap">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => set('amount', String((Number(form.amount) || 0) + a))}
                  className="h-[30px] px-2.5 rounded-[9px] bg-paper text-[12px] font-semibold hover:bg-hairline"
                  title={`บวก ${a.toLocaleString()} บาท`}
                >
                  +{a.toLocaleString()}
                </button>
              ))}
              {Number(form.amount) > 0 && (
                <button
                  type="button"
                  onClick={() => set('amount', '')}
                  className="h-[30px] px-2.5 rounded-[9px] text-[12px] text-muted hover:bg-paper"
                >
                  ล้าง
                </button>
              )}
            </div>
          </div>
          </div>
        )}

        {/* รายการที่บันทึกไว้ — กดใบเดียวเติมชื่อ + หมวดหมู่ให้ทันที เหลือแค่ใส่ยอด
            เป็นทางลัดของรายจ่ายที่ซ้ำเดิมทุกวัน ซึ่งเป็นส่วนใหญ่ของรายการที่บันทึก */}
        <button
          type="button"
          onClick={() => setRecentsOpen(true)}
          className="w-full h-[46px] px-3.5 border border-hairline rounded-ctl bg-[#FAF9F6] flex items-center gap-2.5 hover:bg-[#F2FAD9] hover:border-ink transition"
        >
          <span className="w-7 h-7 flex-none rounded-[9px] bg-ink flex items-center justify-center">
            <UiIcon name="pin" tone="w" size={15} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[12.5px] font-semibold">เลือกจากรายการที่บันทึกไว้</span>
            <span className="hidden sm:block text-[11px] text-faint truncate">
              กดใบเดียวเติมชื่อรายการ หมวดหมู่ และช่องทางจ่ายให้ทันที เหลือแค่ใส่ยอดเงิน
            </span>
          </span>
          <span className="tabular-nums flex-none text-[11px] font-bold bg-hairline text-muted rounded-full px-2.5 py-0.5">
            {quickList.length}
          </span>
          {form.itemName && (
            <span className="hidden md:block flex-none text-[11.5px] text-muted max-w-[150px] truncate">
              ล่าสุด: {form.itemName}
            </span>
          )}
          <Icon name="expand_more" size={20} className="flex-none text-muted" />
        </button>

        {/* มือถือ: 3 รายการที่ใช้บ่อยสุดโผล่เป็นชิปให้กดได้เลย ไม่ต้องเปิดกล่องก่อน */}
        {quickList.length > 0 && (
          <div className="lg:hidden -mt-1.5">
            <div className="text-[11px] text-faint mb-1.5">ใช้บ่อย · กดครั้งเดียวเติมให้ครบ</div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {quickList.slice(0, 3).map((q) => {
                const on = form.itemName === q.name
                return (
                  <button
                    key={q.id ?? q.name}
                    type="button"
                    onClick={() => setMany({ itemName: q.name, ...(q.categoryId ? { category: q.categoryId } : {}) })}
                    className={`flex-none h-10 px-3 rounded-[11px] border text-[12.5px] font-medium flex items-center gap-1.5 ${
                      on ? 'bg-[#F2FAD9] border-ink' : 'bg-white border-hairline'
                    }`}
                  >
                    <Icon name="receipt_long" size={16} className="text-expense" />
                    {q.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <StepHeading
          n={2}
          title="รายการนี้คืออะไร"
          hint="ชื่อรายการและหมวดหมู่ ใช้ในประวัติและรายงาน"
          done={stepDone[1]}
          current={nextStep === 1}
          className="!mb-0"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-baseline gap-[7px] text-[12.5px] font-semibold mb-1.5">
              ชื่อรายการ
              <span className="text-[11px] font-normal text-faint">พิมพ์เองได้ · จะถูกใช้เป็นชื่อในประวัติและรายงาน</span>
            </label>
            <EditableDropdown
              value={form.itemName}
              onChange={(v) => set('itemName', v)}
              items={quickList}
              onAdd={(name) => logQuickItemAdd(name, form.category)}
              onUpdate={(id, name) => logQuickItemUpdate(id, { name })}
              onDelete={logQuickItemDelete}
              placeholder="เช่น ค่าวัตถุดิบ ร้านเจ๊หมวย"
            />
          </div>

          <div>
            <div className="flex items-baseline gap-[7px] mb-1.5">
              <label className="text-[12.5px] font-semibold">หมวดหมู่</label>
              <span className="text-[11px] text-faint">ใช้จัดกลุ่มในรายงาน</span>
              <Link to="/manage/categories" className="ml-auto text-xs text-income hover:underline">
                จัดการหมวดหมู่
              </Link>
            </div>
            <CategorySelect value={form.category} onChange={(v) => set('category', v)} />
            <p className="text-[11px] text-faint leading-snug mt-[5px]">
              การ์ด "ใช้บ่อย" ด้านบนเติมหมวดหมู่นี้ให้อัตโนมัติ · กดที่ช่องเพื่อเปลี่ยนเองได้
            </p>
          </div>
        </div>

        {matchingRecurring && (
          <div className="p-2.5 bg-recurring-soft rounded-ctl border border-[#D6CBF0] text-xs text-[#5A3C90]">
            มีรายการประจำ <strong>"{matchingRecurring.name}"</strong> รอจ่ายในหมวดนี้เดือนนี้ — ตรวจสอบที่แท็บ <strong>รายการประจำ</strong> ก่อนบันทึก
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <div>
            <StepHeading
              n={3}
              title="จ่ายด้วยอะไร"
              hint={lockCardId ? 'รูดบัตรใบที่เปิดอยู่ เปลี่ยนช่องทางที่นี่ไม่ได้' : 'เลือกช่องทาง แล้วระบุบัญชีหรือบัตรถ้าต้องมี'}
              done={stepDone[2]}
              current={nextStep === 2}
              className="!mb-1.5"
            />
            {/* เปิดจากหน้าบัตร = รู้อยู่แล้วว่ารูดใบไหน การให้เลือกช่องทางอีกรอบมีแต่จะ
                เปิดช่องให้บันทึกผิดใบ ถ้าจะจ่ายด้วยอย่างอื่นให้ไปที่หน้าบันทึกรายการ */}
            {lockCardId ? (
              <div className="flex items-center gap-2.5 rounded-ctl border border-expense-line bg-expense-soft/50 px-3 py-2.5">
                <span className="w-9 h-9 flex-none rounded-lg bg-white flex items-center justify-center">
                  <AppIcon value={selectedCard?.icon} size={20} fallback={DEFAULT_ICONS.card} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold truncate">{formatCard(selectedCard)}</span>
                  <span className="block text-[11.5px] text-muted">รูดบัตร · หนี้บัตรเพิ่มทันที ยังไม่ตัดเงินสด</span>
                </span>
              </div>
            ) : (
            <PayFromPicker
              label=""
              value={{ method: form.method, transferAccountId: form.transferAccountId, cardId: form.cardId }}
              onChange={setMany}
              options={['cash', 'transfer', 'card', 'debt', 'pending']}
              itemName={form.itemName}
              debt={form.debt}
              onDebtChange={(d) => set('debt', d)}
              pending={{ dueDate: form.dueDate, accountId: form.pendingAccountId }}
              onPendingChange={(p) => setMany({ dueDate: p.dueDate, pendingAccountId: p.accountId })}
            />
            )}
          </div>
        </div>


        {/* ผู้ใช้ไม่ต้องรู้เรื่องวันสรุปยอด — ระบบตอบคำถามเดียวที่เขาสนใจจริงๆ
            คือต้องหาเงินมาจ่ายเมื่อไร */}
        {form.method === 'card' && selectedCard && (
          <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 space-y-2.5">
            {!form.installment && (
              <p className="text-xs text-rose-700">
                💳 ยังไม่ตัดเงินตอนนี้ — รายการนี้จะไปอยู่ในบิลที่ครบกำหนด{' '}
                <strong>{formatThaiDate(nextDueDate(selectedCard.closingDay, selectedCard.dueDay, new Date(date + 'T00:00:00')))}</strong>
              </p>
            )}

            <label className="flex items-center gap-2 text-xs text-rose-800 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 accent-rose-600"
                checked={form.installment}
                onChange={(e) => set('installment', e.target.checked)}
              />
              <span className="font-medium">แบ่งชำระ (ผ่อน)</span>
            </label>

            {form.installment && (
              <div className="space-y-2">
                {/* โปรฯ ผ่อนจริงมักไม่ได้จ่ายเท่ากันทุกงวด ต้องกรอกกลับทาง
                    คือรู้ค่างวดอยู่แล้วแล้วรวมกลับเป็นยอด จึงแยกเป็นคนละโหมด */}
                <div>
                  <label className="label">รูปแบบการผ่อน</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { v: 'even', t: 'หารเท่ากันทุกงวด' },
                      { v: 'tiered', t: 'ค่างวดตามโปรโมชั่น' },
                    ].map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        className={`btn text-xs py-1 px-3 ${form.installmentMode === o.v ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => {
                          savedRef.current = { tx: null, pending: null, installment: null }
                          // สลับมาโหมดขั้นบันไดทั้งที่ค่างวดกรอกไว้ครบแล้ว = ยอดต้องตามมาทันที
                          setForm((f) => withTierSync({ ...f, installmentMode: o.v }))
                        }}
                      >
                        {o.t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-end gap-2 flex-wrap">
                  <div className="w-28">
                    <label className="label">จำนวนงวด</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="120"
                      value={form.installmentMonths}
                      onChange={(e) => setInstallmentMonths(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-1.5 pb-0.5 flex-wrap">
                    {MONTH_PRESETS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`btn text-xs py-1 px-2.5 ${String(m) === String(form.installmentMonths) ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setInstallmentMonths(String(m))}
                      >
                        {m} งวด
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── ค่างวดตามโปรโมชั่น (ขั้นบันได) ── */}
                {form.installmentMode === 'tiered' && (() => {
                  const months = Math.max(1, Math.round(Number(form.installmentMonths) || 1))
                  const rows = normalizedTiers(form.installmentTiers, months)
                  // ช่วงสุดท้ายกินงวดสุดท้ายอยู่แล้ว = ไม่เหลืองวดให้แบ่งอีก
                  // ต้องปิดปุ่มไว้ ไม่ใช่ให้กดแล้วเงียบ เพราะช่วงใหม่จะถูกตัดทิ้งทันทีที่สร้าง
                  const roomLeft = rows.length === 0 || rows[rows.length - 1].from < months
                  return (
                  <div>
                    <label className="label">ค่างวดตามโปรโมชั่น</label>
                    {rows.map((t, i, arr) => (
                      <div key={i} className="flex items-center gap-1.5 flex-wrap bg-white/70 border border-rose-200 rounded-lg px-2 py-1.5 mb-1.5">
                        {/* จับ "งวดที่ x–y" กับ "งวดละ n บาท" เป็นคนละก้อน ให้ตกบรรทัดได้เฉพาะ
                            ระหว่างสองก้อน ไม่งั้นบนมือถือคำว่า "บาท" จะหลุดไปอยู่บรรทัดล่างตัวเดียว */}
                        <span className="flex items-center gap-1.5 flex-none">
                        <span className="text-xs text-rose-800">งวดที่</span>
                        {/* ต้นช่วงคำนวณจากช่วงก่อนหน้าเสมอ แก้เองไม่ได้ กันกรอกขาดตอน */}
                        <span className="text-xs tabular-nums bg-rose-50 border border-rose-200 rounded px-2 py-0.5 min-w-[34px] text-center">{t.from}</span>
                        <span className="text-xs text-rose-800">–</span>
                        {i === arr.length - 1 ? (
                          <span className="text-xs tabular-nums bg-rose-50 border border-rose-200 rounded px-2 py-0.5 min-w-[34px] text-center" title="ช่วงสุดท้ายยืดไปจบที่งวดสุดท้ายให้เอง">{t.to}</span>
                        ) : (
                          <input
                            className="input !h-7 w-16 text-xs text-center px-1"
                            type="number"
                            min={t.from}
                            max={months}
                            value={form.installmentTiers[i]?.to ?? ''}
                            onChange={(e) => {
                              // บีบให้อยู่ในช่วง [งวดเริ่ม, จำนวนงวดทั้งหมด] ตั้งแต่ตอนพิมพ์
                              // ปล่อยให้พิมพ์เกินไปก่อนแล้วค่อยตัดตอนคำนวณ จะเห็นเลขบนจอ
                              // ไม่ตรงกับตารางงวดที่ระบบสร้างจริง ซึ่งอ่านแล้วนึกว่าระบบคิดผิด
                              const raw = e.target.value
                              const v = raw === ''
                                ? ''
                                : String(Math.min(Math.max(Math.round(Number(raw)) || t.from, t.from), months))
                              const next = form.installmentTiers.map((x, k) => (k === i ? { ...x, to: v } : x))
                              setTiers(next)
                            }}
                          />
                        )}
                        </span>
                        <span className="flex items-center gap-1.5 flex-1 min-w-[148px] justify-end">
                        <span className="text-xs text-rose-800">งวดละ</span>
                        <input
                          className="input !h-7 w-24 text-xs text-right px-2"
                          type="number"
                          min="0"
                          placeholder="0.00"
                          value={form.installmentTiers[i]?.amount ?? ''}
                          onChange={(e) => {
                            const next = form.installmentTiers.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x))
                            setTiers(next)
                          }}
                        />
                        <span className="text-xs text-rose-800">บาท</span>
                        {arr.length > 1 && i < arr.length - 1 && (
                          <button
                            type="button"
                            className="flex-none text-rose-400 hover:text-rose-700 text-sm leading-none px-1"
                            onClick={() => setTiers(form.installmentTiers.filter((_, k) => k !== i))}
                            title="ลบช่วงนี้"
                          >
                            ✕
                          </button>
                        )}
                        </span>
                      </div>
                    ))}
                    {/* โปรฯ ผ่อนประกาศเป็นรายงวด คนกรอกจึงถือตัวเลขรายงวดมา ไม่ได้ถือ "ช่วง" มา
                        ให้กรอกแบบที่ถืออยู่จริงแล้วยุบเป็นช่วงให้เอง จะได้ไม่ต้องนั่งแปลงเอง */}
                    <button
                      type="button"
                      className="w-full text-xs font-semibold text-rose-800 border border-rose-300 bg-white/70 rounded-lg py-1.5 mb-1.5 hover:bg-white"
                      onClick={() => setTierEditOpen(true)}
                    >
                      ⚙ ปรับแต่งค่างวดทีละงวด ({months} งวด)
                    </button>
                    <button
                      type="button"
                      disabled={!roomLeft}
                      className="w-full text-xs text-rose-700 border border-dashed border-rose-300 rounded-lg py-1.5 hover:bg-white/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      onClick={() => {
                        const last = rows[rows.length - 1]
                        // แบ่งช่วงสุดท้ายออกเป็นสอง ปลายช่วงแรกต้องไม่ถึงงวดสุดท้าย
                        // ไม่งั้นช่วงที่เพิ่งเพิ่มจะเริ่มเลยงวดสุดท้ายไปแล้วและถูกตัดทิ้งทันที
                        const split = Math.min(last.from + 5, months - 1)
                        setTiers([
                          ...rows.slice(0, -1),
                          { from: last.from, to: String(split), amount: last.amount },
                          { from: split + 1, to: months, amount: '' },
                        ])
                      }}
                    >
                      + เพิ่มช่วงราคา
                    </button>
                    {installmentPreview?.tierError && (
                      <p className="text-xs text-red-600 mt-1">⚠️ {installmentPreview.tierError}</p>
                    )}
                    <p className="text-xs text-rose-600 mt-1">
                      แบ่งได้ {rows.length} ช่วง ครอบคลุมงวด 1–{months} ครบพอดี
                      {roomLeft
                        ? ' · กด “เพิ่มช่วงราคา” แล้วแก้เลขงวดปิดท้ายของแต่ละช่วงได้เอง'
                        : ' · แบ่งจนครบทุกงวดแล้ว เพิ่มช่วงต่อไม่ได้'}
                    </p>
                    {/* ── แถบซิงค์ยอดเงิน ↔ ค่างวด ──
                        สองช่องนี้เป็นตัวเลขชุดเดียวกันคนละมุม กรอกฝั่งไหนก่อนก็ได้
                        แต่ต้องเดินไปหากันเสมอ ไม่ใช่ปล่อยให้ขัดกันแล้วมาโดนบล็อก
                        ตอนกดบันทึกโดยไม่บอกว่าต้องแก้ตรงไหน */}
                    {tieredSync?.matched ? (
                      <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1.5 flex-wrap">
                        <span>✓ รวมจากค่างวดแล้ว</span>
                        <strong className="tabular-nums">{fmtBaht(tieredSync.total)} บาท</strong>
                        <span className="text-emerald-600">— ใส่ให้ในช่องยอดเงินด้านบนเรียบร้อย</span>
                      </p>
                    ) : tieredSync?.filled ? (
                      <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
                        <p className="text-xs text-amber-900">
                          ยอดยังไม่ตรงกัน — ช่องยอดเงิน{' '}
                          <strong className="tabular-nums">{fmtBaht(tieredSync.amount)}</strong>{' '}
                          แต่ค่างวดรวมได้{' '}
                          <strong className="tabular-nums">{fmtBaht(tieredSync.total)}</strong> บาท
                          {' '}(ต่างกัน {fmtBaht(Math.abs(tieredSync.diff))})
                        </p>
                        <div className="flex gap-1.5 flex-wrap mt-1.5">
                          <button
                            type="button"
                            className="btn btn-primary text-xs py-1 px-2.5"
                            onClick={() => set('amount', String(tieredSync.total))}
                          >
                            ใช้ยอดจากค่างวด {fmtBaht(tieredSync.total)}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary text-xs py-1 px-2.5 disabled:opacity-40"
                            disabled={!tieredSync.canSpread}
                            title={tieredSync.canSpread ? '' : 'ยอดที่กรอกน้อยกว่าค่างวดช่วงอื่นรวมกัน เกลี่ยไม่ได้'}
                            onClick={spreadAmountToTiers}
                          >
                            เกลี่ยค่างวดให้ตรง {fmtBaht(tieredSync.amount)}
                          </button>
                        </div>
                      </div>
                    ) : tieredSync?.canSpread ? (
                      <div className="mt-1 rounded-lg border border-rose-200 bg-white/70 px-2.5 py-2">
                        <p className="text-xs text-rose-700">
                          มียอดเงิน <strong className="tabular-nums">{fmtBaht(tieredSync.amount)}</strong> บาท
                          {' '}อยู่แล้ว แต่ยังกรอกค่างวดไม่ครบทุกช่วง
                        </p>
                        <button
                          type="button"
                          className="btn btn-secondary text-xs py-1 px-2.5 mt-1.5"
                          onClick={spreadAmountToTiers}
                        >
                          เกลี่ยยอดลงช่วงที่ยังว่างให้เลย
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-rose-600">
                        ไม่ต้องกรอกราคาสินค้า กรอกค่างวดให้ครบทุกช่วง ระบบรวมเป็นยอดเงินให้เอง
                      </p>
                    )}
                  </div>
                  )
                })()}

                {form.installmentMode === 'even' && (
                <div>
                  <label className="label">ดอกเบี้ย</label>
                  <div className="flex items-end gap-2 flex-wrap">
                    <button
                      type="button"
                      className={`btn text-xs py-1 px-3 ${Number(form.installmentRate) === 0 ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => set('installmentRate', '0')}
                    >
                      ผ่อน 0%
                    </button>
                    <div className="flex items-center gap-1.5">
                      <input
                        className="input w-24"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.installmentRate}
                        onChange={(e) => set('installmentRate', e.target.value)}
                      />
                      <span className="text-xs text-rose-800 whitespace-nowrap">% ต่อเดือน</span>
                    </div>
                  </div>
                </div>
                )}

                {/* ── สัญญาที่ผ่อนมาก่อนเริ่มใช้แอป ── */}
                <div className="border-t border-rose-200 pt-2">
                  <label className="flex items-center gap-2 text-xs text-rose-800 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-rose-600"
                      checked={form.installmentPrepaid}
                      onChange={(e) => set('installmentPrepaid', e.target.checked)}
                    />
                    <span className="font-medium">เคยผ่อนมาก่อนแล้ว</span>
                  </label>

                  {form.installmentPrepaid && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-rose-800">จ่ายมาแล้ว</span>
                        <input
                          className="input !h-8 w-20 text-sm text-center"
                          type="number"
                          min="0"
                          value={form.installmentPrepaidCount}
                          onChange={(e) => set('installmentPrepaidCount', e.target.value)}
                          placeholder="0"
                        />
                        <span className="text-xs text-rose-800">
                          งวด จากทั้งหมด {form.installmentMonths} งวด
                        </span>
                      </div>

                      {installmentPreview?.prepaidOver ? (
                        <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 space-y-1">
                          <p className="font-medium">⚠️ วันเปิดบิลย้อนหลังไม่พอ</p>
                          <p>
                            เปิดบิล {formatThaiDate(new Date(date + 'T00:00:00'))} มีงวดที่ครบกำหนดแล้วมากสุด{' '}
                            <strong>{installmentPreview.maxPrepaid} งวด</strong> จะบอกว่าจ่ายมา{' '}
                            {installmentPreview.wantPrepaid} งวดไม่ได้
                          </p>
                          {installmentPreview.suggestDate && (
                            <>
                              <p>
                                ถ้าจ่ายมาแล้ว {installmentPreview.wantPrepaid} งวดจริง ต้องเลือกวันเปิดบิลไม่เกิน{' '}
                                <strong>{formatThaiDate(installmentPreview.suggestDate)}</strong>
                              </p>
                              <button
                                type="button"
                                className="btn btn-primary text-xs py-1 px-3 mt-1"
                                onClick={() => setDate(toDateString(installmentPreview.suggestDate))}
                              >
                                ใช้วันที่ {formatThaiDate(installmentPreview.suggestDate)} ให้เลย
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        installmentPreview && (
                          <p className="text-xs text-rose-600">
                            วันเปิดบิลนี้มีงวดครบกำหนดไปแล้ว {installmentPreview.maxPrepaid} งวด
                            {' '}ระบุได้ 0 ถึง {installmentPreview.maxPrepaid} งวด
                          </p>
                        )
                      )}

                      <p className="text-xs text-rose-600">
                        งวดที่จ่ายมาก่อนจะไม่ถูกบันทึกเป็นรายจ่ายย้อนหลังและไม่เพิ่มยอดหนี้บัตร
                        เพราะจ่ายไปก่อนเริ่มใช้ระบบ มีไว้ให้เลขงวดกับยอดคงเหลือถูกต้องเท่านั้น
                      </p>
                    </div>
                  )}
                </div>

                {/* ป้ายงวดทั้งสัญญา — บอกวันครบกำหนดของทุกงวด และกดเลือกงวดที่จ่ายมาแล้วได้
                    ตรงนี้คือที่ที่ตรวจได้ว่า "จ่ายมาแล้วกี่งวด" ที่กรอกไป ตรงกับสลิปในมือไหม */}
                {(() => {
                  const ready = installmentPreview && !installmentPreview.invalid
                  const rows = ready ? installmentPreview.rows : installmentDates?.rows
                  if (!rows) return null
                  return (
                    <InstallmentPips
                      rows={rows}
                      showAmount={!!ready}
                      paidCount={ready ? installmentPreview.prepaidCount : Number(form.installmentPrepaidCount) || 0}
                      maxPaid={ready ? installmentPreview.maxPrepaid : installmentDates.maxPaid}
                      onPickPaid={(n) => setMany({
                        installmentPrepaid: n > 0,
                        installmentPrepaidCount: n > 0 ? String(n) : '',
                      })}
                    />
                  )
                })()}

                {installmentPreview && !installmentPreview.invalid ? (
                  <div className="text-xs text-rose-800 bg-white/70 rounded-lg px-3 py-2 leading-relaxed space-y-0.5">
                    {installmentPreview.interest > 0 ? (
                      <>
                        <div className="flex justify-between gap-3">
                          <span>ราคาสินค้า</span>
                          <span className="tabular-nums">{fmtBaht(installmentPreview.principal)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>
                            ดอกเบี้ย {installmentPreview.ratePerMonth}% × {installmentPreview.months} งวด
                          </span>
                          <span className="tabular-nums">+ {fmtBaht(installmentPreview.interest)}</span>
                        </div>
                        <div className="flex justify-between gap-3 border-t border-rose-200 pt-0.5 font-semibold">
                          <span>ยอดผ่อนรวม</span>
                          <span className="tabular-nums">{fmtBaht(installmentPreview.total)}</span>
                        </div>
                      </>
                    ) : form.installmentMode === 'tiered' ? (
                      <>
                        {normalizedTiers(form.installmentTiers, installmentPreview.months).map((t, i) => (
                          <div key={i} className="flex justify-between gap-3">
                            <span>งวด {t.from}–{t.to} · {t.to - t.from + 1} งวด × {fmtBaht(t.amount)}</span>
                            <span className="tabular-nums">{fmtBaht((t.to - t.from + 1) * (Number(t.amount) || 0))}</span>
                          </div>
                        ))}
                        <div className="flex justify-between gap-3 border-t border-rose-200 pt-0.5 font-semibold">
                          <span>ยอดรวมทั้งสัญญา</span>
                          <span className="tabular-nums">{fmtBaht(installmentPreview.total)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between gap-3 font-semibold">
                        <span>ยอดผ่อนรวม (ผ่อน 0%)</span>
                        <span className="tabular-nums">{fmtBaht(installmentPreview.total)}</span>
                      </div>
                    )}

                    {installmentPreview.prepaidCount > 0 && (
                      <>
                        <div className="flex justify-between gap-3 pt-0.5">
                          <span>จ่ายมาแล้ว {installmentPreview.prepaidCount} งวด</span>
                          <span className="tabular-nums">− {fmtBaht(installmentPreview.paidAlready)}</span>
                        </div>
                        <div className="flex justify-between gap-3 font-semibold border-t border-rose-200 pt-0.5">
                          <span>คงเหลือที่ต้องผ่อนต่อ</span>
                          <span className="tabular-nums">{fmtBaht(installmentPreview.remainingTotal)}</span>
                        </div>
                      </>
                    )}

                    {installmentPreview.prepaidCount > 0 && installmentPreview.nextRow ? (
                      <p className="pt-1">
                        งวดถัดไปคืองวดที่ <strong>{installmentPreview.nextRow.seq}</strong>{' '}
                        <strong>{fmtBaht(installmentPreview.nextRow.amount)}</strong> บาท ครบกำหนด{' '}
                        <strong>{formatThaiDate(installmentPreview.nextRow.dueDate)}</strong>
                      </p>
                    ) : form.installmentMode === 'even' ? (
                      <p className="pt-1">
                        งวดละ <strong>{fmtBaht(installmentPreview.first.amount)}</strong> บาท{' '}
                        {installmentPreview.months} งวด
                        {installmentPreview.hasRemainder && (
                          <> (งวดสุดท้าย {fmtBaht(installmentPreview.last.amount)} บาท)</>
                        )}
                      </p>
                    ) : null}
                    <p>
                      งวดแรกอยู่ในบิลที่ครบกำหนด <strong>{formatThaiDate(installmentPreview.first.dueDate)}</strong>{' '}
                      งวดสุดท้าย <strong>{formatThaiDate(installmentPreview.last.dueDate)}</strong>
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-rose-600">ใส่จำนวนเงินก่อน ระบบจะคำนวณยอดต่องวดให้</p>
                )}

                <p className="text-xs text-rose-600">
                  ไม่บันทึกรายจ่ายก้อนเดียวตอนนี้ — จะทยอยลงทีละงวดตามที่ธนาคารเรียกเก็บ
                  ติดตามได้ที่แท็บ <strong>ผ่อนชำระ</strong>
                </p>
              </div>
            )}
          </div>
        )}


        {/* ช่องที่ไม่ได้กรอกทุกครั้ง พับเก็บไว้ใต้ปุ่มเดียว — ฟอร์มที่ต้องกรอกจริงจึงเหลือ
            3 ช่อง (ยอด ชื่อรายการ หมวดหมู่) ตามที่ตั้งใจไว้ในแบบ ถ้ามีข้อมูลกรอกไว้แล้ว
            จะกางออกให้เองเพื่อไม่ให้ค่าที่กรอกไปหายจากสายตา */}
        <div>
          <StepHeading
            n={4}
            title="รายละเอียดเพิ่มเติม"
            hint="ผู้ขาย · ใบเสร็จ · ใบกำกับภาษี · ไฟล์แนบ"
            done={stepDone[3]}
            optional
          />
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`w-full flex items-center gap-2.5 h-11 px-3.5 border border-dashed border-[#D8D4C9] bg-[#FAF9F6] hover:bg-paper ${
              moreOpen ? 'rounded-t-ctl border-b-0' : 'rounded-ctl'
            }`}
          >
            <Icon name="tune" size={18} className="text-muted" />
            <span className="text-[13px] font-semibold">รายละเอียดเพิ่มเติม</span>
            <span className="text-[11.5px] text-faint hidden sm:inline">ผู้ขาย · เลขที่ใบเสร็จ · ใบกำกับภาษี · ไฟล์แนบ · หมายเหตุ</span>
            <span className="ml-auto text-[11.5px] text-faint">{moreOpen ? 'ปิดรายละเอียด' : moreSummary}</span>
            <Icon name="expand_more" size={20} className={`text-muted transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
          </button>

          {moreOpen && (
            <div className="border border-hairline rounded-b-ctl p-3.5 space-y-4 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditableDropdown
            label="ผู้ขาย/ร้านค้า"
            value={form.vendor}
            onChange={(v) => set('vendor', v)}
            items={vendorList}
            onAdd={logVendorAdd}
            onUpdate={logVendorUpdate}
            onDelete={logVendorDelete}
            onSetIcon={setVendorIcon}
            emptyIcon="storefront"
            placeholder="พิมพ์หรือเลือกร้านค้า..."
          />
          <div>
            <label className="label">เลขที่ใบเสร็จ</label>
            <input className="input" value={form.receiptNo} onChange={(e) => set('receiptNo', e.target.value)} placeholder="เลขที่ใบเสร็จ (ถ้ามี)" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">ใบกำกับภาษี</label>
            <select className="input" value={form.taxStatus} onChange={(e) => { set('taxStatus', e.target.value); setUploadStatus(null) }}>
              <option value="none">ไม่ต้องการ</option>
              <option value="receipt">ใบเสร็จ</option>
              <option value="received">มีใบกำกับภาษี</option>
              <option value="waiting">รอใบกำกับภาษี</option>
            </select>
            {/* ปุ่ม upload แสดงทันทีตาม taxStatus ที่เลือก */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5"
                onClick={() => setUploadOpen(true)}
              >
                {isTaxUpload ? '📎 อัปโหลดใบกำกับภาษี' : '📎 อัปโหลดใบเสร็จ'}
              </button>
              {uploadStatus && (
                <span className="text-emerald-600 text-xs">{uploadStatus}</span>
              )}
            </div>
          </div>
          <div>
            <label className="label">หมายเหตุ</label>
            <input className="input" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" />
          </div>
        </div>

        {form.taxStatus === 'waiting' && (
          <div className="p-3 bg-[#FBEFE4] rounded-ctl border border-[#EBD3BC] space-y-2">
            <p className="text-xs text-[#B4571E] font-medium">รอใบกำกับภาษี — ระบบจะสร้างการ์ดติดตามให้อัตโนมัติ</p>
            <div>
              <label className="label">วันที่คาดว่าจะได้รับใบกำกับภาษี</label>
              <DatePicker value={form.taxDueDate} onChange={(v) => set('taxDueDate', v)} placeholder="ไม่ระบุ" />
            </div>
          </div>
        )}
            </div>
          )}
        </div>

        {/* มือถือ: แป้นตัวเลขทำตัวเหมือนคีย์บอร์ดของเครื่อง — โผล่จากขอบล่าง (เหนือแถบเมนู 68px)
            ใช้กรอกยอดอย่างเดียว กด Enter = ยืนยันยอดแล้วแป้นพับเก็บ ฟอร์มที่เหลือจะได้ไม่โดนบัง
            ปุ่มบันทึกไม่อยู่ในแป้นนี้ — ย้ายไปท้ายฟอร์มข้างล่าง เพราะบันทึกคือขั้นสุดท้ายหลังกรอกครบ */}
        {/* ในป๊อปอัปไม่มีแถบเมนูล่างให้หลบ ถ้ายังเว้น 68px ไว้ แป้นจะลอยค้างกลางจอ */}
        {padOpen && form.method !== 'debt' && (
          <div className={`lg:hidden sticky z-10 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 bg-white/95 backdrop-blur border-t border-[#F2F0EA] ${
            lockCardId ? 'bottom-0' : 'bottom-[68px]'
          }`}>
            <div className="grid grid-cols-3 gap-[7px]">
              {PAD_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => pressPad(k)}
                  className={`h-11 rounded-ctl text-[18px] font-semibold flex items-center justify-center border border-[#EFEDE7] active:bg-paper ${
                    k === '⌫' ? 'bg-[#EFEDE7]' : 'bg-white'
                  }`}
                >
                  {k === '⌫' ? <UiIcon name="backspace" size={20} /> : k}
                </button>
              ))}
              {/* Enter ของแป้น = ยืนยันยอดในช่องจำนวนเงินเท่านั้น ไม่ใช่บันทึกรายการ */}
              <button
                type="button"
                onClick={() => setPadOpen(false)}
                className="col-span-3 h-11 rounded-ctl bg-lime text-ink text-[15px] font-semibold flex items-center justify-center gap-2 active:brightness-95"
                title="ยืนยันยอดแล้วพับแป้น"
              >
                <Icon name="check" size={19} />
                ยืนยันยอด{Number(form.amount) > 0 ? ` ${amountLabel} บาท` : ''}
              </button>
            </div>
          </div>
        )}

        {/* มือถือ: ปุ่มบันทึกอยู่ท้ายฟอร์มตามลำดับขั้น (กรอกยอด → ชื่อ/หมวด → บันทึก)
            ไม่ลอยติดจอ เพราะพอรวมกับแป้นตัวเลขแล้วสูงเกือบ 300px บังฟอร์มจนกรอกต่อไม่ได้ */}
        <div className="lg:hidden pt-1 space-y-2">
          <button
            className="h-[50px] w-full justify-center rounded-[14px] bg-ink px-5 text-white text-[15px] font-semibold flex items-center gap-2 hover:brightness-110 disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            <Icon name="check" size={20} />
            {saving ? 'กำลังบันทึก…' : `บันทึกรายจ่าย${Number(form.amount) > 0 ? ` ${amountLabel} บาท` : ''}`}
          </button>
          {saveStatus}
        </div>

        {/* จอใหญ่: แถบบันทึกติดอยู่ท้ายฟอร์มเสมอ — ฟอร์มยาวขึ้นเมื่อกางรายละเอียดหรือเปิดผ่อนชำระ
            ถ้าปุ่มลอยไปอยู่ท้ายสุดผู้ใช้จะต้องเลื่อนหาทุกครั้ง */}
        <div className="hidden lg:flex sticky z-10 bottom-0 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 px-4 sm:px-5 py-3 bg-white/95 backdrop-blur border-t border-[#F2F0EA] rounded-b-card items-center gap-3 flex-wrap">
          <button
            className="h-[42px] rounded-ctl bg-expense px-5 text-white text-sm font-semibold flex items-center gap-2 hover:brightness-110 disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึกรายจ่าย'}
          </button>

          {/* ปุ่มลัดสองอันที่ mockup วางไว้ข้างปุ่มบันทึก — งานที่มักทำต่อทันทีหลังกรอกยอด
              (มือถือไม่มีตามแบบ แนบไฟล์ยังทำได้ใน "รายละเอียดเพิ่มเติม") */}
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="hidden lg:flex h-[38px] px-3.5 rounded-ctl border border-hairline text-[12.5px] font-semibold items-center gap-1.5 hover:bg-paper"
          >
            <Icon name="upload_file" size={17} />
            แนบใบเสร็จ
            {attachments.length > 0 && <span className="tabular-nums font-bold text-income">{attachments.length}</span>}
          </button>
          {/* ปุ่มนี้พาออกจากหน้าปัจจุบัน จึงไม่ควรอยู่ในป๊อปอัปที่เปิดค้างจากหน้าบัตร */}
          {!lockCardId && (
            <button
              type="button"
              onClick={() => navigate('/transactions?tab=recurring')}
              className="hidden lg:flex h-[38px] px-3.5 rounded-ctl border border-hairline text-[12.5px] font-semibold items-center gap-1.5 hover:bg-paper"
              title="ไปหน้ารายการประจำเพื่อตั้งรายการนี้ให้เรียกเก็บทุกเดือน"
            >
              <Icon name="history" size={17} />
              ตั้งเป็นรายการประจำ
            </button>
          )}

          {saveStatus}
        </div>
      </div>

      <ConfirmPopup
        open={!!warning}
        title="⚠️ ยอดเงินจะติดลบ"
        message={warning?.message ?? ''}
        onConfirm={proceed}
        onCancel={cancel}
        confirmLabel="ยืนยัน (ติดลบ)"
        danger
      />

      {recentsOpen && (
        <RecentItemsPopup
          items={quickList}
          currentName={form.itemName}
          onPick={({ name, categoryId }) => {
            setMany({ itemName: name, ...(categoryId ? { category: categoryId } : {}) })
            setRecentsOpen(false)
          }}
          onSaveCurrent={async (name) => { await logQuickItemAdd(name, form.category); setRecentsOpen(false) }}
          onUpdate={logQuickItemUpdate}
          onDelete={logQuickItemDelete}
          onClose={() => setRecentsOpen(false)}
        />
      )}

      {tierEditOpen && (() => {
        const m = Math.max(1, Math.round(Number(form.installmentMonths) || 1))
        const rows = normalizedTiers(form.installmentTiers, m)
        // ค่าเริ่มต้นของงวดที่ไม่ได้กำหนดเอง — ใช้ค่างวดช่วงแรกที่กรอกไว้ ถ้ายังไม่กรอก
        // เลยก็หารจากยอดที่ใส่ไว้ในช่องจำนวนเงิน จะได้มีตัวตั้งให้แก้ ไม่ใช่เริ่มจาก 0
        const filled = rows.find((t) => Number(t.amount) > 0)
        const base = filled ? Number(filled.amount) : Math.round(((Number(form.amount) || 0) / m) * 100) / 100
        return (
          <PerInstallmentPopup
            months={m}
            amounts={amountsFromTiers(form.installmentTiers, m)}
            base={base}
            target={Number(form.amount) || null}
            dueDates={(installmentPreview?.rows ?? installmentDates?.rows)?.map((r) => r.dueDate) ?? null}
            onClose={() => setTierEditOpen(false)}
            onSave={(values) => {
              setTiers(tiersFromAmounts(values).map((t) => ({ ...t, to: String(t.to) })))
              setTierEditOpen(false)
            }}
          />
        )
      })()}

      {billPick && selectedCard && (
        <BillTargetPopup
          card={selectedCard}
          amount={Number(form.amount)}
          date={date}
          statements={billPick.statements}
          onClose={() => setBillPick(null)}
          onPick={(statementId) => {
            billChoiceRef.current = statementId
            setBillPick(null)
            execute()
          }}
        />
      )}

      {numpadOpen && (
        <AmountNumpadPopup
          initialValue={form.amount}
          kicker={`รายจ่าย${form.itemName ? ' · ' + form.itemName : ''}`}
          onSave={(v) => { set('amount', v); setNumpadOpen(false) }}
          onClose={() => setNumpadOpen(false)}
        />
      )}

      {uploadOpen && (
        <FileUploadPopup
          title={isTaxUpload ? 'อัปโหลดใบกำกับภาษี' : 'อัปโหลดใบเสร็จ'}
          description={`วันที่: ${date}`}
          createdAt={new Date(date + 'T00:00:00').toISOString()}
          filenamePrefix={isTaxUpload ? 'taxinvoice' : 'receipt'}
          folderBase={isTaxUpload ? 'taxinvoices' : 'receipts'}
          onConfirm={handleUploadDone}
          onCancel={() => setUploadOpen(false)}
        />
      )}
    </>
  )
}
