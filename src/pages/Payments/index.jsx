import { useMemo, useState } from 'react'
import { format, subMonths } from 'date-fns'
import usePaymentHistory, { PAYMENT_KINDS } from '../../hooks/usePaymentHistory'
import usePaymentSlipStore from '../../store/usePaymentSlipStore'
import { slipsInstalled } from '../../lib/api/paymentSlips'
import useLogStore from '../../store/useLogStore'
import { buildLogEntry } from '../../lib/logBuilder'
import Icon from '../../components/shared/Icon'
import Popup from '../../components/shared/Popup'
import FileUploadPopup from '../../components/shared/FileUploadPopup'
import AttachmentViewerPopup, { getAttachments } from '../../components/shared/AttachmentViewer'
import DateRangeFilter from '../../components/shared/DateRangeFilter'
import { formatIsoThai } from '../../lib/cardCycle'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import TransferAccountPicker from '../../components/shared/TransferAccountPicker'
import DatePicker from '../../components/shared/DatePicker'
import { undoPlan, undoPaymentRow, editPaymentRow } from '../../lib/paymentActions'

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

/**
 * '2026-09-06T13:45:00' → '6 ก.ย. 2569 13:45'
 *
 * ค่าที่เก็บมามีสองแบบ: บางตารางเก็บเป็นวันที่ล้วน ('2026-09-05') บางตารางเก็บ
 * เวลาเต็ม การเอาวันที่ล้วนไปแปลงเป็นเวลาจะได้เวลาปลอมตามโซนเวลา (07:00)
 * จึงดูจากรูปแบบของค่าที่เก็บ ไม่ใช่จากผลการแปลง
 * และเวลาเที่ยงตรงคือค่าตั้งต้นตอนผู้ใช้เลือกแค่วันที่ ไม่ใช่เวลาจ่ายจริง จึงไม่โชว์
 */
function whenText(value) {
  if (!value) return '—'
  const hasTime = typeof value === 'string' && value.includes('T')
  if (!hasTime) return formatIsoThai(value)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return formatIsoThai(value)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return time === '12:00' ? formatIsoThai(value) : `${formatIsoThai(value)} ${time}`
}

function monthLabel(day) {
  if (!day) return 'ไม่ระบุวันที่'
  const [y, m] = day.split('-').map(Number)
  return `${THAI_MONTHS[m - 1]} ${y + 543}`
}

/**
 * ประวัติการจ่าย — ทุกครั้งที่เงินออกไปปิดภาระ รวมไว้ที่เดียว
 *
 * ทำไมต้องแยกจาก "ประวัติทั้งหมด": หน้านั้นเป็นบันทึกเหตุการณ์ของระบบ (ใครแก้อะไร)
 * ส่วนหน้านี้ตอบคำถามเดียวคือ "จ่ายอะไรไปแล้วบ้าง และหลักฐานอยู่ไหน"
 * ซึ่งเป็นสิ่งที่ต้องหาเจอย้อนหลังเป็นปี ตอนสัญญาปิดไปแล้วหรือตอนมีข้อโต้แย้ง
 */
