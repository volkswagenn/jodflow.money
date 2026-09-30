import { useMemo, useState } from 'react'
import Popup from './Popup'
import Icon from './Icon'
import AmountInput from './AmountInput'
import DatePicker from './DatePicker'
import CategorySelect from './CategorySelect'
import CreditCardPicker from './CreditCardPicker'
import ConfirmPopup from './ConfirmPopup'
import useCreditCardStore from '../../store/useCreditCardStore'
import useWalletStore from '../../store/useWalletStore'
import useTransactionStore from '../../store/useTransactionStore'
import { buildLogEntry } from '../../lib/logBuilder'
import InstallmentPips from './InstallmentPips'
import PerInstallmentPopup from './PerInstallmentPopup'
import {
  installmentSchedule, installmentTotal, tieredSchedule, scheduleTotal,
  validateTiers, normalizedTiers, maxPrepaidCount, latestPurchaseDateFor,
  tiersFromAmounts, amountsFromTiers, formatThaiDate,
} from '../../lib/cardCycle'

/**
 * ฟอร์มรายการผ่อนบนบัตร — ใช้ทั้งสร้างใหม่และแก้ไขของเดิม
 *
 * ทำไมต้องมีนอกเหนือจากฟอร์มบันทึกรายจ่าย
 *   ของเดิมสร้างสัญญาผ่อนได้ทางเดียวคือผ่านฟอร์มรายจ่าย ซึ่งเป็นเส้นทางของ
 *   "เพิ่งรูดวันนี้" คนที่มาบันทึกสัญญาที่ผ่อนอยู่ก่อนแล้ว หรือมาแก้ของที่กรอกผิด
 *   ไม่มีทางเข้าเลย ต้องยกเลิกทิ้งแล้วสร้างใหม่ ทิ้งสัญญาที่ยกเลิกไว้เป็นขยะ
 *
 * ทำไมแก้ได้ไม่เท่ากันทุกใบ
 *   งวดที่เข้าบิลบัตรหรือจ่ายผ่านแอปไปแล้วคือเงินที่เกิดขึ้นจริง ถ้ายอมให้รื้อ
 *   ตารางงวดใหม่ ยอดในบิลกับยอดในสัญญาจะขัดกันทันทีโดยไม่มีอะไรบอก
 *   สัญญาที่แตะงวดจริงไปแล้วจึงแก้ได้แค่ชื่อ ผู้ขาย หมวดหมู่ และหมายเหตุ
 *
 * props
 *   installment – สัญญาที่จะแก้; null/undefined = สร้างใหม่
 *   cardId      – บัตรตั้งต้นตอนสร้างใหม่ (หน้าบัตรส่งใบที่เปิดดูอยู่มาให้)
 *   onClose     – ปิดโดยไม่บันทึก
 *   onSaved     – เรียกเมื่อบันทึกสำเร็จ (ไม่บังคับ)
 */

const MONTH_PRESETS = [3, 6, 10, 12]
const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

function emptyForm(cardId) {
  return {
    cardId: cardId ?? '',
    name: '',
    vendor: '',
    categoryId: '',
    note: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    amount: '',
    rate: '0',
    mode: 'even',
    months: '6',
    tiers: [{ from: 1, to: 6, amount: '' }],
    prepaid: false,
    prepaidCount: '',
  }
}

/** แปลงสัญญาที่บันทึกไว้กลับเป็นค่าในฟอร์ม */
function formOf(ins) {
  const tiers = Array.isArray(ins.tiers) && ins.tiers.length > 0
    ? ins.tiers.map((t) => ({ from: t.from, to: String(t.to), amount: String(t.amount ?? '') }))
    : [{ from: 1, to: String(ins.months), amount: '' }]
  return {
    cardId: ins.cardId ?? '',
    name: ins.name ?? '',
    vendor: ins.vendor ?? '',
    categoryId: ins.categoryId ?? '',
    note: ins.note ?? '',
    purchaseDate: ins.purchaseDate ?? new Date().toISOString().slice(0, 10),
    amount: String(ins.principalAmount ?? ins.totalAmount ?? ''),
    rate: String(ins.interestRate ?? 0),
    mode: Array.isArray(ins.tiers) && ins.tiers.length > 0 ? 'tiered' : 'even',
    months: String(ins.months ?? 6),
    tiers,
    prepaid: (ins.prepaidCount ?? 0) > 0,
    prepaidCount: String(ins.prepaidCount ?? ''),
  }
}

