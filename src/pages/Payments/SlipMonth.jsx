import { getAttachments } from '../../components/shared/AttachmentViewer'
import SlipImage from '../../components/shared/SlipImage'
import { whenText } from '../../lib/paymentSlipView'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * สลิปของเดือนหนึ่ง เรียงเป็นตารางรูป — ใช้ตอนหาสลิปใบหนึ่งจากหน้าตาของมัน
 * หรือส่งให้คนอื่นดู ซึ่งไล่จากแถวรายการแล้วเปิดทีละใบจะช้ากว่ามาก
 */
export default function SlipMonth({ label, rows, onOpen }) {
  const total = rows.reduce((n, r) => n + (r.incoming ? 0 : r.amount), 0)
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5 pt-1.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="tabular-nums text-[11px] font-semibold bg-white border border-hairline rounded-md px-2 py-0.5">{rows.length} สลิป</span>
        <span className="tabular-nums ml-auto text-[13px] font-bold">{fmt(total)}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        {rows.map((r) => {
          const files = getAttachments(r.slip)
          return (
            <button
              key={r.key}
              onClick={() => onOpen(r)}
              aria-label={`เปิดสลิป ${r.title} ${fmt(r.amount)} บาท`}
              className="text-left bg-white border border-hairline rounded-[14px] overflow-hidden flex flex-col transition hover:border-ink hover:shadow-card"
            >
              <span className="relative block h-[188px] bg-paper">
                <SlipImage path={files[0]?.path} alt={files[0]?.label ?? 'สลิป'} className="w-full h-full" />
                {files.length > 1 && (
                  <span className="tabular-nums absolute right-2 top-2 text-[11px] font-bold px-[7px] py-px rounded-md bg-ink text-white">
                    {files.length} ไฟล์
                  </span>
                )}
              </span>
              <span className="block px-[11px] pt-[9px] pb-[11px] border-t border-[#EFEDE7] min-w-0">
                <span className={`tabular-nums block text-[14px] font-bold ${r.incoming ? 'text-income' : 'text-ink'}`}>
                  {r.incoming ? '+' : ''}{fmt(r.amount)}
                </span>
                <span className="block text-[12.5px] font-semibold truncate">{r.title}</span>
                <span className="block text-[11px] text-muted truncate">{whenText(r.paidAt)}{r.source ? ` · ${r.source}` : ''}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
