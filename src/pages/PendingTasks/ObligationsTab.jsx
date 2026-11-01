import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import usePendingStore from '../../store/usePendingStore'
import useRecurringStore from '../../store/useRecurringStore'
import useCreditCardStore from '../../store/useCreditCardStore'
import useDebtStore from '../../store/useDebtStore'
import useWalletStore from '../../store/useWalletStore'
import useLogStore from '../../store/useLogStore'
import { buildLogEntry } from '../../lib/logBuilder'
import { formatIsoThai, daysUntil, toDateString } from '../../lib/cardCycle'
import PayCardBillPopup from '../../components/shared/PayCardBillPopup'
import PayDebtPopup from '../../components/shared/PayDebtPopup'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

const KINDS = [
  { k: 'all', t: 'ทั้งหมด' },
  { k: 'card', t: 'บัตร' },
  { k: 'debt', t: 'กู้ยืม' },
  { k: 'installment', t: 'ผ่อน' },
  { k: 'pending', t: 'ค้างชำระ' },
  { k: 'recurring', t: 'ประจำ' },
  { k: 'receivable', t: 'รอรับ' },
]

const ICON = {
  card: ['💳', 'bg-rose-50'], debt: ['📒', 'bg-amber-50'], installment: ['🪜', 'bg-rose-50'],
  pending: ['⏳', 'bg-yellow-50'], recurring: ['🔁', 'bg-purple-50'], receivable: ['🤝', 'bg-emerald-50'],
}

function Due({ date }) {
  const d = daysUntil(new Date(date + 'T00:00:00'))
  const cls = d < 0 ? 'text-red-600 font-semibold' : d <= 7 ? 'text-amber-700 font-semibold' : 'text-gray-500'
  return <span className={`text-xs ${cls}`}>● {d < 0 ? `เกินกำหนด ${-d} วัน` : d === 0 ? 'วันนี้' : `อีก ${d} วัน`}</span>
}

/**
 * สิ่งที่ต้องจ่าย — รวมภาระทุกชนิดไว้ที่เดียว เรียงตามวันครบกำหนด
 * รายการที่จ่ายได้ตรงนี้: บิลบัตร งวดหนี้ รับคืน
 * รายการอื่นพาไปที่เดิมของมัน เพราะมี flow ของตัวเองอยู่แล้ว
 */
