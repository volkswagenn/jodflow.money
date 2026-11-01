import { supabase, toThaiError } from '../supabase'
import { getShopId } from './context'

/**
 * ไฟล์แนบ (ใบเสร็จ / ใบกำกับภาษี) บน Supabase Storage
 *
 * bucket 'attachments' เป็น private — policy ใน policies.sql ตรวจว่าโฟลเดอร์แรกของพาธ
 * คือ shop_id ที่ผู้ใช้เป็นสมาชิก จึงต้องคุมพาธให้เป็นรูปนี้เสมอ:
 *   <shop_id>/<receipts|taxinvoices>/<YYYY>/<MM>/<filename>
 * ถ้าพาธผิดรูป policy จะ cast โฟลเดอร์แรกเป็น uuid ไม่ผ่านแล้ว error แปลกๆ แทนที่จะบอกว่าไม่มีสิทธิ์
 *
 * ของเดิม (สมัยแอปในเครื่อง) "อัปโหลด" = ดาวน์โหลดไฟล์กลับลงเครื่องผู้ใช้ แล้วเก็บแค่ชื่อพาธ
 * ซึ่งบนเว็บไม่มีความหมาย — เครื่องอื่นเปิดดูไม่ได้เลย
 */
export const ATTACHMENT_BUCKET = 'attachments'

/** โฟลเดอร์ปลายทางของไฟล์ ตามประเภทและวันที่ของรายการ */
export function attachmentFolder(folderBase, createdAt) {
  const d = new Date(createdAt ?? Date.now())
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${getShopId()}/${folderBase}/${year}/${month}`
}

/** พาธนี้อยู่บน Storage ไหม (รุ่นเก่าเก็บพาธในเครื่อง เช่น attachments/receipts/...) */
export function isCloudPath(path) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i.test(String(path ?? ''))
}

function storageError(error) {
  const msg = error?.message ?? String(error)
  if (/bucket not found/i.test(msg)) {
    return 'ยังไม่ได้สร้างที่เก็บไฟล์แนบบนเซิร์ฟเวอร์ — ให้เจ้าของร้านรัน supabase/fix.sql ใน SQL Editor'
  }
  if (/already exists|duplicate/i.test(msg)) return 'มีไฟล์ชื่อนี้อยู่แล้ว ลองอัปโหลดใหม่อีกครั้ง'
  if (/payload too large|exceeded the maximum allowed size/i.test(msg)) return 'ไฟล์ใหญ่เกินขนาดที่เซิร์ฟเวอร์รับ'
  return toThaiError(error)
}

/** อัปโหลด 1 ไฟล์ — คืนพาธที่เก็บ (เอาไปใส่ใน attachments ของรายการ) */
export async function uploadAttachment(file, { folderBase, filename, createdAt }) {
  const path = `${attachmentFolder(folderBase, createdAt)}/${filename}`
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw new Error(storageError(error))
  return path
}

/** ลิงก์ชั่วคราวสำหรับเปิดดู (bucket เป็น private จึงต้องใช้ signed URL) */
export async function getAttachmentUrl(path, expiresInSeconds = 3600, options = undefined) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, expiresInSeconds, options)
  if (error) throw new Error(storageError(error))
  return data.signedUrl
}

export async function deleteAttachment(path) {
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([path])
  if (error) throw new Error(storageError(error))
}
