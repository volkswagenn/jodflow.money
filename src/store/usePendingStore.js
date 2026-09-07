import { create } from 'zustand'
import * as pendingApi from '../lib/api/pending'
import useTransactionStore from './useTransactionStore'
import useWalletStore from './useWalletStore'
import useRecurringStore from './useRecurringStore'

/**
 * หลัง RPC จ่าย/รับเงิน ฐานข้อมูลสร้าง transaction + ขยับยอด + (อาจ) ปิดรอบรายการประจำ
 * ให้ในทีเดียว — store อื่นต้องรู้ด้วย ไม่งั้นรายการใหม่ไม่โผล่ในแดชบอร์ด/ประวัติ
 * และรายการประจำยังขึ้น "รอจ่าย" จนกว่าจะรีโหลด
 */
async function propagateAtomicResult(tx) {
  useTransactionStore.getState().insertLocal(tx)
  await Promise.all([
    useWalletStore.getState().refresh(),
    useRecurringStore.getState().refresh(),
  ])
}

export const INITIAL = { pendingPayments: [], taxInvoices: [], pendingIncomes: [] }

/**
 * ค้างชำระ / รอรับเงิน / รอใบกำกับภาษี
 *
 * `payPendingAtomic` และ `receivePendingIncomeAtomic` คือทางที่ถูกต้อง — สร้างรายการ
 * ตัดเงิน ปิดรายการค้าง และเขียน log จบในคำสั่งเดียวที่ฐานข้อมูล
 * ส่วน `payPending` / `receivePendingIncome` แบบเดิมเหลือไว้เพื่อให้หน้าที่ยังไม่ได้แก้
 * ทำงานต่อได้ (แก้แค่สถานะ ไม่แตะเงิน) — จะถูกถอดออกเมื่อแก้หน้าพวกนั้นครบ
 */
