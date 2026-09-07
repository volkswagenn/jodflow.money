import { create } from 'zustand'
import { getDaysInMonth } from 'date-fns'
import * as recurringApi from '../lib/api/recurring'
import { localMonthStr } from '../lib/dateUtils'
import { addMonths, billedAmount, monthFirstDay } from '../lib/recurringSchedule'

export function computeDueDate(year, month, billingDay) {
  const lastDay = getDaysInMonth(new Date(year, month - 1))
  const day = Math.min(billingDay, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export const INITIAL = { items: [], entries: [] }

const useRecurringStore = create((set, get) => ({
  ...INITIAL,
  _reset: () => set(INITIAL),

  _hydrate: ({ recurringItems, recurringEntries }) =>
    set({ items: recurringItems ?? [], entries: recurringEntries ?? [] }),

  /**
   * ดึงใหม่ทั้งชุดจากเซิร์ฟเวอร์ — ใช้หลัง RPC ที่แก้ recurring_entries เองในฐานข้อมูล
   * (จ่ายรายการค้างที่ผูกกับรายการประจำ / ยกเลิกรายการ) และเมื่อ realtime แจ้งว่ามีคนอื่นแก้
   */
  refresh: async () => {
    const [recurringItems, recurringEntries] = await Promise.all([
      recurringApi.listRecurringItems(),
      recurringApi.listRecurringEntries(),
    ])
    set({ items: recurringItems, entries: recurringEntries })
  },

  // ── แม่แบบรายการประจำ ─────────────────────────────────────────────────────

  addItem: async (data) => {
    const item = await recurringApi.createRecurringItem(data)
    set((s) => ({ items: [...s.items, item] }))
    return item
  },

  updateItem: async (id, changes) => {
    const item = await recurringApi.updateRecurringItem(id, changes)
    set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...item } : it)) }))
    // เปลี่ยนเป็นรายปี → entry รอจ่ายของเดือนอื่นที่งอกไว้ก่อนหน้าต้องถูกเก็บออก
    if (item.frequency === 'yearly' && item.billingMonth) {
      const removed = await recurringApi.deletePendingEntriesOutsideMonth(id, item.billingMonth)
      if (removed.length > 0) {
        const gone = new Set(removed)
        set((s) => ({ entries: s.entries.filter((e) => !gone.has(e.id)) }))
      }
    }
    return item
  },

  toggleItem: async (id) => {
    const current = get().items.find((it) => it.id === id)
    if (!current) return
    return get().updateItem(id, { enabled: !current.enabled })
  },

  deleteItem: async (id) => {
    const hidden = await recurringApi.deleteRecurringItem(id)
    set((s) => ({
      // แม่แบบที่ยังมีประวัติจ่ายแล้วจะถูกซ่อน ไม่ได้ลบทิ้ง — ต้องคงไว้ใน items
      // ไม่งั้นรอบที่จ่ายแล้วของเดือนเก่าจะหาชื่อรายการไม่เจอแล้วหายจากหน้าจอ
      items: hidden
        ? s.items.map((it) => (it.id === id ? { ...it, ...hidden } : it))
        : s.items.filter((it) => it.id !== id),
      // เก็บ entry ที่จ่ายไปแล้วไว้เป็นประวัติ ลบเฉพาะที่ยังไม่จ่าย
      entries: s.entries.filter((e) => e.recurringId !== id || e.status === 'paid'),
    }))
  },

  // ── entries รายเดือน ──────────────────────────────────────────────────────

  /**
   * สร้าง entries ของเดือนที่ระบุ — เรียกซ้ำได้ไม่เกิดรายการซ้ำ
   * ฐานข้อมูลมี unique (recurring_id, month) เป็นคนกันซ้ำให้ ไม่ใช่เช็คใน JS
   * ซึ่งเชื่อถือไม่ได้เมื่อมีหลายเครื่องกดพร้อมกัน
   */
  generateEntries: async (month) => {
    const created = await recurringApi.generateEntries(month, computeDueDate)
    if (created.length === 0) return []
    set((s) => {
      const seen = new Set(s.entries.map((e) => e.id))
      return { entries: [...s.entries, ...created.filter((e) => !seen.has(e.id))] }
    })
    return created
  },

  updateEntry: async (id, changes) => {
    const entry = await recurringApi.updateRecurringEntry(id, changes)
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...entry } : e)) }))
    return entry
  },

  markSkipped: async (entryId) => get().updateEntry(entryId, { status: 'skipped' }),

  /**
   * พักการเรียกเก็บ n เดือน
   *
   * เริ่มนับจากเดือนนี้ ยกเว้นเดือนนี้จ่ายไปแล้ว — ย้อนไปยกเลิกบิลที่จ่ายแล้วไม่ได้
   * จึงเลื่อนไปเริ่มเดือนถัดไปแทน รอบที่ยังไม่จ่ายในช่วงพักจะถูกลบออก
   * ส่วนรอบที่จ่ายแล้วไม่ถูกแตะ ยอดเงินและประวัติจึงไม่เปลี่ยน
   *
   * @returns { from, until } เดือนเริ่มพักและเดือนที่กลับมาเรียกเก็บ
   */
  pauseItem: async (id, months) => {
    const n = Math.max(1, Math.min(24, Math.round(Number(months) || 0)))
    const thisMonth = localMonthStr()

    const paidThisMonth = get().entries.some(
      (e) => e.recurringId === id && e.month === thisMonth && e.status === 'paid'
    )
    const from = paidThisMonth ? addMonths(thisMonth, 1) : thisMonth
    const until = addMonths(from, n)

    await get().updateItem(id, {
      pausedFrom: monthFirstDay(from),
      pausedUntil: monthFirstDay(until),
    })

    const removed = await recurringApi.deletePendingEntriesInRange(id, from, until)
    if (removed.length > 0) {
      const gone = new Set(removed)
      set((s) => ({ entries: s.entries.filter((e) => !gone.has(e.id)) }))
    }
    return { from, until, months: n }
  },

  /** ยกเลิกการพัก กลับมาเรียกเก็บทันที (รอบของเดือนนี้จะงอกใหม่ตอน generateEntries) */
  resumeItem: async (id) => get().updateItem(id, { pausedFrom: null, pausedUntil: null }),

  /**
   * แก้แม่แบบแล้วให้รอบที่ "ยังไม่จ่าย" ตามไปด้วย
   *
   * entry เก็บยอดกับวันครบกำหนดเป็นสำเนาของตัวเอง (เพราะยอดแต่ละเดือนต่างกันได้)
   * ถ้าไม่ซิงก์ให้ พอแก้ยอดในแม่แบบแล้วเดือนนี้จะยังโชว์ยอดเก่า ดูเหมือนแก้ไม่ติด
   *
   * ตั้งใจไม่แตะ 2 อย่าง
   *   • รอบที่จ่ายแล้ว/ข้ามแล้ว — เป็นประวัติ แก้ย้อนหลังไม่ได้ ไม่งั้นยอดจะไม่ตรงเงินจริง
   *   • เดือนที่ผ่านมาแล้ว — แก้วันนี้ต้องไม่ไปเปลี่ยนบิลของเดือนก่อน
   */
  syncPendingEntries: async (itemId, fromMonth) => {
    const item = get().items.find((it) => it.id === itemId)
    if (!item) return 0

    const targets = get().entries.filter(
      (e) => e.recurringId === itemId && e.status === 'pending' && e.month >= fromMonth
    )

    let changed = 0
    for (const e of targets) {
      const [year, mon] = e.month.split('-').map(Number)
      const patch = { dueDate: computeDueDate(year, mon, item.billingDay) }
      // ยอดคงที่เท่านั้นที่ลอกจากแม่แบบได้ ยอดเปลี่ยนแปลงต้องรอกรอกตอนจ่าย
      if (item.amountType === 'fixed') patch.amount = billedAmount(item)
      if (patch.dueDate === e.dueDate && patch.amount === e.amount) continue
      await get().updateEntry(e.id, patch)
      changed++
    }
    return changed
  },

  /** ย้อนการจ่ายรอบเดือน (หน้าประวัติการจ่าย) — คืนเงินตามรายจ่ายที่ผูก ลบรายจ่าย กลับเป็นยังไม่จ่าย */
  undoEntryPayment: async (id, log = null) => {
    const entry = await recurringApi.undoRecurringEntry(id, log)
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...entry } : e)) }))
    return entry
  },

  /** ย้อนสถานะเมื่อรายการที่ผูกไว้ถูกลบจากหน้าประวัติ */
  syncEntryFromTransaction: async (transactionId) => {
    const targets = get().entries.filter((e) => e.transactionId === transactionId)
    for (const e of targets) {
      await get().updateEntry(e.id, {
        status: 'pending', transactionId: null, pendingPaymentId: null,
        paidAt: null, paidMethod: null, amount: 0,
      })
    }
  },

  /** ย้อนกลับ: รายการค้างที่ผูกอยู่ถูกจ่ายจากหน้ากระเป๋าเงิน */
  syncEntryPaidFromPending: async (pendingPaymentId) => {
    const targets = get().entries.filter((e) => e.pendingPaymentId === pendingPaymentId)
    for (const e of targets) {
      await get().updateEntry(e.id, { status: 'paid', paidAt: new Date().toISOString() })
    }
  },

  getEntriesByMonth: (month) => get().entries.filter((e) => e.month === month),

  getEntriesByDate: (date) => get().entries.filter((e) => e.dueDate === date),

  getSummaryByMonth: (month) => {
    const entries = get().getEntriesByMonth(month)
    const paid = entries.filter((e) => e.status === 'paid')
    const pending = entries.filter((e) => e.status === 'pending')
    return {
      paidCount: paid.length,
      paidTotal: paid.reduce((s, e) => s + (e.amount || 0), 0),
      pendingCount: pending.length,
      pendingTotal: pending.reduce((s, e) => s + (e.amount || 0), 0),
      total: [...paid, ...pending].reduce((s, e) => s + (e.amount || 0), 0),
    }
  },

  getPendingCountCurrentMonth: () => {
    const month = localMonthStr()
    return get().entries.filter((e) => e.month === month && e.status === 'pending').length
  },
}))

export default useRecurringStore
