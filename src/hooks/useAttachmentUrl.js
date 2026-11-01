import { useEffect, useState } from 'react'
import { getAttachmentUrl } from '../lib/api/attachments'

// ลิงก์อยู่ได้ 1 ชั่วโมง (ค่าตั้งต้นของ getAttachmentUrl) — เลิกใช้ก่อนหมดอายุจริงเผื่อเปิดหน้าค้างไว้
const REUSE_MS = 50 * 60 * 1000
const cache = new Map()

/**
 * ลิงก์เปิดไฟล์แบบใช้ซ้ำ — หน้าประวัติมีรูปย่อหลายรูปและสลิปเดียวกันโผล่ได้หลายแถว
 * ถ้าขอลิงก์ทุกครั้งที่วาด จะยิงคำขอซ้ำและรูปกะพริบทุกครั้งที่กรองรายการ
 */
function signedUrl(path) {
  const hit = cache.get(path)
  if (hit && hit.expires > Date.now()) return hit.promise
  const promise = getAttachmentUrl(path).catch((err) => {
    cache.delete(path)   // ขอไม่สำเร็จต้องไม่ค้าง ครั้งหน้าจะได้ลองใหม่
    throw err
  })
  cache.set(path, { promise, expires: Date.now() + REUSE_MS })
  return promise
}

/** คืน { url, failed } — path เป็น null เมื่อไฟล์นั้นไม่ต้องขอลิงก์ */
export default function useAttachmentUrl(path) {
  const [state, setState] = useState({ url: null, failed: false })

  useEffect(() => {
    let alive = true
    setState({ url: null, failed: false })
    if (!path) return undefined
    signedUrl(path)
      .then((url) => { if (alive) setState({ url, failed: false }) })
      .catch(() => { if (alive) setState({ url: null, failed: true }) })
    return () => { alive = false }
  }, [path])

  return state
}
