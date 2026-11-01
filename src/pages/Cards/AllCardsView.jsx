import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useCreditCardStore from '../../store/useCreditCardStore'
import AppIcon from '../../components/shared/AppIcon'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import Icon from '../../components/shared/Icon'
import { formatCard } from '../../components/shared/CreditCardPicker'
import { nextClosingDate, formatThaiDate, formatIsoThai, daysUntil } from '../../lib/cardCycle'
import { localDateStr } from '../../lib/dateUtils'
import { statusBand } from './cardStatus'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

const FILTERS = {
  billed: { label: 'ยอดเรียกเก็บ', desc: 'ยอดที่ธนาคารปิดรอบแล้วและต้องจ่ายตามกำหนด' },
  pending: { label: 'ยอดรอเรียกเก็บ', desc: 'ยอดที่สะสมอยู่ในรอบที่ยังไม่ปิด รวมค่างวดผ่อนของรอบนี้ — คือยอดที่จะขึ้นบิลใบถัดไป' },
  overdue: { label: 'เกินกำหนดชำระ', desc: 'ยอดที่เลยวันครบกำหนดแล้วยังไม่จ่าย' },
}

/**
 * ภาพรวมทุกบัตร — ตอบว่าเงินก้อนไหนต้องจ่ายเมื่อไร
 *
 * แยก 3 ตะกร้าเพราะยอดหนี้บัตรก้อนเดียวมีสถานะต่างกันมาก:
 * ที่ปิดรอบแล้วต้องจ่ายตามกำหนด ที่ยังไม่ปิดรอบยังขยับได้ และที่เลยกำหนดคือของด่วน
 */
