import { useEffect, useState } from 'react'
import Popup from './Popup'
import { getAttachmentUrl, isCloudPath } from '../../lib/api/attachments'

function fileNameFromPath(path = '') {
  return String(path).split(/[\\/]/).filter(Boolean).pop() || 'ไฟล์แนบ'
}

export function fileKind(path = '') {
  const ext = fileNameFromPath(path).split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}

/**
 * แสดงไฟล์จาก Storage — bucket เป็น private จึงต้องขอ signed URL ทุกครั้งที่เปิด
 * พาธรุ่นเก่า (ไม่ได้ขึ้นต้นด้วย shop_id) คือไฟล์ที่เคยดาวน์โหลดเก็บไว้ในเครื่องผู้ใช้
 * ระบบไม่มีไฟล์นั้น จึงบอกตรงๆ แทนที่จะพยายามโหลดแล้วขึ้น error
 */
export function AttachmentPreview({ path }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const cloud = isCloudPath(path)
  const kind = fileKind(path)
  const fileName = fileNameFromPath(path)

  useEffect(() => {
    let alive = true
    setUrl(null)
    setError('')
    if (!cloud) return undefined
    setLoading(true)
    getAttachmentUrl(path)
      .then((u) => { if (alive) setUrl(u) })
      .catch((err) => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [path, cloud])

  if (!cloud) {
    return (
      <div className="text-center px-6 py-10">
        <p className="text-5xl mb-3">📄</p>
        <p className="font-semibold text-gray-700">{fileName}</p>
        <p className="text-sm text-gray-400 mt-1">
          ไฟล์นี้ถูกเก็บไว้ในเครื่องที่บันทึกรายการ (ระบบรุ่นก่อนหน้า) เปิดจากเครื่องอื่นไม่ได้
        </p>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 rounded-full border-[3px] border-gray-200 border-t-gray-700 animate-spin" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="text-center px-6 py-10">
        <p className="text-5xl mb-3">⚠️</p>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }
  if (!url) return null
  if (kind === 'image') {
    return <img src={url} alt={fileName} className="max-h-[60vh] w-auto max-w-full object-contain" />
  }
  if (kind === 'pdf') {
    return <iframe src={url} title={fileName} className="w-full h-[60vh] bg-white" />
  }
  return (
    <div className="text-center px-6 py-10">
      <p className="text-5xl mb-3">📎</p>
      <p className="font-semibold text-gray-700">{fileName}</p>
      <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary text-sm mt-3 inline-flex">
        เปิดไฟล์
      </a>
    </div>
  )
}

export function getPrimaryAttachment(record) {
  const attachments = getAttachments(record)
  if (attachments.length > 0) return attachments[0]
  return null
}

export function getAttachments(record) {
  if (!record) return []
  if (Array.isArray(record.attachments) && record.attachments.length > 0) {
    return record.attachments
      .filter((item) => item?.path)
      .map((item, index) => ({
        path: item.path,
        type: item.type || item.documentType || 'receipt',
        label: item.label || item.documentLabel || `เอกสารแนบ ${index + 1}`,
        uploadedAt: item.uploadedAt ?? null,
      }))
  }
  const path =
    record.documentPath ||
    record.receiptPath ||
    record.taxInvoicePath ||
    record.filePath ||
    record.attachmentPath
  if (!path) return []
  return [{
    path,
    type: record.documentType || (record.taxInvoicePath || record.filePath ? 'taxinvoice' : 'receipt'),
    label: record.documentLabel || (record.taxInvoicePath || record.filePath ? 'ใบกำกับภาษี' : 'ใบเสร็จ'),
  }]
}

export function AttachmentButton({ attachment, attachments, compact = false }) {
  const [open, setOpen] = useState(false)
  const list = attachments?.length ? attachments : (attachment?.path ? [attachment] : [])
  if (list.length === 0) return null

  return (
    <>
      <button
        type="button"
        className={`btn btn-secondary ${compact ? 'text-xs py-1 px-2' : 'text-xs'}`}
        onClick={() => setOpen(true)}
      >
        📎 ดูบิล{list.length > 1 ? ` ${list.length} ไฟล์` : ''}
      </button>
      {open && <AttachmentViewerPopup attachments={list} onClose={() => setOpen(false)} />}
    </>
  )
}

export default function AttachmentViewerPopup({ attachment, attachments, onClose, startIndex = 0 }) {
  const attachmentList = attachments?.length ? attachments : (attachment?.path ? [attachment] : [])
  const [activeIndex, setActiveIndex] = useState(startIndex)
  const activeAttachment = attachmentList[activeIndex] ?? attachmentList[0]
  const fileName = fileNameFromPath(activeAttachment?.path)

  const go = (delta) => {
    setActiveIndex((index) => {
      const next = index + delta
      if (next < 0) return attachmentList.length - 1
      if (next >= attachmentList.length) return 0
      return next
    })
  }

  return (
    <Popup
      title={activeAttachment?.label || 'เอกสารแนบ'}
      sub={`${attachmentList.length > 1 ? `${activeIndex + 1}/${attachmentList.length} · ` : ''}${fileName ?? ''}`}
      icon="upload_file"
      width={520}
      onClose={onClose}
      footer={
        <div className="flex-none flex items-center gap-2 justify-end px-[17px] py-3 border-t border-[#EFEDE7] bg-[#FAF9F6]">
          {/* เปิดในแท็บใหม่มีเฉพาะไฟล์บนคลาวด์ — ไฟล์ในเครื่องไม่มี URL ให้เปิด */}
          {isCloudPath(activeAttachment?.path) && (
            <button
              onClick={() => getAttachmentUrl(activeAttachment.path).then((u) => window.open(u, '_blank', 'noopener')).catch(() => {})}
              className="h-[38px] px-4 rounded-[11px] border border-hairline bg-white text-[13px] font-semibold hover:bg-paper"
            >
              เปิดในแท็บใหม่
            </button>
          )}
          <button
            onClick={onClose}
            className="h-[38px] px-[18px] rounded-[11px] bg-ink text-white text-[13px] font-semibold hover:brightness-125"
          >
            ปิด
          </button>
        </div>
      }
    >
        <div className="rounded-xl border border-gray-200 bg-gray-50 min-h-80 flex items-center justify-center overflow-hidden">
          <AttachmentPreview key={activeAttachment?.path} path={activeAttachment?.path} />
        </div>

        {attachmentList.length > 1 && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              <button className="btn btn-secondary text-sm" onClick={() => go(-1)}>ก่อนหน้า</button>
              <span className="text-sm text-gray-500">{activeIndex + 1} / {attachmentList.length}</span>
              <button className="btn btn-secondary text-sm" onClick={() => go(1)}>ถัดไป</button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {attachmentList.map((item, index) => (
                <button
                  key={`${item.path}-${index}`}
                  className={`shrink-0 w-28 rounded-lg border px-2 py-2 text-left ${index === activeIndex ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}
                  onClick={() => setActiveIndex(index)}
                >
                  <p className="text-xs font-medium text-gray-700 truncate">{item.label || `ไฟล์ ${index + 1}`}</p>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">{fileNameFromPath(item.path)}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">ชื่อไฟล์ที่บันทึกไว้</p>
          <p className="font-mono text-xs text-gray-600 break-all">{activeAttachment.path}</p>
        </div>
    </Popup>
  )
}
