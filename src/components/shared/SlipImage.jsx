import { useState } from 'react'
import Icon from './Icon'
import useAttachmentUrl from '../../hooks/useAttachmentUrl'
import { isCloudPath } from '../../lib/api/attachments'
import { fileKind } from './AttachmentViewer'

/**
 * รูปย่อของสลิป/ใบเสร็จ — ขนาดมาจากที่เรียกใช้ (className)
 *
 * ชิดขอบบนของรูป เพราะยอดเงินกับคำว่าโอนสำเร็จอยู่ส่วนบนของสลิปเกือบทุกธนาคาร
 * ไฟล์ที่แสดงเป็นรูปไม่ได้ขึ้นป้ายแทน เปิดดูเต็มได้จากตัวดูสลิปเหมือนกัน
 */
export default function SlipImage({ path, alt = '', className = '' }) {
  const kind = fileKind(path)
  const showable = kind === 'image' && isCloudPath(path)
  const { url, failed } = useAttachmentUrl(showable ? path : null)
  const [broken, setBroken] = useState(false)
  const box = `overflow-hidden flex items-center justify-center ${className}`

  if (kind === 'pdf') {
    return <span className={`${box} bg-expense-soft text-[#A93A2E] text-[11px] font-bold`}>PDF</span>
  }
  if (!showable || failed || broken) {
    return <span className={`${box} bg-paper text-muted`}><Icon name="receipt_long" size={16} /></span>
  }
  if (!url) return <span className={`${box} bg-paper animate-pulse`} />
  return (
    <span className={box}>
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-full h-full object-cover object-top"
      />
    </span>
  )
}
