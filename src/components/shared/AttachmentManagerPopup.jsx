import { useEffect, useRef, useState } from 'react'
import Popup from './Popup'
import Icon from './Icon'
import ConfirmPopup from './ConfirmPopup'
import SlipImage from './SlipImage'
import AttachmentViewerPopup from './AttachmentViewer'
import { uploadAttachment } from '../../lib/api/attachments'
import { attachmentFilename, isAttachableFile, MAX_SLIP_BYTES } from '../../lib/paymentSlipFiles'
import { saveTargetFiles, targetFiles } from '../../lib/attachmentTargets'
import { whenText } from '../../lib/paymentSlipView'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * จัดการไฟล์แนบของรายการหนึ่ง — เพิ่ม ตั้งชื่อ เปลี่ยนไฟล์ และลบ
 *
 * ไม่ถามว่าเป็นเอกสารอะไร เพราะร้านหนึ่งมีได้หลายแบบ (ใบส่งของ ใบแจ้งหนี้ สลิป ฯลฯ)
 * อยากให้ชัดก็พิมพ์ชื่อเองได้ ทุกอย่างบันทึกทันที ไม่มีปุ่มบันทึกให้ลืมกด
 *
 * @param target จาก lib/attachmentTargets
 */
export default function AttachmentManagerPopup({ target, onClose }) {
  const isSlip = target.kind === 'slip'
  const [files, setFiles] = useState(() => targetFiles(target))
  const [names, setNames] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [confirmIndex, setConfirmIndex] = useState(null)
  const [viewIndex, setViewIndex] = useState(null)
  const addRef = useRef(null)
  const replaceRef = useRef(null)
  const replaceIndex = useRef(null)

  const upload = (file, index, total) => uploadAttachment(file, {
    folderBase: isSlip ? 'slips' : 'documents',
    filename: attachmentFilename(file, target.createdAt, index, total, isSlip ? 'slip' : 'document'),
    createdAt: target.createdAt,
  })

  const commit = async (next, action, isAdd = false) => {
    await saveTargetFiles(target, next, { prev: files, action, isAdd })
    setFiles(next)
  }

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const check = (list) => {
    const ok = list.filter((f) => isAttachableFile(f) && f.size <= MAX_SLIP_BYTES)
    if (ok.length < list.length) setError(`แนบได้เฉพาะรูปหรือ PDF ไม่เกิน ${MAX_SLIP_BYTES / 1024 / 1024} MB ต่อไฟล์`)
    return ok
  }

  const addFiles = (incoming) => {
    const list = check(Array.from(incoming ?? []))
    if (list.length === 0) return
    run(async () => {
      const uploadedAt = new Date().toISOString()
      const added = []
      let failed = null
      for (let i = 0; i < list.length; i += 1) {
        try {
          added.push({
            path: await upload(list[i], i, list.length),
            type: isSlip ? 'slip' : 'document',
            label: `${isSlip ? 'สลิป' : 'เอกสาร'} ${files.length + added.length + 1}`,
            uploadedAt,
          })
        } catch (err) { failed = failed ?? err }
      }
      if (added.length > 0) await commit([...files, ...added], `เพิ่มไฟล์แนบ ${added.length} ไฟล์`, true)
      if (failed) throw new Error(`อัปโหลดไม่สำเร็จ ${list.length - added.length} จาก ${list.length} ไฟล์ — ${failed.message}`)
    })
  }

  const replaceFile = (index, file) => {
    if (check([file]).length === 0) return
    run(async () => {
      const path = await upload(file, 0, 1)
      const next = files.map((f, i) => (i === index ? { ...f, path, uploadedAt: new Date().toISOString() } : f))
      await commit(next, `เปลี่ยนไฟล์ "${files[index].label}"`)
    })
  }

  const saveName = (index) => {
    const draft = names[index]
    if (draft === undefined) return
    const label = draft.trim()
    setNames((n) => { const { [index]: _, ...rest } = n; return rest })
    if (!label || label === files[index].label) return
    run(() => commit(
      files.map((f, i) => (i === index ? { ...f, label } : f)),
      `แก้ชื่อไฟล์ "${files[index].label}" เป็น "${label}"`,
    ))
  }

  const removeFile = (index) => {
    const label = files[index].label
    setConfirmIndex(null)
    run(() => commit(files.filter((_, i) => i !== index), `ลบไฟล์ "${label}"`))
  }

  // วางจากคลิปบอร์ดได้ทั้งหน้าต่าง — รับเฉพาะตอนมีไฟล์ การวางข้อความลงช่องชื่อต้องทำงานปกติ
  useEffect(() => {
    const onPaste = (e) => {
      const pasted = Array.from(e.clipboardData?.files ?? [])
      if (pasted.length === 0 || busy) return
      e.preventDefault()
      addFiles(pasted)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  const iconBtn = 'w-11 h-11 sm:w-9 sm:h-9 flex-none rounded-[10px] border border-hairline bg-white flex items-center justify-center text-muted disabled:opacity-50'

  return (
    <>
      <Popup
        title="ไฟล์แนบ"
        sub={`${target.title} · ${fmt(target.amount)} บาท`}
        icon="upload_file"
        width={520}
        onClose={onClose}
        error={error}
        footer={
          <div className="flex-none flex items-center gap-2 justify-between px-[17px] py-3 border-t border-[#EFEDE7] bg-[#FAF9F6]">
            <span className="text-[11.5px] text-muted">{busy ? 'กำลังบันทึก…' : `${files.length} ไฟล์ · บันทึกให้ทันที`}</span>
            <button onClick={onClose} className="h-[38px] px-[18px] rounded-[11px] bg-ink text-white text-[13px] font-semibold hover:brightness-125">
              ปิด
            </button>
          </div>
        }
      >
        {files.map((f, i) => (
          <div key={`${f.path}-${i}`} className="flex-none flex items-center gap-2.5 border border-hairline rounded-[12px] p-2">
            <button
              onClick={() => setViewIndex(i)}
              aria-label={`เปิดดู ${f.label}`}
              className="w-11 h-14 flex-none rounded-lg overflow-hidden border border-hairline hover:border-ink"
            >
              <SlipImage path={f.path} alt={f.label} className="w-full h-full" />
            </button>
            <span className="flex-1 min-w-0">
              <input
                value={names[i] ?? f.label}
                onChange={(e) => setNames((n) => ({ ...n, [i]: e.target.value }))}
                onBlur={() => saveName(i)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                disabled={busy}
                aria-label="ชื่อไฟล์"
                maxLength={60}
                className="w-full h-9 px-2 -ml-px rounded-lg border border-transparent bg-transparent text-[13px] font-medium hover:border-hairline focus:border-ink focus:bg-white outline-none"
              />
              {f.uploadedAt && <span className="block px-2 text-[11px] text-muted truncate">แนบเมื่อ {whenText(f.uploadedAt)}</span>}
            </span>
            <button
              onClick={() => { replaceIndex.current = i; replaceRef.current?.click() }}
              disabled={busy}
              title="แนบไฟล์ใหม่แทนไฟล์นี้"
              aria-label={`แนบไฟล์ใหม่แทน ${f.label}`}
              className={`${iconBtn} hover:bg-paper hover:text-ink`}
            >
              <Icon name="swap_horiz" size={18} />
            </button>
            <button
              onClick={() => setConfirmIndex(i)}
              disabled={busy}
              title="ลบไฟล์นี้"
              aria-label={`ลบ ${f.label}`}
              className={`${iconBtn} hover:bg-expense-soft hover:text-expense`}
            >
              <Icon name="delete" size={18} />
            </button>
          </div>
        ))}

        <input
          ref={addRef}
          type="file"
          multiple
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
        />
        <input
          ref={replaceRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) replaceFile(replaceIndex.current, file)
          }}
        />
        <button
          type="button"
          onClick={() => addRef.current?.click()}
          disabled={busy}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer?.files) }}
          className={`flex-none w-full min-h-[60px] px-3.5 py-3 rounded-[12px] border border-dashed flex items-center gap-2.5 text-left transition disabled:opacity-50 ${
            dragging ? 'border-ink bg-[#F2FAD9]' : 'border-[#C9C5BA] bg-[#FAF9F6] hover:border-ink hover:bg-[#F2FAD9]'
          }`}
        >
          <Icon name="add" size={20} className="text-muted flex-none" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">{files.length > 0 ? 'แนบไฟล์เพิ่ม' : 'แนบไฟล์'}</span>
            <span className="block text-[11px] text-muted leading-snug">
              เอกสารอะไรก็ได้ รูปหรือ PDF · เลือกไฟล์ ลากมาวาง หรือกด Ctrl+V
            </span>
          </span>
        </button>
      </Popup>

      <ConfirmPopup
        open={confirmIndex !== null}
        danger
        title="ลบไฟล์นี้?"
        confirmLabel="ลบไฟล์"
        message={confirmIndex !== null ? `"${files[confirmIndex]?.label}" ของ "${target.title}"\n\nยอดเงินและรายการไม่เปลี่ยน แค่ไฟล์นี้จะไม่แสดงกับรายการนี้อีก` : ''}
        onConfirm={() => removeFile(confirmIndex)}
        onCancel={() => setConfirmIndex(null)}
      />

      {viewIndex !== null && (
        <AttachmentViewerPopup attachments={files} startIndex={viewIndex} onClose={() => setViewIndex(null)} />
      )}
    </>
  )
}
