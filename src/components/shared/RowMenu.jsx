import { useState } from 'react'
import Popup from './Popup'
import Icon from './Icon'
import { toneFor } from '../../lib/actionTone'

/**
 * ปุ่ม ⋮ ท้ายแถว — เก็บงานที่ทำนานๆ ครั้งไว้ข้างใน
 *
 * ทำไมไม่โชว์ปุ่มแก้ไข/ลบไว้ในแถวเลย
 *   ปุ่มลบที่อยู่ติดกับข้อมูลตลอดเวลาเป็นความเสี่ยงที่ไม่จำเป็น เพราะเป็นงานที่ทำ
 *   ไม่กี่ครั้งในชีวิตของบัญชีหนึ่งใบ แต่กดพลาดได้ทุกวัน พอย้ายเข้ามาในเมนู
 *   ต้องกดสองจังหวะจึงจะถึง และแถวก็สะอาดขึ้นให้ตัวเลขเด่นแทน
 *
 * ใช้เปลือก Popup ไม่ใช่เมนูลอย เพราะเมนูลอยจะถูกขอบกล่องที่เลื่อนได้ตัดหายไปครึ่งหนึ่ง
 * (การ์ดในหน้าจัดการข้อมูลและป๊อปอัปหลายตัวมี overflow ของตัวเอง)
 *
 * ห้ามครอบปุ่มนี้ด้วยกล่องที่มี transform (เช่น scale-*) — Popup ข้างในวางตัวแบบ
 * fixed ซึ่งจะยึดกับกล่องที่มี transform แทนที่จะยึดกับหน้าจอ ผลคือกล่องไปโผล่
 * ในกรอบเล็กๆ นั้นจนกดอะไรไม่ได้ ถ้าต้องการปุ่มเล็กลงให้ใช้ compact
 *
 * หน้าตาข้างในเป็นตารางสี่เหลี่ยมจัตุรัสชุดเดียวกับเมนูของกระเป๋าเงิน
 * ของเดิมเป็นรายการแนวตั้งพร้อมคำอธิบายยาวหนึ่งบรรทัดต่อปุ่ม ซึ่งต้องอ่านทีละบรรทัด
 * จึงจะรู้ว่ามีอะไรให้ทำบ้าง ตารางไอคอนกวาดตารอบเดียวเห็นครบและกดถูกตัวเร็วกว่า
 * — คำอธิบายจึงต้องสั้น (ไม่กี่คำ) ถ้ายาวกว่านั้นแปลว่าปุ่มนั้นตั้งชื่อยังไม่ดีพอ
 *
 * สีของแต่ละปุ่มมาจากความหมายของไอคอน (ดู lib/actionTone) เช่นฝากเงินเขียว ถอนเงินแดง
 * ส่ง tone มาเองได้ถ้าปุ่มนั้นไม่ตรงกับกติกากลาง
 *
 * @param items [{ icon, label, desc, onClick, danger, tone }]
 */
export default function RowMenu({
  title, sub, icon = 'more_vert', items = [], buttonTitle = 'เพิ่มเติม', compact = false,
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={buttonTitle}
        className={`flex-none rounded-ctl border border-hairline bg-white flex items-center justify-center text-muted hover:text-ink hover:bg-paper ${
          compact ? 'w-7 h-7' : 'w-9 h-9'
        }`}
      >
        <Icon name="more_vert" size={compact ? 16 : 18} />
      </button>

      {open && (
        <Popup title={title} sub={sub} icon={icon} width={440} onClose={() => setOpen(false)}>
          <div className="grid grid-cols-3 gap-2">
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                title={it.desc ? `${it.label} — ${it.desc}` : it.label}
                onClick={() => { setOpen(false); it.onClick?.() }}
                className={`aspect-square border border-hairline rounded-[12px] bg-white flex flex-col items-center justify-center gap-[5px] p-2 text-center overflow-hidden transition ${
                  toneFor(it).hover
                }`}
              >
                <span className={`w-[34px] h-[34px] flex-none rounded-[10px] flex items-center justify-center ${toneFor(it).chip}`}>
                  <Icon name={it.icon} size={19} className={toneFor(it).icon} />
                </span>
                <span className={`text-[12px] font-semibold leading-tight ${toneFor(it).label ?? ''}`}>
                  {it.label}
                </span>
                {it.desc && <span className="text-[10.5px] text-faint leading-[1.3]">{it.desc}</span>}
              </button>
            ))}
          </div>
        </Popup>
      )}
    </>
  )
}
