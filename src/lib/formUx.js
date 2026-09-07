/**
 * พฤติกรรมของฟอร์มที่ควรเหมือนกันทั้งแอป — ติดตั้งครั้งเดียวตอนเปิดแอป
 *
 * ทำไมต้องทำที่ระดับ document แทนที่จะไล่ใส่ทีละช่อง: แอปนี้มีป็อปอัปเกิน 20 จอ
 * และมีช่องกรอกตัวเลขกระจายอยู่หลายสิบจุด ถ้าไล่แก้ทีละไฟล์จะมีที่ตกหล่นเสมอ
 * และของที่เพิ่มเข้ามาใหม่ก็จะไม่ได้พฤติกรรมนี้จนกว่าจะมีคนนึกได้
 *
 * ทั้ง 3 อย่างผูกกับคลาสปุ่มที่ใช้ทั้งแอปอยู่แล้ว (btn-primary / btn-danger / …)
 * จึงไม่ต้องแก้หน้าจอไหนเลย
 */

// ปุ่มที่ถือเป็น "ปุ่มยืนยัน" ของจอนั้น — ปุ่มรองอย่าง btn-secondary ไม่นับ
const SUBMIT_BTN = /\bbtn-(primary|danger|warning|success|accent)\b/

// กรอบของป็อปอัป ใช้จำกัดขอบเขตว่า Enter จะไปกดปุ่มไหน
const POPUP = '.fixed.inset-0'

const isTypingField = (el) =>
  el instanceof HTMLInputElement &&
  !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(el.type)

function findSubmitButton(scope) {
  return [...scope.querySelectorAll('button')].find(
    (b) => !b.disabled && SUBMIT_BTN.test(b.className)
  )
}

/**
 * 1. กด Enter ในช่องกรอก = กดปุ่มยืนยันของจอนั้น
 *
 * จำกัดขอบเขตไว้แค่ในป็อปอัปหรือ <form> เท่านั้น ถ้าอยู่นอกนั้น (เช่นช่องค้นหา
 * กลางหน้า) จะไม่ทำอะไร ไม่งั้น Enter จะไปกดปุ่มอะไรก็ไม่รู้ที่อยู่ไกลออกไป
 *
 * textarea ไม่เข้าเงื่อนไข เพราะ Enter ในนั้นต้องขึ้นบรรทัดใหม่
 */
function onKeyDown(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
  if (e.isComposing || e.keyCode === 229) return // กำลังพิมพ์ภาษาไทย/ญี่ปุ่นอยู่
  if (!isTypingField(e.target)) return

  const scope = e.target.closest(POPUP) || e.target.closest('form')
  if (!scope) return

  const btn = findSubmitButton(scope)
  if (!btn) return

  e.preventDefault()
  btn.click()
}

/**
 * 2. คลิกเข้าช่องตัวเลข = เลือกค่าเดิมทั้งหมด พิมพ์ทับได้เลย
 *
 * ช่องที่มีค่าตั้งต้นเป็น 0 ถ้าไม่เลือกให้ พอพิมพ์ 10000 จะได้ 010000
 */
const isNumericField = (el) =>
  el instanceof HTMLInputElement &&
  !el.readOnly && !el.disabled &&
  (el.type === 'number' || el.inputMode === 'decimal' || el.inputMode === 'numeric')

// ช่องที่เพิ่งได้โฟกัสและยังไม่ถูกเลือกให้ — ใช้แยกคลิกแรก (เลือกทั้งหมด)
// ออกจากคลิกถัดๆ ไป (วางเคอร์เซอร์เองตามปกติ ยังแก้ทีละหลักได้)
let awaitingSelect = null

function onFocusIn(e) {
  if (!isNumericField(e.target)) {
    awaitingSelect = null
    return
  }
  const el = e.target
  awaitingSelect = el
  // เผื่อกรณีโฟกัสด้วยคีย์บอร์ด (กด Tab) ซึ่งไม่มี click ตามมา
  // ถ้าเข้ามาด้วยเมาส์ mouseup จะล้างการเลือกนี้ทิ้ง แล้วไปเลือกใหม่ตอน click แทน
  setTimeout(() => {
    if (document.activeElement === el && awaitingSelect === el) el.select()
  }, 0)
}

