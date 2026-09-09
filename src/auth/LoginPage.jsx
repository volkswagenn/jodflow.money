import { useState } from 'react'
import Icon from '../components/shared/Icon'
import { useAuth } from './AuthProvider'
import AuthShell, { Field, Notice, SubmitButton, TextLink, inputClass } from './AuthShell'

export default function LoginPage({ onGoSignup, onGoForgot, signupOpen = true }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await signIn(email, password)
      // ไม่ต้อง navigate เอง — AuthProvider จับ session ได้แล้วจะสลับหน้าให้
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthShell
      footer={
        <>
          {signupOpen && (
            <p className="mb-1.5">
              ยังไม่มีบัญชี? <TextLink onClick={onGoSignup}>สมัครใช้ฟรี</TextLink>
            </p>
          )}
          <p>
            <TextLink onClick={onGoForgot}>ลืมรหัสผ่าน</TextLink>
          </p>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Field label="อีเมล">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
            inputMode="email"
            className={inputClass}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="รหัสผ่าน">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={`${inputClass} pr-11`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-1 top-1 w-9 h-9 rounded-ctl flex items-center justify-center
                         text-muted hover:bg-[#F6F5F1]"
              title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
            >
              <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={19} />
            </button>
          </div>
        </Field>

        <div className="mt-1">{error && <Notice>{error}</Notice>}</div>

        <SubmitButton busy={busy} busyLabel="กำลังเข้าสู่ระบบ…">
          เข้าสู่ระบบ
        </SubmitButton>
      </form>
    </AuthShell>
  )
}
