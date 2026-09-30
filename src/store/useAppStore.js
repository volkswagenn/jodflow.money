import { create } from 'zustand'
import * as settingsApi from '../lib/api/settings'

/* global __APP_VERSION__ */
// เวอร์ชันฝังตอน build จาก package.json (ดู define ใน vite.config.js)
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

// allowNegativeBalance เริ่มที่ true = พฤติกรรมเดิม (เตือนแล้วจ่ายต่อได้) จนกว่าจะอ่านค่าจริงจากร้านได้
const INITIAL_PERSISTED = { notifyDaysBefore: 3, allowNegativeBalance: true, negativeSettingReady: false }

const pick = (settings) => ({
  notifyDaysBefore: settings?.notifyDaysBefore ?? 3,
  allowNegativeBalance: settings?.allowNegativeBalance ?? true,
  negativeSettingReady: settings?.negativeSettingReady ?? false,
})

/**
 * ตั้งค่าระดับร้าน — เก็บในตาราง shop_settings ไม่ใช่ localStorage
 * ทุกคนในร้านจึงเห็นค่าเดียวกัน และแก้ได้เฉพาะเจ้าของร้าน (RLS บังคับ)
 */
const useAppStore = create((set) => ({
  version: APP_VERSION,
  ...INITIAL_PERSISTED,

  _reset: () => set(INITIAL_PERSISTED),

  _hydrate: (settings) => set(pick(settings)),

  /** ดึงใหม่ — ใช้เมื่อ realtime แจ้งว่าเจ้าของร้านแก้ค่าตั้งค่าจากเครื่องอื่น */
  refresh: async () => {
    const settings = await settingsApi.loadSettings()
    set(pick(settings))
  },

  /** เปิด/ปิด "อนุญาตให้ยอดเงินติดลบ" — รอผลจากเซิร์ฟเวอร์ก่อนค่อยเปลี่ยนบนจอ */
  setAllowNegativeBalance: async (allow) => {
    const saved = await settingsApi.saveAllowNegativeBalance(allow)
    set(saved)
  },

  setNotifyDaysBefore: async (n) => {
    const previous = useAppStore.getState().notifyDaysBefore
    const value = Number(n) || 0
    set({ notifyDaysBefore: value })
    try {
      await settingsApi.saveNotifyDaysBefore(value)
    } catch (err) {
      set({ notifyDaysBefore: previous })
      throw err
    }
  },
}))

export default useAppStore