/**
 * เลือกทั้งหมดตอนคลิกครั้งแรก
 *
 * ต้องทำตอน click ไม่ใช่ตอน focus เพราะ mouseup จะยุบการเลือกมาเป็นเคอร์เซอร์
 * ตรงจุดที่คลิก การ select() ตอน focus จึงถูกล้างทิ้งทุกครั้งที่ใช้เมาส์
 */
function selectOnFirstClick(e) {
  const el = e.target
  if (!isNumericField(el) || awaitingSelect !== el) return
  awaitingSelect = null
  el.select()
}

/**
 * 3. กันกดปุ่มยืนยันซ้ำ
 *
 * ปุ่มยืนยันเกือบทุกจอสั่งงานที่ต้องรอเซิร์ฟเวอร์ ระหว่างรอป็อปอัปยังเปิดอยู่และ
 * ปุ่มยังกดได้ ผู้ใช้ที่เห็นว่ากดแล้วเงียบจะกดซ้ำ แล้วได้รายการซ้ำหรือเงินถูกตัดสองรอบ
 *
 * ดักที่ช่วง capture ของ document จึงหยุดได้ก่อนที่ React จะได้รับ event
 * นับแยกรายปุ่ม ปุ่มคนละตัวยังกดรัวได้ตามปกติ (เช่นกดจ่ายหลายรายการติดกัน)
 * และไม่แตะปุ่มรอง เลขบนแป้นตัวเลขกับปุ่มเลื่อนเดือนจึงยังกดรัวได้เหมือนเดิม
 */
const LOCK_MS = 900

function onClick(e) {
  selectOnFirstClick(e)

  const btn = e.target instanceof Element ? e.target.closest('button') : null
  if (!btn || btn.disabled || !SUBMIT_BTN.test(btn.className)) return

  const now = Date.now()
  const last = Number(btn.dataset.lastSubmitAt || 0)
  if (last && now - last < LOCK_MS) {
    e.preventDefault()
    e.stopImmediatePropagation()
    return
  }
  btn.dataset.lastSubmitAt = String(now)
}

let installed = false

export function installGlobalFormUx() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', onFocusIn, true)
  // click ต้องมาหลัง mouseup จึงจะเลือกข้อความค้างไว้ได้ (ดู selectOnFirstClick)
  document.addEventListener('click', onClick, true)
}

/**
 * ย้ายโฟกัสไปช่องกรอกถัดไปในฟอร์มเดียวกัน — ใช้กับ Enter ในช่องยอดเงิน
 *
 * ในหน้าบันทึกรายการ ยอดเงินคือช่องแรกที่กรอกเสมอ พอกรอกเสร็จมือต้องไปช่องถัดไป
 * (รายจ่าย = ชื่อรายการ · รายรับ = ช่องทางถัดไป) การให้กด Enter ทำแทน Tab จึงพิมพ์รวดเดียวจบ
 * ไม่ต้องละมือไปหาเมาส์ทุกครั้ง — คนคีย์ใบเสร็จทีละสิบใบรู้สึกต่างทันที
 *
 * นับเฉพาะช่องที่ "กรอกได้จริง" (ปุ่มไม่นับ) ไม่งั้นจะกระโดดไปโดนปุ่มยอดด่วนที่อยู่ข้างๆ
 * และจำกัดขอบเขตไว้ในกล่องฟอร์มเดียวกัน จะได้ไม่หลุดไปโฟกัสช่องของแผงอื่นในหน้า
 */
const FIELDS = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea'

export function focusNextField(from) {
  if (!from) return false
  const scope = from.closest('[data-form-scope], form') ?? document
  const list = [...scope.querySelectorAll(FIELDS)]
    .filter((el) => !el.disabled && !el.readOnly && el.offsetParent !== null)
  const i = list.indexOf(from)
  const next = i === -1 ? null : list[i + 1]
  if (!next) return false
  next.focus()
  // ช่องที่มีค่าอยู่แล้วให้เลือกทั้งหมด พิมพ์ทับได้เลยเหมือนกฎเดิมของช่องตัวเลข
  if (typeof next.select === 'function' && next.value) next.select()
  return true
}
