import { Suspense } from 'react'
import { createHashRouter, Navigate, useRouteError } from 'react-router-dom'
import lazyPage from './lib/lazyPage'
import App from './App'
import Dashboard from './pages/Dashboard'
import TransactionsPage from './pages/Transactions'
import WalletPage from './pages/Wallet'
import CardsPage from './pages/Cards'
import PendingTasksPage from './pages/PendingTasks'

/**
 * หน้าที่เปิดบ่อยที่สุด (ภาพรวม / บันทึกรายการ / กระเป๋าเงิน / รายการรอ) อยู่ใน bundle หลัก
 * เพราะผู้ใช้เข้าแทบทุกครั้งที่เปิดแอป โหลดแยกจะกลายเป็นรอสองรอบ
 *
 * ส่วนที่เหลือแยกไฟล์ เพราะลากไลบรารีหนักติดมาด้วยและนานๆ ใช้ที:
 *   รายงาน → recharts (383 KB) + xlsx (424 KB) + html2canvas (202 KB)
 *   นำเข้าข้อมูล / สำรองข้อมูล → xlsx
 * ก่อนแยก ทุกหน้าต้องรอไฟล์พวกนี้โหลดจบก่อนถึงจะเห็นหน้าแรก
 */
const ManagePage = lazyPage(() => import('./pages/Manage'))
const PaymentsPage = lazyPage(() => import('./pages/Payments'))
const ReportsPage = lazyPage(() => import('./pages/Reports'))
const HistoryPage = lazyPage(() => import('./pages/History'))
const ImportPage = lazyPage(() => import('./pages/Import'))
const BackupPage = lazyPage(() => import('./pages/Backup'))
const SettingsPage = lazyPage(() => import('./pages/Settings'))
// หน้าแอดมินระบบ — คนส่วนใหญ่ไม่มีวันเปิด จึงไม่ควรอยู่ใน bundle หลักของทุกคน
const AdminPage = lazyPage(() => import('./pages/Admin'))

function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 rounded-full border-[3px] border-hairline border-t-ink animate-spin" />
    </div>
  )
}

/** ครอบหน้าที่โหลดแยก — ระหว่างรอไฟล์มาให้เห็นตัวหมุน ไม่ใช่หน้าว่างเปล่า */
const lazyRoute = (Component) => (
  <Suspense fallback={<PageSpinner />}>
    <Component />
  </Suspense>
)

/**
 * หน้าที่ขึ้นเมื่อเปิดหน้าไหนไม่สำเร็จ — แทนหน้า error ดิบของ react-router
 * ที่ขึ้นข้อความอังกฤษล้วนอย่าง "Failed to fetch dynamically imported module"
 * ซึ่งผู้ใช้อ่านแล้วไม่รู้ว่าต้องทำอะไรต่อ
 */
function RouteError() {
  const error = useRouteError()
  const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i
    .test(String(error?.message ?? error ?? ''))

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-paper">
      <div className="card max-w-[420px] w-full px-5 py-6 text-center">
        <div className="text-[15px] font-semibold mb-1.5">
          {stale ? 'แอปมีเวอร์ชันใหม่แล้ว' : 'เปิดหน้านี้ไม่สำเร็จ'}
        </div>
        <p className="text-[12.5px] text-muted leading-relaxed">
          {stale
            ? 'หน้านี้ใช้ไฟล์ของเวอร์ชันเก่าที่ถูกแทนที่ไปแล้ว กดโหลดหน้าใหม่เพื่อใช้เวอร์ชันล่าสุด ข้อมูลที่บันทึกไว้ไม่ได้หายไปไหน'
            : 'ลองโหลดหน้าใหม่อีกครั้ง ถ้ายังไม่ได้ให้ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'}
        </p>
        {!stale && error?.message && (
          <p className="mt-2.5 text-[11px] text-faint break-words">{String(error.message)}</p>
        )}
        <button
          onClick={() => window.location.reload()}
          className="mt-4 h-10 px-5 rounded-ctl bg-ink text-white text-[13px] font-semibold hover:bg-black"
        >
          โหลดหน้าใหม่
        </button>
      </div>
    </div>
  )
}

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'wallet', element: <WalletPage /> },
      // บัตรเครดิต งวดผ่อน และสัญญาหนี้ ย้ายออกจากท้ายหน้ากระเป๋าเงินมาเป็นหน้าของตัวเอง
      { path: 'cards', element: <CardsPage /> },
      { path: 'pending-tasks', element: <PendingTasksPage /> },
      { path: 'wallet/pending', element: <Navigate to="/pending-tasks" replace /> },
      { path: 'transactions', element: <TransactionsPage /> },
      // จัดการข้อมูล — หมวดหมู่ / บัญชีธนาคาร / บัตรเครดิต / หนี้สิน อยู่ใต้เมนูเดียว
      { path: 'manage', element: <Navigate to="/manage/categories" replace /> },
      { path: 'manage/:tab', element: lazyRoute(ManagePage) },
      { path: 'categories', element: <Navigate to="/manage/categories" replace /> },
      { path: 'payments', element: lazyRoute(PaymentsPage) },
      { path: 'reports', element: lazyRoute(ReportsPage) },
      { path: 'history', element: lazyRoute(HistoryPage) },
      { path: 'import', element: lazyRoute(ImportPage) },
      { path: 'backup', element: lazyRoute(BackupPage) },
      { path: 'settings', element: lazyRoute(SettingsPage) },
      // แอดมินระบบ — ตัวหน้าเองเช็ค isPlatformAdmin แล้วเด้งกลับหน้าแรกถ้าไม่ใช่
      // (ด่านจริงอยู่ที่ RLS/RPC ฝั่งฐานข้อมูล ตรงนี้แค่ไม่ให้เห็นหน้าจอเปล่าๆ)
      { path: 'admin', element: <Navigate to="/admin/overview" replace /> },
      { path: 'admin/:tab', element: lazyRoute(AdminPage) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
