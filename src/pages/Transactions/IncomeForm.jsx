import { useEffect, useRef, useState } from 'react'
import AmountInput from '../../components/shared/AmountInput'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import DateNavigator from '../../components/shared/DateNavigator'
import FileUploadPopup from '../../components/shared/FileUploadPopup'
import AccountPickerPopup from '../../components/shared/AccountPickerPopup'
import CategorySelect from '../../components/shared/CategorySelect'
import Icon from '../../components/shared/Icon'
import StepHeading from '../../components/shared/StepHeading'
import useTransactionStore from '../../store/useTransactionStore'
import useLogStore from '../../store/useLogStore'
import usePendingStore from '../../store/usePendingStore'
import useWalletStore from '../../store/useWalletStore'
import { walletTarget } from '../../lib/api/transactions'
import { buildLogEntry } from '../../lib/logBuilder'
import { useFormDraft, DraftBanner } from '../../hooks/useFormDraft'
import useFormDefaults, { setFormDefaults } from '../../hooks/useFormDefaults'
import { focusNextField } from '../../lib/formUx'

const EMPTY = { cash: '', transfer: '', otherAmount: '', otherType: '', otherMethod: 'cash', note: '', detail: '', docType: 'none', transferAccountId: '', otherAccountId: '', category: '' }

/**
 * ช่องกรอกยอดขนาดคงที่ท้ายแถวช่องทางรับเงิน — ตัวเลขชิดขวาให้เทียบกันได้ทุกแถว
 * Enter = ไปช่องถัดไป (ช่องทางรับเงินถัดไป แล้วต่อด้วยช่องประเภท) พิมพ์รวดเดียวจบ
 */
function AmountField({ value, onChange, autoFocus = false }) {
  return (
    <span className="flex-none w-[146px] h-10 border border-hairline rounded-[11px] bg-white flex items-center px-[11px]">
      <AmountInput
        className="flex-1 min-w-0 border-none outline-none bg-transparent text-[15px] font-semibold text-right tabular-nums p-0 h-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          focusNextField(e.currentTarget)
        }}
        autoFocus={autoFocus}
        placeholder="0"
      />
      <span className="flex-none text-[11.5px] text-faint ml-[7px]">บาท</span>
    </span>
  )
}

/**
 * หนึ่งแถวของช่องทางรับเงิน — ไอคอน + ชื่อ + คำอธิบาย + ช่องยอด
 * แถวที่มียอดจะขึ้นขอบเข้ม เห็นได้ทันทีว่ากำลังจะบันทึกกี่รายการ
 */
