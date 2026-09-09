import { supabase } from './supabase'
import useAppStore from '../store/useAppStore'
import useCategoryStore from '../store/useCategoryStore'
import useCreditCardStore from '../store/useCreditCardStore'
import useDebtStore from '../store/useDebtStore'
import useNoteStore from '../store/useNoteStore'
import usePaymentSlipStore from '../store/usePaymentSlipStore'
import usePendingStore from '../store/usePendingStore'
import useRecurringStore from '../store/useRecurringStore'
import useTransactionStore from '../store/useTransactionStore'
import useWalletStore from '../store/useWalletStore'

/**
 * ให้ทุกเครื่องที่เปิดอยู่เห็นการแก้ไขของกันและกัน
 *
 * วิธี: ฟัง postgres_changes ของทุกตารางในร้าน (กรองด้วย shop_id) แล้ว "ดึงใหม่ทั้งชุด"
 * ของ store ที่เกี่ยวข้อง แทนที่จะพยายามแพตช์ทีละแถวจาก payload
 *   • ปลอดภัยกว่า — งานที่แตะเงินแก้หลายตารางในทรานแซกชันเดียว ถ้าแพตช์ทีละ event
 *     จะมีจังหวะที่หน้าจอเห็นครึ่งเดียว (รายการมาแล้วแต่ยอดยังไม่ขยับ)
 *   • ง่ายกว่า — ไม่ต้องแปลง payload snake_case → camelCase และไม่ต้องกรอง echo ของตัวเอง
 *     (event จากสิ่งที่เครื่องนี้เพิ่งทำ แค่ทำให้ดึงซ้ำอีกรอบ ไม่เสียหาย)
 * event ที่มาติดกันถูกรวมเป็นครั้งเดียวด้วย debounce สั้นๆ
 *
 * เสริมด้วย: กลับมาที่แท็บหลังซ่อนไว้นานเกิน STALE_AFTER_MS → ดึงทั้งหมดใหม่ เผื่อ
 * websocket หลุดไปตอนเครื่องหลับแล้ว event หายไประหว่างนั้น
 */

const TABLE_STORES = {
  transactions: [useTransactionStore],
  wallet_state: [useWalletStore],
  transfer_accounts: [useWalletStore],
  sub_wallets: [useWalletStore],
  loans: [useWalletStore],
  credit_cards: [useCreditCardStore],
  card_statements: [useCreditCardStore],
  card_installments: [useCreditCardStore],
  card_installment_entries: [useCreditCardStore],
  card_advances: [useCreditCardStore],
  card_statement_payments: [useCreditCardStore],
  debts: [useDebtStore],
  debt_entries: [useDebtStore],
  pending_payments: [usePendingStore],
  pending_incomes: [usePendingStore],
  tax_invoices: [usePendingStore],
  recurring_items: [useRecurringStore],
  recurring_entries: [useRecurringStore],
  categories: [useCategoryStore],
  vendors: [useCategoryStore],
  quick_items: [useCategoryStore],
  calendar_notes: [useNoteStore],
  shop_settings: [useAppStore],
  payment_slips: [usePaymentSlipStore],
}

const DEBOUNCE_MS = 400
const STALE_AFTER_MS = 30_000

/** ดึงข้อมูลของทุก store ใหม่ (ไม่รวมประวัติ ซึ่งโหลดทีละหน้าตอนเปิดหน้าประวัติ) */
export async function refreshAllStores() {
  const stores = new Set(Object.values(TABLE_STORES).flat())
  await Promise.all([...stores].map((s) => s.getState().refresh()))
}

/**
 * เริ่มฟังการเปลี่ยนแปลงของร้านนี้ — คืนฟังก์ชันสำหรับหยุดฟัง (ใช้ใน useEffect)
 * @param {string} shopId
 * @param {(status: 'connected'|'disconnected') => void} [onStatus]
 */
export function subscribeRealtime(shopId, onStatus) {
  if (!shopId) return () => {}

  const dirty = new Set()
  let timer = null

  const flush = () => {
    timer = null
    const stores = new Set([...dirty].flatMap((table) => TABLE_STORES[table] ?? []))
    dirty.clear()
    for (const store of stores) {
      store.getState().refresh().catch((err) => {
        console.warn('ดึงข้อมูลตาม realtime ไม่สำเร็จ:', err?.message ?? err)
      })
    }
  }

  // postgres_changes ตรวจสิทธิ์ด้วย JWT ของ Supabase Auth ซึ่งเราเลิกใช้แล้ว (ระบบล็อกอินเป็นของเราเอง)
  // จึงเปลี่ยนเป็น broadcast จาก trigger ฝั่งฐาน (supabase/users.sql หมวด 12): ส่งมาแค่
  // "ตาราง X ของร้านนี้เปลี่ยน" ไม่มีตัวข้อมูล แล้วเราดึงใหม่ผ่านทางที่มีสิทธิ์ตามปกติ
  const channel = supabase.channel(`shop:${shopId}`, { config: { private: false } })
  channel.on('broadcast', { event: 'change' }, ({ payload }) => {
    const table = payload?.table
    if (!table || !TABLE_STORES[table]) return
    dirty.add(table)
    if (!timer) timer = setTimeout(flush, DEBOUNCE_MS)
  })
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') onStatus?.('connected')
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('disconnected')
  })

  // กลับมาที่แท็บหลังหายไปนาน → ดึงใหม่ทั้งชุด
  let hiddenAt = null
  const onVisibility = () => {
    if (document.hidden) {
      hiddenAt = Date.now()
      return
    }
    if (hiddenAt && Date.now() - hiddenAt >= STALE_AFTER_MS) {
      refreshAllStores().catch((err) => console.warn('ดึงข้อมูลตอนกลับมาที่แท็บไม่สำเร็จ:', err?.message ?? err))
    }
    hiddenAt = null
  }
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    supabase.removeChannel(channel)
  }
}