export default function PaymentsPage() {
  const rows = usePaymentHistory()
  const saveSlip = usePaymentSlipStore((s) => s.save)
  const removeSlip = usePaymentSlipStore((s) => s.remove)
  const { addLog } = useLogStore()

  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  // เริ่มที่ 12 เดือนล่าสุด ไม่ใช่เดือนนี้ — หน้านี้มีไว้หาย้อนหลัง ถ้าเปิดมาเห็นแค่
  // เดือนปัจจุบันจะดูเหมือนไม่มีประวัติ ทั้งที่ของอยู่ครบแค่ถูกกรองออก
  const [filter, setFilter] = useState('year')
  const [startDate, setStartDate] = useState(format(subMonths(new Date(), 12), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [detail, setDetail] = useState(null)
  const [uploadFor, setUploadFor] = useState(null)
  const [viewSlip, setViewSlip] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // ผลของการย้อน/แก้ไข — ป๊อปอัปปิดไปแล้ว ต้องมีที่บอกว่าเกิดอะไรขึ้นกับเงิน
  const [notice, setNotice] = useState('')
  // ฟอร์มแก้ไขวิธีจ่ายในป๊อปอัป: { method, accountId, date } · null = ยังไม่ได้กดแก้
  const [editing, setEditing] = useState(null)
  const [confirmUndo, setConfirmUndo] = useState(null)
  // ตารางสลิปเป็นของที่ต้องรัน SQL เพิ่มทีหลัง ถ้ายังไม่ได้รัน หน้านี้ยังอ่านประวัติได้ปกติ
  // แต่แนบสลิปไม่ได้ ต้องบอกไว้ตั้งแต่ต้น ไม่ใช่ปล่อยให้อัปโหลดไฟล์เสร็จแล้วค่อยพัง
  const canAttach = slipsInstalled()

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false
      if (startDate && r.day && r.day < startDate) return false
      if (endDate && r.day && r.day > endDate) return false
      if (!kw) return true
      return `${r.title} ${r.detail ?? ''} ${r.source ?? ''}`.toLowerCase().includes(kw)
    })
  }, [rows, kind, q, startDate, endDate])

  const total = shown.reduce((n, r) => n + (r.incoming ? 0 : r.amount), 0)
  const withSlip = shown.filter((r) => getAttachments(r.slip).length > 0).length

  // จัดกลุ่มตามเดือน — ประวัติยาวเป็นปี ถ้าไล่เป็นรายการยาวรวดเดียวจะหาไม่เจอ
  const groups = useMemo(() => {
    const map = new Map()
    for (const r of shown) {
      const k = r.day ? r.day.slice(0, 7) : 'unknown'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(r)
    }
    return [...map.entries()]
  }, [shown])

  const attachSlip = async (row, paths) => {
    setBusy(true); setError('')
    try {
      const attachments = paths.map((path, i) => ({
        path, type: 'slip', label: paths.length > 1 ? `สลิป ${i + 1}` : 'สลิปโอนเงิน',
        uploadedAt: new Date().toISOString(),
      }))
      await saveSlip({ kind: row.kind, refId: row.refId, paidAt: row.paidAt, attachments })
      await addLog(buildLogEntry({
        activityType: 'ATTACH_PAYMENT_SLIP',
        description: `แนบสลิปการจ่าย "${row.title}" ${fmt(row.amount)} บาท`,
        newValue: { kind: row.kind, refId: row.refId, files: paths.length },
      }))
      setDetail((d) => (d && d.key === row.key ? { ...d, slip: { ...d.slip, attachments } } : d))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setUploadFor(null)
    }
  }

  const dropSlip = async (row) => {
    if (!row.slip?.id) return
    setBusy(true); setError('')
    try {
      await removeSlip(row.slip.id)
      setDetail((d) => (d && d.key === row.key ? { ...d, slip: null } : d))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * ย้อน / แก้ไขวิธีจ่าย — ตัวทำงานจริงอยู่ใน lib/paymentActions (คืนเงิน คืนสถานะ
   * เอาติ๊กออก ย้ายสลิป) หน้านี้แค่ถามยืนยัน เรียก แล้วบอกผล
   */
  const closeDetail = () => { setDetail(null); setEditing(null); setConfirmUndo(null) }

  const runUndo = async (row) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await undoPaymentRow(row)
      setNotice(`ยกเลิกการจ่าย "${row.title}" ${fmt(row.amount)} บาท แล้ว — เงินกลับเข้า${row.source ?? 'กระเป๋าเดิม'} และรายการกลับเป็นยังไม่จ่าย`)
      closeDetail()
    } catch (err) {
      setError(err.message)
      setConfirmUndo(null)
    } finally {
      setBusy(false)
    }
  }

  const runEdit = async (row) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await editPaymentRow(row, editing)
      setNotice(`แก้ไขวิธีจ่าย "${row.title}" ${fmt(row.amount)} บาท แล้ว — เงินคืนเข้า${row.source ?? 'กระเป๋าเดิม'} และตัดจากกระเป๋าใหม่ตามที่เลือก`)
      closeDetail()
    } catch (err) {
      // จ่ายใหม่ล้มหลังย้อนไปแล้ว = รายการค้างเป็น "ยังไม่จ่าย" ต้องบอกให้ไปจ่ายซ้ำ ไม่ใช่ปล่อยงง
      setError(`${err.message} — ถ้าการย้อนสำเร็จไปแล้ว รายการนี้จะกลับเป็น "ยังไม่จ่าย" ให้ไปกดจ่ายใหม่ที่หน้าของรายการนั้น`)
      setEditing(null)
      setDetail(null)
    } finally {
      setBusy(false)
    }
  }

  const KindChip = ({ value, label, count }) => (
    <button
      onClick={() => setKind(value)}
      className={`h-[34px] px-3 rounded-ctl border text-[12.5px] font-semibold flex items-center gap-2 transition ${
        kind === value ? 'bg-ink text-white border-ink' : 'bg-white border-hairline hover:border-ink'
      }`}
    >
      {label}
      <span className={`tabular-nums text-[11.5px] ${kind === value ? 'text-[#B9BEC6]' : 'text-faint'}`}>{count}</span>
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="bg-ink rounded-panel px-4 py-3.5">
          <div className="text-[11.5px] text-[#9AA0A8]">จ่ายไปแล้วในช่วงที่เลือก</div>
          <div className="tabular-nums text-[26px] font-semibold text-white tracking-[-0.02em] mt-0.5">{fmt(total)}</div>
        </div>
        <div className="card px-4 py-3.5">
          <div className="text-[11.5px] text-muted">จำนวนครั้ง</div>
          <div className="tabular-nums text-[22px] font-semibold text-[#3F444C] mt-0.5">{shown.length}</div>
        </div>
        <div className="card px-4 py-3.5">
          <div className="text-[11.5px] text-muted">มีสลิปแนบแล้ว</div>
          <div className="tabular-nums text-[22px] font-semibold text-income mt-0.5">{withSlip}</div>
        </div>
        <div className="card px-4 py-3.5">
          <div className="text-[11.5px] text-muted">ยังไม่มีสลิป</div>
          <div className="tabular-nums text-[22px] font-semibold text-[#3F444C] mt-0.5">{shown.length - withSlip}</div>
        </div>
      </div>

      <div className="card px-4 py-3 flex flex-col gap-2.5">
        <DateRangeFilter
          filter={filter} setFilter={setFilter}
          startDate={startDate} endDate={endDate}
          setStartDate={setStartDate} setEndDate={setEndDate}
          compact
        />
        <div className="flex items-center gap-2 flex-wrap">
          <KindChip value="all" label="ทั้งหมด" count={rows.length} />
          {Object.entries(PAYMENT_KINDS).map(([k, meta]) => (
            <KindChip key={k} value={k} label={meta.label} count={rows.filter((r) => r.kind === k).length} />
          ))}
          <div className="flex-1 min-w-[180px] h-[34px] px-3 border border-hairline rounded-ctl bg-white flex items-center gap-2">
            <Icon name="search" size={16} className="text-faint flex-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อรายการหรือบัญชี"
              className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px]"
            />
          </div>
        </div>
      </div>

      {!canAttach && (
        <p className="text-[12.5px] text-[#8A6A15] bg-pending-soft border border-pending-line rounded-ctl px-3.5 py-2.5 leading-relaxed">
          ยังแนบสลิปไม่ได้ — ฐานข้อมูลยังไม่มีตารางสลิป เปิด Supabase › SQL Editor แล้วรัน{' '}
          <b className="font-mono">supabase/slips.sql</b> (ผลตรวจท้ายไฟล์ต้องได้ ✅ ครบ 3 บรรทัด) จากนั้นรีเฟรชหน้านี้ ·
          ประวัติการจ่ายด้านล่างแสดงครบตามปกติอยู่แล้ว
        </p>
      )}
      {error && <p className="text-[12.5px] text-expense bg-expense-soft border border-[#F0C4BE] rounded-ctl px-3.5 py-2.5">{error}</p>}
      {notice && (
        <p className="text-[12.5px] text-[#0F6A50] bg-income-soft border border-[#BFE0D2] rounded-ctl px-3.5 py-2.5 flex items-start gap-2">
          <span className="flex-1 leading-relaxed">✓ {notice}</span>
          <button onClick={() => setNotice('')} className="flex-none text-[#0F6A50]/70 hover:text-[#0F6A50]" title="ปิด">✕</button>
        </p>
      )}

      {shown.length === 0 ? (
        <div className="card px-4 py-10 text-center text-[12.5px] text-muted">
          {rows.length === 0
            ? 'ยังไม่มีประวัติการจ่าย — เมื่อจ่ายบิลบัตร ค่างวด หรือรายการค้างชำระ จะมาอยู่ที่นี่'
            : 'ไม่พบรายการที่ตรงกับที่กรอง'}
        </div>
      ) : groups.map(([month, list]) => (
        <div key={month} className="card overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 pt-3 pb-2 border-b border-[#F2F0EA]">
            <span className="text-sm font-semibold">{monthLabel(list[0].day)}</span>
            <span className="tabular-nums text-[11px] font-semibold bg-paper rounded-md px-2 py-0.5">{list.length} ครั้ง</span>
            <span className="tabular-nums ml-auto text-[13px] font-bold">
              {fmt(list.reduce((n, r) => n + (r.incoming ? 0 : r.amount), 0))}
            </span>
          </div>
          <div className="px-4 py-1.5">
            {list.map((r) => {
              const meta = PAYMENT_KINDS[r.kind]
              const files = getAttachments(r.slip)
              return (
                <div key={r.key} className="flex items-center gap-3 py-2 border-t border-[#F6F4EF] first:border-t-0">
                  <span className={`w-8 h-8 flex-none rounded-[10px] flex items-center justify-center ${meta.tone}`}>
                    <Icon name={meta.icon} size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium truncate">{r.title}</span>
                    <span className="block text-[11px] text-faint truncate">
                      {whenText(r.paidAt)}
                      {r.detail && ` · ${r.detail}`}
                      {r.source && ` · ${r.incoming ? 'เข้า' : 'จาก'}${r.source}`}
                    </span>
                  </span>
                  {files.length > 0 ? (
                    <button
                      onClick={() => setViewSlip(files)}
                      className="flex-none h-[30px] px-2.5 rounded-[9px] border border-hairline bg-white text-[11.5px] font-semibold flex items-center gap-1 hover:bg-paper"
                    >
                      <Icon name="receipt_long" size={15} />
                      ดูสลิป{files.length > 1 ? ` ${files.length}` : ''}
                    </button>
                  ) : (
                    <button
                      onClick={() => setUploadFor(r)}
                      disabled={!canAttach}
                      title={canAttach ? 'แนบสลิปโอนเงินของการจ่ายครั้งนี้' : 'ต้องรัน supabase/slips.sql ก่อน'}
                      className="flex-none h-[30px] px-2.5 rounded-[9px] border border-dashed border-[#D8D4C9] text-[11.5px] text-muted hover:border-ink hover:text-ink disabled:opacity-40 disabled:hover:border-[#D8D4C9] disabled:hover:text-muted"
                    >
                      + แนบสลิป
                    </button>
                  )}
                  <span className={`tabular-nums flex-none w-[104px] text-right text-[13px] font-semibold ${
                    r.incoming ? 'text-income' : 'text-ink'
                  }`}>
                    {r.incoming ? '+' : ''}{fmt(r.amount)}
                  </span>
                  <button
                    // เปิดแถวใหม่ต้องเริ่มจากหน้ารายละเอียด ไม่ใช่ฟอร์มแก้ไขที่ค้างจากแถวก่อน
                    onClick={() => { setEditing(null); setConfirmUndo(null); setDetail(r) }}
                    className="flex-none w-7 h-7 rounded-[8px] flex items-center justify-center text-faint hover:text-ink hover:bg-paper"
                    title="ดูรายละเอียด"
                  >
                    <Icon name="chevron_right" size={18} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {detail && (
        <Popup
          title="รายละเอียดการจ่าย"
          sub={detail.title}
          icon={PAYMENT_KINDS[detail.kind].icon}
          width={460}
          onClose={() => setDetail(null)}
        >
          <div className="rounded-ctl bg-paper px-3.5 py-3">
            <div className="text-[11.5px] text-muted">{PAYMENT_KINDS[detail.kind].label}</div>
            <div className={`tabular-nums text-[26px] font-semibold mt-0.5 ${detail.incoming ? 'text-income' : 'text-ink'}`}>
              {detail.incoming ? '+' : ''}{fmt(detail.amount)}
            </div>
          </div>

          {[
            ['จ่ายเมื่อ', whenText(detail.paidAt)],
            ['รายการ', detail.title],
            ['รายละเอียด', detail.detail || '—'],
            [detail.incoming ? 'เข้ากระเป๋า' : 'ตัดจาก', detail.source || '—'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2.5 py-1.5 border-t border-[#F6F4EF]">
              <span className="flex-none w-[110px] text-[11.5px] text-faint">{k}</span>
              <span className="flex-1 min-w-0 text-[12.5px] text-right">{v}</span>
            </div>
          ))}

          {detail.legacy && (
            <p className="text-[11px] text-faint leading-relaxed">
              บิลใบนี้จ่ายไว้ก่อนระบบจะแยกเก็บการจ่ายทีละครั้ง จึงแสดงเป็นยอดรวมที่จ่ายไปทั้งหมดของใบ
            </p>
          )}

          {/* ── แก้ไข / ยกเลิกการจ่ายนี้ ──────────────────────────────────────
              จ่ายผิดกระเป๋าเป็นเรื่องที่เกิดทุกเดือน ต้องแก้ได้จากที่ที่เห็นประวัติ ไม่ใช่
              ให้ไล่กลับไปหาปุ่มย้อนของแต่ละหน้า ปุ่มเป็นกล่องสี่เหลี่ยมชุดเดียวกับเมนูอื่น */}
          {(() => {
            const plan = undoPlan(detail)
            if (editing) {
              return (
                <div className="border-t border-[#F6F4EF] pt-2.5 flex flex-col gap-2.5">
                  <div className="text-[12px] font-semibold">แก้ไขวิธีจ่าย — ยอดเท่าเดิม {fmt(detail.amount)} บาท</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: 'cash', icon: 'payments', t: 'เงินสด' },
                      { v: 'transfer', icon: 'account_balance', t: 'เงินโอน' },
                    ].map((m) => {
                      const on = editing.method === m.v
                      return (
                        <button
                          key={m.v}
                          onClick={() => setEditing((e) => ({ ...e, method: m.v }))}
                          className={`h-[42px] rounded-[11px] border flex items-center justify-center gap-2 text-[12.5px] font-semibold transition ${
                            on ? 'border-ink shadow-[0_0_0_1px_#16181D] bg-[#F2FAD9]' : 'border-hairline bg-white hover:border-ink'
                          }`}
                        >
                          <Icon name={m.icon} size={17} className={on ? 'text-ink' : 'text-faint'} />
                          {m.t}
                        </button>
                      )
                    })}
                  </div>
                  {editing.method === 'transfer' && (
                    <TransferAccountPicker
                      value={editing.accountId}
                      onChange={(id) => setEditing((e) => ({ ...e, accountId: id }))}
                      label={detail.incoming ? 'รับเข้าบัญชี' : 'ตัดจากบัญชี'}
                    />
                  )}
                  <div>
                    <label className="label">วันที่จ่าย</label>
                    <DatePicker value={editing.date} onChange={(d) => setEditing((e) => ({ ...e, date: d }))} />
                  </div>
                  <p className="text-[11px] text-faint leading-relaxed">
                    ระบบจะย้อนการจ่ายเดิม (เงินคืนเข้า{detail.source ?? 'กระเป๋าเดิม'}) แล้วจ่ายใหม่ยอดเท่าเดิมจากกระเป๋าที่เลือก
                    · สลิปที่แนบไว้จะตามไปอยู่กับการจ่ายครั้งใหม่
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditing(null)} disabled={busy} className="h-[38px] px-4 rounded-[11px] border border-hairline bg-white text-[13px] font-semibold hover:bg-paper disabled:opacity-50">
                      ยกเลิก
                    </button>
                    <button onClick={() => runEdit(detail)} disabled={busy} className="h-[38px] px-[18px] rounded-[11px] bg-ink text-white text-[13px] font-semibold hover:bg-black disabled:opacity-50">
                      {busy ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
                    </button>
                  </div>
                </div>
              )
            }
            return (
              <div className="border-t border-[#F6F4EF] pt-2.5">
                <div className="text-[11.5px] text-faint mb-1.5">จัดการการจ่ายนี้</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    disabled={busy || !plan.ok}
                    onClick={() => setEditing({
                      method: detail.source === 'เงินสด' ? 'cash' : 'transfer',
                      accountId: detail.ref?.transferAccountId ?? null,
                      date: detail.day ?? format(new Date(), 'yyyy-MM-dd'),
                    })}
                    title={plan.ok ? 'เปลี่ยนกระเป๋าที่ตัดเงิน หรือวันที่ ยอดเท่าเดิม' : plan.reason}
                    className="aspect-square border border-hairline rounded-[12px] bg-white flex flex-col items-center justify-center gap-[5px] p-2 text-center hover:bg-[#F2FAD9] hover:border-ink disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-hairline"
                  >
                    <span className="w-[34px] h-[34px] rounded-[10px] bg-[#F4F3EF] flex items-center justify-center"><Icon name="swap_horiz" size={19} className="text-[#5C6068]" /></span>
                    <span className="text-[12px] font-semibold leading-tight">แก้ไขวิธีจ่าย</span>
                    <span className="text-[10.5px] text-faint leading-[1.3]">กระเป๋า · วันที่</span>
                  </button>
                  <button
                    disabled={busy || !plan.ok}
                    onClick={() => setConfirmUndo(detail)}
                    title={plan.ok ? 'คืนเงินและคืนสถานะทั้งหมด' : plan.reason}
                    className="aspect-square border border-hairline rounded-[12px] bg-white flex flex-col items-center justify-center gap-[5px] p-2 text-center hover:bg-expense-soft hover:border-expense disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-hairline"
                  >
                    <span className="w-[34px] h-[34px] rounded-[10px] bg-expense-soft flex items-center justify-center"><Icon name="undo" size={19} className="text-expense" /></span>
                    <span className="text-[12px] font-semibold leading-tight text-expense">ยกเลิกการจ่าย</span>
                    <span className="text-[10.5px] text-faint leading-[1.3]">เงินกลับ ติ๊กออก</span>
                  </button>
                </div>
                {!plan.ok && <p className="text-[11px] text-[#8A6A15] leading-relaxed mt-1.5">{plan.reason}</p>}
              </div>
            )
          })()}

          <div className="border-t border-[#F6F4EF] pt-2.5">
            <div className="text-[11.5px] text-faint mb-1.5">สลิป / หลักฐานการโอน</div>
            {getAttachments(detail.slip).length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setViewSlip(getAttachments(detail.slip))}
                  className="h-[34px] px-3 rounded-[9px] bg-ink text-white text-[12px] font-semibold flex items-center gap-1.5 hover:bg-black"
                >
                  <Icon name="receipt_long" size={16} />
                  เปิดดูสลิป
                </button>
                <button
                  onClick={() => setUploadFor(detail)}
                  className="h-[34px] px-3 rounded-[9px] border border-hairline bg-white text-[12px] hover:bg-paper"
                >
                  เปลี่ยนไฟล์
                </button>
                <button
                  onClick={() => dropSlip(detail)}
                  disabled={busy}
                  className="h-[34px] px-3 rounded-[9px] border border-hairline bg-white text-[12px] text-expense hover:bg-expense-soft disabled:opacity-50"
                >
                  เอาสลิปออก
                </button>
              </div>
            ) : (
              <button
                onClick={() => setUploadFor(detail)}
                disabled={!canAttach}
                title={canAttach ? 'แนบสลิปโอนเงินของการจ่ายครั้งนี้' : 'ต้องรัน supabase/slips.sql ก่อน'}
                className="h-[34px] px-3 rounded-[9px] border border-dashed border-[#D8D4C9] text-[12px] text-muted hover:border-ink hover:text-ink disabled:opacity-40 disabled:hover:border-[#D8D4C9] disabled:hover:text-muted"
              >
                + แนบสลิปการโอน
              </button>
            )}
          </div>
        </Popup>
      )}

      <ConfirmPopup
        open={!!confirmUndo}
        danger
        title="ยกเลิกการจ่ายนี้?"
        confirmLabel={busy ? 'กำลังย้อน…' : 'ยกเลิกการจ่าย'}
        message={confirmUndo ? [
          `"${confirmUndo.title}" ${fmt(confirmUndo.amount)} บาท · จ่ายเมื่อ ${whenText(confirmUndo.paidAt)}`,
          '',
          'ระบบจะทำสิ่งเหล่านี้ทั้งหมด:',
          ...(undoPlan(confirmUndo).lines ?? []).map((l) => `• ${l}`),
          '',
          'ทุกอย่างถูกบันทึกไว้ในประวัติทั้งหมด',
        ].join('\n') : ''}
        onConfirm={() => runUndo(confirmUndo)}
        onCancel={() => setConfirmUndo(null)}
      />

      {uploadFor && (
        <FileUploadPopup
          title="แนบสลิปการจ่าย"
          description={`${uploadFor.title} · ${fmt(uploadFor.amount)} บาท`}
          createdAt={uploadFor.paidAt}
          filenamePrefix="slip"
          folderBase="slips"
          onConfirm={(saved) => {
            const paths = saved ? (Array.isArray(saved) ? saved : [saved]) : []
            if (paths.length === 0) return setUploadFor(null)
            attachSlip(uploadFor, paths)
          }}
          onCancel={() => setUploadFor(null)}
        />
      )}

      {viewSlip && <AttachmentViewerPopup attachments={viewSlip} onClose={() => setViewSlip(null)} />}
    </div>
  )
}