export default function ObligationsTab() {
  const navigate = useNavigate()
  const [kind, setKind] = useState('all')
  const [payCard, setPayCard] = useState(null)
  const [payDebt, setPayDebt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pending = usePendingStore((s) => s.pendingPayments)
  const recEntries = useRecurringStore((s) => s.entries)
  const recItems = useRecurringStore((s) => s.items)
  const cards = useCreditCardStore((s) => s.cards)
  const statements = useCreditCardStore((s) => s.statements)
  const installments = useCreditCardStore((s) => s.installments)
  const instEntries = useCreditCardStore((s) => s.entries)
  const getCardLabel = useCreditCardStore((s) => s.getCardLabel)
  const debts = useDebtStore((s) => s.debts)
  const debtEntries = useDebtStore((s) => s.entries)
  const getProgress = useDebtStore((s) => s.getProgress)
  const { payStatement } = useCreditCardStore()
  const { payEntry } = useDebtStore()
  const refreshWallet = useWalletStore((s) => s.refresh)
  const { addLog } = useLogStore()

  const rows = useMemo(() => {
    const out = []
    const month = format(new Date(), 'yyyy-MM')

    // ใบที่ยอดถูกยกไปรวมในบิลใบถัดไปแล้ว (carriedTo) ไม่ใช่ภาระแยกอีกใบ
    for (const s of statements) if (s.status !== 'paid' && !s.carriedTo) out.push({
      key: `s-${s.id}`, kind: 'card', title: `บิลบัตร ${getCardLabel(s.cardId)}`,
      sub: `รอบ ${s.cycle} · ปิดรอบแล้ว · ขั้นต่ำ ${fmt(s.minimumAmount)}`,
      amount: Number(s.amount) - Number(s.paidAmount), due: s.dueDate, payable: true, data: s,
    })

    const activeDebt = new Map(debts.filter((d) => d.status === 'active').map((d) => [d.id, d]))
    const seen = new Set()
    for (const e of [...debtEntries].sort((a, b) => a.seq - b.seq)) {
      const d = activeDebt.get(e.debtId)
      if (!d || e.status !== 'pending' || seen.has(d.id)) continue
      seen.add(d.id)
      const p = getProgress(d.id)
      const recv = d.direction === 'receivable'
      out.push({
        key: `d-${e.id}`, kind: recv ? 'receivable' : 'debt', title: d.name,
        sub: `${d.counterparty || ''} · งวดที่ ${e.seq} จาก ${d.months}`.replace(/^ · /, ''),
        amount: Number(e.amount), due: e.dueDate, payable: true, data: { debt: d, entry: e, progress: p },
        progress: p ? { pct: (p.doneCount / d.months) * 100, left: p.remainingAmount, count: p.remainingCount } : null,
      })
    }

    const activeInst = new Map(installments.filter((i) => i.status === 'active').map((i) => [i.id, i]))
    const seenI = new Set()
    for (const e of [...instEntries].sort((a, b) => a.seq - b.seq)) {
      const i = activeInst.get(e.installmentId)
      // งวดที่เข้าบิลแล้วอยู่ในแถวบิลบัตรข้างบนแล้ว ถ้านับตรงนี้อีกจะบวกซ้ำ
      if (!i || e.status !== 'pending' || seenI.has(i.id)) continue
      seenI.add(i.id)
      const remaining = instEntries.filter((x) => x.installmentId === i.id && x.status === 'pending')
      const done = instEntries.filter((x) => x.installmentId === i.id && !['pending', 'cancelled'].includes(x.status)).length
      out.push({
        key: `i-${e.id}`, kind: 'installment', title: i.name,
        sub: `ผ่อนบัตร ${getCardLabel(i.cardId)} · งวดที่ ${e.seq} จาก ${i.months}`,
        amount: Number(e.amount), due: e.dueDate, payable: false,
        note: 'เรียกเก็บผ่านบิลบัตร',
        progress: { pct: (done / i.months) * 100, left: remaining.reduce((s, x) => s + Number(x.amount), 0), count: remaining.length },
      })
    }

    for (const p of pending) if (p.status === 'pending') out.push({
      key: `p-${p.id}`, kind: 'pending', title: p.description || p.itemName || 'ค้างชำระ',
      sub: 'ค้างชำระ', amount: Number(p.amount), due: p.dueDate || toDateString(new Date()), payable: false, goto: '/pending-tasks',
    })

    for (const e of recEntries) if (e.month === month && e.status === 'pending') {
      const it = recItems.find((x) => x.id === e.recurringId)
      out.push({
        key: `r-${e.id}`, kind: 'recurring', title: it?.name ?? 'รายการประจำ',
        sub: `รายจ่ายประจำ${it?.defaultMethod === 'card' ? ' · ตัดบัตร' : ''}`,
        amount: Number(e.amount), due: e.dueDate, payable: false, goto: '/transactions',
      })
    }

    return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
  }, [statements, debts, debtEntries, installments, instEntries, pending, recEntries, recItems, getCardLabel, getProgress])

  const shown = kind === 'all' ? rows : rows.filter((r) => r.kind === kind)
  const month = format(new Date(), 'yyyy-MM')
  const thisMonth = rows.filter((r) => r.kind !== 'receivable' && r.due.slice(0, 7) === month).reduce((s, r) => s + r.amount, 0)
  const within7 = rows.filter((r) => r.kind !== 'receivable' && daysUntil(new Date(r.due + 'T00:00:00')) <= 7).length
  const debtTotals = useDebtStore((s) => s.getTotals())
  const cardDebt = cards.reduce((s, c) => s + Number(c.outstanding || 0), 0)
  const instLeft = rows.filter((r) => r.kind === 'installment').reduce((s, r) => s + (r.progress?.left ?? 0), 0)
  const totalDebt = debtTotals.payable + cardDebt + instLeft

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

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-card bg-ink p-5 text-white">
        <div className="absolute -right-8 -top-11 w-[130px] h-[130px] rounded-full bg-lime opacity-[.13]" />
        <p className="text-[12.5px] text-[#9AA0A8]">หนี้คงเหลือรวม</p>
        <p className="text-[30px] font-semibold tabular-nums tracking-[-0.02em] mt-0.5">
          {fmt(totalDebt)}<span className="text-[13px] font-normal text-[#9AA0A8] ml-1.5">บาท</span>
        </p>
        <div className="flex gap-5 mt-2 flex-wrap text-[12px]">
          <span className="text-[#9AA0A8]">เดือนนี้ต้องจ่าย <b className="text-[#F2A0A0] font-medium ml-1 tabular-nums">{fmt(thisMonth)}</b></span>
          <span className="text-[#9AA0A8]">ครบกำหนดใน 7 วัน <b className="text-white font-medium ml-1">{within7} รายการ</b></span>
          {debtTotals.receivable > 0 && <span className="text-[#9AA0A8]">คนอื่นติดเรา <b className="text-white font-medium ml-1 tabular-nums">{fmt(debtTotals.receivable)}</b></span>}
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {KINDS.map((k) => (
          <button key={k.k} className={`btn text-xs py-1 px-3 rounded-full ${kind === k.k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind(k.k)}>{k.t}</button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {error}</p>}

      {shown.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">ไม่มีรายการ</p>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => {
            const [ic, bg] = ICON[r.kind]
            const recv = r.kind === 'receivable'
            return (
              <div key={r.key} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className={`w-8 h-8 rounded-lg grid place-items-center text-base shrink-0 ${bg}`}>{ic}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.title}</p>
                    <p className="text-xs text-gray-500 truncate">{r.sub}{r.note ? ` · ${r.note}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[15px] font-semibold tabular-nums ${recv ? 'text-emerald-700' : r.kind === 'card' ? 'text-rose-600' : r.kind === 'debt' ? 'text-amber-800' : 'text-gray-900'}`}>{fmt(r.amount)}</p>
                    <p className="text-[11px] text-gray-400">{formatIsoThai(r.due)}</p>
                  </div>
                </div>
                {r.progress && (
                  <>
                    <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${recv ? 'bg-emerald-500' : r.kind === 'installment' ? 'bg-rose-400' : 'bg-amber-600'}`} style={{ width: `${r.progress.pct}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-gray-500">
                      <span>{recv ? 'รอรับคืน' : 'คงเหลือ'} <span className="tabular-nums">{fmt(r.progress.left)}</span></span>
                      <span>เหลือ <span className="tabular-nums">{r.progress.count}</span> งวด</span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Due date={r.due} />
                  {r.payable && r.kind === 'card' && <button className="btn btn-primary text-xs !h-8 px-3" onClick={() => setPayCard(r.data)}>จ่ายบิล</button>}
                  {r.payable && (r.kind === 'debt' || r.kind === 'receivable') && <button className="btn btn-primary text-xs !h-8 px-3" onClick={() => setPayDebt(r.data)}>{recv ? 'รับคืน' : 'จ่ายงวด'}</button>}
                  {!r.payable && r.goto && <button className="btn btn-secondary text-xs !h-8 px-3" onClick={() => navigate(r.goto)}>ไปจ่าย</button>}
                  {!r.payable && !r.goto && <span className="text-[11px] text-gray-400 rounded-full border border-gray-200 px-2 py-0.5">{r.note}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {payCard && <PayCardBillPopup statement={payCard} cardLabel={getCardLabel(payCard.cardId)} onConfirm={doPayCard} onCancel={() => setPayCard(null)} busy={busy} />}
      {payDebt && <PayDebtPopup debt={payDebt.debt} entry={payDebt.entry} progress={payDebt.progress} onConfirm={doPayDebt} onCancel={() => setPayDebt(null)} busy={busy} />}
    </div>
  )
}
