import { create } from 'zustand'
import * as cardApi from '../lib/api/creditCards'
import * as stmtApi from '../lib/api/cardStatements'
import * as instApi from '../lib/api/cardInstallments'
import { cyclePeriod, pendingCycles, toDateString, clampedDate, dueDateFor, cycleKey } from '../lib/cardCycle'
import useTransactionStore from './useTransactionStore'

/**
 * บัตรเครดิตและใบแจ้งยอด
 *
 * store นี้เป็นแค่ "แคชของยอดบนเซิร์ฟเวอร์" เหมือน useWalletStore
 * ยอดหนี้ (outstanding) ถูกขยับที่ฐานข้อมูลผ่าน apply_wallet_effect ตอนบันทึก/แก้/ยกเลิก
 * รายการ และตอนจ่ายบิล ฝั่งหน้าจอจึงต้องเรียก refresh() หลังงานพวกนั้นเสมอ
 *
 * บัตรเป็นหนี้ ไม่ใช่ทรัพย์สิน จึงไม่ถูกรวมเข้า total() ของกระเป๋าเงิน
 * ยอดรวมหน้าแรกยังตอบคำถามว่า "มีเงินเท่าไร" ไม่ใช่ "รวยเท่าไร"
 */
export const INITIAL = {
  cards: [], statements: [], installments: [], entries: [], advances: [],
  statementPayments: [], rowMarks: [], closing: false,
}

