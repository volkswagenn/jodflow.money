import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import Popup from '../../components/shared/Popup'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import Icon from '../../components/shared/Icon'
import { toneFor } from '../../lib/actionTone'
import AppIcon from '../../components/shared/AppIcon'
import AmountInput from '../../components/shared/AmountInput'
import DatePicker from '../../components/shared/DatePicker'
import IconPicker from '../../components/shared/IconPicker'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import { formatAccount } from '../../components/shared/TransferAccountPicker'
import { listWalletLogsSince } from '../../lib/api/logs'
import {
  addToWallet, deductWallet, transferBetweenWallets, moveBetweenTransferAccounts,
  depositToSubWallet, withdrawFromSubWallet, transferBetweenSubWallets, borrowFromSubWallet, returnLoan,
} from '../../lib/walletEngine'
import { useNegativeConfirm } from '../../hooks/useNegativeConfirm'
import useWalletStore from '../../store/useWalletStore'
import useTransactionStore from '../../store/useTransactionStore'
import useCategoryStore from '../../store/useCategoryStore'
import { formatIsoThai } from '../../lib/cardCycle'
import { localMonthStr, THAI_MONTH_SHORT } from '../../lib/dateUtils'
import {
  buildYearStatement, buildMonthEntries, deltaForAccount, deltaForSubWallet, deltaForCash,
  monthLabel, yearsWithMovement,
} from '../../lib/accountStatement'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v) => Number(v) || 0

