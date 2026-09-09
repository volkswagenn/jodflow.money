import { useState } from 'react'
import Icon from '../../components/shared/Icon'
import Popup from '../../components/shared/Popup'
import { adminIssueTempPassword } from '../../lib/api/platform'
import { MIN_PASSWORD_LENGTH, checkPasswordStrength, PASSWORD_PROBLEM_TEXT } from '../../lib/passwordRules'

/** ตัวอักษรที่ใช้สุ่ม — ตัดตัวที่สับสน (0/O, 1/l/I) เพราะต้องอ่านทางโทรศัพท์ให้ลูกค้าพิมพ์ตาม */
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/** สุ่มด้วย crypto ไม่ใช่ Math.random — รหัสผ่านที่เดาลำดับได้ก็ไม่ต่างจากไม่มีรหัส */
function randomPassword(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join('')
}

/**
 * คัดลอกข้อความ — navigator.clipboard ใช้ได้เฉพาะ https กับ localhost
 * ถ้าเปิดผ่าน http ธรรมดา (เช่นทดสอบจากมือถือในวง LAN) จะโยน error
 * จึงต้องมีทางถอยเป็น textarea + execCommand ไม่งั้นปุ่มกดแล้วเงียบโดยไม่มีใครรู้ว่าทำไม
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/**
 * ตั้งรหัสผ่านให้ลูกค้า — แอดมินพิมพ์เองหรือกดสุ่มก็ได้
 *
 * สองจังหวะในป๊อปอัปเดียว: กรอก → ยืนยัน → เห็นรหัสพร้อมปุ่มคัดลอก
 * ที่ต้องแยกจังหวะเพราะหลังกดยืนยันแล้ว รหัสเดิมของลูกค้าใช้ไม่ได้ทันที
 * และรหัสใหม่จะเห็นได้ครั้งเดียว (ฐานเก็บแค่แฮช) — ปิดไปแล้วต้องตั้งใหม่อย่างเดียว
 */
export default function TempPasswordPopup({ shop, onClose, onDone }) {
  const [password, setPassword] = useState(() => randomPassword())
  const [mustChange, setMustChange] = useState(true)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const problem = checkPasswordStrength(password)

  async function handleConfirm() {
    setError('')
    setBusy(true)
    try {
      const issued = await adminIssueTempPassword(shop.ownerId, { password, mustChange })
      setResult(issued)
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    const ok = await copyText(result)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2500)
    else setError('คัดลอกอัตโนมัติไม่ได้ในหน้านี้ — ลากคลุมรหัสแล้วกด Ctrl+C แทน')
  }

  // ── จังหวะที่ 2: ตั้งเรียบร้อยแล้ว ────────────────────────────────────
  if (result) {
    return (
      <Popup
        title="ตั้งรหัสผ่านเรียบร้อย"
        sub={`ของ ${shop.ownerEmail} — แสดงครั้งเดียว ปิดแล้วดูอีกไม่ได้`}
        icon="lock_reset"
        headTone="note"
        width={430}
        onClose={onClose}
        footer={
          <div className="px-[17px] py-3 flex justify-end">
            <button className="btn btn-primary" onClick={onClose}>จดแล้ว ปิด</button>
          </div>
        }
      >
        <div className="rounded-panel border border-hairline bg-[#FAF9F6] px-4 py-4 text-center">
          <div className="font-mono text-[24px] tracking-[0.16em] font-semibold text-ink select-all break-all">
            {result}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={`mt-3 h-9 px-4 rounded-ctl text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
              copied ? 'bg-income-soft text-income' : 'bg-ink text-white hover:bg-[#24282F]'
            }`}
          >
            <Icon name={copied ? 'check' : 'content_copy'} size={17} />
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'}
          </button>
        </div>

        <p className="text-[12px] text-muted leading-relaxed">
          {mustChange
            ? 'ลูกค้าเข้าด้วยรหัสนี้แล้วระบบจะบังคับตั้งรหัสของตัวเองทันที'
            : 'ลูกค้าใช้รหัสนี้ได้ถาวรจนกว่าจะเปลี่ยนเอง'}
          {' '}ทุกเครื่องที่เคยล็อกอินค้างอยู่ถูกออกจากระบบแล้ว
        </p>
        {error && <p className="text-label text-expense">{error}</p>}
      </Popup>
    )
  }

  // ── จังหวะที่ 1: เลือกรหัส ────────────────────────────────────────────
  return (
    <Popup
      title="ตั้งรหัสผ่านให้ลูกค้า"
      sub={shop.ownerEmail}
      icon="lock_reset"
      headTone="note"
      width={430}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmLabel="ตั้งรหัสผ่าน"
      busy={busy}
      disabled={Boolean(problem)}
      error={error}
    >
      <p className="text-[12px] text-muted leading-relaxed">
        ยืนยันตัวตนลูกค้าด้วยคนก่อนเสมอ — รหัสเดิมจะใช้ไม่ได้ทันทีที่กดยืนยัน
        และทุกเครื่องที่ล็อกอินค้างอยู่จะหลุดออกจากระบบ
      </p>

      <label className="block">
        <span className="label">รหัสผ่านใหม่</span>
        <div className="flex gap-2">
          <input
            className="input flex-1 font-mono tracking-wider"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setPassword(randomPassword())}
            title="สุ่มรหัสใหม่"
            className="h-11 w-11 flex-none rounded-ctl border border-hairline text-muted hover:bg-[#F6F5F1] flex items-center justify-center"
          >
            <Icon name="autorenew" size={19} />
          </button>
        </div>
        <span className={`block text-[11px] mt-1.5 leading-relaxed ${problem ? 'text-expense' : 'text-faint'}`}>
          {problem
            ? PASSWORD_PROBLEM_TEXT[problem]
            : `พิมพ์เองได้ หรือกดปุ่มสุ่ม · อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`}
        </span>
      </label>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" className="mt-1" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
        <span>
          <span className="text-[13px] font-medium">บังคับให้ลูกค้าตั้งรหัสใหม่ตอนเข้าครั้งแรก</span>
          <span className="block text-[11px] text-faint leading-relaxed mt-0.5">
            {mustChange
              ? 'แนะนำ — พอลูกค้าตั้งรหัสของตัวเองแล้ว เราจะไม่รู้รหัสของเขาอีก'
              : '⚠️ ปิดไว้ = ลูกค้าใช้รหัสนี้ต่อไปเรื่อย ๆ และเราจะรู้รหัสของเขาตลอด ใช้เฉพาะเมื่อลูกค้าขอเองเท่านั้น'}
          </span>
        </span>
      </label>
    </Popup>
  )
}
