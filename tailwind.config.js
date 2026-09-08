/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      /**
       * จุดตัด "จอกว้าง" ของแบบ — เนื้อหา (จอ ลบเมนูซ้าย 256px) กว้างตั้งแต่ 1300px ขึ้นไป
       * 256 + 1300 = 1556 พอถึงจุดนี้แผงขวาขยาย และหลายหน้าจัดคอลัมน์ใหม่
       * ตั้งเป็นชื่อเดียวไว้ที่นี่ จะได้ไม่ต้องเขียนเลข 1556 กระจายตามไฟล์
       */
      screens: { wide: '1556px' },
      fontFamily: {
        sans: ['Anuphan', 'Sarabun', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ── Design tokens ของ JodFlow ────────────────────────────────
        ink: '#16181D',          // สีเข้มหลัก: sidebar, ตัวอักษร, ปุ่มหลัก
        lime: {
          DEFAULT: '#C7F250',    // สีเน้นของแบรนด์
          dark: '#B9E93A',       // ตอน hover
          deep: '#8FA82E',       // เงา/ตัวอักษรบนพื้นอ่อน
        },
        paper: '#F4F3EF',        // พื้นหลังหน้า
        hairline: '#E4E2DC',     // เส้นขอบ

        income: {
          DEFAULT: '#12795B',
          soft: '#DCEFE6',
        },
        expense: {
          DEFAULT: '#D0483C',
          soft: '#FBE9E7',
        },
        pending: {
          DEFAULT: '#A8760B',
          soft: '#FBF7EC',
          line: '#F0E3C4',
        },
        transfer: {
          DEFAULT: '#3A55C4',
          soft: '#E7EAFA',
        },
        recurring: {
          DEFAULT: '#6D4AA8',
          soft: '#EDE7FA',
        },
        // กระเป๋าตังค์ย่อย — เงินที่กันไว้ ยังเป็นเงินเราแต่ตั้งใจไม่แตะ
        // ใช้สีน้ำตาลเพราะสีที่เหลือถูกจองความหมายไปหมดแล้ว (เข้า/ออก/ย้าย/ค้าง/ประจำ)
        pocket: {
          DEFAULT: '#8A5A2B',
          soft: '#F3EADF',
          line: '#E3D2BE',
        },

        // เฉดเทาที่ใช้บ่อยใน mockup
        muted: '#7A7F87',
        faint: '#8A8F97',
        'ink-line': '#24282F',   // เส้นคั่นใน sidebar
        'ink-soft': '#767C85',   // ตัวอักษรรองใน sidebar
      },
      borderRadius: {
        // ทั้งดีไซน์ไม่มีมุม 20px เลย การ์ดเนื้อหาทุกใบเป็น 16px เท่ากันหมด
        card: '16px',   // การ์ดใหญ่
        panel: '16px',  // การ์ดใน
        ctl: '12px',    // ปุ่ม / input
      },
      fontSize: {
        body: ['13.5px', '1.55'],
        label: ['12.5px', '1.4'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(22,24,29,.04)',
        pop: '0 12px 32px rgba(22,24,29,.14)',
      },
    },
  },
  plugins: [],
}
