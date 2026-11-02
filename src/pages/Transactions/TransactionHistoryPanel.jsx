import { useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { th } from 'date-fns/locale'
import useTransactionStore from '../../store/useTransactionStore'
import useCategoryStore, { buildCategoryTree, resolveCategoryFilterIds } from '../../store/useCategoryStore'
import usePendingStore from '../../store/usePendingStore'
import DateRangeFilter from '../../components/shared/DateRangeFilter'
import EditTransactionPopup from '../../components/shared/EditTransactionPopup'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import { getAttachments, getPrimaryAttachment } from '../../components/shared/AttachmentViewer'
import AttachmentManagerPopup from '../../components/shared/AttachmentManagerPopup'
import { txTarget } from '../../lib/attachmentTargets'
import { cancelTransaction, describeTxCancelEffects } from '../../lib/transactionActions'

function methodLabel(m) {
  if (m === 'cash') return 'เงินสด'
  if (m === 'transfer') return 'เงินโอน'
  if (m === 'card') return 'บัตรเครดิต'
  if (m === 'pending') return 'ค้างชำระ'
  return 'อื่นๆ'
}

function TxCard({ tx, onEdit }) {
  const { getCategoryPath } = useCategoryStore()
  const { pendingPayments, taxInvoices, pendingIncomes } = usePendingStore()
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [managingFiles, setManagingFiles] = useState(false)

  const isIncome = tx.type === 'income'
  const borderColor = isIncome ? 'border-l-emerald-400' : 'border-l-red-400'
  const amountColor = isIncome ? 'text-emerald-600' : 'text-red-600'
  const badgeColor = isIncome ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'

  const attachment = getPrimaryAttachment(tx)
  const attachments = getAttachments(tx)
  const hasDetails = tx.vendor || tx.receiptNo || tx.detail || tx.dueDate || tx.taxStatus !== 'none' || tx.otherIncomeType || attachment
  const cancelEffects = describeTxCancelEffects(tx, { pendingPayments, taxInvoices, pendingIncomes })

  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // รอให้ฐานข้อมูลยกเลิกเสร็จก่อนปิดกล่อง — ถ้าล้ม (เช่นไม่มีสิทธิ์) ต้องเห็นตรงนี้
  // ไม่ใช่กล่องปิดเหมือนสำเร็จแล้วรายการยังอยู่
  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await cancelTransaction(tx)
      setConfirmDelete(false)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {managingFiles && <AttachmentManagerPopup target={txTarget(tx)} onClose={() => setManagingFiles(false)} />}
      <div className={`rounded-lg border-l-4 ${borderColor} border border-gray-100 bg-white shadow-sm overflow-hidden`}>
        <div className="px-3 py-2 flex items-center gap-2">

          {/* Badge */}
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${badgeColor}`}>
            {isIncome ? 'รับ' : 'จ่าย'}
          </span>

          {/* ชื่อ + รายละเอียดย่อ */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-gray-800 truncate">{tx.itemName || '—'}</span>
              <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                · {methodLabel(tx.method)}{tx.otherIncomeType ? ` · ${tx.otherIncomeType}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-400">
                {format(new Date(tx.date), 'd MMM yyyy', { locale: th })}
              </span>
              {tx.category && (
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                  {getCategoryPath(tx.category)}
                </span>
              )}
              {tx.note && <span className="text-xs text-gray-400 truncate">· 📝 {tx.note}</span>}
              <button className="btn btn-secondary text-xs py-1 px-2" onClick={() => setManagingFiles(true)}>
                {attachments.length > 0 ? `📎 ไฟล์ ${attachments.length}` : '+ แนบไฟล์'}
              </button>
              {hasDetails && !expanded && (
                <button className="text-xs text-blue-500 hover:underline" onClick={() => setExpanded(true)}>รายละเอียด ▾</button>
              )}
              {expanded && (
                <button className="text-xs text-blue-500 hover:underline" onClick={() => setExpanded(false)}>ย่อ ▴</button>
              )}
            </div>

            {expanded && (
              <div className="mt-1 pt-1 border-t border-gray-100 space-y-0.5 text-xs text-gray-500">
                {tx.vendor && <p>ร้านค้า: {tx.vendor}</p>}
                {tx.receiptNo && <p>เลขใบเสร็จ: {tx.receiptNo}</p>}
                {tx.taxStatus && tx.taxStatus !== 'none' && (
                  <p>ใบกำกับภาษี: {tx.taxStatus === 'received' ? 'มีใบกำกับ' : 'รอใบกำกับ'}</p>
                )}
                {tx.dueDate && <p>วันครบกำหนด: {tx.dueDate}</p>}
                {tx.otherIncomeType && <p>ประเภทรายรับ: {tx.otherIncomeType}</p>}
                {attachment && <p>เอกสารแนบ: {attachment.label} ({attachment.path.split(/[\\/]/).pop()})</p>}
                {tx.detail && <p className="whitespace-pre-line">รายละเอียด: {tx.detail}</p>}
              </div>
            )}
          </div>

          {/* จำนวนเงิน + actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-sm font-bold tabular-nums whitespace-nowrap ${amountColor}`}>
              {isIncome ? '+' : '-'}{tx.amount.toLocaleString()}
              <span className="text-xs font-normal text-gray-400"> บาท</span>
            </span>
            <button className="text-gray-300 hover:text-blue-500 transition-colors" onClick={() => onEdit(tx)}>✏️</button>
            <button className="text-gray-300 hover:text-red-500 transition-colors" onClick={() => setConfirmDelete(true)}>🗑️</button>
          </div>

        </div>
      </div>

      <ConfirmPopup
        open={confirmDelete}
        title="ยืนยันการยกเลิกรายการ"
        message={`ต้องการลบรายการนี้ทิ้งทั้งรายการ พร้อมคืนเงินเข้าบัญชีเดิม\nยกเลิกรายการ "${tx.itemName}" ${tx.amount.toLocaleString()} บาท\nผลที่จะเกิด:\n${cancelEffects.map(e => `• ${e}`).join('\n')}`}
        onConfirm={handleDelete}
        onCancel={() => { setConfirmDelete(false); setDeleteError('') }}
        confirmLabel={deleting ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิก'}
        danger
      />
      {deleteError && confirmDelete && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 shadow-lg">
          ยกเลิกรายการไม่สำเร็จ — {deleteError}
        </div>
      )}
    </>
  )
}

export default function TransactionHistoryPanel() {
  const { transactions, ensureRange } = useTransactionStore()
  const categories = useCategoryStore((s) => s.categories)
  const [filter, setFilter] = useState('month')
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [typeFilter, setTypeFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const PAGE_SIZE = 30

  // เลือกช่วงย้อนหลังเกิน 24 เดือนที่โหลดไว้ → ดึงรายการเก่ามาเพิ่มก่อนกรอง
  useEffect(() => {
    ensureRange(startDate).catch((err) => console.warn('โหลดรายการย้อนหลังไม่สำเร็จ:', err))
  }, [startDate, ensureRange])

  // หมวดหมู่แยกตามประเภท จึงกรองด้วยหมวดหมู่ได้เมื่อเลือกรายรับหรือรายจ่ายแล้วเท่านั้น
  const catTree = useMemo(
    () => (typeFilter === 'all' ? [] : buildCategoryTree(categories, typeFilter)),
    [categories, typeFilter]
  )

  // เลือกหมวดหมู่หลัก → รวมรายการของหมวดหมู่ย่อยข้างในทั้งหมด
  // เลือกหมวดหมู่ย่อย → เฉพาะรายการของหมวดหมู่ย่อยนั้น ไม่รวมของหมวดหมู่หลักหรือย่อยอื่น
  const catScope = useMemo(
    () => (catFilter ? new Set(resolveCategoryFilterIds(categories, catFilter)) : null),
    [categories, catFilter]
  )

  const filtered = transactions.filter((t) => {
    if (t.date < startDate || t.date > endDate) return false
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    if (catScope && !catScope.has(t.category)) return false
    return true
    // createdAt ว่างได้ในรายการที่นำเข้าย้อนหลังหรือที่สร้างก่อนมีคอลัมน์นี้
    // ถ้าเรียกใช้ตรงๆ ทั้งตารางจะพังทั้งหน้า ไม่ใช่แค่แถวนั้นเรียงเพี้ยน
  }).sort((a, b) =>
    String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
  )

  const totalIncome = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const totalExpense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const resetPage = () => setPage(1)

  return (
    <div className="space-y-4">
      {/* Date filter */}
      <DateRangeFilter
        filter={filter} setFilter={(v) => { setFilter(v); resetPage() }}
        startDate={startDate} endDate={endDate}
        setStartDate={(v) => { setStartDate(v); resetPage() }}
        setEndDate={(v) => { setEndDate(v); resetPage() }}
      />

      {/* Type + Category filter */}
      <div className="flex flex-wrap gap-2 items-center">
        {[
          { key: 'all', label: 'ทั้งหมด' },
          { key: 'income', label: 'รายรับ' },
          { key: 'expense', label: 'รายจ่าย' },
        ].map((o) => (
          <button
            key={o.key}
            className={`btn text-sm ${typeFilter === o.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setTypeFilter(o.key); setCatFilter(''); resetPage() }}
          >
            {o.label}
          </button>
        ))}
        {catTree.length > 0 && (
          <select
            className={`input text-sm py-1.5 w-56 ${typeFilter === 'income' ? 'border-emerald-200' : 'border-red-200'}`}
            value={catFilter}
            onChange={(e) => { setCatFilter(e.target.value); resetPage() }}
          >
            <option value="">หมวดหมู่ทั้งหมด</option>
            {catTree.map((main) =>
              main.children.length > 0 ? (
                <optgroup key={main.id} label={main.name}>
                  <option value={main.id}>{main.name} (รวมย่อยทั้งหมด)</option>
                  {main.children.map((sub) => (
                    <option key={sub.id} value={sub.id}>{'  '}└ {sub.name}</option>
                  ))}
                </optgroup>
              ) : (
                <option key={main.id} value={main.id}>{main.name}</option>
              )
            )}
          </select>
        )}
        <span className="text-sm text-gray-500 ml-auto">{filtered.length} รายการ</span>
      </div>

      {/* ตัวเลขสรุปของช่วงที่กรองอยู่ — บรรทัดล่างบอกว่าตัวเลขนั้นหมายถึงอะไร
          ไม่งั้น "สุทธิ" ของช่วงที่เลือกจะถูกอ่านสลับกับยอดเงินคงเหลือในกระเป๋า */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-[14px] border border-[#D9EBA0] bg-[#F4FBEE] px-3.5 py-[11px]">
            <p className="text-[11px] text-[#5C7A0F]">รายรับรวม</p>
            <p className="tabular-nums text-[22px] font-bold text-[#0F6A50] tracking-[-0.01em] mt-0.5">
              {totalIncome.toLocaleString('th-TH')}
            </p>
            <p className="text-[11px] text-faint mt-px">เงินเข้าในช่วงที่เลือก</p>
          </div>
          <div className="rounded-[14px] border border-[#F0C4BE] bg-[#FEF6F5] px-3.5 py-[11px]">
            <p className="text-[11px] text-[#A3564C]">รายจ่ายรวม</p>
            <p className="tabular-nums text-[22px] font-bold text-[#C0392B] tracking-[-0.01em] mt-0.5">
              {totalExpense.toLocaleString('th-TH')}
            </p>
            <p className="text-[11px] text-faint mt-px">เงินออกในช่วงที่เลือก</p>
          </div>
          <div className="rounded-[14px] border border-[#EFEDE7] bg-[#FAF9F6] px-3.5 py-[11px]">
            <p className="text-[11px] text-muted">{totalIncome - totalExpense >= 0 ? 'เหลือสุทธิ' : 'ขาดสุทธิ'}</p>
            <p className={`tabular-nums text-[22px] font-bold tracking-[-0.01em] mt-0.5 ${
              totalIncome - totalExpense >= 0 ? 'text-[#0F6A50]' : 'text-[#C0392B]'
            }`}>
              {(totalIncome - totalExpense).toLocaleString('th-TH')}
            </p>
            <p className="text-[11px] text-faint mt-px">รายรับหักรายจ่าย</p>
          </div>
        </div>
      )}

      {/* Transaction cards */}
      {paged.length === 0 ? (
        <p className="text-center text-gray-400 py-10">ไม่มีรายการในช่วงที่เลือก</p>
      ) : (
        <div className="space-y-1.5">
          {paged.map((tx) => (
            <TxCard key={tx.id} tx={tx} onEdit={setEditing} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button className="btn btn-secondary text-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>‹</button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button className="btn btn-secondary text-sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>›</button>
        </div>
      )}

      {editing && <EditTransactionPopup transaction={editing} onClose={() => setEditing(null)} />}
      <p className="text-[11px] text-faint leading-relaxed pt-1">
        แก้ไขหรือลบรายการย้อนหลังได้จากปุ่มท้ายแถว ทุกการแก้ไขถูกเก็บไว้ที่หน้าประวัติทั้งหมด
      </p>
    </div>
  )
}
