import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/shared/Icon'
import { hydrateStores } from '../store/hydrate'
import { subscribeRealtime } from '../lib/realtime'
import useCreditCardStore from '../store/useCreditCardStore'
import { useAuth } from './AuthProvider'

/**
 * โหลดข้อมูลของร้านให้ครบก่อนเข้าแอป
 *
 * ระบบนี้ออนไลน์อย่างเดียวตามที่ออกแบบไว้ — ถ้าโหลดไม่สำเร็จต้องบอกตรงๆ
 * ไม่ใช่ปล่อยให้เข้าไปแล้วเห็นหน้าจอว่างเปล่าซึ่งแยกไม่ออกว่าข้อมูลหายจริงหรือแค่โหลดไม่มา
 */
export default function DataGate({ children }) {
  const { shopId } = useAuth()
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  // โหลดข้อมูลครบแล้วค่อยเริ่มฟัง realtime — เปิดก่อนหน้านั้นไม่มีประโยชน์
  // (hydrate จะเขียนทับอยู่ดี) และต้องหยุดฟังเมื่อออกจากระบบ/สลับร้าน
  useEffect(() => {
    if (status !== 'ready' || !shopId) return undefined
    return subscribeRealtime(shopId)
  }, [status, shopId])

  const retry = useCallback(() => {
    setStatus('loading')
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  // shopId อยู่ในรายการพึ่งพาด้วย เพราะแอดมินสลับเข้า-ออกร้านลูกค้าได้ระหว่างใช้งาน
  // ถ้าไม่โหลดใหม่ หน้าจอจะยังเป็นข้อมูลร้านเดิมทั้งที่ api ยิงไปอีกร้านแล้ว
  useEffect(() => {
    let alive = true
    setStatus('loading')
    setError(null)
    hydrateStores()
      .then(() => {
        if (!alive) return
        setStatus('ready')
        // ปิดรอบบิลบัตรที่ผ่านวันสรุปยอดไปแล้ว — ทำหลังข้อมูลพร้อม และไม่ให้บล็อกการเข้าแอป
        // ถ้าล้มก็แค่ยังไม่มีใบแจ้งยอด ไม่กระทบส่วนอื่น (store จับ error ไว้เองแล้ว)
        useCreditCardStore.getState().ensureStatements()
      })
      .catch((err) => {
        if (!alive) return
        setError(err.message)
        setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [attempt, shopId])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center">
          <div className="w-9 h-9 mx-auto mb-3 rounded-full border-[3px] border-hairline border-t-ink animate-spin" />
          <p className="text-label text-muted">กำลังโหลดข้อมูลร้าน…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px] text-center">
          <div className="w-14 h-14 rounded-panel bg-expense-soft text-expense flex items-center justify-center mx-auto mb-4">
            <Icon name="cloud_off" size={28} />
          </div>
          <h1 className="text-[17px] font-semibold text-ink">โหลดข้อมูลไม่สำเร็จ</h1>
          <p className="text-body text-muted mt-2 leading-relaxed">{error}</p>
          <button
            onClick={retry}
            className="mt-6 w-full h-11 rounded-ctl bg-ink text-white text-body font-semibold hover:bg-[#24282F]"
          >
            ลองใหม่
          </button>
        </div>
      </div>
    )
  }

  return children
}