const timeLabel = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${THAI_MONTH_SHORT[d.getMonth()]}`
}
const shiftMonth = (key, n) => {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** ป้ายชนิดความเคลื่อนไหว — อ่านจากชนิดของ log ก่อน ถ้าไม่รู้จักดูจากทิศทางเงิน */
const KIND_OF = {
  CASH_DEPOSIT: 'ฝากเข้า', BANK_DEPOSIT: 'ฝากเข้า', TRANSFER_TO_WALLET: 'ฝากเข้า',
  WITHDRAW_FROM_TRANSFER: 'ถอนออก', BANK_WITHDRAW: 'ถอนออก',
  TRANSFER_ACCOUNT_MOVE: 'ย้ายบัญชี', SUB_DEPOSIT: 'กันเงิน', SUB_WITHDRAW: 'ถอนออก',
  SUB_TRANSFER: 'ย้ายกระเป๋า', SUB_BORROW: 'ยืมออก', SUB_RETURN: 'คืนเข้า',
  ADD_INCOME: 'รับเข้า', ADD_EXPENSE: 'จ่ายออก', CARD_PAYMENT: 'จ่ายบิลบัตร', CARD_PREPAY: 'จ่ายบัตร',
}
const kindOf = (row) => KIND_OF[row.activityType] ?? (row.delta > 0 ? 'รับเข้า' : 'จ่ายออก')

/** ปุ่มสี่เหลี่ยมในเมนู — ไอคอนบนกล่องเทา ชื่อ และคำอธิบายสั้น */
function Tile({ icon, label, desc, onClick, disabled, danger, tone }) {
  // สีมาจากความหมายของปุ่ม (ดู lib/actionTone) — ฝากเขียว ถอนแดง โอนน้ำเงิน กระเป๋าย่อยน้ำตาล
  const t = toneFor({ icon, tone, danger })
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`aspect-square border border-hairline rounded-[12px] bg-white flex flex-col items-center justify-center gap-[5px] p-1.5 text-center transition disabled:opacity-40 ${t.hover}`}
    >
      <span className={`w-[34px] h-[34px] flex-none rounded-[10px] flex items-center justify-center ${t.chip}`}>
        <Icon name={icon} size={19} className={t.icon} />
      </span>
      <span className={`text-[12px] font-semibold leading-tight ${t.label ?? ''}`}>{label}</span>
      <span className="text-[10.5px] text-faint leading-[1.3]">{desc}</span>
    </button>
  )
}

/** รายการให้เลือกต้นทาง/ปลายทาง — แถวละที่ มีวงกลมติ๊ก */
function PickList({ options, value, onChange }) {
  if (options.length === 0) {
    return <p className="text-[11.5px] text-faint bg-paper rounded-ctl px-3 py-2.5">ยังไม่มีปลายทางให้เลือก</p>
  }
  return (
    <div className="flex flex-col gap-[7px]">
      {options.map((o) => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={`flex items-center gap-2.5 rounded-[11px] px-3 py-[9px] text-left border transition ${
              on ? 'bg-[#F2FAD9] border-ink shadow-[0_0_0_1px_#16181D]' : 'bg-white border-hairline hover:bg-paper'
            }`}
          >
            <span className={`w-7 h-7 flex-none rounded-[9px] flex items-center justify-center text-[10px] font-bold ${o.chipClass ?? 'bg-paper'}`}>
              {o.chip ?? <AppIcon value={o.icon} size={15} fallback={o.fallback ?? DEFAULT_ICONS.account} />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-semibold truncate">{o.name}</span>
              <span className="block text-[11px] text-faint truncate">{o.meta}</span>
            </span>
            {on ? (
              <span className="w-5 h-5 flex-none rounded-full bg-ink flex items-center justify-center">
                <Icon name="check" size={14} className="text-lime" />
              </span>
            ) : (
              <span className="w-5 h-5 flex-none rounded-full border border-[#D8D4C9]" />
            )}
          </button>
        )
      })}
    </div>
  )
}

/** แถวสรุปต้นทาง/ปลายทางที่ล็อกไว้ (ไม่ต้องเลือก) */
function FixedRow({ label, value }) {
  return (
    <div className="flex items-center gap-2.5 bg-[#FAF9F6] border border-[#EFEDE7] rounded-[11px] px-3 py-[9px]">
      <span className="flex-none w-[74px] text-[11px] text-muted">{label}</span>
      <span className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{value}</span>
    </div>
  )
}

/**
 * ป๊อปอัปของ "ที่เก็บเงิน" หนึ่งที่ — เงินสดในร้าน / บัญชีธนาคาร / กระเป๋าตังค์ย่อย
 *
 * ทำตาม mockup (doc/Mockup interface … JodFlow-UI-v2): กดปุ่ม ⋮ ท้ายแถวแล้วได้เมนูเดียว
 * ที่รวมทุกอย่างของที่นั่นเป็นสามหมวด
 *   • ทำธุรกรรม — ฝาก ถอน โอน (กระเป๋าย่อยมียืม) ย้ายเงินระหว่างกระเป๋าของร้าน ไม่นับเป็นรายรับ-รายจ่าย
 *   • ข้อมูล — ดูรายการที่ใช้เงินจากที่นี่ · ความเคลื่อนไหวรายเดือน · สรุปรายปี
 *   • จัดการ — ชื่อ ไอคอน ลบ (กระเป๋าย่อย) / ลิงก์ไปหน้าจัดการ (บัญชี)
 * ทุกมุมมองอยู่ในป๊อปอัปเดียว มีปุ่มย้อนกลับ ไม่เปิดซ้อนกันหลายชั้น
 *
 * ก่อนกดยืนยันทุกฟอร์มมีกล่อง "ระบบจะทำสิ่งนี้" บอกผลต่อยอดเงินสามบรรทัด — คนไม่ต้องเดา
 * ว่าเงินจะไปโผล่ที่ไหน และไม่ต้องเปิดประวัติมาเช็คทีหลัง
 *
 * props
 *   kind   'cash' | 'bank' | 'sub'
 *   item   บัญชี (bank) หรือกระเป๋าย่อย (sub) · เงินสดไม่ต้องส่ง
 *   onRename(id, name) / onSetIcon(id, icon) / onDelete(id)  เฉพาะ sub
 */
export default function WalletItemPopup({ kind, item = null, onClose, onRename, onSetIcon, onDelete }) {
  const [view, setView] = useState('menu')
  const [monthKey, setMonthKey] = useState(() => localMonthStr())
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [logs, setLogs] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  // ฟอร์มธุรกรรม
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [note, setNote] = useState('')
  const [pick, setPick] = useState('')        // ปลายทาง/ต้นทางที่เลือกในรายการ
  const [source, setSource] = useState('cash')  // ฝาก/ถอนของบัญชี: 'cash' | 'outside'
  const [loanId, setLoanId] = useState('')
  const [newName, setNewName] = useState(item?.name ?? '')
  const [iconOpen, setIconOpen] = useState(false)
  // เข้าหน้าความเคลื่อนไหวจากสรุปรายปี → ปุ่มย้อนกลับต้องพากลับไปที่สรุปรายปี ไม่ใช่เมนู
  const [cameFromYear, setCameFromYear] = useState(false)

  const cash = useWalletStore((s) => s.cash)
  const accounts = useWalletStore((s) => s.transferAccounts)
  const subWallets = useWalletStore((s) => s.subWallets)
  const loans = useWalletStore((s) => s.loans)
  const transactions = useTransactionStore((s) => s.transactions)
  const getCategoryName = useCategoryStore((s) => s.getCategoryName)
  const { warning, check, proceed, cancel } = useNegativeConfirm()

  const isCash = kind === 'cash'
  const isBank = kind === 'bank'
  const isSub = kind === 'sub'
  // อ่านยอดจาก store เสมอ ไม่ใช่จาก prop — หลังทำรายการแล้วยอดต้องขยับทันทีในป๊อปอัปเดิม
  const live = isBank ? (accounts.find((a) => a.id === item.id) ?? item)
    : isSub ? (subWallets.find((w) => w.id === item.id) ?? item)
    : null
  const balance = isCash ? cash : num(live?.balance)
  const name = isCash ? 'เงินสดในร้าน' : isBank ? formatAccount(live) : live?.name
  const shortName = isCash ? 'เงินสด' : isBank ? (live?.name ?? '') : live?.name
  const activeLoans = isSub ? loans.filter((l) => !l.returned && l.subWalletId === item.id) : []
  const loanTotal = activeLoans.reduce((s, l) => s + num(l.amount), 0)

  // ── ความเคลื่อนไหวจาก activity_logs ─────────────────────────────────────
  useEffect(() => {
    let alive = true
    const since = new Date()
    since.setFullYear(since.getFullYear() - 3)
    listWalletLogsSince(since.toISOString())
      .then((rows) => { if (alive) setLogs(rows) })
      .catch((err) => { if (alive) { setError(err.message); setLogs([]) } })
    return () => { alive = false }
  }, [])

  const getDelta = useMemo(() => (
    isCash ? deltaForCash
      : isBank ? (log) => deltaForAccount(log, item.id)
      : (log) => deltaForSubWallet(log, item.id)
  ), [isCash, isBank, item?.id])
  const years = useMemo(() => (logs ? yearsWithMovement(logs, getDelta) : []), [logs, getDelta])
  const yearData = useMemo(
    () => (logs ? buildYearStatement({ logs, getDelta, currentBalance: balance, year }) : null),
    [logs, getDelta, balance, year],
  )
  const monthData = useMemo(
    () => (logs ? buildMonthEntries({ logs, getDelta, currentBalance: balance, monthKey }) : null),
    [logs, getDelta, balance, monthKey],
  )
  const monthIn = monthData?.rows.reduce((s, r) => s + (r.delta > 0 ? r.delta : 0), 0) ?? 0
  const monthOut = monthData?.rows.reduce((s, r) => s + (r.delta < 0 ? -r.delta : 0), 0) ?? 0

  // ── รายการที่ใช้เงินจากที่นี่ (ตาราง transactions) ─────────────────────
  const txRows = useMemo(() => {
    if (isSub) return []
    return transactions
      .filter((t) => String(t.date).slice(0, 7) === monthKey)
      .filter((t) => (isCash ? t.method === 'cash' : t.method === 'transfer' && t.transferAccountId === item.id))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }, [transactions, monthKey, isCash, isSub, item?.id])
  const txOut = txRows.filter((t) => t.type === 'expense').reduce((s, t) => s + num(t.amount), 0)
  const txIn = txRows.filter((t) => t.type === 'income').reduce((s, t) => s + num(t.amount), 0)
  // กระเป๋าย่อยไม่มีรายรับ-รายจ่ายของตัวเอง "ดูรายการ" จึงเป็นประวัติยืม-คืน
  const loanRows = useMemo(
    () => (isSub ? loans.filter((l) => l.subWalletId === item.id)
      .sort((a, b) => String(b.borrowedAt).localeCompare(String(a.borrowedAt))) : []),
    [loans, isSub, item?.id],
  )

  // ── ตัวเลือกต้นทาง/ปลายทาง ────────────────────────────────────────────
  const bankOptions = (exceptId = null) => accounts
    .filter((a) => a.id !== exceptId)
    .map((a) => ({ key: a.id, name: formatAccount(a), meta: `เหลือ ${fmt(a.balance)}`, icon: a.icon }))
  const cashOption = { key: 'cash', name: 'เงินสดในร้าน', meta: `เหลือ ${fmt(cash)}`, chip: 'สด', chipClass: 'bg-[#F2FAD9] text-[#5C7A0F]' }
  const moneyOptions = [cashOption, ...bankOptions()]           // เงินสด + ทุกบัญชี (สำหรับกระเป๋าย่อย)
  const subOptions = (exceptId = null) => subWallets
    .filter((w) => w.id !== exceptId)
    .map((w) => ({ key: w.id, name: w.name, meta: `กันไว้แล้ว ${fmt(w.balance)}`, icon: w.icon, fallback: 'wallet' }))

  /** ฟอร์มธุรกรรมของแต่ละมุมมอง — ใครเป็นต้นทาง ปลายทาง เลือกอะไรได้ และผลสามบรรทัด */
  const MOVE = useMemo(() => {
    const amt = num(amount)
    const pickedBank = accounts.find((a) => a.id === pick)
    const pickedSub = subWallets.find((w) => w.id === pick)
    const moneyName = pick === 'cash' ? 'เงินสดในร้าน' : (pickedBank ? formatAccount(pickedBank) : 'ที่เลือก')
    const bal = fmt(balance)
    if (isBank) {
      return {
        deposit: {
          title: 'ฝากเงินเข้าบัญชี', sub: `เงินเข้า ${shortName}`,
          from: source === 'cash' ? `เงินสดในร้าน · เหลือ ${fmt(cash)}` : 'เงินจากข้างนอก (ไม่ได้มาจากกระเป๋าไหนในแอป)',
          fromLabel: 'ตัดจาก', toLabel: 'เข้าบัญชี', to: `${name} · เหลือ ${bal}`,
          sourceToggle: [['cash', 'เงินสดในร้าน'], ['outside', 'รับจากข้างนอก']],
          effect: source === 'cash'
            ? ['เงินสดในร้านลดลง', 'ยอดในบัญชีเพิ่มขึ้นเท่ากัน', 'ยอดรวมทั้งร้านไม่เปลี่ยน']
            : ['ยอดในบัญชีเพิ่มขึ้น', 'ยอดรวมทั้งร้านเพิ่มขึ้นเท่ากัน', 'ไม่นับเป็นรายรับในรายงาน — ถ้าเป็นรายได้ให้บันทึกที่ "บันทึกรายการ"'],
          ok: 'บันทึกการฝากเงิน',
        },
        withdraw: {
          title: 'ถอนเงินออกจากบัญชี', sub: `เงินออกจาก ${shortName}`,
          fromLabel: 'ตัดจากบัญชี', from: `${name} · เหลือ ${bal}`,
          toLabel: 'เข้าที่', to: source === 'cash' ? `เงินสดในร้าน · เหลือ ${fmt(cash)}` : 'ออกไปข้างนอก (ไม่เข้ากระเป๋าไหนในแอป)',
          sourceToggle: [['cash', 'เป็นเงินสดในร้าน'], ['outside', 'จ่ายออกข้างนอก']],
          effect: source === 'cash'
            ? ['ยอดในบัญชีลดลง', 'เงินสดในร้านเพิ่มขึ้นเท่ากัน', 'ยอดรวมทั้งร้านไม่เปลี่ยน']
            : ['ยอดในบัญชีลดลง', 'ยอดรวมทั้งร้านลดลงเท่ากัน', 'ไม่นับเป็นรายจ่ายในรายงาน — ถ้าเป็นค่าใช้จ่ายให้บันทึกที่ "บันทึกรายการ"'],
          ok: 'บันทึกการถอนเงิน',
        },
        transfer: {
          title: 'โอนเงินไปบัญชีอื่น', sub: 'ย้ายเงินระหว่างบัญชีธนาคารของร้าน',
          fromLabel: 'ตัดจากบัญชี', from: `${name} · เหลือ ${bal}`, toLabel: 'โอนเข้าบัญชี',
          options: bankOptions(item.id),
          effect: ['ยอดในบัญชีต้นทางลดลง', `ยอด ${pickedBank ? formatAccount(pickedBank) : 'บัญชีปลายทาง'} เพิ่มขึ้นเท่ากัน`, 'ยอดรวมทั้งร้านไม่เปลี่ยน'],
          ok: 'บันทึกการโอนเงิน',
        },
        pocket: {
          title: 'ฝากเข้ากระเป๋าตังค์ย่อย', sub: `กันเงินจาก ${shortName} ไว้ในกระเป๋าย่อย`,
          fromLabel: 'กันเงินจาก', from: `${name} · เหลือ ${bal}`, toLabel: 'เข้ากระเป๋า',
          options: subOptions(),
          effect: [`ยอดในกระเป๋า ${pickedSub?.name ?? 'ที่เลือก'} เพิ่มขึ้น`, 'ยอดในบัญชีลดลงเท่ากัน', 'ยอดรวมทั้งร้านไม่เปลี่ยน แต่ที่ใช้ได้จริงลดลงเท่าที่กันไว้'],
          ok: 'บันทึกการกันเงิน',
        },
      }
    }
    if (isCash) {
      return {
        deposit: {
          title: 'ฝากเงินสดเข้าบัญชี', sub: 'ย้ายเงินสดในร้านเข้าบัญชีธนาคาร',
          fromLabel: 'ตัดจาก', from: `เงินสดในร้าน · เหลือ ${bal}`, toLabel: 'เข้าบัญชี',
          options: bankOptions(),
          effect: ['เงินสดในร้านลดลง', `ยอด ${pickedBank ? formatAccount(pickedBank) : 'บัญชีที่เลือก'} เพิ่มขึ้นเท่ากัน`, 'ยอดรวมทั้งร้านไม่เปลี่ยน'],
          ok: 'บันทึกการฝากเงิน',
        },
        withdraw: {
          title: 'ถอนเงินมาเป็นเงินสด', sub: 'ย้ายเงินจากบัญชีธนาคารมาเก็บในร้าน',
          fromLabel: 'ตัดจากบัญชี', toLabel: 'เข้าที่', to: `เงินสดในร้าน · เหลือ ${bal}`,
          options: bankOptions(), pickLabel: 'ถอนจากบัญชี',
          effect: [`ยอด ${pickedBank ? formatAccount(pickedBank) : 'บัญชีที่เลือก'} ลดลง`, 'เงินสดในร้านเพิ่มขึ้นเท่ากัน', 'ยอดรวมทั้งร้านไม่เปลี่ยน'],
          ok: 'บันทึกการถอนเงิน',
        },
        receive: {
          title: 'รับเงินสดเข้าร้าน', sub: 'เงินสดใหม่ที่ไม่ได้มาจากกระเป๋าไหนในแอป',
          fromLabel: 'มาจาก', from: 'ข้างนอก เช่นเงินส่วนตัวเติมเข้าร้าน', toLabel: 'เข้าที่', to: `เงินสดในร้าน · เหลือ ${bal}`,
          effect: ['เงินสดในร้านเพิ่มขึ้น', 'ยอดรวมทั้งร้านเพิ่มขึ้นเท่ากัน', 'ไม่นับเป็นรายรับในรายงาน — ถ้าเป็นยอดขายให้บันทึกที่ "บันทึกรายการ"'],
          ok: 'บันทึกการรับเงิน',
        },
        pocket: {
          title: 'ฝากเข้ากระเป๋าตังค์ย่อย', sub: 'กันเงินสดไว้ในกระเป๋าย่อย',
          fromLabel: 'กันเงินจาก', from: `เงินสดในร้าน · เหลือ ${bal}`, toLabel: 'เข้ากระเป๋า',
          options: subOptions(),
          effect: [`ยอดในกระเป๋า ${pickedSub?.name ?? 'ที่เลือก'} เพิ่มขึ้น`, 'เงินสดในร้านลดลงเท่ากัน', 'ยอดรวมทั้งร้านไม่เปลี่ยน แต่ที่ใช้ได้จริงลดลงเท่าที่กันไว้'],
          ok: 'บันทึกการกันเงิน',
        },
      }
    }
    const loan = activeLoans.find((l) => l.id === loanId) ?? activeLoans[0]
    return {
      deposit: {
        title: 'ฝากเงินเข้ากระเป๋า', sub: `กันเงินจากกระเป๋าหลักมาเก็บไว้ใน ${name}`,
        fromLabel: 'กันเงินจาก', toLabel: 'เข้ากระเป๋า', to: `${name} · เหลือ ${bal}`,
        options: moneyOptions, pickLabel: 'กันเงินจาก',
        effect: [`ยอดในกระเป๋า ${name} เพิ่มขึ้น`, `ยอด ${moneyName} ลดลงเท่ากัน`, 'ยอดรวมทั้งร้านไม่เปลี่ยน'],
        ok: 'บันทึกการฝากเงิน',
      },
      withdraw: {
        title: 'ถอนเงินออกจากกระเป๋า', sub: `เอาเงินที่กันไว้ใน ${name} ออกมาใช้`,
        fromLabel: 'ตัดจากกระเป๋า', from: `${name} · เหลือ ${bal}`, toLabel: 'เข้าที่',
        options: moneyOptions,
        effect: [`ยอดในกระเป๋า ${name} ลดลง`, `ยอด ${moneyName} เพิ่มขึ้นเท่ากัน`, 'ยอดรวมทั้งร้านไม่เปลี่ยน'],
        ok: 'บันทึกการถอนเงิน',
      },
      transfer: {
        title: 'โอนไปกระเป๋าตังค์ย่อยอื่น', sub: 'ย้ายเงินระหว่างกระเป๋าตังค์ย่อย',
        fromLabel: 'ตัดจากกระเป๋า', from: `${name} · เหลือ ${bal}`, toLabel: 'โอนเข้ากระเป๋า',
        options: subOptions(item.id),
        effect: ['ยอดในกระเป๋าต้นทางลดลง', `ยอดในกระเป๋า ${pickedSub?.name ?? 'ปลายทาง'} เพิ่มขึ้นเท่ากัน`, 'ไม่กระทบเงินสดและบัญชีธนาคาร'],
        ok: 'บันทึกการโอนเงิน',
      },
      borrow: {
        title: 'ยืมเงินจากกระเป๋า', sub: `เอาเงินใน ${name} มาใช้ก่อน แล้วบันทึกว่าต้องคืน`,
        fromLabel: 'ยืมจาก', from: `${name} · เหลือ ${bal}`, toLabel: 'ยืมเป็น',
        options: moneyOptions,
        effect: [`ยอดในกระเป๋า ${name} ลดลง`, `ยอด ${moneyName} เพิ่มขึ้นเท่ากัน`, 'ระบบบันทึกเป็นยอดยืมค้าง แล้วเตือนที่หน้ากระเป๋าเงินและรอดำเนินการ'],
        ok: 'บันทึกการยืม',
      },
      repay: {
        title: 'คืนเงินเข้ากระเป๋า', sub: `คืนยอดที่ยืมออกไปกลับเข้า ${name}`,
        fromLabel: 'หักจาก', toLabel: 'คืนเข้ากระเป๋า', to: `${name} · เหลือ ${bal}`,
        options: moneyOptions, pickLabel: 'หักจากกระเป๋า', fixedAmount: loan ? num(loan.amount) : 0, loan,
        effect: [`ยอด ${moneyName} ลดลง ${fmt(loan?.amount)}`, `ยอดในกระเป๋า ${name} กลับมาเท่าเดิม`, `ยอดยืมค้าง ${fmt(loan?.amount)} ถูกปิด`],
        ok: 'บันทึกการคืนเงิน',
      },
    }
  }, [isBank, isCash, amount, pick, source, loanId, accounts, subWallets, cash, balance, name, shortName, item?.id, activeLoans]) // eslint-disable-line react-hooks/exhaustive-deps

  const move = MOVE[view] ?? null
  const value = move?.fixedAmount ?? num(amount)
  const needsPick = !!move?.options
  const pickOk = !needsPick || !!pick

  const openView = (v) => {
    setAmount(''); setNote(''); setPick(''); setSource('cash'); setError(''); setDone('')
    setDate(format(new Date(), 'yyyy-MM-dd'))
    if (v === 'repay') { setLoanId(activeLoans[0]?.id ?? ''); setPick(activeLoans[0]?.method === 'transfer' ? (activeLoans[0]?.transferAccountId ?? '') : 'cash') }
    if (v === 'rename') setNewName(live?.name ?? '')
    if (v === 'icon') { setIconOpen(true); return }
    setView(v)
  }
  const back = () => {
    setError('')
    if (view === 'statement' && cameFromYear) { setCameFromYear(false); setView('yearly') }
    else setView('menu')
  }

  // ── ทำรายการ ─────────────────────────────────────────────────────────────
  const submit = () => {
    if (busy) return
    if (view === 'rename') return doRename()
    if (view === 'del') return doDelete()
    if (!move) return onClose()
    if (view === 'repay' && !move.loan) return setError('ไม่มียอดยืมค้างให้คืนแล้ว')
    if (!(value > 0)) return setError('ใส่จำนวนเงิน')
    if (!pickOk) return setError(`เลือก${move.pickLabel ?? move.toLabel}`)
    const dl = ` (${formatIsoThai(date)})`
    const desc = (base) => base + dl + (note.trim() ? ` — ${note.trim()}` : '')
    const method = pick === 'cash' ? 'cash' : 'transfer'
    const acct = pick === 'cash' ? null : pick

    const execute = async () => {
      setBusy(true); setError('')
      try {
        if (isBank) {
          if (view === 'deposit' && source === 'cash') await transferBetweenWallets('cash', 'transfer', value, { description: desc(`ฝากเงินสด ${fmt(value)} บาท เข้าบัญชี "${name}"`) }, item.id)
          else if (view === 'deposit') await addToWallet('transfer', value, { activityType: 'BANK_DEPOSIT', description: desc(`รับเงินโอน ${fmt(value)} บาท เข้าบัญชี "${name}"`) }, item.id)
          else if (view === 'withdraw' && source === 'cash') await transferBetweenWallets('transfer', 'cash', value, { description: desc(`ถอนเงิน ${fmt(value)} บาท จากบัญชี "${name}" เป็นเงินสด`) }, item.id)
          else if (view === 'withdraw') await deductWallet('transfer', value, { activityType: 'BANK_WITHDRAW', description: desc(`จ่ายเงินออกจากบัญชี "${name}" ${fmt(value)} บาท`) }, item.id)
          else if (view === 'transfer') await moveBetweenTransferAccounts(item.id, pick, value)
          else if (view === 'pocket') await depositToSubWallet(pick, value, 'transfer', { description: desc(`กันเงิน ${fmt(value)} บาท จากบัญชี "${name}" เข้ากระเป๋า "${subWallets.find((w) => w.id === pick)?.name}"`) }, item.id)
        } else if (isCash) {
          if (view === 'deposit') await transferBetweenWallets('cash', 'transfer', value, { description: desc(`ฝากเงินสด ${fmt(value)} บาท เข้าบัญชี "${formatAccount(accounts.find((a) => a.id === pick))}"`) }, pick)
          else if (view === 'withdraw') await transferBetweenWallets('transfer', 'cash', value, { description: desc(`ถอนเงิน ${fmt(value)} บาท จากบัญชี "${formatAccount(accounts.find((a) => a.id === pick))}" เป็นเงินสด`) }, pick)
          else if (view === 'receive') await addToWallet('cash', value, { activityType: 'CASH_DEPOSIT', description: desc(`รับเงินสดเข้าร้าน ${fmt(value)} บาท`) })
          else if (view === 'pocket') await depositToSubWallet(pick, value, 'cash', { description: desc(`กันเงินสด ${fmt(value)} บาท เข้ากระเป๋า "${subWallets.find((w) => w.id === pick)?.name}"`) })
        } else {
          if (view === 'deposit') await depositToSubWallet(item.id, value, method, { description: desc(`ฝากเงินเข้า "${name}" ${fmt(value)} บาท`) }, acct)
          else if (view === 'withdraw') await withdrawFromSubWallet(item.id, value, method, { description: desc(`ถอนเงินจาก "${name}" ${fmt(value)} บาท`) }, acct)
          else if (view === 'transfer') await transferBetweenSubWallets(item.id, pick, value)
          else if (view === 'borrow') await borrowFromSubWallet(item.id, value, method, name, acct)
          else if (view === 'repay') await returnLoan(move.loan.id, method, acct)
        }
        setDone(`${move.ok.replace('บันทึก', '')} ${fmt(value)} บาท เรียบร้อย`)
        setView('menu')
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
    }

    // เตือนก่อนถ้ากระเป๋าต้นทางจะติดลบ — ไม่บล็อก เพราะบางทีคนบันทึกย้อนหลังไม่เรียงลำดับ
    if (isBank) {
      if (view === 'deposit' && source === 'cash') check({ method: 'cash', amount: value, onConfirm: execute })
      else if (view === 'deposit') execute()
      else check({ method: 'transfer', amount: value, accountId: item.id, onConfirm: execute })
    } else if (isCash) {
      if (view === 'withdraw') check({ method: 'transfer', amount: value, accountId: pick, onConfirm: execute })
      else if (view === 'receive') execute()
      else check({ method: 'cash', amount: value, onConfirm: execute })
    } else {
      if (view === 'deposit' || view === 'repay') check({ method, amount: value, accountId: acct, onConfirm: execute })
      else check({ subWalletId: item.id, amount: value, onConfirm: execute })
    }
  }

  const doRename = async () => {
    const v = newName.trim()
    if (!v) return setError('ใส่ชื่อกระเป๋า')
    setBusy(true)
    try { await onRename?.(item.id, v); setDone('เปลี่ยนชื่อเรียบร้อย'); setView('menu') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const doDelete = async () => {
    setBusy(true)
    try { await onDelete?.(item.id); onClose() }
    catch (err) { setError(err.message); setBusy(false) }
  }

  // ── หัวเรื่อง / ความกว้าง / ปุ่มท้าย ────────────────────────────────────
  const head = move ? [move.title, move.sub]
    : view === 'txlist' ? [isSub ? 'ประวัติยืม-คืน' : 'รายการที่ใช้เงินจากที่นี่', `${name} · เดือน ${monthLabel(monthKey)}`]
    : view === 'statement' ? ['ความเคลื่อนไหว', `${name} · ${monthLabel(monthKey)} · เงินเข้า-ออกทุกรายการ`]
    : view === 'yearly' ? ['สรุปความเคลื่อนไหวรายปี', `${name} · ปี ${year + 543} · กดที่เดือนเพื่อดูรายละเอียด`]
    : view === 'rename' ? ['เปลี่ยนชื่อกระเป๋า', 'ชื่อนี้จะไปแสดงในรายงานและในฟอร์มบันทึกรายการ']
    : view === 'del' ? [`ลบกระเป๋า ${name}`, 'ยอดที่กันไว้จะกลับไปรวมกับกระเป๋าหลัก']
    : [name, `คงเหลือ ${fmt(balance)}${isBank && live?.bankName ? ` · ${live.bankName}${live.accountNo ? ` · ${live.accountNo}` : ''}` : ''}${isSub && loanTotal > 0 ? ` · ยืมออกไป ${fmt(loanTotal)} ยังไม่คืน` : ''}`]
  const width = view === 'menu' ? 520 : view === 'yearly' ? 620 : (view === 'statement' || view === 'txlist') ? 660 : 470
  const okLabel = move ? move.ok : view === 'rename' ? 'บันทึกชื่อใหม่' : view === 'del' ? 'ลบกระเป๋า' : 'ปิด'
  const okDisabled = move ? (!(value > 0) || !pickOk) : false
  const showOk = !!move || view === 'rename' || view === 'del' || view === 'menu'

  const chip = (
    <span className={`w-[34px] h-[34px] flex-none rounded-[10px] flex items-center justify-center text-[11px] font-bold ${
      isCash ? 'bg-[#F2FAD9] text-[#5C7A0F]' : 'bg-paper'
    }`}>
      {isCash ? 'สด' : <AppIcon value={live?.icon} size={20} fallback={isSub ? 'wallet' : DEFAULT_ICONS.account} />}
    </span>
  )

  const tiles = isSub
    ? [
      { icon: 'south_west', label: 'ฝากเงิน', desc: 'เข้ากระเป๋านี้', v: 'deposit' },
      { icon: 'north_east', label: 'ถอนเงิน', desc: 'ออกไปใช้', v: 'withdraw' },
      { icon: 'swap_horiz', label: 'โอนเงิน', desc: 'ไปกระเป๋าย่อยอื่น', v: 'transfer', disabled: subWallets.length < 2 },
      // ยืม = ยังต้องคืน จึงใช้สีเหลืองของ 'ค้างอยู่' ไม่ใช่สีน้ำตาลของกระเป๋าย่อย
      { icon: 'handshake', label: 'ยืมเงิน', desc: 'ใช้ก่อน คืนทีหลัง', v: 'borrow', tone: 'wait' },
    ]
    : isCash
      ? [
        { icon: 'south_west', label: 'ฝากเงิน', desc: 'เงินสด → บัญชี', v: 'deposit', disabled: accounts.length === 0 },
        { icon: 'north_east', label: 'ถอนเงิน', desc: 'บัญชี → เงินสด', v: 'withdraw', disabled: accounts.length === 0 },
        { icon: 'add', label: 'รับเงินสด', desc: 'เงินใหม่เข้าร้าน', v: 'receive' },
        { icon: 'savings', label: 'กระเป๋าย่อย', desc: 'กันเงินไว้', v: 'pocket', disabled: subWallets.length === 0 },
      ]
      : [
        { icon: 'south_west', label: 'ฝากเงิน', desc: 'เข้าบัญชีนี้', v: 'deposit' },
        { icon: 'north_east', label: 'ถอนเงิน', desc: 'ออกจากบัญชีนี้', v: 'withdraw' },
        { icon: 'swap_horiz', label: 'โอนเงิน', desc: 'ไปบัญชีอื่น', v: 'transfer', disabled: accounts.length < 2 },
        { icon: 'savings', label: 'กระเป๋าย่อย', desc: 'กันเงินไว้', v: 'pocket', disabled: subWallets.length === 0 },
      ]

  const footer = (
    <div className="flex-none flex items-center gap-2 px-[17px] py-3 border-t border-[#EFEDE7] bg-[#FAF9F6]">
      {view !== 'menu' && (
        <button onClick={back} disabled={busy} className="h-[38px] px-4 rounded-[11px] border border-hairline bg-white text-[13px] font-semibold flex items-center gap-1.5 hover:bg-paper disabled:opacity-50">
          <Icon name="chevron_left" size={17} />
          ย้อนกลับ
        </button>
      )}
      {showOk && (
        <button
          onClick={view === 'menu' ? onClose : submit}
          disabled={busy || okDisabled}
          className={`ml-auto h-[38px] px-[18px] rounded-[11px] text-white text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 ${view === 'del' ? 'bg-expense' : 'bg-ink'}`}
        >
          {busy ? 'กำลังบันทึก…' : okLabel}
        </button>
      )}
    </div>
  )

  const monthNav = (
    <div className="flex items-center gap-1.5">
      <button onClick={() => setMonthKey(shiftMonth(monthKey, -1))} className="w-8 h-8 rounded-[9px] border border-hairline bg-white flex items-center justify-center hover:bg-paper"><Icon name="chevron_left" size={17} /></button>
      <span className="text-[12.5px] font-semibold min-w-[84px] text-center">{monthLabel(monthKey)}</span>
      <button onClick={() => setMonthKey(shiftMonth(monthKey, 1))} className="w-8 h-8 rounded-[9px] border border-hairline bg-white flex items-center justify-center hover:bg-paper"><Icon name="chevron_right" size={17} /></button>
    </div>
  )

  return (
    <>
    <Popup title={head[0]} sub={head[1]} icon={isCash ? 'payments' : isBank ? 'account_balance' : 'savings'} width={width} onClose={onClose} footer={footer}>

      {/* ── เมนู ─────────────────────────────────────────────────────── */}
      {view === 'menu' && (
        <>
          {done && (
            <p className="text-[12px] text-income bg-income-soft border border-[#BFE0D2] rounded-ctl px-3 py-2 flex items-center gap-1.5">
              <Icon name="check_circle" size={15} />{done}
            </p>
          )}
          {isSub && activeLoans.length > 0 && (
            <div className="flex items-center gap-2.5 bg-pending-soft border border-pending-line rounded-[12px] px-3 py-2.5">
              <Icon name="schedule" size={18} className="flex-none text-[#A8760B]" />
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-semibold text-[#8A6A15]">ยืมออกไปแล้วยังไม่คืน {fmt(loanTotal)}</span>
                <span className="block text-[10.5px] text-[#A08040]">
                  {activeLoans.length} รายการ · ล่าสุด {formatIsoThai(String(activeLoans[0].borrowedAt).slice(0, 10))}
                </span>
              </span>
              <button onClick={() => openView('repay')} className="flex-none h-[30px] px-3 rounded-[9px] bg-ink text-white text-[12px] font-semibold hover:bg-black">คืนเงิน</button>
            </div>
          )}
          <div className="flex items-center gap-[11px] bg-[#FAF9F6] border border-[#EFEDE7] rounded-[13px] px-[13px] py-[11px]">
            {chip}
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-semibold truncate">{name}</span>
              <span className="block text-[11px] text-faint">ยอดคงเหลือตอนนี้</span>
            </span>
            <span className={`flex-none tabular-nums text-[16px] font-bold ${balance < 0 ? 'text-expense' : 'text-[#12795B]'}`}>{fmt(balance)}</span>
          </div>

          {[
            { label: 'ทำธุรกรรม', hint: 'ย้ายเงินระหว่างกระเป๋าของร้าน ไม่นับเป็นรายรับหรือรายจ่าย', tiles },
            {
              label: 'ข้อมูล', hint: 'ดูว่าเงินจากที่นี่ถูกใช้ไปกับอะไร และเข้า-ออกช่วงไหน',
              tiles: [
                { icon: 'receipt_long', label: 'ดูรายการ', desc: isSub ? 'ยืม-คืน' : 'ใช้กับอะไร', v: 'txlist' },
                { icon: 'swap_vert', label: 'ความเคลื่อนไหว', desc: 'เงินเข้า-ออก', v: 'statement' },
                { icon: 'calendar_month', label: 'สรุปรายปี', desc: '12 เดือน', v: 'yearly' },
              ],
            },
            ...(isSub ? [{
              label: 'จัดการกระเป๋า', hint: 'ชื่อ ไอคอน และการลบกระเป๋าใบนี้',
              tiles: [
                { icon: 'edit_note', label: 'เปลี่ยนชื่อ', desc: live?.name, v: 'rename' },
                { icon: 'palette', label: 'เปลี่ยนไอคอน', desc: 'เลือกจากคลัง', v: 'icon' },
                { icon: 'delete', label: 'ลบกระเป๋า', desc: 'ยอดกลับกระเป๋าหลัก', v: 'del', danger: true },
              ],
            }] : []),
          ].map((sec) => (
            <div key={sec.label}>
              <div className="flex items-baseline gap-2 mb-[7px]">
                <span className="text-[12.5px] font-semibold">{sec.label}</span>
                <span className="flex-1 min-w-0 text-[11px] text-faint leading-relaxed">{sec.hint}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {sec.tiles.map((t) => (
                  <Tile key={t.v} icon={t.icon} label={t.label} desc={t.desc} tone={t.tone} danger={t.danger} disabled={t.disabled} onClick={() => openView(t.v)} />
                ))}
              </div>
            </div>
          ))}

          {isBank && (
            <p className="text-[11px] text-faint leading-relaxed">
              เปลี่ยนชื่อ ธนาคาร เลขบัญชี ปรับยอด หรือลบบัญชี ทำได้ที่{' '}
              <Link to="/manage/accounts" onClick={onClose} className="text-income font-semibold hover:underline">จัดการข้อมูล → บัญชีธนาคาร</Link>
            </p>
          )}
        </>
      )}

      {/* ── ฟอร์มธุรกรรม ───────────────────────────────────────────── */}
      {move && (
        <>
          <div className="grid grid-cols-2 gap-[9px]">
            <div>
              <label className="label">จำนวนเงิน</label>
              {move.fixedAmount ? (
                <div className="h-[44px] px-3 border border-hairline rounded-ctl bg-paper flex items-center tabular-nums text-[17px] font-bold">{fmt(move.fixedAmount)}</div>
              ) : (
                <AmountInput className="input text-right text-[17px] font-bold tabular-nums" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }} placeholder="0.00" autoFocus />
              )}
            </div>
            <div>
              <label className="label">วันที่ทำรายการ</label>
              <DatePicker value={date} onChange={setDate} />
            </div>
          </div>

          {move.sourceToggle && (
            <div className="grid grid-cols-2 gap-2">
              {move.sourceToggle.map(([k, label]) => (
                <button key={k} onClick={() => setSource(k)} className={`h-9 rounded-[10px] text-[12.5px] font-semibold transition ${source === k ? 'bg-ink text-white' : 'border border-hairline bg-white text-muted hover:bg-paper'}`}>{label}</button>
              ))}
            </div>
          )}

          {view === 'repay' && activeLoans.length > 1 && (
            <div>
              <label className="label">คืนรายการไหน</label>
              <PickList
                options={activeLoans.map((l) => ({ key: l.id, name: `ยืม ${fmt(l.amount)} บาท`, meta: `${formatIsoThai(String(l.borrowedAt).slice(0, 10))} · ยืมเป็น${l.method === 'cash' ? 'เงินสด' : 'เงินโอน'}`, chip: '฿', chipClass: 'bg-pending-soft text-[#8A6A15]' }))}
                value={move.loan?.id ?? ''}
                onChange={setLoanId}
              />
            </div>
          )}

          <div className="flex flex-col gap-[7px]">
            {move.from && <FixedRow label={move.fromLabel} value={move.from} />}
            {move.to && <FixedRow label={move.toLabel} value={move.to} />}
          </div>

          {needsPick && (
            <div>
              <label className="label">{move.pickLabel ?? move.toLabel}</label>
              <PickList options={move.options} value={pick} onChange={(k) => { setPick(k); setError('') }} />
            </div>
          )}

          <div>
            <label className="label">โน้ต <span className="text-faint font-normal">(ไม่ใส่ก็ได้)</span></label>
            <input className="input !h-[38px] text-[12.5px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ฝากเข้าบัญชีตอนปิดร้าน" />
          </div>

          <div className="bg-[#F2FAD9] border border-[#D9EBA0] rounded-[12px] px-[13px] py-2.5">
            <div className="text-[11.5px] font-semibold text-[#3F5A08] mb-1">ระบบจะทำสิ่งนี้</div>
            <div className="flex flex-col gap-[3px] text-[11.5px] text-[#4A5C1E] leading-[1.55]">
              {move.effect.map((e) => <span key={e}>· {e}</span>)}
              {value > 0 && (
                <span>· ยอด {name} หลังทำรายการ{' '}
                  <b className="tabular-nums">
                    {fmt(balance + ((isCash ? ['withdraw', 'receive'] : ['deposit', 'repay']).includes(view) ? value : -value))}
                  </b>
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── ดูรายการ ───────────────────────────────────────────────── */}
      {view === 'txlist' && (
        <>
          <div className="flex items-center gap-2.5 bg-[#FAF9F6] border border-[#EFEDE7] rounded-[11px] px-3 py-2">
            {monthNav}
            <span className="flex-1 min-w-0 text-[11.5px] text-muted text-right">
              {isSub ? `${loanRows.length} รายการ` : `${txRows.length} รายการ${txIn > 0 ? ` · รับ ${fmt(txIn)}` : ''}`}
            </span>
            {!isSub && <><span className="flex-none text-[11px] text-faint">จ่าย</span><span className="flex-none tabular-nums text-[14px] font-bold text-expense">{fmt(txOut)}</span></>}
          </div>
          {isSub ? (
            loanRows.length === 0 ? <p className="text-center text-[12.5px] text-faint py-8">ยังไม่เคยยืมเงินจากกระเป๋านี้</p>
              : loanRows.map((l) => (
                <div key={l.id} className="grid grid-cols-[64px_minmax(0,1fr)_96px_92px] gap-2 items-center py-2 border-b border-[#F5F3EE]">
                  <span className="tabular-nums text-[11.5px] text-muted">{timeLabel(l.borrowedAt)}</span>
                  <span className="text-[12.5px] font-medium truncate">ยืมเป็น{l.method === 'cash' ? 'เงินสด' : 'เงินโอน'}{l.returned && l.returnedAt ? ` · คืนแล้ว ${timeLabel(l.returnedAt)}` : ''}</span>
                  <span className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 justify-self-start ${l.returned ? 'bg-income-soft text-income' : 'bg-pending-soft text-[#8A6A15]'}`}>{l.returned ? 'คืนแล้ว' : 'ยังไม่คืน'}</span>
                  <span className="tabular-nums text-[12.5px] font-semibold text-right">{fmt(l.amount)}</span>
                </div>
              ))
          ) : txRows.length === 0 ? (
            <p className="text-center text-[12.5px] text-faint py-8">เดือนนี้ไม่มีรายการที่ใช้เงินจากที่นี่</p>
          ) : (
            <>
              <div className="grid grid-cols-[56px_minmax(0,1fr)_150px_92px] gap-2 pb-1.5 border-b border-[#EFEDE7] text-[10.5px] font-semibold text-faint">
                <span>วันที่</span><span>รายการ</span><span>หมวดหมู่</span><span className="text-right">จำนวน</span>
              </div>
              {txRows.map((t) => (
                <div key={t.id} className="grid grid-cols-[56px_minmax(0,1fr)_150px_92px] gap-2 items-center py-2 border-b border-[#F5F3EE]">
                  <span className="tabular-nums text-[11.5px] text-muted">{timeLabel(t.date + 'T00:00:00')}</span>
                  <span className="min-w-0"><span className="block text-[12.5px] font-medium truncate">{t.itemName || '(ไม่ระบุชื่อ)'}</span>{t.vendor && <span className="block text-[10.5px] text-faint truncate">{t.vendor}</span>}</span>
                  <span className="text-[11px] text-faint truncate">{getCategoryName(t.category)}</span>
                  <span className={`tabular-nums text-[12.5px] font-semibold text-right ${t.type === 'income' ? 'text-income' : ''}`}>{t.type === 'income' ? '+' : ''}{fmt(t.amount)}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* ── ความเคลื่อนไหวรายเดือน ────────────────────────────────────── */}
      {view === 'statement' && (
        <>
          <div className="flex items-center justify-between gap-2">
            {monthNav}
            <span className="text-[11px] text-faint">ยอดยกมา <b className="tabular-nums text-ink">{fmt(monthData?.opening)}</b> · ยกไป <b className="tabular-nums text-ink">{fmt(monthData?.closing)}</b></span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#F4FBEE] border border-[#D9EBA0] rounded-[11px] px-3 py-2"><div className="text-[10.5px] text-[#5C7A0F]">เงินเข้า</div><div className="tabular-nums text-[15px] font-bold text-income">{fmt(monthIn)}</div></div>
            <div className="bg-expense-soft border border-[#F5D3CE] rounded-[11px] px-3 py-2"><div className="text-[10.5px] text-[#A3564C]">เงินออก</div><div className="tabular-nums text-[15px] font-bold text-expense">{fmt(monthOut)}</div></div>
            <div className="bg-[#FAF9F6] border border-[#EFEDE7] rounded-[11px] px-3 py-2"><div className="text-[10.5px] text-muted">สุทธิ</div><div className={`tabular-nums text-[15px] font-bold ${monthIn - monthOut >= 0 ? 'text-income' : 'text-expense'}`}>{monthIn - monthOut >= 0 ? '+' : '−'}{fmt(Math.abs(monthIn - monthOut))}</div></div>
          </div>
          {logs === null ? <p className="text-center text-[12.5px] text-faint py-8">กำลังอ่านความเคลื่อนไหว…</p>
            : monthData.rows.length === 0 ? <p className="text-center text-[12.5px] text-faint py-8">เดือนนี้ยังไม่มีความเคลื่อนไหว</p>
            : (
              <>
                <div className="grid grid-cols-[52px_minmax(0,1fr)_72px_92px_92px_100px] gap-2 pb-1.5 border-b border-[#EFEDE7] text-[10.5px] font-semibold text-faint">
                  <span>วันที่</span><span>รายละเอียด</span><span>ประเภท</span><span className="text-right">เงินเข้า</span><span className="text-right">เงินออก</span><span className="text-right">คงเหลือ</span>
                </div>
                {monthData.rows.slice().reverse().map((r) => (
                  <div key={r.id} className="grid grid-cols-[52px_minmax(0,1fr)_72px_92px_92px_100px] gap-2 items-center py-2 border-b border-[#F5F3EE]">
                    <span className="tabular-nums text-[11.5px] text-muted">{timeLabel(r.timestamp)}</span>
                    <span className="text-[12.5px] font-medium truncate" title={r.description}>{r.description}</span>
                    <span className={`text-[10.5px] font-semibold rounded-full px-[7px] py-0.5 justify-self-start whitespace-nowrap ${r.delta > 0 ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`}>{kindOf(r)}</span>
                    <span className="tabular-nums text-[12.5px] font-semibold text-right text-income">{r.delta > 0 ? fmt(r.delta) : ''}</span>
                    <span className="tabular-nums text-[12.5px] font-semibold text-right text-expense">{r.delta < 0 ? fmt(-r.delta) : ''}</span>
                    <span className="tabular-nums text-[12.5px] text-right text-muted">{fmt(r.balance)}</span>
                  </div>
                ))}
              </>
            )}
          <p className="text-[11px] text-faint leading-relaxed">ไล่จากประวัติการใช้งานของแอป (ย้อนหลัง 3 ปี) ไม่ใช่ใบแจ้งยอดจากธนาคาร · ยอดคงเหลือไล่ถอยหลังจากยอดจริงตอนนี้</p>
        </>
      )}

      {/* ── สรุปรายปี ──────────────────────────────────────────────── */}
      {view === 'yearly' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {years.slice(0, 4).map((y) => (
              <button key={y} onClick={() => setYear(y)} className={`h-8 px-3 rounded-[9px] text-[12.5px] border ${y === year ? 'bg-ink text-white border-ink font-semibold' : 'bg-white border-hairline hover:bg-paper'}`}>{y + 543}</button>
            ))}
            <span className="ml-auto text-[11px] text-faint">ยอดคงเหลือตอนนี้ {fmt(balance)}</span>
          </div>
          {logs === null ? <p className="text-center text-[12.5px] text-faint py-8">กำลังอ่านความเคลื่อนไหว…</p> : (
            <>
              <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_22px] gap-2 pb-1.5 border-b border-[#EFEDE7] text-[10.5px] font-semibold text-faint">
                <span>เดือน</span><span className="text-right">เงินเข้า</span><span className="text-right">เงินออก</span><span className="text-right">สุทธิ</span><span className="text-right">คงเหลือ</span><span />
              </div>
              {yearData.rows.map((r) => {
                const has = r.count > 0
                return (
                  <button
                    key={r.key}
                    onClick={() => { setMonthKey(r.key); setCameFromYear(true); setView('statement') }}
                    className={`w-full grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_22px] gap-2 items-center py-2 border-b border-[#F5F3EE] text-left hover:bg-[#F4F3EF] ${r.key === localMonthStr() ? 'bg-[#F2FAD9]' : ''}`}
                  >
                    <span className="text-[12px] font-semibold">{THAI_MONTH_SHORT[Number(r.key.slice(5)) - 1]}</span>
                    <span className="tabular-nums text-[12.5px] text-right text-income">{has && r.income ? fmt(r.income) : '—'}</span>
                    <span className="tabular-nums text-[12.5px] text-right text-expense">{has && r.expense ? fmt(r.expense) : '—'}</span>
                    <span className={`tabular-nums text-[12.5px] font-bold text-right ${!has ? 'text-faint' : r.net < 0 ? 'text-expense' : 'text-income'}`}>{has ? `${r.net < 0 ? '−' : ''}${fmt(Math.abs(r.net))}` : '—'}</span>
                    <span className="tabular-nums text-[12px] text-right text-muted">{fmt(r.closing)}</span>
                    <Icon name="chevron_right" size={17} className="text-faint" />
                  </button>
                )
              })}
              <p className="text-[11px] text-faint leading-relaxed">กดที่เดือนไหนก็ได้เพื่อเปิดดูความเคลื่อนไหวของเดือนนั้น · คงเหลือคือยอดปลายเดือน ไล่ถอยหลังจากยอดจริงตอนนี้</p>
            </>
          )}
        </>
      )}

      {/* ── จัดการกระเป๋าย่อย ──────────────────────────────────────── */}
      {view === 'rename' && (
        <div>
          <label className="label">ชื่อกระเป๋า</label>
          <input className="input" value={newName} onChange={(e) => { setNewName(e.target.value); setError('') }} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
          <p className="text-[11px] text-faint leading-relaxed mt-[7px]">ชื่อนี้จะไปแสดงในรายงานและในฟอร์มบันทึกรายการ</p>
        </div>
      )}
      {view === 'del' && (
        <div className="flex items-start gap-2.5 bg-expense-soft border border-[#F5D3CE] rounded-[12px] px-[13px] py-[11px]">
          <Icon name="error" size={17} className="flex-none text-expense mt-px" />
          <span className="flex-1 min-w-0 text-[11.5px] text-[#A3564C] leading-[1.6]">
            ลบกระเป๋า "{name}" ที่มียอดกันไว้ {fmt(balance)} บาท · ยอดนี้จะกลับไปรวมกับกระเป๋าหลัก ไม่ได้หายไปจากยอดรวมทั้งร้าน · รายการเก่าที่เคยผูกกับกระเป๋านี้ยังอยู่ครบ
            {activeLoans.length > 0 && ` · ยอดที่ยืมออกไป ${fmt(loanTotal)} ยังค้างอยู่ ควรคืนก่อนลบ`}
          </span>
        </div>
      )}

      {error && (
        <p className="text-[12px] text-expense bg-expense-soft border border-[#F0C4BE] rounded-ctl px-3 py-2">{error}</p>
      )}
    </Popup>

    {iconOpen && (
      <IconPicker
        value={live?.icon ?? null}
        tone="#3A55C4"
        onPick={async (v) => { setIconOpen(false); await onSetIcon?.(item.id, v); setDone('เปลี่ยนไอคอนเรียบร้อย') }}
        onClose={() => setIconOpen(false)}
      />
    )}

    <ConfirmPopup open={!!warning} title="ยอดเงินจะติดลบ" message={warning?.message ?? ''} onConfirm={proceed} onCancel={cancel} confirmLabel="ยืนยัน (ติดลบ)" danger />
    </>
  )
}
