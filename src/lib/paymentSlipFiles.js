import { uploadAttachment } from './api/attachments'
import { buildLogEntry } from './logBuilder'
import usePaymentSlipStore from '../store/usePaymentSlipStore'
import useLogStore from '../store/useLogStore'

/** ขนาดสูงสุดต่อไฟล์ — เท่ากับช่องอัปโหลดอื่นในแอป (FileUploadPopup) */
export const MAX_SLIP_BYTES = 15 * 1024 * 1024

const EXT_OF_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf',
}

/**
 * ตั้งชื่อไฟล์ — หน้าดูสลิปดูชนิดไฟล์จากนามสกุล จึงต้องมีนามสกุลจริงเสมอ
 * (รูปที่วางจากคลิปบอร์ดบางเบราว์เซอร์ไม่มีชื่อไฟล์มาให้)
 */
function slipFilename(file, paidAt, index, total) {
  const named = file.name?.includes('.') ? file.name.split('.').pop().toLowerCase() : null
  const ext = named || EXT_OF_TYPE[file.type] || 'file'
  const base = new Date(paidAt ?? Date.now())
  const now = new Date()
  const two = (n) => String(n).padStart(2, '0')
  const day = `${two(base.getDate())}${two(base.getMonth() + 1)}${String(base.getFullYear()).slice(-2)}`
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  const suffix = total > 1 ? `_${two(index + 1)}` : ''
  return `slip_${day}_${time}${suffix}.${ext}`
}

/**
 * ป๊อปอัปปิดไปแล้วตอนสลิปพลาด จึงต้องขึ้นที่ ErrorToast ซึ่งอยู่ทุกหน้า
 * ใช้ event แยกจาก error ทั่วไป เพราะหัวข้อ "ทำรายการไม่สำเร็จ" ของ error ทั่วไป
 * จะทำให้เข้าใจว่าเงินยังไม่ออก แล้วกดจ่ายซ้ำ
 */
function warnPaidButNoSlip(message) {
  window.dispatchEvent(new CustomEvent('app-warning', {
    detail: { title: 'จ่ายเงินสำเร็จแล้ว แต่แนบสลิปไม่ครบ', message },
  }))
}

/**
 * แนบสลิปให้การจ่ายที่เพิ่งสำเร็จ — เรียกหลังเงินออกแล้วเท่านั้น
 *
 * ฟังก์ชันนี้ห้าม throw: เงินออกไปแล้ว ถ้าโยน error ขึ้นไป หน้าจ่ายจะขึ้นว่าไม่สำเร็จ
 * แล้วคนจะกดจ่ายซ้ำ สลิปเป็นหลักฐานประกอบ พลาดก็แค่บอกให้แนบใหม่จากหน้าประวัติการจ่าย
 *
 * @param kind  card_bill | card_installment | debt | pending | recurring
 * @param refId id ของแถวการจ่าย ต้องตรงกับที่ usePaymentHistory ใช้ ไม่งั้นสลิปจะไม่โผล่
 */
export async function attachSlipFiles({ kind, refId, paidAt, title, amount, files }) {
  if (!files?.length) return
  const uploadedAt = new Date().toISOString()
  const attachments = []
  let firstError = null

  for (let i = 0; i < files.length; i += 1) {
    try {
      const path = await uploadAttachment(files[i], {
        folderBase: 'slips',
        filename: slipFilename(files[i], paidAt, i, files.length),
        createdAt: paidAt,
      })
      attachments.push({
        path, type: 'slip', uploadedAt,
        label: files.length > 1 ? `สลิป ${i + 1}` : 'สลิปโอนเงิน',
      })
    } catch (err) {
      firstError = firstError ?? err
    }
  }

  const failed = files.length - attachments.length
  try {
    if (attachments.length > 0) {
      await usePaymentSlipStore.getState().save({ kind, refId, paidAt, attachments })
      await useLogStore.getState().addLog(buildLogEntry({
        activityType: 'ATTACH_PAYMENT_SLIP',
        description: `แนบสลิปการจ่าย "${title}" ${Number(amount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,
        newValue: { kind, refId, files: attachments.length },
      }))
    }
  } catch (err) {
    firstError = firstError ?? err
    if (failed === 0) {
      warnPaidButNoSlip(`ไม่ต้องจ่ายซ้ำ — แนบสลิปใหม่ได้ที่หน้าประวัติการจ่าย (${err.message})`)
      return
    }
  }

  if (failed > 0) {
    warnPaidButNoSlip(
      `อัปโหลดไม่สำเร็จ ${failed} จาก ${files.length} ไฟล์ · ไม่ต้องจ่ายซ้ำ — แนบใหม่ได้ที่หน้าประวัติการจ่าย`
      + (firstError?.message ? ` (${firstError.message})` : ''),
    )
  }
}