export default function AllCardsView({ onOpenCard }) {
  const cards = useCreditCardStore((s) => s.cards)
  const statements = useCreditCardStore((s) => s.statements)
  // ต้องเกาะสองก้อนนี้ไว้ ถึงจะไม่ได้อ่านตรงๆ — getCurrentCycle อ่านค่างวดจากมัน
  // ถ้าไม่ subscribe ตัวเลขจะไม่ขยับตอนสร้างหรือจ่ายงวดผ่อน
  const entries = useCreditCardStore((s) => s.entries)
  const installments = useCreditCardStore((s) => s.installments)
  const getCurrentCycle = useCreditCardStore((s) => s.getCurrentCycle)
  const isPayableStatement = useCreditCardStore((s) => s.isPayableStatement)
  const getStatementBreakdown = useCreditCardStore((s) => s.getStatementBreakdown)
  const getUnbilledInstallmentTotal = useCreditCardStore((s) => s.getUnbilledInstallmentTotal)
  const getCardLimitUsage = useCreditCardStore((s) => s.getCardLimitUsage)
  const getCardBillStatus = useCreditCardStore((s) => s.getCardBillStatus)
  const [filter, setFilter] = useState('billed')

  // สามกลุ่มตามสิ่งที่ต้องทำ — ตอบ "ใบไหนกำลังถูกเรียกเก็บ ใบไหนจ่ายแล้ว" ในหน้าเดียว
  const withStatus = cards.map((card) => {
    const st = getCardBillStatus(card.id)
    return { card, st, band: statusBand(st) }
  })
  const billingRows = withStatus
    .filter((x) => x.st.kind === 'billing' || x.st.kind === 'partial')
    .sort((x, y) => x.st.days - y.st.days)
  const statusGroups = [
    {
      key: 'billing', title: 'กำลังเรียกเก็บ', icon: 'schedule', tile: 'bg-[#C03A2D] text-white',
      total: fmt(billingRows.reduce((n, x) => n + x.st.amount, 0)), totalTone: 'text-[#C03A2D]',
      rows: billingRows.map((x) => ({
        ...x,
        note: `ครบกำหนด ${formatIsoThai(x.st.dueDate)} · ${x.band.text.split(' · ').pop()}`,
        noteTone: x.st.days <= 3 ? 'text-[#C03A2D] font-medium' : 'text-faint',
        amountTone: 'text-[#C03A2D]',
      })),
      empty: 'ไม่มีบิลที่กำลังเรียกเก็บ',
    },
    {
      key: 'paid', title: 'จ่ายแล้วรอบนี้', icon: 'check_circle', tile: 'bg-lime text-ink',
      rows: withStatus.filter((x) => x.st.kind === 'paid').map((x) => ({
        ...x,
        note: x.band.text,
        noteTone: 'text-[#4C5A1E]',
        amountTone: x.st.amount > 0 ? 'text-ink' : 'text-faint',
      })),
      empty: 'ยังไม่มีบัตรที่จ่ายบิลรอบนี้',
    },
    {
      key: 'quiet', title: 'ยังไม่มีบิลรอบนี้', icon: 'credit_card', tile: 'bg-paper text-[#5F646C]',
      rows: withStatus.filter((x) => x.st.kind === 'open' || x.st.kind === 'none').map((x) => ({
        ...x,
        note: x.band.text,
        noteTone: 'text-faint',
        amountTone: x.st.amount > 0 ? 'text-ink' : 'text-faint',
      })),
      empty: 'ไม่มี',
    },
  ]

  const rows = useMemo(() => {
    const today = localDateStr()
    return cards.map((c) => {
      const unpaid = statements
        .filter((s) => s.cardId === c.id && isPayableStatement(s))
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      const left = (s) => Number(s.amount) - Number(s.paidAmount)
      const billed = unpaid.reduce((n, s) => n + left(s), 0)
      const overdue = unpaid.filter((s) => s.dueDate < today).reduce((n, s) => n + left(s), 0)
      const cycle = getCurrentCycle(c.id)
      const usage = getCardLimitUsage(c.id)
      const nextBill = unpaid[0] ?? null

      return {
        card: c,
        billed,
        overdue,
        // cycle.net รวมค่างวดผ่อนของรอบนี้มาให้แล้ว (ดู getCurrentCycle)
        pending: Math.max(0, cycle?.net ?? 0),
        total: Number(c.outstanding) || 0,
        insReserved: getUnbilledInstallmentTotal(c.id),
        billedDue: nextBill ? `ครบกำหนด ${formatIsoThai(nextBill.dueDate)}` : 'ไม่มีบิลค้าง',
        // บอกด้วยว่าบิลใบนี้เป็นของรูดเต็มจำนวนเท่าไร ค่างวดเท่าไร — บัตรที่ใช้ผ่อนอย่างเดียว
        // จะได้ไม่ต้องกดเข้าไปดูว่ายอดที่ต้องจ่ายมาจากไหน
        billedMeta: nextBill
          ? (() => {
              const b = getStatementBreakdown(nextBill.id)
              return [
                `รอบ ${nextBill.cycle} · ขั้นต่ำ ${fmt(nextBill.minimumAmount)}`,
                b?.full > 0 ? `รูดเต็มจำนวน ${fmt(b.full)}` : null,
                b?.installment > 0 ? `ค่างวดผ่อน ${b.installmentCount} งวด ${fmt(b.installment)}` : null,
                b?.previous > 0 ? `ยกมา ${fmt(b.previous)}` : null,
              ].filter(Boolean).join(' · ')
            })()
          : '',
        pendingDue: cycle
          ? `สรุปยอด ${formatThaiDate(cycle.end)} · ครบกำหนด ${formatThaiDate(cycle.due)}`
          : '—',
        // แยกให้เห็นว่ายอดมาจากไหน ค่างวดผ่อนกับยอดรูดคนละเรื่องกันในสายตาผู้ใช้
        pendingMeta: cycle
          ? [
              cycle.count ? `${cycle.count} รายการในรอบนี้` : null,
              cycle.installmentCount
                ? `ในนั้นเป็นค่างวดผ่อน ${cycle.installmentCount} งวด ${fmt(cycle.installment)}`
                : null,
              cycle.prepaid > 0 ? `จ่ายล่วงหน้าแล้ว −${fmt(cycle.prepaid)}` : null,
            ].filter(Boolean).join(' · ')
          : '',
        cutTxt: `สรุปยอดทุกวันที่ ${c.closingDay} · ครบกำหนดทุกวันที่ ${c.dueDay}`,
        countTxt: unpaid.length > 1 ? `มีบิลค้าง ${unpaid.length} รอบ` : `บิลค้าง ${unpaid.length} รอบ`,
        limitTxt: usage?.limit
          ? `วงเงิน ${fmt(usage.limit)} · ใช้ไป ${fmt(Math.max(0, usage.used))}`
          : 'ไม่ได้ตั้งวงเงิน',
        overdueDays: nextBill && nextBill.dueDate < today ? -daysUntil(new Date(nextBill.dueDate + 'T00:00:00')) : 0,
      }
    })
  }, [cards, statements, entries, installments, getCurrentCycle, getCardLimitUsage, getUnbilledInstallmentTotal, getStatementBreakdown])

  const pick = (r) => (filter === 'billed' ? r.billed : filter === 'pending' ? r.pending : r.overdue)
  const shown = rows.filter((r) => pick(r) > 0)
  const total = rows.reduce((n, r) => n + pick(r), 0)

  const debtTotal = rows.reduce((n, r) => n + r.total, 0)
  const billedTotal = rows.reduce((n, r) => n + r.billed, 0)
  const pendingTotal = rows.reduce((n, r) => n + r.pending, 0)
  const insTotal = rows.reduce((n, r) => n + r.insReserved, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="bg-ink rounded-panel px-4 py-3.5">
          <div className="text-[11.5px] text-[#9AA0A8]">ยอดหนี้บัตรรวมทุกบัตร</div>
          <div className="tabular-nums text-[26px] font-semibold text-white tracking-[-0.02em] mt-0.5">{fmt(debtTotal)}</div>
        </div>
        <div className="card px-4 py-3.5">
          <div className="text-[11.5px] text-muted">ยอดเรียกเก็บแล้ว</div>
          <div className="tabular-nums text-[22px] font-semibold text-[#C03A2D] mt-0.5">{fmt(billedTotal)}</div>
        </div>
        <div className="card px-4 py-3.5">
          <div className="text-[11.5px] text-muted">ยอดรอเรียกเก็บ</div>
          <div className="tabular-nums text-[22px] font-semibold text-[#3F444C] mt-0.5">{fmt(pendingTotal)}</div>
        </div>
        <div className="card px-4 py-3.5">
          <div className="text-[11.5px] text-muted">ยอดผ่อนที่ธนาคารกันวงเงินไว้</div>
          <div className="tabular-nums text-[22px] font-semibold text-[#3F444C] mt-0.5">{fmt(insTotal)}</div>
        </div>
      </div>

      {cards.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 items-start">
          {statusGroups.map((g) => (
            <section key={g.key} className="card px-[15px] py-3.5 flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 pb-2">
                <span className={`w-[26px] h-[26px] flex-none rounded-lg flex items-center justify-center ${g.tile}`}>
                  <Icon name={g.icon} size={17} fill />
                </span>
                <span className="flex-1 min-w-0 text-[13.5px] font-semibold">{g.title}</span>
                <span className={`tabular-nums text-[12.5px] font-bold ${g.totalTone ?? 'text-muted'}`}>
                  {g.total ?? `${g.rows.length} ใบ`}
                </span>
              </div>
              {g.rows.length === 0 ? (
                <p className="text-[11.5px] text-faint border-t border-[#F2F0EA] pt-2">{g.empty}</p>
              ) : g.rows.map((r) => (
                <button
                  key={r.card.id}
                  onClick={() => onOpenCard(r.card.id)}
                  className="w-full min-h-[46px] flex items-center gap-2.5 border-t border-[#F2F0EA] px-1 py-1.5 text-left hover:bg-paper"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-medium truncate">{formatCard(r.card)}</span>
                    <span className={`block text-[11px] truncate ${r.noteTone}`}>{r.note}</span>
                  </span>
                  <span className={`tabular-nums flex-none text-[13px] font-semibold ${r.amountTone}`}>{fmt(r.st.amount)}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(FILTERS).map(([key, f]) => {
          const on = key === filter
          const amt = rows.reduce((n, r) => n + (key === 'billed' ? r.billed : key === 'pending' ? r.pending : r.overdue), 0)
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`h-[38px] px-3.5 rounded-ctl border flex items-center gap-2.5 transition ${
                on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-hairline hover:border-ink'
              }`}
            >
              <span className="text-[12.5px] font-semibold">{f.label}</span>
              <span className={`tabular-nums text-[12.5px] font-bold ${on ? 'text-[#B9BEC6]' : 'text-faint'}`}>{fmt(amt)}</span>
            </button>
          )
        })}
        <span className="flex-1 min-w-[200px] text-[11.5px] text-faint leading-relaxed ml-1">{FILTERS[filter].desc}</span>
      </div>

      <div className="card flex flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 px-[18px] pt-3 pb-2.5 border-b border-[#F2F0EA] flex-none">
          <span className="text-sm font-semibold">{FILTERS[filter].label}รวมทุกบัตร</span>
          <span className="tabular-nums ml-auto text-[19px] font-bold">{fmt(total)}</span>
        </div>

        <div className="px-[18px] py-2.5 flex flex-col gap-2.5">
          {cards.length === 0 ? (
            <div className="border border-dashed border-[#D8D4C9] rounded-[13px] p-7 text-center">
              <div className="text-[12.5px] text-muted">
                ยังไม่มีบัตรเครดิต — เพิ่มได้ที่{' '}
                <Link to="/manage/cards" className="text-income hover:underline">จัดการข้อมูล → บัตรเครดิต</Link>
              </div>
            </div>
          ) : shown.length === 0 ? (
            <div className="border border-dashed border-[#D8D4C9] rounded-[13px] p-7 text-center">
              <div className="text-[12.5px] text-muted">
                {filter === 'overdue' ? 'ไม่มียอดที่เลยกำหนดชำระ' : filter === 'billed' ? 'ไม่มีบิลที่ปิดรอบรอจ่าย' : 'ยังไม่มียอดสะสมในรอบถัดไป'}
              </div>
              {/* ตะกร้าที่เปิดอยู่ว่างไม่ได้แปลว่าไม่มีอะไรต้องจ่าย — บอกไปเลยว่ายอดไปอยู่ตะกร้าไหน
                  ไม่งั้นหน้าจอว่างทั้งหน้าและผู้ใช้สรุปว่าระบบไม่แสดงข้อมูล */}
              {filter !== 'pending' && pendingTotal > 0 && (
                <button
                  onClick={() => setFilter('pending')}
                  className="mt-2 text-[12px] text-income hover:underline"
                >
                  มียอดกำลังสะสมอยู่ในรอบที่ยังไม่ปิด {fmt(pendingTotal)} บาท — ดูยอดรอเรียกเก็บ
                </button>
              )}
              {filter === 'pending' && billedTotal > 0 && (
                <button
                  onClick={() => setFilter('billed')}
                  className="mt-2 text-[12px] text-income hover:underline"
                >
                  มีบิลที่ปิดรอบแล้วรอจ่าย {fmt(billedTotal)} บาท — ดูยอดเรียกเก็บ
                </button>
              )}
            </div>
          ) : shown.map((r) => (
            <button
              key={r.card.id}
              onClick={() => onOpenCard(r.card.id)}
              className="flex items-center gap-3.5 border border-hairline rounded-[13px] px-3.5 py-3 bg-white text-left hover:bg-[#FAF9F6] hover:border-ink transition"
            >
              <span className="w-[38px] h-[38px] flex-none rounded-[11px] bg-paper flex items-center justify-center">
                <span className="w-8 h-8 flex-none rounded-lg bg-paper flex items-center justify-center">
                  <AppIcon value={r.card.icon} size={18} fallback={DEFAULT_ICONS.card} />
                </span>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold truncate">{formatCard(r.card)}</span>
                <span className="block text-[11.5px] text-faint">
                  {filter === 'billed' ? r.billedDue : filter === 'pending' ? r.pendingDue : `เลยกำหนดแล้ว ${r.overdueDays} วัน`}
                </span>
                <span className="block text-[11px] text-[#A5A199] mt-px">
                  {filter === 'billed' ? r.billedMeta : filter === 'pending' ? r.pendingMeta : ''}
                </span>
              </span>
              <span className="flex-none w-[210px] text-[11px] text-faint leading-[1.55] hidden lg:block">
                <span className="block">{r.cutTxt}</span>
                <span className="block">หนี้รวมบัตรนี้ {fmt(r.total)} · ผ่อนค้าง {fmt(r.insReserved)}</span>
                <span className="block">{r.countTxt}</span>
                <span className="block">{r.limitTxt}</span>
              </span>
              <span className={`tabular-nums flex-none text-xl font-bold text-right w-[124px] ${
                filter === 'overdue' ? 'text-[#C0392B]' : filter === 'billed' ? 'text-[#C03A2D]' : 'text-[#3F444C]'
              }`}>
                {fmt(pick(r))}
              </span>
              <Icon name="chevron_right" size={20} className="flex-none text-[#A5A199]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
