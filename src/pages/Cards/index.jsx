import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AllCardsView from './AllCardsView'
import CardDetailView from './CardDetailView'
import DebtView from './DebtView'
import Icon from '../../components/shared/Icon'
import useCreditCardStore from '../../store/useCreditCardStore'
import useTransactionStore from '../../store/useTransactionStore'
import useDebtStore from '../../store/useDebtStore'
import { formatIsoThaiShort } from '../../lib/cardCycle'
import AppIcon from '../../components/shared/AppIcon'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import { statusBand } from './cardStatus'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * บัตรและหนี้สิน — สลับมุมมองด้วยแถบเดียวบนสุด
 *
 *   รวมทุกบัตร        ภาพรวมว่าบัตรไหนต้องจ่ายเท่าไรเมื่อไร
 *   <ชื่อบัตรแต่ละใบ>  รายละเอียดบัตรใบนั้นทั้งหมด (บิล รอบถัดไป วงเงิน รายการ ผ่อน)
 *   หนี้สินและงวดผ่อน  สัญญาหนี้ + งวดผ่อนผ่านบัตร
 *
 * แท็บบอกยอดหนี้ของบัตรใบนั้นไว้บนชิปเลย จะได้เลือกได้โดยไม่ต้องกดเข้าไปดูทีละใบ
 */
