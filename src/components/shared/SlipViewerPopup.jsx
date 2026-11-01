import { useState } from 'react'
import Popup from './Popup'
import Icon from './Icon'
import ConfirmPopup from './ConfirmPopup'
import SlipImage from './SlipImage'
import { AttachmentPreview } from './AttachmentViewer'
import { getAttachmentUrl, isCloudPath } from '../../lib/api/attachments'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * ตัวดูสลิป — สลิปอยู่ข้างรายการที่ระบบบันทึกไว้
 *
 * คนเปิดสลิปเพื่อเทียบว่าตรงกับที่บันทึกไหม ถ้าต้องจำตัวเลขจากอีกหน้ามาเทียบจะพลาดง่าย
 * จึงวางสองอย่างไว้ในสายตาเดียวกัน และกดไปการจ่ายถัดไปได้เลยเวลาไล่เช็คทั้งเดือน
 *
 * @param items    [{ key, title, kindLabel, amount, incoming, facts: [[ชื่อ, ค่า]], files, row }]
 *                 row มีเฉพาะการจ่ายที่แก้สลิปจากตรงนี้ได้ (ใบเสร็จของรายการแก้ที่ฟอร์มรายการ)
 * @param itemKey  key ของรายการที่กำลังดู
 */
export default function SlipViewerPopup({ items, itemKey, onChangeItem, onClose, onReplace, onRemove, busy = false }) {
  const [fileIndex, setFileIndex] = useState(0)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const index = items.findIndex((x) => x.key === itemKey)
  const item = items[index]
  if (!item) return null

  const file = item.files[Math.min(fileIndex, item.files.length - 1)]
  const many = item.files.length > 1
  const cloud = isCloudPath(file?.path)

  const goItem = (delta) => { setFileIndex(0); onChangeItem(items[index + delta].key) }
  const goFile = (delta) => setFileIndex((i) => (i + delta + item.files.length) % item.files.length)
  const openFile = (download) => {
    getAttachmentUrl(file.path, 60, download ? { download: true } : undefined)
      .then((u) => window.open(u, '_blank', 'noopener'))
      .catch(() => {})
  }

  const barBtn = 'w-11 h-11 flex-none rounded-[10px] flex items-center justify-center text-[#E4E6E9] hover:bg-white/10'
  const footBtn = 'h-11 rounded-[10px] text-[12.5px] font-semibold flex items-center gap-0.5 hover:bg-paper disabled:opacity-35 disabled:hover:bg-transparent'

  return (
    <>
      <Popup
        title={item.title}
        sub={item.kindLabel}
        icon="receipt_long"
        width={980}
        onClose={onClose}
        bodyClassName="flex flex-wrap"
        footer={
          <div className="flex-none flex items-center gap-2 px-3 py-1 border-t border-[#EFEDE7] bg-[#FAF9F6]">
            <button onClick={() => goItem(-1)} disabled={index <= 0} className={`${footBtn} pl-1.5 pr-2.5`}>
              <Icon name="chevron_left" size={19} />
              ก่อนหน้า
            </button>
            <span className="tabular-nums text-[11.5px] text-muted mx-auto">{index + 1} / {items.length}</span>
            <button onClick={() => goItem(1)} disabled={index >= items.length - 1} className={`${footBtn} pl-2.5 pr-1.5`}>
              ถัดไป
              <Icon name="chevron_right" size={19} />
            </button>
          </div>
        }
      >
        <div className="flex-[999_1_420px] min-w-0 bg-[#1E2126] flex flex-col">
          <div className="flex items-center gap-2 pl-3.5 pr-1.5 py-1 text-[#E4E6E9]">
            <span className="text-[12.5px] font-semibold truncate">{file?.label ?? 'เอกสารแนบ'}</span>
            {many && <span className="tabular-nums text-[11.5px] text-[#B9BEC6] flex-none">ไฟล์ {fileIndex + 1} จาก {item.files.length}</span>}
            {cloud && (
              <span className="ml-auto flex flex-none">
                <button onClick={() => openFile(false)} className={barBtn} title="เปิดในแท็บใหม่" aria-label="เปิดในแท็บใหม่">
                  <Icon name="open_in_new" size={19} />
                </button>
                <button onClick={() => openFile(true)} className={barBtn} title="ดาวน์โหลด" aria-label="ดาวน์โหลด">
                  <Icon name="download" size={19} />
                </button>
              </span>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center gap-2 px-2 sm:px-3 pb-3 min-h-[320px]">
            {many && (
              <button onClick={() => goFile(-1)} className="w-11 h-11 flex-none rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20" aria-label="ไฟล์ก่อนหน้า">
                <Icon name="chevron_left" size={22} />
              </button>
            )}
            <div className="flex-1 min-w-0 bg-white rounded-xl overflow-hidden flex items-center justify-center min-h-[260px]">
              <AttachmentPreview key={file?.path} path={file?.path} />
            </div>
            {many && (
              <button onClick={() => goFile(1)} className="w-11 h-11 flex-none rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20" aria-label="ไฟล์ถัดไป">
                <Icon name="chevron_right" size={22} />
              </button>
            )}
          </div>

          {many && (
            <div className="flex gap-2 justify-center px-3.5 pb-3.5 overflow-x-auto">
              {item.files.map((f, i) => (
                <button
                  key={`${f.path}-${i}`}
                  onClick={() => setFileIndex(i)}
                  aria-label={`ไฟล์ที่ ${i + 1}`}
                  aria-current={i === fileIndex}
                  className={`w-11 h-14 flex-none rounded-lg overflow-hidden border-2 bg-white ${i === fileIndex ? 'border-lime' : 'border-transparent opacity-70 hover:opacity-100'}`}
                >
                  <SlipImage path={f.path} className="w-full h-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-[1_1_300px] min-w-0 p-4 flex flex-col gap-3">
          <div className="rounded-ctl bg-paper px-3.5 py-3">
            <div className="text-[11.5px] text-muted">ยอดที่บันทึกในระบบ</div>
            <div className={`tabular-nums text-[26px] font-semibold ${item.incoming ? 'text-income' : 'text-ink'}`}>
              {item.incoming ? '+' : ''}{fmt(item.amount)}
            </div>
          </div>

          <div>
            {item.facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2.5 py-2 border-t border-[#F2F0EA]">
                <span className="flex-none w-[84px] text-[11.5px] text-muted">{k}</span>
                <span className="flex-1 min-w-0 text-[12.5px] text-right break-words">{v}</span>
              </div>
            ))}
          </div>

          {item.row && (
            <div className="mt-auto flex flex-wrap gap-2">
              <button
                onClick={() => onReplace(item.row)}
                disabled={busy}
                className="flex-[1_1_120px] h-11 rounded-[11px] border border-hairline bg-white text-[12.5px] font-semibold flex items-center justify-center gap-1.5 hover:bg-paper disabled:opacity-50"
              >
                <Icon name="swap_horiz" size={17} />
                เปลี่ยนไฟล์
              </button>
              <button
                onClick={() => setConfirmRemove(true)}
                disabled={busy}
                className="flex-[1_1_120px] h-11 rounded-[11px] border border-hairline bg-white text-[12.5px] font-semibold text-expense flex items-center justify-center gap-1.5 hover:bg-expense-soft disabled:opacity-50"
              >
                <Icon name="delete" size={17} />
                เอาสลิปออก
              </button>
            </div>
          )}
        </div>
      </Popup>

      <ConfirmPopup
        open={confirmRemove}
        danger
        title="เอาสลิปออกจากการจ่ายนี้?"
        confirmLabel="เอาสลิปออก"
        message={`"${item.title}" ${fmt(item.amount)} บาท\n\nการจ่ายและยอดเงินไม่เปลี่ยน แค่สลิปจะไม่แสดงกับรายการนี้อีก`}
        onConfirm={() => {
          // ไปใบข้างเคียงก่อนเอาออก ไม่งั้นตัวดูค้างชี้การจ่ายนี้ แล้วเด้งกลับมาเองตอนแนบใหม่
          const next = items[index + 1] ?? items[index - 1]
          setConfirmRemove(false)
          setFileIndex(0)
          if (next) onChangeItem(next.key)
          else onClose()
          onRemove(item.row)
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  )
}
