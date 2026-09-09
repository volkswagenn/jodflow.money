import { useState } from 'react'
import { resetPassword, resetVerify } from '../lib/api/auth'
import AuthShell, { Field, Notice, SubmitButton, TextLink, inputClass } from './AuthShell'
import { MIN_PASSWORD_LENGTH, passwordPairProblem } from '../lib/passwordRules'

/**
 * ลืมรหัสผ่าน — ตามแบบ Jodflow.order §4.8
 *
 * ระบบไม่มีตัวส่งอีเมล จึงยืนยันตัวด้วย อีเมล + วันเกิด + เบอร์ที่ลงทะเบียน ตรงครบสาม
 * ⇒ ได้ตั๋ว 15 นาที ตั้งรหัสใหม่ได้ทันที · ไม่ตรง / บัญชีเก่าที่ไม่มีวันเกิด ⇒ ฐานข้อมูล
 * เปิดคำขอให้แอดมินเองอัตโนมัติ (ผู้ใช้ไม่ต้องทำอะไรเพิ่ม)
 *
 * ข้อความตอนไม่ผ่านมาจากฐานข้อมูลและ "เหมือนกันทุกกรณี" — ห้ามแยกว่าผิดช่องไหน
 * ตั้งรหัสใหม่สำเร็จ = ทุกเครื่องถูกออกจากระบบ (ถ้าคนร้ายเข้าไปได้ก่อน เจ้าของต้องได้เครื่องคืน)
 */
export default function ForgotPasswordPage({ onGoLogin }) {
  const [step, setStep] = useState(1) // 1 ยืนยันตัว · 2 ตั้งรหัสใหม่ · 3 เสร็จ
  const [form, setForm] = useState({ email: '', birthDate: '', phone: '' })
  const [resetToken, setResetToken] = useState('')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleVerify(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      setResetToken(await resetVerify(form))
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    const problem = passwordPairProblem(pw1, pw2)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await resetPassword(resetToken, pw1)
      setStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (step === 3) {
    return (
      <AuthShell title="ตั้งรหัสผ่านใหม่แล้ว" subtitle="ทุกเครื่องที่เคยล็อกอินไว้ถูกออกจากระบบ">
        <Notice tone="ok">เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย</Notice>
        <button type="button" onClick={onGoLogin} className="w-full h-11 rounded-ctl bg-ink text-white text-body font-semibold hover:bg-[#24282F]">
          ไปหน้าเข้าสู่ระบบ
        </button>
      </AuthShell>
    )
  }

  if (step === 2) {
    return (
      <AuthShell title="ตั้งรหัสผ่านใหม่" subtitle="ยืนยันตัวตนผ่านแล้ว — ตั๋วนี้ใช้ได้ 15 นาที">
        <form onSubmit={handleReset}>
          <Field label="รหัสผ่านใหม่" hint={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`}>
            <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} required autoFocus minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} />
          </Field>
          <Field label="ยืนยันรหัสผ่านใหม่">
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" className={inputClass} />
          </Field>
          <div className="mt-1">{error && <Notice>{error}</Notice>}</div>
          <SubmitButton busy={busy} busyLabel="กำลังบันทึก…">ตั้งรหัสผ่านใหม่</SubmitButton>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="ลืมรหัสผ่าน"
      subtitle="ยืนยันตัวด้วยข้อมูลที่ลงทะเบียนไว้ แล้วตั้งรหัสใหม่ได้ทันที"
      footer={
        <p>
          จำรหัสได้แล้ว? <TextLink onClick={onGoLogin}>เข้าสู่ระบบ</TextLink>
        </p>
      }
    >
      <form onSubmit={handleVerify}>
        <Field label="อีเมลที่ใช้สมัคร">
          <input type="email" value={form.email} onChange={set('email')} required autoFocus inputMode="email" className={inputClass} placeholder="you@example.com" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="วันเกิด">
            <input type="date" value={form.birthDate} onChange={set('birthDate')} required className={inputClass} />
          </Field>
          <Field label="เบอร์โทรที่ลงทะเบียน">
            <input type="tel" value={form.phone} onChange={set('phone')} required inputMode="tel" className={inputClass} placeholder="0812345678" />
          </Field>
        </div>
        <p className="text-[11px] text-faint -mt-2 mb-4 leading-relaxed">
          ถ้าบัญชียังไม่ได้บันทึกวันเกิดหรือเบอร์ไว้ ระบบจะส่งคำขอให้ผู้ดูแลติดต่อกลับเพื่อยืนยันตัวตนแทน
        </p>
        <div className="mt-1">{error && <Notice>{error}</Notice>}</div>
        <SubmitButton busy={busy} busyLabel="กำลังตรวจสอบ…">ยืนยันตัวตน</SubmitButton>
      </form>
    </AuthShell>
  )
}