const useCreditCardStore = create((set, get) => ({
  ...INITIAL,
  _reset: () => set(INITIAL),

  _hydrate: (data) => set({
    cards: data?.cards ?? [],
    statements: data?.statements ?? [],
    installments: data?.installments ?? [],
    entries: data?.entries ?? [],
    advances: data?.advances ?? [],
    statementPayments: data?.statementPayments ?? [],
    rowMarks: data?.rowMarks ?? [],
  }),

  refresh: async () => {
    const [cards, statements, inst, advances, rowMarks, statementPayments] = await Promise.all([
      cardApi.listCreditCards(),
      stmtApi.listCardStatements(),
      instApi.listInstallments(),
      cardApi.listCardAdvances(),
      cardApi.listCardRowMarks(),
      stmtApi.listStatementPayments(),
    ])
    set({ cards, statements, installments: inst.installments, entries: inst.entries, advances, rowMarks, statementPayments })
    return { cards, statements, advances, rowMarks, statementPayments, ...inst }
  },

  // ── เครื่องหมายถูกรายแถวในบิล — ไม่แตะยอดเงิน เป็นแค่ตัวช่วยไล่เช็คบิลกับสลิป ──
  isRowMarked: (rowKey) => get().rowMarks.includes(rowKey),

  markRow: async ({ cardId, cycle, rowKey }) => {
    await cardApi.markCardRow({ cardId, cycle, rowKey })
    set((s) => (s.rowMarks.includes(rowKey) ? s : { rowMarks: [...s.rowMarks, rowKey] }))
  },

  unmarkRow: async (rowKey) => {
    await cardApi.unmarkCardRow(rowKey)
    set((s) => ({ rowMarks: s.rowMarks.filter((k) => k !== rowKey) }))
  },

  // ── จัดการบัตร ────────────────────────────────────────────────────────────

  createCard: async (data) => {
    const card = await cardApi.createCreditCard(data)
    set((s) => ({ cards: [...s.cards, card] }))
    return card
  },

  updateCard: async (id, changes) => {
    const card = await cardApi.updateCreditCard(id, changes)
    set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, ...card } : c)) }))
    return card
  },

  deleteCard: async (id) => {
    await cardApi.deleteCreditCard(id)
    set((s) => ({ cards: s.cards.filter((c) => c.id !== id) }))
  },

  // ── กดเงินสด ───────────────────────────────────────────────────────────

  /** ยอดหนี้และเงินในกระเป๋าขยับที่เซิร์ฟเวอร์ — ดึงทั้งชุดกลับมาแทนการเดา */
  cashAdvance: async (cardId, params) => {
    const advance = await cardApi.cashAdvance(cardId, params)
    await get().refresh()
    return advance
  },

  undoAdvance: async (advanceId, log) => {
    await cardApi.undoCashAdvance(advanceId, log)
    await get().refresh()
  },

  /** รายการกดเงินสดของบัตร ใหม่สุดก่อน */
  getAdvances: (cardId) => get().advances.filter((a) => a.cardId === cardId),

  /** ปรับยอดหนี้ยกมา — delta เป็นบวกคือหนี้เพิ่ม */
  adjustOutstanding: async (id, delta) => {
    await cardApi.adjustOutstanding(id, delta)
    await get().refresh()
  },

  // ── รอบบิล ────────────────────────────────────────────────────────────────

  /**
   * ปิดทุกรอบที่ผ่านวันสรุปยอดไปแล้วแต่ยังไม่มีใบแจ้งยอด
   *
   * เรียกตอนเปิดหน้า แบบเดียวกับ generateEntries ของรายการประจำ — ไม่ต้องมี cron
   * ปิดทีละรอบตามลำดับเก่าไปใหม่ เพราะยอดค้างของรอบก่อนถูกยกไปเป็นยอดยกมาของรอบถัดไป
   * ฝั่งฐานข้อมูลกันปิดซ้ำด้วย unique (card_id, cycle) อยู่แล้ว เรียกซ้ำจึงไม่เสียหาย
   */
  ensureStatements: async () => {
    if (get().closing) return
    const cards = get().cards.filter((c) => !c.deleted)
    if (cards.length === 0) return

    const txs = useTransactionStore.getState().transactions
    const todo = []
    for (const card of cards) {
      const existing = new Set(
        get().statements.filter((s) => s.cardId === card.id).map((s) => s.cycle)
      )
      // รอบก่อนวันเพิ่มบัตรจะถูกปิดก็ต่อเมื่อมีของอยู่ในรอบนั้นจริง —
      // งวดผ่อนที่ยังไม่ถูกเรียกเก็บ รายการที่ลงวันที่ย้อนหลัง หรือยอดกดเงินสด
      // (งวดที่ทำเครื่องหมายว่าจ่ายมาก่อนแล้วไม่นับ เพราะไม่มีอะไรต้องเก็บอีก)
      const activeIns = new Set(
        get().installments.filter((i) => i.status === 'active' && i.cardId === card.id).map((i) => i.id)
      )
      const pendingCycleKeys = new Set(
        get().entries
          .filter((e) => activeIns.has(e.installmentId) && e.status === 'pending')
          .map((e) => e.cycle)
      )
      const hasData = (cycle, start, end) => {
        if (pendingCycleKeys.has(cycle)) return true
        const from = toDateString(start)
        const to = toDateString(end)
        return txs.some((t) => t.cardId === card.id && t.date >= from && t.date <= to)
          || get().advances.some((a) => a.cardId === card.id && a.date >= from && a.date <= to)
      }
      for (const period of pendingCycles(card, existing, { hasData })) {
        todo.push({ cardId: card.id, period })
      }
    }
    if (todo.length === 0) return

    set({ closing: true })
    try {
      // ต้องทีละใบตามลำดับ ห้ามยิงขนาน — ยอดยกมาของใบถัดไปอ่านจากใบก่อนหน้า
      for (const { cardId, period } of todo) {
        await stmtApi.closeStatement(cardId, period)
      }
      await get().refresh()
    } catch (err) {
      console.warn('ปิดรอบบิลไม่สำเร็จ:', err?.message ?? err)
    } finally {
      set({ closing: false })
    }
  },

  payStatement: async (statementId, params) => {
    const statement = await stmtApi.payStatement(statementId, params)
    await get().refresh()
    return statement
  },

  undoPayment: async (statementId, amount, log) => {
    const statement = await stmtApi.undoPayment(statementId, amount, log)
    await get().refresh()
    return statement
  },

  // ── จ่ายรายการรูดทีละรายการก่อนออกบิล (supabase/card.sql ส่วนที่ 16) ────────
  // รูดแล้วโอนคืนเข้าบัตรเฉพาะยอดนั้นทันที ไม่รอบิล — ยอดหายจากรอบที่กำลังสะสม
  // และบิลที่ออกมาจะรับรู้ว่าจ่ายไปแล้วเท่าไร ไม่ต้องจ่ายซ้ำ

  prepayTransaction: async (transactionId, params) => {
    const leg = await stmtApi.prepayTransaction(transactionId, params)
    await get().refresh()
    return leg
  },

  undoPrepayment: async (legId, log) => {
    await stmtApi.undoPrepayment(legId, log)
    await get().refresh()
  },

  /** ย้อนขาการจ่ายบิลขาเดียวที่ระบุ (หน้าประวัติการจ่าย) */
  undoPaymentLeg: async (legId, log) => {
    const statement = await stmtApi.undoPaymentLeg(legId, log)
    await get().refresh()
    return statement
  },

  /** แก้ไขขาการจ่ายในที่ — วิธี/บัญชี/ยอด/วันที่ (หน้าประวัติการจ่าย) */
  editPaymentLeg: async (legId, params) => {
    const leg = await stmtApi.editPaymentLeg(legId, params)
    await get().refresh()
    return leg
  },

  /** บิลเก่าที่ไม่มีขาการจ่าย — แก้กระเป๋า/วันที่ของยอดที่จ่ายทั้งใบ */
  editStatementPayment: async (statementId, params) => {
    const statement = await stmtApi.editStatementPayment(statementId, params)
    await get().refresh()
    return statement
  },

  // ทำเครื่องหมายว่ารายการในบิลจ่ายไปแล้ว — ไม่ตัดเงินซ้ำ แค่ผูกขาที่จ่ายไว้แล้ว
  // เข้ากับรายการ ใช้กับของที่จ่ายไปก่อนระบบจะจำได้ว่าเงินก้อนไหนของบรรทัดไหน
  assignStatementPayment: async (transactionId, log) => {
    await stmtApi.assignStatementPayment(transactionId, log)
    await get().refresh()
  },

  unassignStatementPayment: async (transactionId, log) => {
    await stmtApi.unassignStatementPayment(transactionId, log)
    await get().refresh()
  },

  /** ขาที่จ่ายก่อนออกบิลและยังไม่ถูกรวมเข้าใบไหน ของบัตรใบนี้ */
  getOpenPrepayments: (cardId) =>
    get().statementPayments.filter((l) => l.cardId === cardId && !l.statementId),

  /** ยอดที่จ่ายให้รายการนี้ไว้ก่อนออกบิล — null ถ้ายังไม่เคยจ่าย */
  getPrepaidForTransaction: (transactionId) => {
    const legs = get().statementPayments.filter((l) => l.transactionId === transactionId && !l.statementId)
    if (legs.length === 0) return null
    return { amount: legs.reduce((s, l) => s + Number(l.amount || 0), 0), legs }
  },

  // ── ผ่อนชำระ ──────────────────────────────────────────────────────────────

  createInstallment: async (cardId, data, schedule, log) => {
    const ins = await instApi.createInstallment(cardId, data, schedule, log)
    await get().refresh()
    // สัญญาที่บันทึกย้อนหลังมักมีงวดตกอยู่ในรอบที่ผ่านไปแล้วและยังไม่มีใบแจ้งยอด
    // ปิดรอบพวกนั้นให้ทันที งวดจะได้ขึ้นบิลของรอบตัวเองพร้อมวันครบกำหนดที่ถูกต้อง
    // แทนที่จะไปกองรวมอยู่ในบิลใบหน้าจนกว่าจะมีใครเปิดหน้าบัตรอีกครั้ง
    await get().ensureStatements()
    return ins
  },

  /** จ่ายค่างวดทีละงวด — เงินออกจากบัญชี/เงินสด ไม่ผ่านบัตร */
  payEntry: async (entryId, params) => {
    const entry = await instApi.payInstallmentEntry(entryId, params)
    await get().refresh()
    return entry
  },

  /** ย้อนการจ่ายค่างวด */
  undoEntry: async (entryId, log) => {
    const entry = await instApi.undoInstallmentEntry(entryId, log)
    await get().refresh()
    return entry
  },

  /** แก้ไขการจ่ายค่างวดในที่ — วิธี/บัญชี/ยอด/วันเวลา */
  editEntryPayment: async (entryId, params) => {
    const entry = await instApi.editInstallmentPayment(entryId, params)
    await get().refresh()
    return entry
  },

  settleInstallment: async (id, params) => {
    const ins = await instApi.settleInstallment(id, params)
    await get().refresh()
    return ins
  },

  cancelInstallment: async (id, log) => {
    const ins = await instApi.cancelInstallment(id, log)
    await get().refresh()
    return ins
  },

  updateInstallment: async (id, changes, log) => {
    const ins = await instApi.updateInstallment(id, changes, log)
    set((s) => ({ installments: s.installments.map((x) => (x.id === id ? { ...x, ...ins } : x)) }))
    return ins
  },

  /** แก้ทั้งแผน — ตารางงวดถูกสร้างใหม่ทั้งชุด จึงต้องดึงข้อมูลใหม่ทั้งก้อน */
  updateInstallmentPlan: async (id, cardId, data, schedule, log) => {
    const ins = await instApi.updateInstallmentPlan(id, cardId, data, schedule, log)
    await get().refresh()
    // แก้แผนแล้ววันที่ของงวดขยับได้ อาจมีงวดตกไปอยู่ในรอบที่ผ่านมาแล้ว — เหตุผลเดียวกับตอนสร้าง
    await get().ensureStatements()
    return ins
  },

  /** ลบสัญญาทิ้ง — คืนเงินงวดที่จ่ายผ่านแอปไปแล้วให้ด้วย ยอดกระเป๋าจึงต้องดึงใหม่ */
  deleteInstallment: async (id, log) => {
    await instApi.deleteInstallment(id, log)
    await get().refresh()
  },

  /** งวดของสัญญาหนึ่ง เรียงตามลำดับงวด */
  getEntries: (installmentId) =>
    get().entries.filter((e) => e.installmentId === installmentId).sort((a, b) => a.seq - b.seq),

  /**
   * สรุปความคืบหน้าของสัญญาผ่อนหนึ่งรายการ
   *
   * งวดถือว่า "จ่ายแล้ว" เมื่อใบแจ้งยอดที่งวดนั้นอยู่ถูกจ่ายครบ — อ่านจากใบ ไม่เก็บซ้ำ
   * ถ้าเก็บสองที่ วันหนึ่งจะมีที่หนึ่งอัปเดตไม่ทันแล้วตัวเลขสองหน้าจะขัดกัน
   */
  getInstallmentProgress: (installmentId) => {
    const ins = get().installments.find((i) => i.id === installmentId)
    if (!ins) return null
    const entries = get().getEntries(installmentId)
    const stmts = get().statements

    const rows = entries.map((e) => {
      const stmt = e.statementId ? stmts.find((s) => s.id === e.statementId) : null
      // งวดจ่ายแล้วได้ 2 ทาง: จ่ายผ่านบิล (ดูจากใบแจ้งยอด) หรือจ่ายทีละงวดจากบัญชี
      // (สถานะ paid มาจากฐานข้อมูลตรงๆ พร้อมเวลาที่จ่ายของตัวเอง)
      let status = e.status                       // pending | billed | paid | cancelled
      if (status === 'billed' && stmt?.status === 'paid') status = 'paid'
      const paidAt = e.status === 'paid' ? e.paidAt : (stmt?.status === 'paid' ? stmt.paidAt : null)
      return { ...e, status, paidAt }
    })

    const paid = rows.filter((r) => r.status === 'paid')
    // prepaid = ผ่อนมาก่อนเริ่มใช้แอป ถือว่าผ่านไปแล้วเหมือนกัน แต่แยกนับไว้
    // เพราะไม่มีรายจ่ายและไม่เคยขยับยอดหนี้ในระบบเรา
    const prepaid = rows.filter((r) => r.status === 'prepaid')
    const remaining = rows.filter((r) => r.status === 'pending')
    return {
      rows,
      paidCount: paid.length,
      prepaidCount: prepaid.length,
      billedCount: rows.filter((r) => r.status === 'billed').length,
      remainingCount: remaining.length,
      remainingAmount: remaining.reduce((s, r) => s + Number(r.amount || 0), 0),
      // งวดที่จ่ายผ่านแอปเก็บยอดที่จ่ายจริงแยกไว้ (paid_amount) — ยอดตามตารางไม่ถูกเขียนทับ
      paidAmount: paid.reduce((s, r) => s + Number(r.paidAmount ?? r.amount ?? 0), 0),
      // ยังเป็นหนี้อยู่จริงเท่าไร = งวดที่ยังไม่ถึงรอบ + งวดที่เข้าบิลแล้วแต่บิลยังไม่ถูกจ่าย
      // ต่างจาก remainingAmount ที่นับเฉพาะงวดที่ยังไม่เข้าบิล (ใช้ตอนปิดยอดคงเหลือ)
      // ถ้าเอา remainingAmount ไปโชว์เป็น "คงเหลือ" ช่วงที่บิลปิดแล้วแต่ยังไม่จ่าย
      // ยอดจะหายไปหนึ่งงวดทั้งที่ยังไม่ได้จ่าย
      unpaidAmount: rows
        .filter((r) => r.status === 'pending' || r.status === 'billed')
        .reduce((s, r) => s + Number(r.amount || 0), 0),
    }
  },

  /** สัญญาที่ยังผ่อนอยู่ ใช้ทำ badge บนแท็บ */
  getActiveInstallments: (cardId = null) =>
    get().installments.filter((i) => i.status === 'active' && (!cardId || i.cardId === cardId)),

  /**
   * ภาระค่างวดต่อเดือนจากสัญญาผ่อนบัตร — งวดถัดไปของแต่ละสัญญารวมกัน
   *
   * ต้องอ่านจากงวดจริง ไม่ใช่ monthly_amount ของสัญญา เพราะสัญญาแบบขั้นบันได
   * ค่างวดไม่เท่ากันทุกงวด ถ้าใช้ค่าในสัญญาจะได้ตัวเลขคนละตัวกับที่จะถูกเก็บจริง
   * (เคยมีสองสูตรในสองหน้าจอแล้วโชว์ไม่ตรงกัน)
   */
  getInstallmentMonthly: (cardId = null) =>
    get().getActiveInstallments(cardId).reduce((sum, i) => {
      const p = get().getInstallmentProgress(i.id)
      const next = p?.rows.find((r) => r.status === 'pending' || r.status === 'billed')
      return sum + Number(next?.amount ?? 0)
    }, 0),

  /** ยอดผ่อนที่ยังไม่ถูกเรียกเก็บของบัตรใบหนึ่ง — ธนาคารกันวงเงินไว้แล้วตั้งแต่วันซื้อ */
  getUnbilledInstallmentTotal: (cardId) => {
    const ids = new Set(
      get().installments.filter((i) => i.status === 'active' && i.cardId === cardId).map((i) => i.id)
    )
    return get().entries
      .filter((e) => ids.has(e.installmentId) && e.status === 'pending')
      .reduce((s, e) => s + Number(e.amount || 0), 0)
  },

  /**
   * วงเงินที่ใช้ไปจริง = หนี้คงค้าง + ยอดผ่อนที่ยังไม่ถูกเรียกเก็บ
   * เพราะธนาคารกันวงเงินเต็มก้อนตั้งแต่วันที่ซื้อ ไม่ได้กันทีละงวด
   */
  getCardLimitUsage: (cardId) => {
    const card = get().getCard(cardId)
    if (!card) return null
    const unbilled = get().getUnbilledInstallmentTotal(cardId)
    const used = (Number(card.outstanding) || 0) + unbilled
    const limit = Number(card.creditLimit) || 0
    return { used, unbilled, limit, remaining: limit - used, over: limit > 0 && used > limit }
  },

  // ── ตัวช่วยอ่านค่า ────────────────────────────────────────────────────────

  getCard: (id) => get().cards.find((c) => c.id === id),

  /** บัตรที่ยังใช้งานอยู่ — ตัวเลือกในฟอร์มต้องไม่โชว์บัตรที่ปิดไปแล้ว */
  getActiveCards: () => get().cards.filter((c) => c.enabled),

  /** มีบัตรใบเดียว → ใช้ใบนั้นอัตโนมัติ ไม่ต้องให้ผู้ใช้เลือก */
  resolveCardId: (id) => {
    const cards = get().getActiveCards()
    if (id && cards.some((c) => c.id === id)) return id
    return cards.length === 1 ? cards[0].id : null
  },

  /**
   * ชื่อเต็มของบัตร เช่น "กสิกรไทย — Credit Card K+ ···6931"
   *
   * ผู้ใช้มักกรอกชื่อธนาคารกับชื่อบัตรเหมือนกัน (หรือชื่อหนึ่งมีอีกชื่ออยู่ข้างใน)
   * ถ้าต่อกันตรงๆ จะได้ "Ture Pay Next — Ture Pay Next" ซึ่งยาวและอ่านแล้วงง
   * จึงตัดส่วนที่ซ้ำออกก่อนเสมอ
   */
  getCardLabel: (id) => {
    const c = get().cards.find((x) => x.id === id)
    if (!c) return 'ไม่ระบุบัตร'
    const bank = (c.bankName || '').trim()
    const name = (c.name || '').trim()
    let base
    if (!bank) base = name
    else if (!name) base = bank
    else if (name.includes(bank)) base = name
    else if (bank.includes(name)) base = bank
    else base = `${bank} — ${name}`
    return c.last4 ? `${base} ···${c.last4}` : base
  },

  /**
   * ชื่อสั้นสำหรับที่แคบ (ปฏิทิน, กล่องข้อมูลเมื่อชี้เมาส์)
   * เอาแค่ชื่อบัตรกับเลขท้าย ซึ่งเป็นส่วนที่แยกแยะบัตรได้จริง ตัดชื่อธนาคารทิ้ง
   */
  getCardShortLabel: (id, maxLen = 22) => {
    const c = get().cards.find((x) => x.id === id)
    if (!c) return 'ไม่ระบุบัตร'
    let name = (c.name || c.bankName || 'บัตร').trim()
    if (name.length > maxLen) name = name.slice(0, maxLen - 1).trimEnd() + '…'
    return c.last4 ? `${name} ···${c.last4}` : name
  },

  /** หนี้รวมทุกใบ — ใช้บนหน้าแรกและหน้ากระเป๋าเงิน */
  getTotalOutstanding: () => get().cards.reduce((sum, c) => sum + (Number(c.outstanding) || 0), 0),

  /** ใบแจ้งยอดของบัตรใบหนึ่ง เรียงใหม่ก่อน */
  getStatements: (cardId) => get().statements.filter((s) => s.cardId === cardId),

  /**
   * ใบนี้ยังต้องจ่ายแยกอยู่ไหม — กฎเดียวที่ทุกหน้าจอต้องใช้ร่วมกัน
   *
   * ไม่ใช่แค่ status ≠ paid เพราะ
   *   • ใบที่ยอดค้างถูกยกไปรวมในบิลรอบถัดไปแล้ว (carried_to ถูกตั้ง) เงินก้อนนั้นอยู่ใน
   *     previous_balance ของใบใหม่แล้ว ถ้ายังนับใบเก่าด้วยจะเห็นหนี้ก้อนเดียวสองที่
   *     และจ่ายได้สองรอบจนหนี้ติดลบ
   *   • บัตรที่ถูกลบไปแล้ว ใบของมันไม่ควรโผล่ในยอดที่ต้องจ่าย ทั้งที่ยอดหนี้รวมหายไปแล้ว
   */
  isPayableStatement: (s) => {
    if (!s || s.status === 'paid' || s.carriedTo) return false
    const card = get().cards.find((c) => c.id === s.cardId)
    return !!card && !card.deleted
  },

  /** ใบที่ยังจ่ายไม่ครบ ทั้งร้าน เรียงตามวันครบกำหนด */
  getUnpaidStatements: () =>
    get().statements
      .filter((s) => get().isPayableStatement(s))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),

  /**
   * รายการที่รูดแล้วแต่ยังไม่อยู่ในใบแจ้งยอดไหนเลย ถึงวันที่กำหนด
   *
   * นี่คือกฎเดียวกับที่ close_card_statement ใช้ตอนออกบิล: บิลใบถัดไปเก็บทุกรายการ
   * ที่ยังไม่มีใบไหนครอบ ไม่ใช่แค่รายการในช่วงวันที่ของรอบ — จะได้ไม่ตกหล่นเมื่อ
   *   • ลงรายการย้อนหลังเข้าไปในรอบที่ปิดไปแล้ว (ธนาคารจริงก็เอามาเก็บบิลใบหน้า)
   *   • เปลี่ยนวันสรุปยอดจนรอบใหม่กับรอบเก่าเหลื่อมกันหรือมีช่องว่าง
   * รายการที่ใบเก่าครอบอยู่แล้วต้องไม่ถูกนับซ้ำ ไม่ว่าช่วงวันที่ของรอบใหม่จะทับมันหรือไม่
   */
  getUncoveredTransactions: (cardId, upTo) => {
    const periods = get().statements
      .filter((s) => s.cardId === cardId)
      .map((s) => [s.periodStart, s.periodEnd])
    const covered = (d) => periods.some(([a, b]) => d >= a && d <= b)
    // รายการที่ถูกใส่เข้าบิลใบไหนไปแล้วตรงๆ (card_statement_id) ถือว่ามีใบครอบ
    // ไม่ว่าวันที่ของมันจะอยู่ช่วงไหน — กฎเดียวกับ close_card_statement ฝั่งฐานข้อมูล
    return useTransactionStore.getState().transactions
      .filter((t) => t.cardId === cardId && t.date <= upTo && !t.cardStatementId && !covered(t.date))
  },

  /**
   * ใส่รายการรูดเข้าบิลใบที่ออกไปแล้ว / เอาออก
   * ยอดบิลถูกคิดใหม่ที่ฐานข้อมูล ต้องดึงทั้งใบและรายการมาใหม่ให้ตรงกัน
   */
  attachTransactionToStatement: async (transactionId, statementId) => {
    await stmtApi.attachTransaction(transactionId, statementId)
    await Promise.all([get().refresh(), useTransactionStore.getState().refresh()])
  },
  detachTransactionFromStatement: async (transactionId) => {
    await stmtApi.detachTransaction(transactionId)
    await Promise.all([get().refresh(), useTransactionStore.getState().refresh()])
  },

  /** ยอดที่ต้องจ่ายรวมทุกใบที่ยังค้าง */
  getDueTotal: () =>
    get().getUnpaidStatements().reduce((sum, s) => sum + (Number(s.amount) - Number(s.paidAmount)), 0),

  /**
   * แยกยอดในใบแจ้งยอดว่ามาจากอะไรบ้าง
   *
   * ใบเก็บ spend_amount เป็นก้อนเดียว ซึ่งรวมค่างวดผ่อนที่ถูกแปลงเป็นรายจ่ายตอนปิดรอบ
   * ไว้ด้วย ผู้ใช้จึงแยกไม่ออกว่าบิลใบนี้เป็นของที่รูดเต็มจำนวนเท่าไร เป็นค่างวดเท่าไร
   * ค่างวดดึงกลับได้จากตารางงวด (งวดถูกผูกกับใบผ่าน statement_id ตอนปิดรอบ)
   * ส่วนที่เหลือของ spend คือยอดรูดเต็มจำนวน (รวมค่าธรรมเนียม ซึ่งเป็นรายจ่ายเหมือนกัน)
   */
  getStatementBreakdown: (statementId) => {
    const s = get().statements.find((x) => x.id === statementId)
    if (!s) return null
    const insRows = get().entries.filter((e) => e.statementId === statementId)
    const installment = insRows.reduce((n, e) => n + Number(e.amount || 0), 0)
    const spend = Number(s.spendAmount || 0)
    return {
      full: Math.max(0, Math.round((spend - installment) * 100) / 100),
      installment,
      installmentCount: insRows.length,
      advance: Number(s.advanceAmount || 0),
      credit: Number(s.creditAmount || 0),
      previous: Number(s.previousBalance || 0),
      amount: Number(s.amount || 0),
      remaining: Number(s.amount || 0) - Number(s.paidAmount || 0),
    }
  },

  /**
   * "บัตรใบนี้ต้องจ่ายอะไรเป็นอย่างถัดไป" — ตัวเลขเดียวที่ควรอยู่บนชิปเลือกบัตร
   *
   * ยอดหนี้คงค้าง (outstanding) ไม่เหมาะกับชิป เพราะบัตรที่มีแต่รายการผ่อนจะเป็น 0.00
   * จนกว่ารอบจะปิด ทั้งที่มีค่างวดรออยู่ในบิลใบหน้า คนดูจึงสรุปว่าระบบไม่แสดงข้อมูล
   *
   * ลำดับ: บิลที่ปิดรอบแล้วยังจ่ายไม่ครบ (ยอดนิ่ง ต้องจ่ายตามกำหนด) มาก่อน
   * ถ้าไม่มี ค่อยเป็นยอดที่สะสมอยู่ในรอบปัจจุบัน (ประมาณการ ยังขยับได้)
   */
  getNextDue: (cardId) => {
    const bill = get().statements
      .filter((s) => s.cardId === cardId && get().isPayableStatement(s))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0]
    if (bill) {
      return {
        kind: 'closed',
        amount: Number(bill.amount) - Number(bill.paidAmount),
        dueDate: bill.dueDate,
        cycle: bill.cycle,
        statement: bill,
      }
    }
    const cur = get().getCurrentCycle(cardId)
    if (!cur) return null
    return {
      kind: 'projected',
      amount: Math.max(0, cur.net),
      dueDate: toDateString(cur.due),
      cycle: cur.cycle,
      current: cur,
    }
  },

  /**
   * บิลบัตรที่ต้องจ่ายในอีก N เดือนข้างหน้า — ทั้งที่ปิดรอบแล้วและที่ยังไม่ปิด
   *
   * มีสองชนิดที่ต้องแยกให้ผู้ใช้เห็นชัด
   *   • ปิดรอบแล้ว (closed) — ยอดนิ่งแล้ว ไม่เปลี่ยนอีก
   *   • ประมาณการ (projected) — รอบยังไม่ปิด ยอดยังขยับได้ทุกครั้งที่รูด
   *     คิดจากรายการที่รูดไปแล้วในรอบ บวกงวดผ่อนที่จะถูกเรียกเก็บในรอบนั้น
   *
   * ตั้งใจไม่รวมยอดยกมาในตัวประมาณการ เพราะยังไม่รู้ว่าบิลรอบก่อนจะถูกจ่ายครบไหม
   * เดาแล้วผิดแย่กว่าไม่เดา
   */
  getUpcomingBills: (months = 2) => {
    const today = new Date()
    const horizon = new Date(today.getFullYear(), today.getMonth() + months, today.getDate())
    const txs = useTransactionStore.getState().transactions
    const rows = []

    // บัตรที่ปิดใช้งานแล้วยังมีบิลค้างได้ ต้องนับบิลของมันด้วย (ข้ามแค่ยอดประมาณการ
    // เพราะจะไม่มีการรูดเพิ่มอีกแล้ว) ไม่งั้นยอดในปฏิทินกับยอดที่ต้องจ่ายจะไม่ตรงกัน
    for (const card of get().cards) {
      // 1) ใบที่ปิดรอบแล้วและยังจ่ายไม่ครบ — ยอดแน่นอน
      for (const s of get().statements) {
        if (s.cardId !== card.id || !get().isPayableStatement(s)) continue
        const due = new Date(`${s.dueDate}T00:00:00`)
        if (due > horizon) continue
        rows.push({
          key: `s-${s.id}`,
          kind: 'closed',
          cardId: card.id,
          cycle: s.cycle,
          dueDate: s.dueDate,
          due,
          amount: Number(s.amount) - Number(s.paidAmount),
          overdue: due < new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        })
      }

      // 2) รอบที่ยังไม่ปิด ไล่ไปข้างหน้าจนพ้นช่วงที่ดู (บัตรที่ปิดใช้งานแล้วไม่ต้องประมาณการ)
      if (!card.enabled) continue
      const closed = new Set(get().statements.filter((s) => s.cardId === card.id).map((s) => s.cycle))
      const base = cyclePeriod(card.closingDay, card.dueDay)
      const activeIds = new Set(
        get().installments.filter((i) => i.status === 'active' && i.cardId === card.id).map((i) => i.id)
      )
      // รอบประมาณการใบแรกกวาดทุกอย่างที่ยังไม่มีใบไหนครอบ (รายการย้อนหลัง งวดตกค้าง)
      // เหมือนที่ close_card_statement จะทำจริง ใบถัดๆ ไปจึงเอาเฉพาะของในรอบตัวเอง
      // ไม่งั้นของก้อนเดียวกันจะโผล่ในทุกใบประมาณการ
      let sweptUpTo = null      // วันที่สรุปยอดของใบประมาณการก่อนหน้า (string)
      let sweptCycle = null
      for (let k = 0; k <= months + 1; k++) {
        const end = clampedDate(base.end.getFullYear(), base.end.getMonth() + k, card.closingDay)
        const due = dueDateFor(end, card.dueDay)
        if (due > horizon) break
        const cycle = cycleKey(end)
        if (closed.has(cycle)) continue

        const to = toDateString(end)
        const inRange = get().getUncoveredTransactions(card.id, to)
          .filter((t) => !sweptUpTo || t.date > sweptUpTo)
        const spend = inRange.filter((t) => t.type === 'expense')
          .reduce((s, t) => s + Number(t.amount || 0), 0)
        const credit = inRange.filter((t) => t.type === 'income')
          .reduce((s, t) => s + Number(t.amount || 0), 0)
        const advance = get().advances
          .filter((a) => a.cardId === card.id && !a.statementId && a.date <= to && (!sweptUpTo || a.date > sweptUpTo))
          .reduce((s, a) => s + Number(a.amount || 0), 0)

        // งวดผ่อนที่จะถูกเรียกเก็บในรอบนี้ ยังไม่เป็น transaction จึงต้องบวกเพิ่ม
        const installment = get().entries
          .filter((e) => activeIds.has(e.installmentId) && e.status === 'pending'
            && e.cycle <= cycle && (!sweptCycle || e.cycle > sweptCycle))
          .reduce((s, e) => s + Number(e.amount || 0), 0)
        // ยอดที่จ่ายให้รายการไว้ก่อนออกบิล หักออกจากใบที่จะเก็บรายการนั้น (ดู getCurrentCycle)
        const inRangeIds = new Set(inRange.map((t) => t.id))
        const prepaid = get().getOpenPrepayments(card.id)
          .filter((l) => (l.transactionId
            ? inRangeIds.has(l.transactionId)
            : l.paidAt <= to && (!sweptUpTo || l.paidAt > sweptUpTo)))
          .reduce((s, l) => s + Number(l.amount || 0), 0)
        sweptUpTo = to
        sweptCycle = cycle

        const amount = spend + advance - credit + installment - prepaid
        if (amount <= 0) continue
        rows.push({
          key: `p-${card.id}-${cycle}`,
          kind: 'projected',
          cardId: card.id,
          cycle,
          dueDate: toDateString(due),
          due,
          amount,
          installment,
          overdue: false,
        })
      }
    }

    rows.sort((a, b) => a.due - b.due)
    const closedTotal = rows.filter((r) => r.kind === 'closed').reduce((s, r) => s + r.amount, 0)
    const projectedTotal = rows.filter((r) => r.kind === 'projected').reduce((s, r) => s + r.amount, 0)
    return { rows, closedTotal, projectedTotal, total: closedTotal + projectedTotal, months, horizon }
  },

  /**
   * ยอดที่สะสมอยู่ในรอบที่ยังไม่ปิด — คำนวณสดจากรายการ ไม่เก็บในฐานข้อมูล
   * ตอบคำถามว่า "ตอนนี้ก่อหนี้ก้อนหน้าไว้เท่าไรแล้ว"
   *
   * ยอดในรอบมาจากสามที่ และต้องครบทั้งสามถึงจะตรงกับบิลที่ธนาคารจะออก
   *   1. รายการที่รูด (transactions ของบัตรใบนี้ในช่วงรอบ)
   *   2. ยอดกดเงินสด (ไม่ใช่รายรับ-รายจ่าย แต่ธนาคารเก็บรวมมาในบิลเหมือนกัน)
   *   3. ค่างวดผ่อนที่ตกรอบนี้ — ข้อนี้เคยตกหล่น ทำให้บัตรที่มีแต่ยอดผ่อนขึ้น 0.00
   *      ทั้งที่บิลใบหน้ามีค่างวดรออยู่จริง
   *
   * ค่างวดยังไม่ใช่ transaction จนกว่ารอบจะถูกปิด (close_card_statement เป็นคนสร้าง
   * รายจ่ายและเพิ่มหนี้บัตรให้ตอนนั้น) ก่อนหน้านั้นจึงต้องอ่านจากตารางงวดเอง
   * และห้ามนับซ้ำ — งวดที่ปิดรอบไปแล้วสถานะเป็น billed และมี transaction ของตัวเองแล้ว
   * ที่นับตรงนี้จึงเอาเฉพาะ pending
   */
  getCurrentCycle: (cardId) => {
    const card = get().getCard(cardId)
    if (!card) return null
    const period = cyclePeriod(card.closingDay, card.dueDay)
    const to = toDateString(period.end)
    // ทุกรายการที่ยังไม่มีใบไหนครอบ ถึงวันสรุปยอดของรอบนี้ (ดู getUncoveredTransactions)
    const txs = get().getUncoveredTransactions(cardId, to)

    const spend = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0)
    const credit = txs.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0)
    // เงินสดที่กดจากบัตรไม่ใช่รายการรับ-จ่าย แต่ธนาคารเรียกเก็บในบิลรอบนี้เหมือนยอดรูด
    // ที่ยังไม่ผูกกับใบไหน = ยังไม่ถูกเรียกเก็บ
    const adv = get().advances.filter((a) => a.cardId === cardId && !a.statementId && a.date <= to)
    const advance = adv.reduce((s, a) => s + Number(a.amount || 0), 0)

    const activeIns = new Set(
      get().installments.filter((i) => i.status === 'active' && i.cardId === cardId).map((i) => i.id)
    )
    // งวดของรอบนี้ และงวดที่ตกค้างจากรอบก่อนที่ยังไม่ถูกเก็บ (รอบที่ข้ามไปหรือถูกเปลี่ยนวันสรุปยอด)
    // — ธนาคารจะรวมมาในบิลใบถัดไปเสมอ ไม่ปล่อยให้หายไปเฉยๆ
    const insRows = get().entries.filter(
      (e) => activeIns.has(e.installmentId) && e.status === 'pending' && e.cycle <= period.cycle
    )
    const installment = insRows.reduce((s, e) => s + Number(e.amount || 0), 0)

    // ยอดที่โอนจ่ายให้รายการทีละรายการไว้ก่อนออกบิล — ธนาคารหักออกจากยอดที่ต้องชำระ
    // ของใบถัดไป (close_card_statement ตั้ง paid_amount ให้) กฎเลือกขาต้องตรงกับ SQL:
    // ขาของรายการที่ใบนี้จะเก็บ · ขาที่รายการถูกลบไปแล้วดูวันที่จ่ายแทน (กลายเป็นเครดิต)
    const txIds = new Set(txs.map((t) => t.id))
    const prepaid = get().getOpenPrepayments(cardId)
      .filter((l) => (l.transactionId ? txIds.has(l.transactionId) : l.paidAt <= to))
      .reduce((s, l) => s + Number(l.amount || 0), 0)

    return {
      ...period, spend, credit, advance, prepaid,
      installment, installmentCount: insRows.length,
      net: spend + advance - credit + installment - prepaid,
      count: txs.length + adv.length + insRows.length,
    }
  },
}))

export default useCreditCardStore
