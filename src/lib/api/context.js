/**
 * ร้านที่กำลังเปิดอยู่ + ผู้ใช้ที่ล็อกอินอยู่
 *
 * ทุก query ต้องกรองด้วย shop_id เสมอ (RLS กันอีกชั้นที่ฐานข้อมูลอยู่แล้ว แต่ถ้าไม่กรอง
 * ฝั่ง client เวลาเปิดหลายร้านในอนาคตจะได้ข้อมูลปนกัน) เก็บไว้ที่เดียวตรงนี้
 * แทนที่จะส่ง shopId ผ่านทุกฟังก์ชัน — AuthProvider เป็นคนตั้งค่าให้ตอนโหลดร้านเสร็จ
 *
 * userId ใช้กับ insert ตรงที่ต้องใส่คอลัมน์ "ใครทำ" เอง (ประวัติจากหน้ากระเป๋าเงิน ·
 * เครื่องหมายติ๊กในบิลบัตร) — RPC การเงินไม่ต้องใช้ เพราะฐานข้อมูลรู้จาก auth.uid()
 * ที่ pre-request hook ตั้งให้จากตั๋วของเรา (ดู supabase/users.sql หมวด 3)
 */
let currentShopId = null
let currentRole = null
let currentUserId = null

export function setShopId(id) {
  currentShopId = id ?? null
}

/** role ของผู้ใช้ในร้านนี้ ('owner' | 'editor' | 'viewer') — AuthProvider ตั้งให้พร้อม shopId */
export function setShopRole(role) {
  currentRole = role ?? null
}

export function setUserId(id) {
  currentUserId = id ?? null
}

/** id ของผู้ใช้ที่ล็อกอินอยู่ — null ถ้ายังไม่ได้ล็อกอิน */
export function getUserId() {
  return currentUserId
}

/**
 * แก้ไขข้อมูลได้ไหม — ใช้ที่ชั้น api สำหรับงานที่ "แอบเขียน" ตอนเปิดหน้า
 * (เช่นสร้างรอบรายการประจำของเดือนที่ดู) จะได้ข้ามไปเลยสำหรับ viewer
 * แทนที่จะยิงไปให้ RLS ปฏิเสธแล้วเด้ง error ทุกครั้งที่เปิดหน้า
 */
export function canEditShop() {
  return currentRole === 'owner' || currentRole === 'editor'
}

export function getShopId() {
  if (!currentShopId) {
    throw new Error('ยังไม่ได้เลือกร้าน — เกิดจากเรียก api ก่อนที่ระบบจะโหลดข้อมูลร้านเสร็จ')
  }
  return currentShopId
}

export function hasShop() {
  return Boolean(currentShopId)
}
