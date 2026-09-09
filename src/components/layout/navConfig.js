/**
 * โครงเมนูของแอป — จัดเป็น 3 กลุ่มตามความถี่ที่ใช้งาน
 *
 * ของเดิมเป็นรายการเรียงยาว 10 อัน ไม่มีหัวข้อ ทำให้หาเมนูที่ต้องการช้า
 * และเมนูที่ใช้นานๆ ครั้ง (นำเข้า/สำรองข้อมูล) กินที่เท่าเมนูที่ใช้ทุกวัน
 * ตอนนี้สองอันนั้นย้ายไปอยู่ในหน้า "ตั้งค่า" ซึ่งเป็นที่ของงานที่ทำเป็นครั้งคราว
 *
 * badges = ชื่อตัวนับใน badgeCounts ที่จะบวกกันเป็นตัวเลขบนป้าย
 */
export const NAV_GROUPS = [
  {
    title: 'ทุกวัน',
    items: [
      { to: '/dashboard', icon: 'space_dashboard', label: 'ภาพรวม' },
      { to: '/transactions', icon: 'edit_note', label: 'บันทึกรายการ' },
      { to: '/pending-tasks', icon: 'pending_actions', label: 'รอดำเนินการ', badges: ['pending', 'income'], badgeTone: 'red' },
    ],
  },
  {
    title: 'เงินของฉัน',
    items: [
      { to: '/wallet', icon: 'account_balance_wallet', label: 'กระเป๋าเงิน' },
      { to: '/cards', icon: 'credit_card', label: 'บัตรและหนี้สิน', badges: ['cardBill'], badgeTone: 'amber' },
      { to: '/payments', icon: 'receipt_long', label: 'ประวัติการจ่าย' },
      { to: '/reports', icon: 'bar_chart', label: 'รายงาน' },
    ],
  },
  {
    title: 'ข้อมูลและระบบ',
    items: [
      { to: '/manage', icon: 'database', label: 'จัดการข้อมูล' },
      { to: '/history', icon: 'history', label: 'ประวัติทั้งหมด' },
      { to: '/settings', icon: 'settings', label: 'ตั้งค่า' },
    ],
  },
]

/**
 * เมนูที่ขึ้นเฉพาะบัญชีแอดมินระบบ — Sidebar เป็นคนตัดสินว่าจะต่อท้ายไหม
 * แยกออกจาก NAV_GROUPS เพื่อให้ "คนทั่วไปเห็นอะไร" อ่านจบได้จากก้อนบนก้อนเดียว
 */
export const ADMIN_GROUP = {
  title: 'แอดมินระบบ',
  items: [{ to: '/admin', icon: 'shield_person', label: 'จัดการลูกค้า' }],
}

/** ชื่อ + คำอธิบายใต้ชื่อของแต่ละหน้า ใช้บนแถบหัวเรื่อง */
export const PAGE_HEADS = {
  '/': { title: 'ภาพรวม' },
  '/dashboard': { title: 'ภาพรวม' },
  '/transactions': { title: 'บันทึกรายการ' },
  '/pending-tasks': { title: 'รอดำเนินการ', sub: 'ทุกอย่างที่ต้องจ่ายและรอรับ รวมไว้ที่เดียว' },
  '/wallet': { title: 'กระเป๋าเงิน', sub: 'เงินสด บัญชีธนาคาร และกระเป๋าย่อยทั้งหมด' },
  '/cards': { title: 'บัตรและหนี้สิน', sub: 'บิลบัตรเครดิต สัญญาผ่อน และเงินกู้' },
  '/payments': { title: 'ประวัติการจ่าย', sub: 'ทุกครั้งที่จ่ายเงินออกไป พร้อมสลิปที่แนบไว้' },
  '/reports': { title: 'รายงาน', sub: 'เลือกช่วงเวลาและประเภท แล้วส่งออกได้ทันที' },
  '/manage': { title: 'จัดการข้อมูล', sub: 'หมวดหมู่ บัญชี บัตร และสัญญาหนี้' },
  '/history': { title: 'ประวัติทั้งหมด', sub: 'ทุกการเปลี่ยนแปลง พร้อมชื่อคนที่ทำ' },
  '/settings': { title: 'ตั้งค่า', sub: 'การแจ้งเตือน สมาชิก ข้อมูล และค่าเริ่มต้นของฟอร์ม' },
  '/import': { title: 'นำเข้าข้อมูล', sub: 'กรอกย้อนหลังเป็นตาราง หรือแนบไฟล์ที่ส่งออกไว้' },
  '/backup': { title: 'สำรองข้อมูล', sub: 'ดาวน์โหลดข้อมูลทั้งหมดของร้านเป็นไฟล์' },
  '/admin': { title: 'แอดมินระบบ', sub: 'ลูกค้าทุกราย สถานะ วันหมดอายุ และบันทึกการเข้าถึง' },
}

/** แถบล่างบนมือถือ — 4 ปุ่ม + ปุ่มบันทึกตรงกลาง */
export const MOBILE_TABS = [
  { to: '/dashboard', icon: 'space_dashboard', label: 'ภาพรวม' },
  { to: '/wallet', icon: 'account_balance_wallet', label: 'กระเป๋า' },
  { fab: true, to: '/transactions', label: 'บันทึกรายการ' },
  { to: '/pending-tasks', icon: 'pending_actions', label: 'รอจ่าย', badges: ['pending', 'income'] },
  { to: '/settings', icon: 'more_horiz', label: 'เพิ่มเติม' },
]