export default function CardsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const cards = useCreditCardStore((s) => s.cards)
  const ensureStatements = useCreditCardStore((s) => s.ensureStatements)
  const getNextDue = useCreditCardStore((s) => s.getNextDue)
  const getCardBillStatus = useCreditCardStore((s) => s.getCardBillStatus)
  // เกาะไว้ให้ชิปคำนวณใหม่เมื่อบิล/รายการ/งวดเปลี่ยน — getNextDue อ่านจากพวกนี้
  useCreditCardStore((s) => s.statements)
  useCreditCardStore((s) => s.entries)
  useTransactionStore((s) => s.transactions)
  const activeDebts = useDebtStore((s) => s.debts.filter((d) => d.status === 'active').length)

  // ปิดรอบที่เลยวันสรุปยอดแล้วให้ครบก่อนคำนวณตัวเลขบนชิป
  useEffect(() => { ensureStatements() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // รองรับลิงก์เก่าที่ยังใช้ ?tab= (installments/debts → มุมมองหนี้สิน)
  const legacy = params.get('tab')
  const view = params.get('view')
    ?? (legacy === 'installments' || legacy === 'debts' ? 'debt' : null)
    ?? 'all'
  const setView = (v) => setParams(v === 'all' ? {} : { view: v }, { replace: true })

  const isCard = cards.some((c) => c.id === view)
  const currentCard = isCard ? cards.find((c) => c.id === view) : null

  // ชิปบอก "ต้องจ่ายอะไรถัดไป" ไม่ใช่ยอดหนี้คงค้าง — หนี้คงค้างของบัตรที่มีแต่รายการผ่อน
  // เป็น 0.00 จนกว่ารอบจะปิด ทั้งที่มีค่างวดรออยู่ในบิลใบหน้า ดูแล้วเหมือนไม่มีข้อมูล
  const nextDues = cards.map((c) => getNextDue(c.id))
  const nextTotal = nextDues.reduce((n, d) => n + (d?.amount ?? 0), 0)
  const statuses = cards.map((c) => getCardBillStatus(c.id))
  const billingCount = statuses.filter((st) => st.kind === 'billing' || st.kind === 'partial').length
  const paidCount = statuses.filter((st) => st.kind === 'paid').length
  const dueUnit = (d, st) => {
    if (!d || d.amount <= 0) return 'ไม่มียอดรอจ่าย'
    if (d.kind === 'closed') return `บิลครบกำหนด ${formatIsoThaiShort(d.dueDate)}`
    // จ่ายบิลรอบนี้ไปแล้ว ยอดที่เห็นคือของรอบหน้า ถ้ายังเขียนว่า "รอบนี้" จะดูเหมือนยังไม่ได้จ่าย
    return `${st.kind === 'paid' ? 'รอบหน้า' : 'รอบนี้'} · จ่าย ${formatIsoThaiShort(d.dueDate)}`
  }
  const QUIET_BAND = { bg: '#F4F3EF', fg: '#3C4048', bgOn: '#2A2E35', fgOn: '#C9CDD2' }

  const tabs = [
    {
      key: 'all', grow: 1, icon: 'credit_card', iconFg: '#16181D',
      label: 'รวมทุกบัตร', kicker: `${cards.length} ใบ`,
      sub: fmt(nextTotal), unit: 'ต้องจ่ายถัดไปรวม',
      band: { ...QUIET_BAND, text: `เรียกเก็บ ${billingCount} ใบ · จ่ายแล้ว ${paidCount} ใบ` },
    },
    ...cards.map((c, i) => ({
      key: c.id, grow: 1.2, cardIcon: c.icon ?? null, isCard: true,
      label: c.last4 ? `${c.bankName || c.name} · ${c.last4}` : (c.name || 'บัตร'),
      kicker: c.name || 'บัตรเครดิต',
      sub: fmt(nextDues[i]?.amount ?? 0), unit: dueUnit(nextDues[i], statuses[i]),
      band: statusBand(statuses[i]),
      // บิลที่ปิดรอบแล้วต้องจ่ายตามกำหนด — ให้ตัวเลขเป็นสีแดงเหมือนหน้าบิล
      subTone: nextDues[i]?.kind === 'closed' && nextDues[i].amount > 0 ? 'text-[#C03A2D]' : '',
    })),
    {
      key: 'debt', grow: 1, icon: 'receipt_long', iconFg: '#6D4AA8',
      label: 'หนี้สินและงวดผ่อน', kicker: 'สัญญาผ่อน เงินกู้',
      sub: String(activeDebts), unit: 'สัญญาที่ยังผ่อนอยู่',
      band: { ...QUIET_BAND, text: 'ไม่ผูกกับรอบบิลบัตร' },
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* แถวคำอธิบาย + ปุ่มจัดการบัตร — แยกจากแถวเลือกบัตรข้างล่าง
          เพราะปุ่มพวกนี้ทำงานกับบัตรที่เลือกอยู่ ไม่ใช่ตัวเลือกบัตร */}
      <div className="flex gap-2 items-center flex-none flex-wrap">
        <span className="flex-1 min-w-0 text-[11.5px] text-faint leading-snug">
          เลือกบัตรที่จะดู · ตัวเลขบนแต่ละใบคือยอดที่ต้องจ่ายถัดไป — บิลที่ปิดรอบแล้ว หรือถ้ายังไม่มี ก็เป็นยอดที่สะสมอยู่ในรอบนี้ (รวมค่างวดผ่อน)
        </span>
        {currentCard && (
          <button
            onClick={() => navigate('/manage/cards')}
            className="flex-none h-[34px] px-3.5 rounded-[10px] border border-hairline bg-white text-[12.5px] font-semibold flex items-center gap-[5px] hover:bg-paper"
          >
            <Icon name="tune" size={17} />
            แก้ไขบัตรนี้
          </button>
        )}
        <button
          onClick={() => navigate('/manage/cards')}
          className="flex-none h-[34px] px-3.5 rounded-[10px] bg-ink text-white text-[12.5px] font-semibold flex items-center gap-[5px] hover:bg-black"
        >
          <Icon name="add" size={17} />
          เพิ่มบัตร
        </button>
      </div>

      {/* ชิปเลือกบัตรตามแบบ: แถวเดียว ไอคอน–ชื่อ/คำบรรยาย–ยอด/หน่วย
          ใบที่เลือกอยู่เป็นพื้นเข้มตัวเลขสีมะนาว จึงหาเจอทันทีว่ากำลังดูใบไหน
          ของเดิมใช้ขอบเข้มบนพื้นขาวเหมือนกันหมด ต้องกวาดตาหาว่าใบไหนถูกเลือก

          ยังขึ้นบรรทัดใหม่ได้ทุกขนาดจอ (แบบมี 4 ชิปพอดีแถว แต่ของจริงมีได้ 8 ใบ)
          และ min-w กันชื่อบัตรถูกบีบจนเหลือ "ไทย…" อ่านไม่ออกว่าใบไหนเป็นใบไหน */}
      <div className="flex gap-2 flex-none flex-wrap">
        {tabs.map((t) => {
          const on = t.key === view || (t.key === 'all' && !isCard && view !== 'debt')
          return (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              style={{ flex: `${t.grow} 1 0` }}
              title={`${t.label} · ${t.kicker} · ${t.sub} ${t.unit} · ${t.band.text}`}
              className={`min-w-[212px] max-w-[340px] flex flex-col overflow-hidden rounded-[14px] border text-left transition ${
                on ? 'border-ink shadow-[0_0_0_1px_#16181D] bg-ink' : 'border-hairline bg-white hover:border-ink'
              }`}
            >
              <span className="w-full flex items-center gap-2.5 px-[11px] py-[9px]">
                <span className={`w-[34px] h-[34px] flex-none rounded-[10px] flex items-center justify-center ${
                  on ? 'bg-white/[0.12]' : 'bg-paper'
                }`}>
                  {t.isCard
                    // ไอคอนที่ตั้งไว้กับบัตร หรือรูปบัตรกลางๆ ถ้ายังไม่เลือก — ไม่เดาโลโก้จากชื่อธนาคาร
                    ? <AppIcon value={t.cardIcon} size={19} fallback={DEFAULT_ICONS.card} />
                    : <Icon name={t.icon} size={19} style={{ color: on ? '#C7F250' : t.iconFg }} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-[12.5px] font-semibold truncate leading-[1.3] ${on ? 'text-white' : ''}`}>
                    {t.label}
                  </span>
                  <span className={`block text-[10.5px] truncate ${on ? 'text-[#9AA0A8]' : 'text-faint'}`}>{t.kicker}</span>
                </span>
                <span className="flex-none text-right">
                  <span className={`tabular-nums block text-sm font-bold leading-[1.2] ${
                    on ? 'text-[#C7F250]' : (t.subTone ?? '')
                  }`}>
                    {t.sub}
                  </span>
                  <span className={`block text-[10px] whitespace-nowrap ${on ? 'text-[#9AA0A8]' : 'text-faint'}`}>{t.unit}</span>
                </span>
              </span>
              {/* แถบสถานะรอบบิล — ไล่ดูแถวเดียวก็รู้ว่าใบไหนกำลังถูกเรียกเก็บ ใบไหนจ่ายแล้ว
                  ไม่ต้องกดเข้าไปทีละใบ · ใช้ตัวหนังสือกับไอคอนคู่กับสี ไม่ได้บอกด้วยสีอย่างเดียว */}
              <span
                className="w-full min-h-[26px] flex items-center gap-[5px] px-[11px] text-[11px] font-semibold"
                style={{ background: on ? (t.band.bgOn ?? t.band.bg) : t.band.bg, color: on ? (t.band.fgOn ?? t.band.fg) : t.band.fg }}
              >
                {t.band.icon && <Icon name={t.band.icon} size={15} fill />}
                <span className="truncate">{t.band.text}</span>
              </span>
            </button>
          )
        })}
      </div>

      {isCard
        ? <CardDetailView key={view} cardId={view} />
        : view === 'debt'
          ? <DebtView onOpenBill={() => setView(cards[0]?.id ?? 'all')} />
          : <AllCardsView onOpenCard={setView} />}
    </div>
  )
}
