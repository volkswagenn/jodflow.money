import { useState } from 'react'
import Icon from '../components/shared/Icon'
import { useAuth } from './AuthProvider'
import AuthShell, { Field, Notice, SubmitButton, TextLink, inputClass } from './AuthShell'
import { MIN_PASSWORD_LENGTH, passwordPairProblem } from '../lib/passwordRules'

/**
 * สมัครสมาชิก — ตามแบบ Jodflow.order §4.10
 *
 * เส้นทางนี้ไม่มีใครล็อกอิน ⇒ ทุกค่าที่ส่งไปถูกตรวจซ้ำที่ฐานข้อมูลทั้งหมด (app_signup)
 * ที่นี่ตรวจก่อนแค่ให้ผู้ใช้เห็นข้อผิดพลาดเร็ว ไม่ใช่ด่านจริง
 *
 * วันเกิด + เบอร์ ถามตั้งแต่สมัคร เพราะเป็นทางเดียวที่ผู้ใช้จะกู้รหัสผ่านเองได้
 * (ระบบไม่มีตัวส่งอีเมล — ดู ForgotPasswordPage) ไม่กรอกก็สมัครได้ แต่ลืมรหัสแล้วต้องรอแอดมิน
 *
 * สิ่งที่ "ไม่" อยู่ในฟอร์มโดยตั้งใจ: สถานะร้าน วันหมดอายุ สิทธิ์แอดมิน — ฐานข้อมูลกำหนดเอง
 */
export default function SignupPage({ onGoLogin, trialDays = 14, signupNote }) {
  const { signUp } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', confirm: '', name: '', shopName: '', birthDate: '', phone: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    const problem = passwordPairProblem(form.password, form.confirm)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await signUp({
        email: form.email,
        password: form.password,
        displayName: form.name,
        shopName: form.shopName,
        birthDate: form.birthDate,
        phone: form.phone,
      })
      // สำเร็จ = AuthProvider ได้ตั๋วแล้วพาเข้าแอปเอง
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="สมัครใช้งาน"
      subtitle={`ทดลองใช้ฟรี ${trialDays} วัน ไม่ต้องใส่บัตร`}
      footer={
        <p>
          มีบัญชีอยู่แล้ว? <TextLink onClick={onGoLogin}>เข้าสู่ระบบ</TextLink>
        </p>
      }
    >
      {signupNote && <Notice tone="info">{signupNote}</Notice>}

      <form onSubmit={handleSubmit}>
        <Field label="อีเมล">
          <input type="email" value={form.email} onChange={set('email')} required autoFocus autoComplete="username" inputMode="email" className={inputClass} placeholder="you@example.com" />
        </Field>

        <Field label="ชื่อของคุณ">
          <input type="text" value={form.name} onChange={set('name')} required autoComplete="name" className={inputClass} placeholder="ชื่อที่อยากให้ระบบเรียก" />
        </Field>

        <Field label="ชื่อสมุดบัญชี" hint="ไม่กรอกก็ได้ — จะใช้ชื่อของคุณแทน เปลี่ยนทีหลังได้ตลอด">
          <input type="text" value={form.shopName} onChange={set('shopName')} className={inputClass} placeholder="เช่น ร้านกาแฟบ้านสวน" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="วันเกิด">
            <input type="date" value={form.birthDate} onChange={set('birthDate')} className={inputClass} />
          </Field>
          <Field label="เบอร์โทร">
            <input type="tel" value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" className={inputClass} placeholder="0812345678" />
          </Field>
        </div>
        <p className="text-[11px] text-faint -mt-2 mb-4 leading-relaxed">
          สองช่องนี้ใช้ยืนยันตัวตอนลืมรหัสผ่าน จะได้ตั้งรหัสใหม่เองได้ทันทีโดยไม่ต้องรอผู้ดูแล
        </p>

        <Field label="รหัสผ่าน" hint={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร — ยาวไว้ก่อน ไม่ต้องมีอักขระพิเศษ`}>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={`${inputClass} pr-11`} placeholder="••••••••••" />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-1 top-1 w-9 h-9 rounded-ctl flex items-center justify-center text-muted hover:bg-[#F6F5F1]" title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
              <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={19} />
            </button>
          </div>
        </Field>

        <Field label="ยืนยันรหัสผ่าน">
          <input type={showPassword ? 'text' : 'password'} value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" className={inputClass} placeholder="พิมพ์ซ้ำอีกครั้ง" />
        </Field>

        <div className="mt-1">{error && <Notice>{error}</Notice>}</div>

        <SubmitButton busy={busy} busyLabel="กำลังสร้างบัญชี…">สมัครและเริ่มใช้งาน</SubmitButton>
      </form>
    </AuthShell>
  )
}
