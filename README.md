# الشِّفرة (Codenames Arabic) 🕵️‍♂️💬

لعبة جماعية تفاعلية حية (Real-Time Multiplayer Web App) مستوحاة من لعبة Codenames الشهيرة باللغة العربية، مصممة بأحدث تقنيات الويب مع واجهة عصرية وبث حي للأحداث.

---

## 🚀 المميزات (Features)
* **لعب جماعي حي:** اعتماد Socket.io للبث الفوري لحركات اللاعبين والتفاعلات دون الحاجة لتحديث الصفحة.
* **تفاعلات إيموجي حية:** ظهور تفاعلات عائمة (🔥, 🤦‍♂️, 💀) فوق البطاقات فور التخمين.
* **بنك كلمات ضخم:** استيعاب آلاف الكلمات العربية المصنفة مع خيار التخصيص.
* **تصميم متجاوب:** واجهة ملائمة لشاشات الهواتف والأجهزة المختلفة بتنسيق داكن عالي التباين.

---

## 🛠️ البنية البرمجية (Tech Stack)
* **Backend:** Node.js / Express.js
* **Real-time Engine:** Socket.io
* **Data Storage:** JSON Word Bank (`words-bank.json`)
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla ES6)

---

## 📁 هيكلية المشروع (Project Structure)
```text
codesiber/
├── game.js            # منطق الاتصال وأحداث العميل
├── gameEngine.js      # محرك اللعبة وقوانينها
├── index.html         # الواجهة الرئيسية
├── package.json       # التبعيات والحزم
├── README.md          # ملف التوثيق
├── server.js          # خادم Express و Socket.io
├── style.css          # الأنماط والتصميم المتجاوب
└── words-bank.json    # بنك الكلمات العربية
