import { useCallback, useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import Sidebar from './components/layout/Sidebar'
import BottomTabs from './components/layout/BottomTabs'
import SearchPopup from './components/shared/SearchPopup'
import FloatingCalculator from './components/shared/FloatingCalculator'
import { AdminViewBanner, TrialBanner } from './auth/StatusBanners'

export default function App() {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  /**
   * กด N ที่ไหนก็ได้เพื่อเปิดฟอร์มบันทึกรายการ — ปุ่มลัดที่ป้าย kbd บนเมนูซ้ายบอกไว้
   *
   * ต้องข้ามตอนที่โฟกัสอยู่ในช่องกรอก ไม่งั้นพิมพ์ตัว n ในชื่อรายการแล้วเด้งออกจากฟอร์ม
   * และต้องข้ามเมื่อกดพร้อมปุ่มร่วม เพราะ Ctrl+N คือเปิดหน้าต่างใหม่ของเบราว์เซอร์
   */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' && e.key !== 'N' && e.key !== 'ๆ') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target
      if (el?.isContentEditable) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return
      e.preventDefault()
      navigate('/transactions')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="min-h-screen bg-paper flex">
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />

      {/* จอ lg ขึ้นไปเนื้อหาเลี่ยงเมนูข้าง 256px — จอเล็กเต็มความกว้าง เมนูเป็นลิ้นชักทับข้างบน */}
      <div className="flex-1 min-w-0 flex flex-col lg:ml-[256px]">
        {/* แถบสถานะอยู่เหนือแถบหัวเรื่อง เพราะเป็นเรื่องของ "ทั้งแอป" ไม่ใช่ของหน้าใดหน้าหนึ่ง */}
        <AdminViewBanner />
        <TrialBanner />
        <Navbar onOpenSidebar={() => setSidebarOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
        {/*
          เนื้อหามีเพดานกว้าง 1680px แล้วจัดกลาง — จอ 2560px ถ้าปล่อยให้ยืดเต็ม
          ตารางจะกว้างจนสายตาต้องกวาดข้ามจอทั้งใบเพื่ออ่านหนึ่งแถว
          หัวเรื่องด้านบนใช้เพดานเดียวกัน ขอบซ้ายของชื่อหน้าจะได้ตรงกับขอบการ์ดข้างล่าง

          pb-24 บนมือถือเว้นที่ให้แถบล่าง ไม่งั้นเนื้อหาท้ายหน้าถูกทับ
        */}
        <main className="flex-1 min-w-0 w-full max-w-[1680px] mx-auto px-4 sm:px-6 pt-4 pb-24 lg:pb-5">
          <Outlet />
        </main>
      </div>

      <BottomTabs />
      {searchOpen && <SearchPopup onClose={() => setSearchOpen(false)} />}

      {/* เครื่องคิดเลขลอย — อยู่นอกโครงหน้า จะได้ค้างอยู่ทุกหน้าและลอยเหนือทุกอย่าง */}
      <FloatingCalculator />
    </div>
  )
}