function IncomeRow({ on, icon, iconBg, iconFg, label, sub, value, onChange, extra, autoFocus = false }) {
  return (
    <div
      className={`flex items-center gap-[11px] rounded-[13px] border px-[11px] py-[9px] transition ${
        on ? 'border-ink shadow-[0_0_0_1px_#16181D] bg-[#F2FAD9]/40' : 'border-hairline bg-white'
      }`}
    >
      <span className="w-8 h-8 flex-none rounded-[10px] flex items-center justify-center" style={{ background: iconBg }}>
        <Icon name={icon} size={18} style={{ color: iconFg }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-semibold">{label}</span>
        <span className="block text-[11px] text-faint truncate">{sub}</span>
      </span>
      {extra}
      <AmountField value={value} onChange={onChange} autoFocus={autoFocus} />
    </div>
  )
}

export default function IncomeForm({ onPreviewChange }) {
  const navigate = useNavigate()
  const formDefaults = useFormDefaults()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [form, setForm, clearDraft, hasDraft] = useFormDraft('income', EMPTY)
  const [saved, setSaved] = useState(false)
  const [savedMsg, setSavedMsg] = useState('✓ บันทึกสำเร็จ')
  const [errMsg, setErrMsg] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [attachments, setAttachments] = useState([])
  // pending income state
  const [isPendingMode, setIsPendingMode] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // เลือกบัญชีผ่านป๊อปอัปเหมือนฝั่งรายจ่าย — null | 'transfer' | 'other'
  const [pickAcct, setPickAcct] = useState(null)

  // ส่งสถานะขึ้นไปให้แผงขวา "ก่อนกดบันทึก" — แผงจะบอกว่าเงินจะเข้ากระเป๋าไหน เพิ่มขึ้นเท่าไร
  useEffect(() => {
    onPreviewChange?.({
      kind: 'income',
      cash: Number(form.cash) || 0,
      transfer: Number(form.transfer) || 0,
      other: Number(form.otherAmount) || 0,
      otherMethod: form.otherMethod,
      transferAccountId: form.transferAccountId,
      otherAccountId: form.otherAccountId,
      isPending: isPendingMode,
    })
  }, [onPreviewChange, form.cash, form.transfer, form.otherAmount, form.otherMethod, form.transferAccountId, form.otherAccountId, isPendingMode])

  const { addTransaction } = useTransactionStore()
  const { addLog } = useLogStore()
  const { addPendingIncome } = usePendingStore()
  const refreshWallet = useWalletStore((s) => s.refresh)
  // ระบบออนไลน์อย่างเดียว ต้องรอผลจริงจากเซิร์ฟเวอร์ จึงต้องกันกดซ้ำระหว่างรอ
  const [saving, setSaving] = useState(false)
  // ช่องที่บันทึกลงเซิร์ฟเวอร์สำเร็จแล้วในรอบนี้ — ถ้าช่องถัดไปล้ม ผู้ใช้กดบันทึกซ้ำ
  // ได้โดยไม่สร้างรายการของช่องแรกซ้ำอีกรอบ (ล้างเมื่อสำเร็จครบหรือแก้ฟอร์ม)
  const savedPartsRef = useRef(new Set())

  const set = (k, v) => {
    savedPartsRef.current = new Set()
    setForm((f) => ({ ...f, [k]: v }))
  }

  const cashAmt = Number(form.cash) || 0
  const transferAmt = Number(form.transfer) || 0
  const otherAmt = Number(form.otherAmount) || 0

  const resolveAccount = useWalletStore((s) => s.resolveTransferAccountId)
  const getAccountLabel = useWalletStore((s) => s.getTransferAccountLabel)

  const docFields = attachments.length > 0 ? {
    attachments,
    documentPath: attachments[0].path,
    documentType: attachments[0].type,
    documentLabel: attachments[0].label,
  } : {}

  const finishSaved = (msg, ms) => {
    savedPartsRef.current = new Set()
    // ล้างฟอร์มตามค่า "บันทึกแล้วเปิดฟอร์มใหม่" ที่ตั้งไว้ในหน้าตั้งค่า
    if (formDefaults.reopenAfterSave) clearDraft()
    setSavedMsg(msg)
    setSaved(true)
    setUploadStatus(null)
    setAttachments([])
    setTimeout(() => setSaved(false), ms)
  }

  /**
   * บันทึกรายรับ — แต่ละช่อง (สด / โอน / อื่นๆ) = 1 รายการ + เพิ่มเงิน + log
   * จบใน RPC เดียว (post_transaction) เหมือนหน้ารายจ่าย
   *
   * ของเดิมเรียก addTransaction แล้ว addToWallet แยกกันโดยไม่ await สักตัว:
   * ถ้า insert ล้ม เงินก็ยังถูกบวก, log เก็บ Promise แทนรายการ, และหน้าจอขึ้น
   * "บันทึกสำเร็จ" ก่อนที่เซิร์ฟเวอร์จะตอบอะไรเลย
   */
  const handleSave = async () => {
    if (saving) return
    if (!cashAmt && !transferAmt && !otherAmt) return setErrMsg('กรุณาใส่จำนวนเงินอย่างน้อย 1 ช่อง')
    if (otherAmt > 0 && !form.otherType) return setErrMsg('กรุณาระบุประเภทรายรับอื่นๆ')
    if (otherAmt > 0 && !isPendingMode && !form.otherMethod) return setErrMsg('กรุณาเลือกว่ารายรับอื่นๆ เข้ากระเป๋าไหน')

    // เงินโอนต้องระบุว่าเข้าบัญชีธนาคารไหน
    const transferAccountId = resolveAccount(form.transferAccountId)
    const otherAccountId = resolveAccount(form.otherAccountId)
    if (!isPendingMode) {
      if (transferAmt > 0 && !transferAccountId) return setErrMsg('กรุณาเลือกบัญชีสำหรับเงินโอน')
      if (otherAmt > 0 && form.otherMethod === 'transfer' && !otherAccountId) {
        return setErrMsg('กรุณาเลือกบัญชีสำหรับรายรับอื่นๆ')
      }
    }
    setErrMsg('')
    setSaving(true)

    try {
      // ── PENDING MODE: รวมทุกยอดเป็น pendingIncome เดียว ──
      if (isPendingMode) {
        const totalAmt = cashAmt + transferAmt + otherAmt
        const parts = []
        if (cashAmt > 0) parts.push(`สด ${cashAmt.toLocaleString()}`)
        if (transferAmt > 0) parts.push(`โอน ${transferAmt.toLocaleString()}`)
        if (otherAmt > 0) parts.push(`${form.otherType || 'อื่นๆ'} ${otherAmt.toLocaleString()}`)

        const noteText = [form.note, parts.join(' / ')].filter(Boolean).join(' | ')
        const item = await addPendingIncome({
          date,
          amount: totalAmt,
          description: `เปิดบิลรอรับเงิน ${date}`,
          note: noteText,
          source: !cashAmt && !transferAmt ? 'other' : 'main',
          category: form.category || undefined,
          otherIncomeType: otherAmt > 0 ? (form.otherType || 'อื่นๆ') : undefined,
          // ผูกบัญชีไว้ล่วงหน้า เวลากดรับเงินโอนจะเข้าบัญชีนี้ทันที
          ...(form.transferAccountId ? { defaultTransferAccountId: form.transferAccountId } : {}),
          ...docFields,
        })
        await addLog(buildLogEntry({
          activityType: 'OPEN_BILL_INCOME',
          description: `เปิดบิลรอรับเงิน ${totalAmt.toLocaleString()} บาท (${date}) — ${parts.join(' / ')}`,
          newValue: { pendingIncomeId: item.id, amount: totalAmt, billDate: date },
        }))

        setIsPendingMode(false)
        finishSaved('✓ สร้างรายการรอรับเงินแล้ว', 3000)
        return
      }

      // ── NORMAL MODE ──
      const common = { date, type: 'income', category: form.category || undefined, note: form.note, detail: form.detail, ...docFields }
      const parts = []
      if (cashAmt > 0) {
        parts.push({
          key: 'cash',
          tx: { ...common, amount: cashAmt, method: 'cash', itemName: 'รายรับเงินสด' },
          activityType: 'ADD_INCOME_MAIN',
          description: `รับเงินสด ${cashAmt.toLocaleString()} บาท`,
        })
      }
      if (transferAmt > 0) {
        parts.push({
          key: 'transfer',
          tx: { ...common, amount: transferAmt, method: 'transfer', transferAccountId, itemName: 'รายรับเงินโอน' },
          activityType: 'ADD_INCOME_MAIN',
          description: `รับเงินโอน ${transferAmt.toLocaleString()} บาท`,
        })
      }
      if (otherAmt > 0) {
        const method = form.otherMethod || 'cash'
        const accountId = method === 'transfer' ? otherAccountId : null
        parts.push({
          key: 'other',
          tx: {
            ...common, amount: otherAmt, method,
            ...(accountId ? { transferAccountId: accountId } : {}),
            otherIncomeType: form.otherType,
            itemName: form.otherType || 'รายรับอื่นๆ',
          },
          activityType: 'ADD_OTHER_INCOME',
          description: `${form.otherType} ${otherAmt.toLocaleString()} บาท → กระเป๋า${method === 'cash' ? 'เงินสด' : 'เงินโอน'}`,
        })
      }

      for (const part of parts) {
        if (savedPartsRef.current.has(part.key)) continue
        const target = walletTarget(part.tx.method, { transferAccountId: part.tx.transferAccountId ?? null })
        await addTransaction(part.tx, {
          effect: target ? { target, delta: +part.tx.amount } : null,
          log: buildLogEntry({
            activityType: part.activityType,
            description: part.description,
            walletEffect: target
              ? { target: part.tx.method, delta: +part.tx.amount, transferAccountId: part.tx.transferAccountId ?? null }
              : null,
            newValue: { itemName: part.tx.itemName, amount: part.tx.amount, method: part.tx.method, date },
          }),
        })
        savedPartsRef.current.add(part.key)
      }

      // ยอดเงินถูกแก้ที่เซิร์ฟเวอร์ ต้องดึงค่าจริงมาแสดง ไม่คำนวณเองเพราะอาจมีคนอื่นแก้พร้อมกัน
      await refreshWallet()
      finishSaved('✓ บันทึกสำเร็จ', 2000)
    } catch (err) {
      // ยังไม่ล้างฟอร์ม ผู้ใช้จะได้กดบันทึกซ้ำได้ (ช่องที่สำเร็จแล้วจะถูกข้าม)
      setErrMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isTaxUpload = form.docType === 'taxinvoice'

  const handleUploadDone = (savedPath) => {
    setUploadOpen(false)
    if (savedPath) {
      const paths = Array.isArray(savedPath) ? savedPath : [savedPath]
      const nextAttachments = paths.map((path, index) => ({
        path,
        type: isTaxUpload ? 'taxinvoice' : 'receipt',
        label: `${isTaxUpload ? 'ใบกำกับภาษี' : 'ใบเสร็จ'}${paths.length > 1 ? ` ${index + 1}` : ''}`,
        uploadedAt: new Date().toISOString(),
      }))
      setAttachments(nextAttachments)
      setUploadStatus(`✓ อัปโหลดเสร็จสิ้น — ${paths.length > 1 ? `${paths.length} ไฟล์` : paths[0]}`)
      addLog(buildLogEntry({
        activityType: isTaxUpload ? 'UPLOAD_TAX_INVOICE_FILE' : 'UPLOAD_RECEIPT',
        description: `อัปโหลด${isTaxUpload ? 'ไฟล์ใบกำกับภาษี' : 'ใบเสร็จ'}สำหรับรายรับ (${date})`,
        newValue: { savedPath: paths[0], savedPaths: paths, date, docType: form.docType },
      }))
    }
  }

  const total = cashAmt + transferAmt + otherAmt
  const filledCount = [cashAmt, transferAmt, otherAmt].filter((n) => n > 0).length
  const accountLabel = getAccountLabel(resolveAccount(form.transferAccountId)) || 'ยังไม่ได้เลือกบัญชี'
  const otherAccountLabel = getAccountLabel(resolveAccount(form.otherAccountId)) || 'ยังไม่ได้เลือกบัญชี'
  const otherNeedsType = otherAmt > 0 && !form.otherType.trim()

  // สรุปสั้นๆ ว่าในส่วนที่พับไว้มีอะไรกรอกไปแล้วบ้าง จะได้ไม่ต้องกางดูทุกครั้ง
  const moreSummary = [
    form.note && 'หมายเหตุ',
    form.detail && 'รายละเอียด',
    attachments.length > 0 && `ไฟล์แนบ ${attachments.length}`,
  ].filter(Boolean).join(' · ') || 'ไม่ได้กรอก 3 ช่อง — ไม่กรอกก็บันทึกได้'

  // สถานะของแต่ละขั้นตอน — "ที่ต้องทำต่อ" คือขั้นแรกที่ยังไม่ได้กรอก
  // (สองขั้นหลังไม่บังคับ จึงไม่ถูกชี้ว่าเป็นขั้นที่ต้องทำ ไม่งั้นจะดูเหมือนกรอกไม่ครบตลอด)
  const stepDone = [total > 0, !!form.category, isPendingMode, !!(form.note || form.detail || attachments.length)]
  const nextStep = stepDone[0] ? (stepDone[1] ? -1 : 1) : 0

  return (
    // data-form-scope = ขอบเขตของ "ช่องถัดไป" ตอนกด Enter (ดู focusNextField)
    <div data-form-scope className="flex flex-col">
      <div className="px-5 pt-4 space-y-4">
        <DraftBanner hasDraft={hasDraft} onClear={clearDraft} />
        <DateNavigator date={date} onChange={setDate} />
      </div>

      {/* ช่องทางรับเงิน — กรอกได้หลายช่องพร้อมกัน แต่ละช่องกลายเป็นหนึ่งรายการ
          ช่องที่มียอดจะขึ้นขอบเข้ม จะได้เห็นทันทีว่ากำลังจะบันทึกกี่รายการ */}
      <div className="px-5 pt-4">
        <StepHeading
          n={1}
          title="รับเงินเข้าช่องทางไหน"
          hint="กรอกได้หลายช่องพร้อมกัน แต่ละช่องถูกบันทึกเป็นหนึ่งรายการ"
          done={stepDone[0]}
          current={nextStep === 0}
        />

        <div className="flex flex-col gap-2">
          <IncomeRow
            on={cashAmt > 0}
            icon="payments"
            iconBg="#DCEFE6"
            iconFg="#12795B"
            label="เงินสด"
            sub="เข้ากระเป๋าเงินสดในร้าน"
            value={form.cash}
            onChange={(v) => set('cash', v)}
            // เปิดหน้ามาแล้วพิมพ์ยอดได้เลย — เฉพาะจอใหญ่ บนมือถือการโฟกัสจะดัน
            // คีย์บอร์ดของเครื่องขึ้นมาบังฟอร์มทั้งหน้าตั้งแต่ยังไม่ได้เริ่มกรอก
            autoFocus={typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches}
          />

          <IncomeRow
            on={transferAmt > 0}
            icon="account_balance"
            iconBg="#E7EAFA"
            iconFg="#3A55C4"
            label="เงินโอน"
            sub={isPendingMode ? `ตั้งไว้ว่าจะเข้า ${accountLabel}` : accountLabel}
            value={form.transfer}
            onChange={(v) => set('transfer', v)}
            extra={
              <button
                type="button"
                onClick={() => setPickAcct('transfer')}
                className="flex-none h-8 px-2.5 rounded-[9px] border border-hairline bg-white text-[11.5px] font-semibold text-muted flex items-center gap-[5px] hover:bg-[#F2FAD9] hover:border-ink hover:text-ink"
              >
                เปลี่ยนบัญชี
                <Icon name="expand_more" size={16} />
              </button>
            }
          />

          {/* รายรับอื่นๆ มีสองบรรทัด เพราะต้องระบุประเภทและปลายทางเพิ่ม */}
          <div
            className={`rounded-[13px] border px-[11px] py-[9px] flex flex-col gap-[9px] transition ${
              otherAmt > 0 ? 'border-ink shadow-[0_0_0_1px_#16181D] bg-[#F2FAD9]/40' : 'border-hairline bg-white'
            }`}
          >
            <div className="flex items-center gap-[11px]">
              <span className="w-8 h-8 flex-none rounded-[10px] flex items-center justify-center" style={{ background: '#FBF7EC' }}>
                <Icon name="savings" size={18} style={{ color: '#A8760B' }} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold">รายรับอื่นๆ</span>
                <span className="block text-[11px] text-faint truncate">
                  {form.otherMethod === 'transfer' ? otherAccountLabel : 'เช่น บัตรเครดิต ดอกเบี้ย เงินคืน'}
                </span>
              </span>
              <AmountField value={form.otherAmount} onChange={(v) => set('otherAmount', v)} />
            </div>

            <div className="flex items-center gap-2 border-t border-[#EFEDE7] pt-[9px] flex-wrap">
              <span className="flex-none text-[11.5px] text-muted">ประเภท</span>
              <input
                className="flex-1 min-w-[140px] h-[34px] px-[11px] border border-hairline rounded-[10px] bg-white text-[12.5px] outline-none focus:border-ink"
                value={form.otherType}
                onChange={(e) => set('otherType', e.target.value)}
                placeholder="เช่น บัตรเครดิต ดอกเบี้ย เงินคืน"
              />
              <span className="flex-none text-[11.5px] text-muted ml-0.5">เข้ากระเป๋า</span>
              {[
                { value: 'cash', label: 'เงินสด', icon: 'payments' },
                { value: 'transfer', label: 'เงินโอน', icon: 'account_balance' },
              ].map((o) => {
                const on = form.otherMethod === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => set('otherMethod', o.value)}
                    className={`flex-none h-[34px] px-[11px] rounded-[10px] border text-[12px] font-semibold flex items-center gap-[5px] transition ${
                      on ? 'border-ink bg-[#F2FAD9] text-ink' : 'border-hairline bg-white text-muted hover:bg-paper'
                    }`}
                  >
                    <Icon name={o.icon} size={16} />
                    {o.label}
                  </button>
                )
              })}
              {form.otherMethod === 'transfer' && (
                <button
                  type="button"
                  onClick={() => setPickAcct('other')}
                  className="flex-none h-[34px] px-2.5 rounded-[10px] border border-hairline bg-white text-[11.5px] font-semibold text-muted flex items-center gap-1 hover:bg-[#F2FAD9] hover:border-ink hover:text-ink"
                >
                  {form.otherAccountId ? 'เปลี่ยนบัญชี' : 'เลือกบัญชี'}
                  <Icon name="expand_more" size={15} />
                </button>
              )}
            </div>

            {otherNeedsType && (
              <span className="text-[11px] text-[#8A6A15] leading-snug">
                ใส่ยอดในช่องนี้แล้วต้องระบุประเภทด้วย ระบบจะใช้ชื่อนี้ในรายงาน
              </span>
            )}
          </div>
        </div>

        {/* ยอดรวมของทุกช่อง — ตอบคำถามเดียวว่ากดบันทึกแล้วจะเกิดอะไรขึ้นรวมเท่าไร */}
        <div className="flex items-center gap-2.5 bg-paper rounded-ctl px-[13px] py-2.5 mt-[9px]">
          <span className="flex-1 min-w-0 text-[12px] text-muted truncate">
            รวมรายรับที่จะบันทึก · {filledCount === 0 ? 'ยังไม่ได้กรอกช่องไหน' : `กรอกแล้ว ${filledCount} ช่อง`}
          </span>
          <span className={`tabular-nums flex-none text-[17px] font-bold ${total > 0 ? 'text-income' : 'text-faint'}`}>
            {total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="flex-none text-[11.5px] text-faint">บาท</span>
        </div>
      </div>

      {/* หมวดหมู่ + ประเภทเอกสาร */}
      <div className="px-5 pt-4">
        <StepHeading
          n={2}
          title="หมวดหมู่และเอกสาร"
          hint="ใช้จัดกลุ่มในรายงาน · ออกให้ลูกค้าหรือไม่"
          done={stepDone[1]}
          current={nextStep === 1}
        />
      </div>
      <div className="px-5 grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div>
          <label className="flex items-baseline gap-[7px] text-[12.5px] font-semibold mb-1.5">
            หมวดหมู่รายรับ
            <span className="text-[11px] font-normal text-faint">ใช้จัดกลุ่มในรายงาน</span>
          </label>
          <CategorySelect
            type="income"
            value={form.category}
            onChange={(v) => set('category', v)}
            placeholder="ไม่ระบุหมวดหมู่"
          />
        </div>
        <div>
          <label className="flex items-baseline gap-[7px] text-[12.5px] font-semibold mb-1.5">
            ประเภทเอกสาร
            <span className="text-[11px] font-normal text-faint">ออกให้ลูกค้าหรือไม่</span>
          </label>
          <select
            className="input h-11"
            value={form.docType}
            onChange={(e) => { set('docType', e.target.value); setUploadStatus(null) }}
          >
            <option value="none">ไม่ต้องการ</option>
            <option value="receipt">ใบเสร็จ</option>
            <option value="taxinvoice">มีใบกำกับภาษี</option>
            <option value="waiting_tax">รอใบกำกับภาษี</option>
          </select>
        </div>
      </div>

      {/* เปิดบิลรอรับเงิน — ติ๊กแล้วทุกช่องรวมเป็นบิลใบเดียว ยังไม่เข้ากระเป๋า */}
      <div className="px-5 pt-4">
        <StepHeading n={3} title="ได้รับเงินแล้วหรือยัง" hint="ถ้ายังไม่ได้รับ ให้เปิดเป็นบิลรอรับเงิน" done={stepDone[2]} optional />
        <button
          type="button"
          onClick={() => setIsPendingMode((v) => !v)}
          className={`w-full flex items-center gap-[11px] h-[52px] px-[13px] rounded-[13px] border text-left transition ${
            isPendingMode ? 'border-ink bg-pending-soft' : 'border-hairline bg-white hover:border-ink'
          }`}
        >
          <Icon name={isPendingMode ? 'check_circle' : 'schedule'} size={20} className="flex-none text-ink" />
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] font-semibold">เปิดบิลรอรับเงิน · ยังไม่ได้รับเงินตอนนี้</span>
            <span className="block text-[11px] text-faint truncate">
              รวมทุกช่องเป็นบิลรอรับเงินใบเดียว ยังไม่เพิ่มเงินเข้ากระเป๋า แล้วไปกดรับเงินที่หน้ารอดำเนินการ
            </span>
          </span>
        </button>
      </div>

      {/* ช่องที่ไม่ได้กรอกทุกครั้ง พับเก็บไว้ใต้ปุ่มเดียว เหมือนฝั่งรายจ่าย */}
      <div className="px-5 pt-3.5">
        <StepHeading n={4} title="รายละเอียดเพิ่มเติม" hint="หมายเหตุ · รายละเอียด · ไฟล์แนบ" done={stepDone[3]} optional />
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={`w-full flex items-center gap-[9px] h-11 px-3.5 border border-dashed border-[#D8D4C9] bg-[#FAF9F6] hover:bg-paper ${
            moreOpen ? 'rounded-t-ctl border-b-0' : 'rounded-ctl'
          }`}
        >
          <Icon name="tune" size={18} className="text-muted" />
          <span className="text-[13px] font-semibold">รายละเอียดเพิ่มเติม</span>
          <span className="text-[11.5px] text-faint hidden sm:inline">หมายเหตุ · รายละเอียด · ไฟล์แนบ</span>
          <span className="ml-auto text-[11.5px] text-faint">{moreOpen ? 'ปิดรายละเอียด' : moreSummary}</span>
          <Icon name="expand_more" size={20} className={`text-muted transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
        </button>

        {moreOpen && (
          <div className="border border-hairline border-t-0 rounded-b-ctl p-3.5 grid grid-cols-1 md:grid-cols-2 gap-3 bg-white">
            <div>
              <label className="block text-[12px] text-muted mb-1.5">หมายเหตุ</label>
              <input
                className="input h-10"
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="พิมพ์สั้นๆ ได้"
              />
            </div>
            <div>
              <label className="block text-[12px] text-muted mb-1.5">รายละเอียด</label>
              <input
                className="input h-10"
                value={form.detail}
                onChange={(e) => set('detail', e.target.value)}
                placeholder="รายละเอียดเพิ่มเติม"
              />
            </div>
            <div className="md:col-span-2">
              <label className="flex items-baseline gap-[7px] text-[12px] text-muted mb-1.5">
                ไฟล์แนบ · ใบเสร็จ / ใบกำกับภาษี
                <span className="text-[11px] text-[#B3AFA6]">JPG PNG PDF ไม่เกิน 10 MB ต่อไฟล์</span>
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="h-10 px-[13px] rounded-[11px] bg-ink text-white text-[12.5px] font-semibold flex items-center gap-[7px] hover:bg-black"
                >
                  <Icon name="upload_file" size={17} />
                  {isTaxUpload ? 'แนบใบกำกับภาษี' : 'แนบใบเสร็จ'}
                </button>
                {uploadStatus && <span className="text-income text-xs">{uploadStatus}</span>}
                {attachments.length > 0 && (
                  <span className="text-[11px] text-faint">
                    แนบแล้ว {attachments.length} ไฟล์ · เปิดดูย้อนหลังได้จากหน้าประวัติและรายงาน
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* แถบบันทึกติดท้ายฟอร์มเสมอ — ชุดเดียวกับหน้ารายจ่าย ปุ่มจึงอยู่ที่เดิมทั้งสองแท็บ */}
      <div className="mt-4 border-t border-[#F2F0EA] px-[18px] py-[13px] flex items-center gap-2.5 flex-wrap">
        <button
          className={`h-[50px] w-full justify-center rounded-[14px] lg:h-[42px] lg:w-auto lg:justify-start lg:rounded-ctl px-[22px] text-white text-sm font-semibold flex items-center gap-2 hover:brightness-110 disabled:opacity-50 ${
            isPendingMode ? 'bg-pending' : 'bg-income'
          }`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? 'กำลังบันทึก…'
            : `${isPendingMode ? 'เปิดบิลรอรับเงิน' : 'บันทึกรายรับ'} ${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          <kbd className="hidden lg:inline text-[10.5px] font-semibold rounded-[5px] px-1.5 py-0.5 bg-white/20 text-white">⌘ ↵</kbd>
        </button>

        <button
          type="button"
          onClick={() => setFormDefaults({ reopenAfterSave: !formDefaults.reopenAfterSave })}
          className="flex items-center gap-2 text-[12.5px] text-muted"
        >
          <span
            className={`w-[18px] h-[18px] flex-none rounded-[5px] border flex items-center justify-center ${
              formDefaults.reopenAfterSave ? 'bg-lime border-lime' : 'bg-white border-hairline'
            }`}
          >
            {formDefaults.reopenAfterSave && <Icon name="check" size={14} className="text-ink" />}
          </span>
          เปิดฟอร์มใหม่ทันที
        </button>

        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="h-[38px] px-3.5 rounded-ctl border border-hairline text-[12.5px] font-semibold flex items-center gap-1.5 hover:bg-paper"
        >
          <Icon name="upload_file" size={17} />
          แนบใบเสร็จ
          {attachments.length > 0 && <span className="tabular-nums font-bold text-income">{attachments.length}</span>}
        </button>

        <button
          type="button"
          onClick={() => navigate('/transactions?tab=recurring')}
          className="h-[38px] px-3.5 rounded-ctl border border-hairline text-[12.5px] font-semibold flex items-center gap-1.5 hover:bg-paper"
          title="ไปหน้ารายการประจำเพื่อตั้งรายการนี้ให้เข้าทุกเดือน"
        >
          <Icon name="history" size={17} />
          ตั้งเป็นรายการประจำ
        </button>

        {saved && <span className="text-income text-sm font-medium">{savedMsg}</span>}
        {errMsg && <span className="text-expense text-sm">{errMsg}</span>}
      </div>

      {uploadOpen && (
        <FileUploadPopup
          title={isTaxUpload ? 'อัปโหลดใบกำกับภาษี' : 'อัปโหลดใบเสร็จ'}
          description={`วันที่: ${date}`}
          createdAt={new Date(date + 'T00:00:00').toISOString()}
          filenamePrefix={isTaxUpload ? 'taxinvoice' : 'receipt'}
          folderBase={isTaxUpload ? 'taxinvoices' : 'receipts'}
          onConfirm={handleUploadDone}
          onCancel={() => setUploadOpen(false)}
        />
      )}

      {/* เลือกบัญชีปลายทาง — ป๊อปอัปตัวเดียวใช้ทั้งช่องเงินโอนและช่องรายรับอื่นๆ */}
      {pickAcct && (
        <AccountPickerPopup
          title="เงินเข้าบัญชีไหน"
          sub={pickAcct === 'other' ? 'ของช่องรายรับอื่นๆ' : 'ของช่องเงินโอน'}
          value={pickAcct === 'other' ? form.otherAccountId : form.transferAccountId}
          onPick={(id) => {
            set(pickAcct === 'other' ? 'otherAccountId' : 'transferAccountId', id)
            setPickAcct(null)
          }}
          onClose={() => setPickAcct(null)}
        />
      )}
    </div>
  )
}