const usePendingStore = create((set, get) => ({
  ...INITIAL,
  _reset: () => set(INITIAL),

  _hydrate: ({ pendingPayments, pendingIncomes, taxInvoices }) =>
    set({
      pendingPayments: pendingPayments ?? [],
      pendingIncomes: pendingIncomes ?? [],
      taxInvoices: taxInvoices ?? [],
    }),

  /**
   * ดึงทั้ง 3 รายการใหม่จากเซิร์ฟเวอร์
   * ใช้หลังคำสั่งที่ฐานข้อมูลแก้หลายตารางเองในทีเดียว (เช่นยกเลิกรายการ)
   * ซึ่ง client เดาไม่ได้ว่ามีแถวไหนเปลี่ยนไปบ้าง
   */
  refresh: async () => {
    const [pendingPayments, pendingIncomes, taxInvoices] = await Promise.all([
      pendingApi.listPendingPayments(),
      pendingApi.listPendingIncomes(),
      pendingApi.listTaxInvoices(),
    ])
    set({ pendingPayments, pendingIncomes, taxInvoices })
  },

  // ── รอรับเงิน ─────────────────────────────────────────────────────────────

  addPendingIncome: async (data) => {
    const item = await pendingApi.createPendingIncome(data)
    set((s) => ({ pendingIncomes: [item, ...s.pendingIncomes] }))
    return item
  },

  receivePendingIncome: async (id, method, transactionId = null, transferAccountId = null) => {
    const item = await pendingApi.updatePendingIncome(id, {
      status: 'received',
      receivedAt: new Date().toISOString(),
      receivedMethod: method,
      transferAccountId,
      ...(transactionId ? { transactionId } : {}),
    })
    set((s) => ({ pendingIncomes: s.pendingIncomes.map((p) => (p.id === id ? { ...p, ...item } : p)) }))
    return item
  },

  /** รับเงิน + สร้างรายการ + เพิ่มยอด ในคำสั่งเดียว — คืน transaction ที่สร้าง */
  receivePendingIncomeAtomic: async (id, { method, accountId = null, date = null, log = null }) => {
    const tx = await pendingApi.receivePendingIncome(id, { method, accountId, date, log })
    set((s) => ({
      pendingIncomes: s.pendingIncomes.map((p) =>
        p.id === id
          ? {
            ...p, status: 'received', receivedAt: new Date().toISOString(),
            receivedMethod: method, transferAccountId: accountId, transactionId: tx.id,
          }
          : p
      ),
    }))
    await propagateAtomicResult(tx)
    return tx
  },

  deletePendingIncome: async (id) => {
    await pendingApi.deletePendingIncome(id)
    set((s) => ({ pendingIncomes: s.pendingIncomes.filter((p) => p.id !== id) }))
  },

  unReceivePendingIncome: async (id) => {
    const item = await pendingApi.updatePendingIncome(id, {
      status: 'pending', receivedAt: null, receivedMethod: null, transactionId: null,
    })
    set((s) => ({ pendingIncomes: s.pendingIncomes.map((p) => (p.id === id ? { ...p, ...item } : p)) }))
  },

  getPendingIncomeUnpaid: () => get().pendingIncomes.filter((p) => p.status === 'pending'),
  getPendingIncomeTotal: () =>
    get().pendingIncomes.filter((p) => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0),

  // ── ค้างชำระ ──────────────────────────────────────────────────────────────

  addPending: async (data) => {
    const item = await pendingApi.createPendingPayment(data)
    set((s) => ({ pendingPayments: [item, ...s.pendingPayments] }))
    return item
  },

  /** ย้อนการจ่าย (หน้าประวัติการจ่าย) — เงินคืน รายจ่ายหาย รายการกลับเป็นค้างชำระ */
  undoPendingPayment: async (id, log = null) => {
    const item = await pendingApi.undoPendingPayment(id, log)
    set((s) => ({ pendingPayments: s.pendingPayments.map((p) => (p.id === id ? { ...p, ...item } : p)) }))
    return item
  },

  payPending: async (id, method, transactionId = null, transferAccountId = null) => {
    const item = await pendingApi.updatePendingPayment(id, {
      status: 'paid',
      paidAt: new Date().toISOString(),
      paidMethod: method,
      transferAccountId,
      ...(transactionId ? { transactionId } : {}),
    })
    set((s) => ({ pendingPayments: s.pendingPayments.map((p) => (p.id === id ? { ...p, ...item } : p)) }))
    return item
  },

  /** จ่าย + สร้างรายการ + ตัดเงิน + อัปเดตรายการประจำ ในคำสั่งเดียว */
  payPendingAtomic: async (id, { method, accountId = null, date = null, log = null }) => {
    const tx = await pendingApi.payPendingPayment(id, { method, accountId, date, log })
    set((s) => ({
      pendingPayments: s.pendingPayments.map((p) =>
        p.id === id
          ? {
            ...p, status: 'paid', paidAt: new Date().toISOString(),
            paidMethod: method, transferAccountId: accountId, transactionId: tx.id,
          }
          : p
      ),
    }))
    await propagateAtomicResult(tx)
    return tx
  },

  deletePending: async (id) => {
    await pendingApi.deletePendingPayment(id)
    set((s) => ({ pendingPayments: s.pendingPayments.filter((p) => p.id !== id) }))
  },

  deletePendingByTxId: async (transactionId) => {
    await pendingApi.deletePendingPaymentByTxId(transactionId)
    set((s) => ({ pendingPayments: s.pendingPayments.filter((p) => p.transactionId !== transactionId) }))
  },

  unPayPending: async (id) => {
    const item = await pendingApi.updatePendingPayment(id, {
      status: 'pending', paidAt: null, paidMethod: null, transactionId: null,
    })
    set((s) => ({ pendingPayments: s.pendingPayments.map((p) => (p.id === id ? { ...p, ...item } : p)) }))
  },

  updatePendingById: async (id, changes) => {
    const item = await pendingApi.updatePendingPayment(id, changes)
    set((s) => ({ pendingPayments: s.pendingPayments.map((p) => (p.id === id ? { ...p, ...item } : p)) }))
    return item
  },

  syncPendingByTxId: async (transactionId, changes) => {
    const targets = get().pendingPayments.filter((p) => p.transactionId === transactionId)
    for (const p of targets) await get().updatePendingById(p.id, changes)
  },

  getPendingUnpaid: () => get().pendingPayments.filter((p) => p.status === 'pending'),
  getPendingTotal: () =>
    get().pendingPayments.filter((p) => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0),

  // ── รอใบกำกับภาษี ─────────────────────────────────────────────────────────

  addTaxInvoice: async (data) => {
    const item = await pendingApi.createTaxInvoice(data)
    set((s) => ({ taxInvoices: [item, ...s.taxInvoices] }))
    return item
  },

  receiveTaxInvoice: async (id, filePath = null) => {
    const item = await pendingApi.receiveTaxInvoice(id, filePath)
    set((s) => ({ taxInvoices: s.taxInvoices.map((t) => (t.id === id ? { ...t, ...item } : t)) }))
    return item
  },

  deleteTaxInvoice: async (id) => {
    await pendingApi.deleteTaxInvoice(id)
    set((s) => ({ taxInvoices: s.taxInvoices.filter((t) => t.id !== id) }))
  },

  deleteTaxInvoiceByTxId: async (transactionId) => {
    await pendingApi.deleteTaxInvoiceByTxId(transactionId)
    set((s) => ({ taxInvoices: s.taxInvoices.filter((t) => t.transactionId !== transactionId) }))
  },

  unreceiveTaxInvoice: async (id) => {
    const item = await pendingApi.unreceiveTaxInvoice(id)
    set((s) => ({ taxInvoices: s.taxInvoices.map((t) => (t.id === id ? { ...t, ...item } : t)) }))
  },

  syncTaxInvoiceByTxId: async (transactionId, changes) => {
    const targets = get().taxInvoices.filter((t) => t.transactionId === transactionId)
    for (const t of targets) {
      const item = await pendingApi.updateTaxInvoice(t.id, changes)
      set((s) => ({ taxInvoices: s.taxInvoices.map((x) => (x.id === t.id ? { ...x, ...item } : x)) }))
    }
  },

  getTaxWaiting: () => get().taxInvoices.filter((t) => t.status === 'waiting'),
}))

export default usePendingStore