export default function InstallmentFormPopup({ installment = null, cardId = '', onClose, onSaved }) {
  const isEdit = !!installment
  const cards = useCreditCardStore((s) => s.cards)
  const statements = useCreditCardStore((s) => s.statements)
  const getEntries = useCreditCardStore((s) => s.getEntries)
  const createInstallment = useCreditCardStore((s) => s.createInstallment)
  const updateInstallment = useCreditCardStore((s) => s.updateInstallment)
  const updateInstallmentPlan = useCreditCardStore((s) => s.updateInstallmentPlan)
  const refreshWallet = useWalletStore((s) => s.refresh)

  const [form, setForm] = useState(() => (isEdit ? formOf(installment) : emptyForm(cardId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [tierEditOpen, setTierEditOpen] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const statementPayments = useCreditCardStore((s) => s.statementPayments)

  /**
   * งวดที่ "จ่ายไปแล้ว" = แผนถูกล็อก แก้ได้แค่ข้อมูลอธิบาย
   *
   * งวดที่แค่เข้าบิลแต่บิลใบนั้นยังไม่มีเงินจ่ายเข้าไม่นับ — ยังไม่มีเงินออกไปจริง แก้แผนแล้ว
   * ฐานข้อมูลถอนงวดออกจากบิลแล้วเติมกลับด้วยยอดใหม่ให้ (update_card_installment)
   * เคยล็อกตั้งแต่เข้าบิล ผลคือกรอกราคาผิดแล้วแก้ไม่ได้เลยทันทีที่ถึงวันสรุปยอด
   * กฎชุดเดียวกับฝั่งฐานข้อมูล: จ่ายผ่านแอป · อยู่ในบิลที่จ่ายแล้ว (ครบ/บางส่วน) · จ่ายรายการนั้นไว้
   */
  const { lockedCount, rebillCount } = useMemo(() => {
    if (!isEdit) return { lockedCount: 0, rebillCount: 0 }
    const stById = new Map(statements.map((st) => [st.id, st]))
    const paidTx = new Set(statementPayments.filter((l) => l.transactionId).map((l) => l.transactionId))
    let locked = 0
    let rebill = 0
    for (const e of getEntries(installment.id)) {
      if (e.status === 'paid') locked++
      else if (e.status === 'billed') {
        const st = stById.get(e.statementId)
        if (!st || st.status === 'paid' || Number(st.paidAmount || 0) > 0 || paidTx.has(e.transactionId)) locked++
        else rebill++
      }
    }
    return { lockedCount: locked, rebillCount: rebill }
  }, [isEdit, installment, getEntries, statements, statementPayments])
  const planLocked = lockedCount > 0

  const card = cards.find((c) => c.id === form.cardId) ?? null
  const months = Math.max(1, Math.round(Number(form.months) || 1))

  /** ตารางงวดที่จะได้จากค่าที่กรอกอยู่ตอนนี้ — คำนวณสดเพื่อให้เห็นก่อนกดบันทึก */
  const preview = useMemo(() => {
    if (planLocked || !card) return null
    if (!(months >= 1) || months > 120) return null
    const buyDate = new Date(form.purchaseDate + 'T00:00:00')
    if (Number.isNaN(buyDate.getTime())) return null

    let rows, money, tierError = null
    if (form.mode === 'tiered') {
      const tiers = normalizedTiers(form.tiers, months)
      tierError = validateTiers(tiers, months)
      if (tierError) return { invalid: true, tierError }
      if (!tiers.every((t) => Number(t.amount) > 0)) return null
      rows = tieredSchedule(card, buyDate, months, tiers)
      const total = scheduleTotal(rows)
      money = { principal: total, interest: 0, total, ratePerMonth: 0 }
    } else {
      const principal = Number(form.amount)
      const rate = Number(form.rate) || 0
      if (!(principal > 0) || rate < 0) return null
      money = installmentTotal(principal, months, rate)
      rows = installmentSchedule(card, buyDate, months, money.total)
    }

    // งวดที่บอกว่าจ่ายมาแล้ว ต้องเป็นงวดที่ครบกำหนดไปแล้วจริงเมื่อนับจากวันเปิดบิล
    const maxPrepaid = Math.min(maxPrepaidCount(card, buyDate), months)
    const wantPrepaid = form.prepaid ? Math.max(0, Math.round(Number(form.prepaidCount) || 0)) : 0
    const prepaidOver = wantPrepaid > maxPrepaid
    const prepaidCount = prepaidOver ? 0 : wantPrepaid

    return {
      ...money,
      rows,
      first: rows[0],
      last: rows[rows.length - 1],
      maxPrepaid,
      prepaidOver,
      suggestDate: prepaidOver ? latestPurchaseDateFor(card, wantPrepaid) : null,
      prepaidCount,
      remainingTotal: scheduleTotal(rows.slice(prepaidCount)),
      tierError,
    }
  }, [planLocked, card, months, form])

  const validate = () => {
    if (!form.name.trim()) return 'ใส่ชื่อรายการที่ผ่อน'
    if (planLocked) return null
    if (!form.cardId) return 'เลือกบัตรที่ใช้ผ่อน'
    if (!(months >= 1) || months > 120) return 'จำนวนงวดต้องอยู่ระหว่าง 1 ถึง 120'
    if (form.mode === 'tiered') {
      const tiers = normalizedTiers(form.tiers, months)
      const err = validateTiers(tiers, months)
      if (err) return err
      if (!tiers.every((t) => Number(t.amount) > 0)) return 'กรอกยอดต่องวดให้ครบทุกช่วงราคา'
    } else if (!(Number(form.amount) > 0)) {
      return 'ใส่ราคาสินค้าให้ถูกต้อง'
    }
    if (preview?.prepaidOver) {
      return `วันที่ซื้อย้อนหลังไม่พอ ระบุว่าจ่ายมาแล้วได้มากสุด ${preview.maxPrepaid} งวด` +
        (preview.suggestDate ? ` — เลือกวันที่ซื้อไม่เกิน ${formatThaiDate(preview.suggestDate)}` : '')
    }
    if (!preview) return 'ยังคำนวณตารางงวดไม่ได้ ตรวจยอดและวันที่อีกครั้ง'
    return null
  }

  const handleSave = async () => {
    if (busy) return
    const err = validate()
    if (err) { setError(err); setConfirm(false); return }
    setBusy(true)
    setError('')
    try {
      // แผนถูกล็อก — แก้ได้แค่ข้อมูลอธิบาย ไม่แตะตารางงวดและไม่แตะเงิน
      if (planLocked) {
        await updateInstallment(installment.id, {
          name: form.name.trim(),
          vendor: form.vendor || null,
          categoryId: form.categoryId || null,
          note: form.note || null,
        }, buildLogEntry({
          activityType: 'INSTALLMENT_EDIT',
          description: `แก้ข้อมูลรายการผ่อน "${form.name}" (มีงวดที่เกิดขึ้นแล้ว ${lockedCount} งวด จึงแก้ได้เฉพาะรายละเอียด)`,
          oldValue: installment,
          newValue: { name: form.name, vendor: form.vendor, categoryId: form.categoryId, note: form.note },
        }))
        onSaved?.()
        onClose()
        return
      }

      const tiers = form.mode === 'tiered'
        ? normalizedTiers(form.tiers, months).map((t) => ({ ...t, amount: Number(t.amount) || 0 }))
        : null
      const data = {
        name: form.name.trim(),
        vendor: form.vendor || null,
        categoryId: form.categoryId || null,
        note: form.note || null,
        principalAmount: preview.principal,
        totalAmount: preview.total,
        months,
        monthlyAmount: preview.rows[preview.prepaidCount]?.amount ?? preview.rows[0].amount,
        interestRate: preview.ratePerMonth,
        tiers,
        prepaidCount: preview.prepaidCount,
        purchaseDate: form.purchaseDate,
      }
      const summary =
        `${months} งวด รวม ${fmt(preview.total)} บาท` +
        (tiers ? ` แบบขั้นบันได ${tiers.length} ช่วง` : ` งวดละ ${fmt(preview.rows[0].amount)} บาท`) +
        (preview.prepaidCount > 0 ? ` · ผ่อนมาก่อนแล้ว ${preview.prepaidCount} งวด` : '')

      if (isEdit) {
        await updateInstallmentPlan(installment.id, form.cardId, data, preview.rows, buildLogEntry({
          activityType: 'INSTALLMENT_EDIT',
          description: `แก้ไขรายการผ่อน "${form.name}" — ${summary}`,
          oldValue: installment,
          newValue: { ...data, cardId: form.cardId },
        }))
      } else {
        await createInstallment(form.cardId, data, preview.rows, buildLogEntry({
          activityType: 'INSTALLMENT_CREATE',
          description: `ผ่อน "${form.name}" ${summary}`,
          newValue: { ...data, cardId: form.cardId },
        }))
      }
      // ฝั่งฐานข้อมูลอาจคืนเงินงวดที่จ่ายไปแล้ว และอาจ "สร้างรายจ่าย" ให้งวดที่ตกใน
      // รอบที่ออกบิลไปแล้ว (attach_installment_to_closed_statements) — รายการในรอบบิล
      // ของหน้าบัตรอ่านจากรายจ่ายพวกนั้น ถ้าไม่ดึงรายการใหม่ด้วย จะไม่เห็นจนกว่าจะรีเฟรชหน้า
      await Promise.all([refreshWallet(), useTransactionStore.getState().refresh()])
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  const rows = normalizedTiers(form.tiers, months)
  const roomLeft = rows.length === 0 || rows[rows.length - 1].from < months

  /**
   * วันครบกำหนดของทุกงวด คิดจากบัตร + วันเปิดบิลอย่างเดียว
   * preview ต้องรอค่างวดครบก่อน แต่ช่วงที่ยังกรอกอยู่คือช่วงที่อยากเห็นวันที่ที่สุด
   */
  const dateRows = useMemo(() => {
    if (planLocked || !card) return null
    const buyDate = new Date(form.purchaseDate + 'T00:00:00')
    if (Number.isNaN(buyDate.getTime())) return null
    return {
      rows: tieredSchedule(card, buyDate, months, [{ from: 1, to: months, amount: 0 }]),
      maxPaid: Math.min(maxPrepaidCount(card, buyDate), months),
    }
  }, [planLocked, card, form.purchaseDate, months])

  const pipRows = preview && !preview.invalid ? preview.rows : dateRows?.rows
  const pipMaxPaid = preview && !preview.invalid ? preview.maxPrepaid : dateRows?.maxPaid

  return (
    <>
      <Popup
        title={isEdit ? 'แก้ไขรายการผ่อน' : 'เพิ่มรายการผ่อน'}
        sub={isEdit ? installment.name : card ? `ผ่อนผ่าน ${card.bankName ? `${card.bankName} — ` : ''}${card.name}` : 'บันทึกสัญญาผ่อนบนบัตรเครดิต'}
        icon="credit_card"
        width={560}
        onClose={onClose}
        onConfirm={() => (isEdit && !planLocked ? setConfirm(true) : handleSave())}
        confirmLabel={isEdit ? 'บันทึกการแก้ไข' : 'บันทึกรายการผ่อน'}
        busy={busy}
        error={error}
      >
        {planLocked && (
          <div className="flex-none text-[11.5px] bg-pending-soft border border-pending-line text-[#8A6A15] rounded-ctl px-3 py-2">
            มีงวดที่จ่ายไปแล้ว {lockedCount} งวด (จ่ายค่างวดผ่านแอป หรืออยู่ในบิลที่จ่ายแล้ว) — แก้ได้เฉพาะชื่อ ผู้ขาย หมวดหมู่ และหมายเหตุ
            ถ้าต้องแก้ยอดหรือจำนวนงวด ให้ย้อนงวดที่จ่ายไว้ก่อน
          </div>
        )}
        {!planLocked && rebillCount > 0 && (
          <div className="flex-none text-[11.5px] bg-paper border border-hairline text-muted rounded-ctl px-3 py-2">
            มี {rebillCount} งวดที่เข้าบิลแล้วแต่บิลยังไม่ได้จ่าย — แก้ยอดได้ บันทึกแล้วยอดในบิลจะคิดใหม่ตามยอดที่แก้ให้เอง
          </div>
        )}

        <div>
          <label className="label">ชื่อรายการที่ผ่อน</label>
          <input
            className="input"
            autoFocus
            placeholder="เช่น มือถือ / ตู้แช่ / ค่าซ่อมรถ"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        {!planLocked && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <CreditCardPicker
                value={form.cardId}
                onChange={(v) => set('cardId', v)}
                label="บัตรที่ใช้ผ่อน"
                showOutstanding={false}
              />
            </div>
            <div>
              <label className="label">วันที่ซื้อ/เริ่มผ่อน</label>
              <DatePicker value={form.purchaseDate} onChange={(v) => set('purchaseDate', v)} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">ผู้ขาย/ร้านค้า</label>
            <input className="input" value={form.vendor ?? ''} onChange={(e) => set('vendor', e.target.value)} />
          </div>
          <div>
            <label className="label">หมวดหมู่</label>
            <CategorySelect type="expense" value={form.categoryId} onChange={(v) => set('categoryId', v)} placeholder="ไม่ระบุ" />
          </div>
        </div>

        {!planLocked && (
          <div className="rounded-ctl border border-expense-line bg-expense-soft/50 px-3 py-2.5 space-y-2.5">
            <div className="flex items-center gap-1.5">
              {[
                { v: 'even', t: 'หารเท่ากันทุกงวด' },
                { v: 'tiered', t: 'ค่างวดตามโปรโมชั่น' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={`btn text-xs py-1 px-3 ${form.mode === o.v ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => set('mode', o.v)}
                >
                  {o.t}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-2 flex-wrap">
              <div className="w-24">
                <label className="label">จำนวนงวด</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="120"
                  value={form.months}
                  onChange={(e) => {
                    // ตัดช่วงที่เลยจำนวนงวดใหม่ทิ้งทันที ไม่งั้นช่องจะค้างเลขที่ระบบไม่ได้ใช้แล้ว
                    const m = Math.round(Number(e.target.value) || 0)
                    setForm((f) => ({
                      ...f,
                      months: e.target.value,
                      tiers: m >= 1 ? normalizedTiers(f.tiers, m).map((t) => ({ ...t, to: String(t.to) })) : f.tiers,
                    }))
                  }}
                />
              </div>
              <div className="flex gap-1.5 pb-0.5 flex-wrap">
                {MONTH_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn text-xs py-1 px-2.5 ${String(m) === String(form.months) ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setForm((f) => ({
                      ...f,
                      months: String(m),
                      tiers: normalizedTiers(f.tiers, m).map((t) => ({ ...t, to: String(t.to) })),
                    }))}
                  >
                    {m} งวด
                  </button>
                ))}
              </div>
            </div>

            {form.mode === 'even' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">ราคาสินค้า (บาท)</label>
                  <AmountInput className="input text-right" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
                </div>
                <div>
                  <label className="label">ดอกเบี้ยต่อเดือน (%)</label>
                  <input className="input text-right" type="number" min="0" step="0.01" value={form.rate} onChange={(e) => set('rate', e.target.value)} />
                </div>
              </div>
            ) : (
              <div>
                <label className="label">ค่างวดตามโปรโมชั่น</label>
                {rows.map((t, i, arr) => (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap bg-white/70 border border-expense-line rounded-lg px-2 py-1.5 mb-1.5">
                    <span className="text-xs text-expense">งวดที่</span>
                    <span className="text-xs tabular-nums bg-expense-soft border border-expense-line rounded px-2 py-0.5 min-w-[34px] text-center">{t.from}</span>
                    <span className="text-xs text-expense">–</span>
                    {i === arr.length - 1 ? (
                      <span className="text-xs tabular-nums bg-expense-soft border border-expense-line rounded px-2 py-0.5 min-w-[34px] text-center" title="ช่วงสุดท้ายยืดไปจบที่งวดสุดท้ายให้เอง">{t.to}</span>
                    ) : (
                      <input
                        className="input !h-7 w-16 text-xs text-center px-1"
                        type="number"
                        min={t.from}
                        max={months}
                        value={form.tiers[i]?.to ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          const v = raw === ''
                            ? ''
                            : String(Math.min(Math.max(Math.round(Number(raw)) || t.from, t.from), months))
                          set('tiers', form.tiers.map((x, k) => (k === i ? { ...x, to: v } : x)))
                        }}
                      />
                    )}
                    <span className="text-xs text-expense">งวดละ</span>
                    <input
                      className="input !h-7 w-24 text-xs text-right px-2"
                      type="number"
                      min="0"
                      placeholder="0.00"
                      value={form.tiers[i]?.amount ?? ''}
                      onChange={(e) => set('tiers', form.tiers.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))}
                    />
                    <span className="text-xs text-expense">บาท</span>
                    {arr.length > 1 && i < arr.length - 1 && (
                      <button
                        type="button"
                        className="ml-auto text-expense/50 hover:text-expense text-sm leading-none px-1"
                        onClick={() => set('tiers', form.tiers.filter((_, k) => k !== i))}
                        title="ลบช่วงนี้"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {/* กรอกทีละงวดตามที่โปรฯ ประกาศมา แล้วยุบเป็นช่วงให้เอง */}
                <button
                  type="button"
                  className="w-full text-xs font-semibold text-expense border border-expense-line bg-white/70 rounded-lg py-1.5 mb-1.5 hover:bg-white"
                  onClick={() => setTierEditOpen(true)}
                >
                  ⚙ ปรับแต่งค่างวดทีละงวด ({months} งวด)
                </button>
                <button
                  type="button"
                  disabled={!roomLeft}
                  className="w-full text-xs text-expense border border-dashed border-expense-line rounded-lg py-1.5 hover:bg-white/60 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => {
                    const last = rows[rows.length - 1]
                    const split = Math.min(last.from + 5, months - 1)
                    set('tiers', [
                      ...rows.slice(0, -1),
                      { from: last.from, to: String(split), amount: last.amount },
                      { from: split + 1, to: months, amount: '' },
                    ])
                  }}
                >
                  + เพิ่มช่วงราคา
                </button>
                <p className="text-[11px] text-expense mt-1">
                  แบ่งได้ {rows.length} ช่วง ครอบคลุมงวด 1–{months} ครบพอดี
                  {roomLeft ? '' : ' · แบ่งจนครบทุกงวดแล้ว'}
                </p>
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-expense">
              <input type="checkbox" checked={form.prepaid} onChange={(e) => set('prepaid', e.target.checked)} />
              เคยผ่อนมาก่อนแล้ว (บันทึกสัญญาที่ผ่อนอยู่ก่อนเริ่มใช้แอป)
            </label>
            {form.prepaid && (
              <div className="w-40">
                <label className="label">จ่ายมาแล้วกี่งวด</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={months}
                  value={form.prepaidCount}
                  onChange={(e) => set('prepaidCount', e.target.value)}
                />
              </div>
            )}

            {/* ป้ายงวด — บันทึกสัญญาเก่าแล้วตรวจได้ทันทีว่างวดถัดไปตรงกับสลิปในมือไหม */}
            {pipRows && (
              <InstallmentPips
                rows={pipRows}
                showAmount={!!(preview && !preview.invalid)}
                paidCount={preview && !preview.invalid ? preview.prepaidCount : Number(form.prepaidCount) || 0}
                maxPaid={pipMaxPaid}
                onPickPaid={(n) => setForm((f) => ({ ...f, prepaid: n > 0, prepaidCount: n > 0 ? String(n) : '' }))}
              />
            )}
          </div>
        )}

        <div>
          <label className="label">หมายเหตุ</label>
          <input className="input" value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} />
        </div>

        {/* ตัวอย่างตารางงวด — ให้เห็นยอดจริงก่อนกดบันทึก */}
        {!planLocked && preview && !preview.invalid && (
          <div className="rounded-ctl bg-paper border border-hairline px-3 py-2.5 text-[11.5px] text-muted space-y-1">
            <div className="flex justify-between gap-2">
              <span>รวมทั้งสัญญา</span>
              <span className="tabular-nums font-semibold text-ink">{fmt(preview.total)} บาท</span>
            </div>
            {preview.interest > 0 && (
              <div className="flex justify-between gap-2">
                <span>ดอกเบี้ยรวม</span>
                <span className="tabular-nums">{fmt(preview.interest)} บาท</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span>งวดแรก {formatThaiDate(preview.first.dueDate)} · รอบ {preview.first.cycle}</span>
              <span className="tabular-nums">{fmt(preview.first.amount)} บาท</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>งวดสุดท้าย {formatThaiDate(preview.last.dueDate)}</span>
              <span className="tabular-nums">{fmt(preview.last.amount)} บาท</span>
            </div>
            {preview.prepaidCount > 0 && (
              <div className="flex justify-between gap-2 text-income">
                <span>ผ่อนมาก่อนแล้ว {preview.prepaidCount} งวด · เหลือต้องผ่อน</span>
                <span className="tabular-nums">{fmt(preview.remainingTotal)} บาท</span>
              </div>
            )}
            {/* งวดที่ตกในรอบที่ระบบออกบิลไปแล้ว — บอกล่วงหน้าว่าจะเกิดอะไร ไม่ให้ไปงงทีหลัง
                ว่าทำไมบิลใบเก่ายอดเปลี่ยน หรือทำไมมีสองงวดโผล่ในรอบเดียว */}
            {(() => {
              const closed = preview.rows.slice(preview.prepaidCount).map((r) => ({
                r, st: statements.find((s) => s.cardId === form.cardId && s.cycle === r.cycle),
              })).filter((x) => x.st)
              if (closed.length === 0) return null
              const attach = closed.filter((x) => x.st.status !== 'paid')
              const sweep = closed.filter((x) => x.st.status === 'paid')
              return (
                <div className="text-[11px] text-[#8A6A15] bg-pending-soft border border-pending-line rounded-lg px-2.5 py-2 leading-relaxed">
                  {attach.length > 0 && (
                    <div>
                      งวด {attach.map((x) => x.r.seq).join(', ')} อยู่ในรอบที่ออกบิลไปแล้ว —
                      ระบบจะเพิ่มเข้าบิลใบนั้นให้ทันที (บิลรอบ {attach.map((x) => x.st.cycle).join(', ')} ยอดจะเพิ่มขึ้น
                      {' '}{fmt(attach.reduce((n, x) => n + x.r.amount, 0))} บาท)
                      ถ้างวดนี้จ่ายไปแล้วจริง ให้เพิ่มจำนวน "ผ่อนมาก่อนแล้ว" แทน
                    </div>
                  )}
                  {sweep.length > 0 && (
                    <div>
                      งวด {sweep.map((x) => x.r.seq).join(', ')} อยู่ในรอบที่จ่ายบิลจบไปแล้ว — จะถูกเก็บรวมในบิลรอบถัดไป
                    </div>
                  )}
                </div>
              )
            })()}
            <p className="text-[11px] text-faint pt-1 border-t border-hairline">
              ยังไม่ตัดเงินและยังไม่ขึ้นเป็นรายจ่ายตอนนี้ — งวดจะทยอยเข้าบิลบัตรตามรอบ
            </p>
          </div>
        )}
        {!planLocked && preview?.tierError && (
          <p className="text-[11.5px] text-expense flex items-center gap-1">
            <Icon name="error" size={15} /> {preview.tierError}
          </p>
        )}
      </Popup>

      {tierEditOpen && (() => {
        const filled = rows.find((t) => Number(t.amount) > 0)
        const base = filled ? Number(filled.amount) : Math.round(((Number(form.amount) || 0) / months) * 100) / 100
        return (
          <PerInstallmentPopup
            months={months}
            amounts={amountsFromTiers(form.tiers, months)}
            base={base}
            target={preview && !preview.invalid ? preview.total : (Number(form.amount) || null)}
            dueDates={pipRows?.map((r) => r.dueDate) ?? null}
            onClose={() => setTierEditOpen(false)}
            onSave={(values) => {
              set('tiers', tiersFromAmounts(values).map((t) => ({ ...t, to: String(t.to) })))
              setTierEditOpen(false)
            }}
          />
        )
      })()}

      <ConfirmPopup
        open={confirm}
        title="ยืนยันการแก้ไขรายการผ่อน"
        message={
          `แก้ไข "${form.name}"\n` +
          `ตารางงวดทั้งหมดจะถูกสร้างใหม่ตามค่าที่กรอก\n` +
          `รวม ${months} งวด${preview ? ` · ${fmt(preview.total)} บาท` : ''}` +
          (rebillCount > 0 ? `\n\nงวดที่อยู่ในบิลที่ยังไม่จ่าย ${rebillCount} งวด จะคิดยอดใหม่ในบิลใบเดิม — ยอดบิลและหนี้บัตรขยับตาม` : '')
        }
        onConfirm={handleSave}
        onCancel={() => setConfirm(false)}
        confirmLabel="ยืนยันแก้ไข"
      />
    </>
  )
}
