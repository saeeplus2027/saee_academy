# سعي أكاديمي | Saee Academy

مستودع مستقل لمنصة شروحات جامعية. يعتمد Python Workers + Cloudflare D1 + Cloudflare R2، والواجهة العربية داخل `public/`.

## الموارد المستقلة
- Worker: `saee-academy-api`
- D1: `saee-academy-db`
- R2: `saee-academy-media`

## المتطلبات
- حساب Cloudflare
- Node.js وWrangler
- uv وPython Workers CLI (`workers-py`)

## الإعداد الأولي
1. أنشئ قاعدة بيانات مستقلة: `npx wrangler d1 create saee-academy-db`
2. انسخ `database_id` الناتج إلى `wrangler.toml` مكان `REPLACE_WITH_YOUR_NEW_D1_DATABASE_ID`.
3. أنشئ bucket مستقلاً: `npx wrangler r2 bucket create saee-academy-media`
4. طبّق المخطط: `npx wrangler d1 migrations apply saee-academy-db --remote`
5. ثبّت بيئة Python Workers وشغّل محلياً: `uv run pywrangler dev`
6. انشر: `uv run pywrangler deploy`

## إنشاء حساب الأدمن لأول مرة
أضف سراً قوياً من اختيارك:

`npx wrangler secret put ADMIN_BOOTSTRAP_KEY`

بعد النشر، أرسل طلب POST إلى `/api/admin/bootstrap` مع ترويسة `x-bootstrap-key` تساوي السر، وجسم JSON:

`{"full_name":"Admin","email":"admin@example.com","password":"Use-A-Long-Unique-Password"}`

كلمة مرور الأدمن يجب أن تكون 14 حرفاً على الأقل. بعد إنشاء الحساب، احذف السر:

`npx wrangler secret delete ADMIN_BOOTSTRAP_KEY`

## ملاحظات مهمة قبل الإنتاج
- هذه نسخة تأسيسية قابلة للتطوير وليست اعتماداً أمنياً نهائياً. يلزم إضافة اختبارات، مراقبة، حدود معدل الطلبات (Rate Limiting)، وتدقيق أمني قبل استقبال بيانات حقيقية.
- لا ترفع فيديوهات حساسة قبل اختبار صلاحيات الوصول وحجم الرفع والبث على حساب Cloudflare الفعلي.
- رفع الفيديو عبر API حالياً محدود إلى 500MB لكل ملف، وبحد أقصى 30 فيديو لكل مادة.
- الواجهة تعرض طلبات الاشتراك للطالب؛ صفحة إدارة الأدمن الكاملة وإدارة الفيديوهات ستكون المرحلة التالية.
- روابط الفيديو لا تُعرض مباشرة؛ API يتحقق من الاشتراك قبل إرجاع محتوى R2.
- استخدم HTTPS فقط، ولا تشارك مفاتيح Cloudflare أو كلمات المرور داخل المستودع.

## API المتوفرة حالياً
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/specializations` (بعد تسجيل الدخول)
- `GET /api/courses` (بعد تسجيل الدخول)
- `POST /api/enrollments`
- `GET /api/my/enrollments`
- `GET /api/watch/{video_id}`
- `POST /api/admin/bootstrap` (تهيئة لمرة واحدة بمفتاح سري)
- `POST /api/admin/specializations`
- `POST /api/admin/courses`
- `POST /api/admin/videos/{course_id}`
- `GET /api/admin/requests`
- `POST /api/admin/requests/{request_id}`

## لوحة الإدارة
بعد تسجيل الدخول بحساب الأدمن افتح `/admin.html` لإدارة طلبات الاشتراك والتخصصات والمواد ورفع الفيديوهات. صفحة الإدارة منفصلة عن الواجهة العامة، وتتحقق الخوادم من دور الأدمن في كل endpoint.
