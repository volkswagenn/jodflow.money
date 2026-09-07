import { create } from 'zustand'
import * as api from '../lib/api/debts'
import { toDateString } from '../lib/cardCycle'

/**
 * หนี้สินและลูกหนี้ — แคชของเซิร์ฟเวอร์ ยอดขยับผ่าน RPC เท่านั้น
 *
 * "คงเหลือ" ไม่เก็บในฐานข้อมูล คำนวณจากงวดที่ยัง pending
 * ป้องกันตัวเลขสองที่ขัดกันเมื่อมีคนแก้พร้อมกัน
 */
export const INITIAL = { debts: [], entries: [] }

const useDebtStore = create((set, get) => ({
  ...INITIAL,
  _reset: () => set(INITIAL),
  _hydrate: (d) => set({ debts: d?.debts ?? [], entries: d?.entries ?? [] }),

  refresh: async () => {
    const d = await api.listDebts()
    set({ debts: d.debts, entries: d.entries })
    return d
  },

  createDebt: async (data, schedule, log) => {
    const debt = await api.createDebt(data, schedule, log)
    await get().refresh()
    return debt
  },
  payEntry: async (id, params) => { const r = await api.payDebtEntry(id, params); await get().refresh(); return r },
  undoEntry: async (id, log) => { const r = await api.undoDebtEntry(id, log); await get().refresh(); return r },
  /** แก้ไขการจ่ายงวดในที่ — วิธี/บัญชี/ยอด/วันที่ */
  editEntryPayment: async (id, params) => { const r = await api.editDebtPayment(id, params); await get().refresh(); return r },
  settleDebt: async (id, params) => { const r = await api.settleDebt(id, params); await get().refresh(); return r },
  cancelDebt: async (id, log) => { const r = await api.cancelDebt(id, log); await get().refresh(); return r },
  /** แก้สัญญาทั้งฉบับ — งวดที่จ่ายไปแล้วไม่ถูกแตะ */
  editDebt: async (id, data, schedule, log) => {
    const d = await api.editDebt(id, data, schedule, log)
    await get().refresh()
    return d
  },

  updateDebt: async (id, changes) => {
    const d = await api.updateDebt(id, changes)
    set((s) => ({ debts: s.debts.map((x) => (x.id === id ? { ...x, ...d } : x)) }))
    return d
  },

  // ── อ่านค่า ───────────────────────────────────────────────────────────────

  getDebt: (id) => get().debts.find((d) => d.id === id),
  getEntries: (debtId) => get().entries.filter((e) => e.debtId === debtId).sort((a, b) => a.seq - b.seq),
  getActive: (direction = null) =>
    get().debts.filter((d) => d.status === 'active' && (!direction || d.direction === direction)),

  /** ความคืบหน้าของสัญญาหนึ่งรายการ */
  getProgress: (debtId) => {
    const debt = get().getDebt(debtId)
    if (!debt) return null
    const rows = get().getEntries(debtId)
    const paid = rows.filter((r) => r.status === 'paid')
    const prepaid = rows.filter((r) => r.status === 'prepaid')
    const remaining = rows.filter((r) => r.status === 'pending')
    const next = remaining[0] ?? null
    return {
      rows,
      paidCount: paid.length,
      prepaidCount: prepaid.length,
      doneCount: paid.length + prepaid.length,
      remainingCount: remaining.length,
      remainingAmount: remaining.reduce((s, r) => s + Number(r.amount || 0), 0),
      paidAmount: [...paid, ...prepaid].reduce((s, r) => s + Number(r.amount || 0), 0),
      next,
    }
  },

  /** หนี้คงเหลือรวม แยกทิศทาง */
  getTotals: () => {
    const active = get().getActive()
    const ids = (dir) => new Set(active.filter((d) => d.direction === dir).map((d) => d.id))
    const sum = (set_) => get().entries
      .filter((e) => set_.has(e.debtId) && e.status === 'pending')
      .reduce((s, e) => s + Number(e.amount || 0), 0)
    return { payable: sum(ids('payable')), receivable: sum(ids('receivable')) }
  },

  /** งวดที่ครบกำหนดภายในช่วง — ใช้ในหน้าสิ่งที่ต้องจ่าย */
  getDueEntries: ({ from = new Date(), days = 60 } = {}) => {
    const start = toDateString(from)
    const end = toDateString(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days))
    const activeIds = new Set(get().getActive().map((d) => d.id))
    return get().entries
      .filter((e) => activeIds.has(e.debtId) && e.status === 'pending' && e.dueDate <= end)
      .filter((e) => e.dueDate >= start || true) // รวมที่เลยกำหนดแล้วด้วย
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  },
}))

export default useDebtStore
