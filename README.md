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


## النشر من GitHub (الواجهة + الخادم)

- الواجهة تُنشر من مجلد `public/` بواسطة Workflow باسم `Deploy Saee Academy website to GitHub Pages`. اجعل مصدر Pages هو `GitHub Actions`.
- خادم التسجيل وواجهات API يُنشر بشكل مستقل على Cloudflare بواسطة Workflow باسم `Deploy Saee Academy API to Cloudflare`.
- قبل أول نشر للخادم، أضف GitHub Actions Secret باسم `CLOUDFLARE_API_TOKEN` في `Settings → Secrets and variables → Actions`. استخدم Cloudflare API Token بصلاحية نشر Workers في الحساب المرتبط بـ `account_id` في `wrangler.toml`. لا تضع الرمز في أي ملف بالمستودع.
- بعد إضافة السر ورفع التعديلات، راقب عمليتي النشر في تبويب `Actions`. نجاح نشر GitHub Pages وحده لا ينشر API.
- عنوان API مضبوط في `public/config.js` على `https://saee-academy-api.ligagym.workers.dev`. يجب أن يكون هذا هو عنوان Worker المنشور في حساب Cloudflare.


## النشر من GitHub (الواجهة + الخادم)

- الواجهة تُنشر من مجلد `public/` بواسطة Workflow باسم `Deploy Saee Academy website to GitHub Pages`. اجعل مصدر Pages هو `GitHub Actions`.
- خادم التسجيل وواجهات API يُنشر بشكل مستقل على Cloudflare بواسطة Workflow باسم `Deploy Saee Academy API to Cloudflare`.
- قبل أول نشر للخادم، أضف GitHub Actions Secret باسم `CLOUDFLARE_API_TOKEN` في `Settings → Secrets and variables → Actions`. استخدم Cloudflare API Token بصلاحية نشر Workers في الحساب المرتبط بـ `account_id` في `wrangler.toml`. لا تضع الرمز في أي ملف بالمستودع.
- بعد إضافة السر ورفع التعديلات، راقب عمليتي النشر في تبويب `Actions`. نجاح نشر GitHub Pages وحده لا ينشر API.
- عنوان API مضبوط في `public/config.js` على `https://saee-academy-api.ligagym.workers.dev`. يجب أن يكون هذا هو عنوان Worker المنشور في حساب Cloudflare.


## صفحات الموقع ولوحة الإدارة

- `index.html`: الصفحة الرئيسية.
- `specializations.html`: صفحة مستقلة للتخصصات.
- `courses.html`: صفحة مستقلة للمواد والبحث والتصفية.
- `course.html?id=COURSE_ID`: صفحة تفاصيل مستقلة لكل مادة.
- `how.html`: صفحة مستقلة تشرح طريقة استخدام المنصة.
- `admin.html`: لوحة الإدارة المباشرة: `https://saeeplus2027.github.io/saee_academy/admin.html`.

## ميزات الإدارة والحساب

تسمح لوحة الإدارة بإدارة طلبات الاشتراك، وإضافة/تعديل/حذف التخصصات والمواد، ورفع وحذف الفيديوهات، وإدارة تفعيل المستخدمين وحذفهم، وتعديل النصوص الأساسية الظاهرة في الموقع. صفحة الإدارة محمية بصلاحية `admin` على الخادم؛ معرفة رابطها وحده لا تمنح صلاحية الدخول.

يظهر في صفحة المادة عدد الطلاب الذين لديهم طلب اشتراك قيد المراجعة أو اشتراك مقبول. يزيد العدد عند إرسال طالب جديد طلباً، ولا يُحتسب الطلب المرفوض أو الاشتراك المنتهي.

يمكن للمستخدم الضغط على «مرحباً، الاسم» لفتح إعدادات الحساب وتعديل الاسم وكلمة المرور أو طلب حذف الحساب نهائياً. يتطلب التعديل/الحذف كلمة المرور الحالية. لا يسمح النظام بحذف آخر حساب أدمن.

## ترحيل قاعدة البيانات

أضيفت الهجرة `migrations/0002_site_content.sql` لإنشاء جدول `site_content` الذي يحفظ نصوص الموقع القابلة للتعديل من لوحة الإدارة. يقوم سير عمل نشر الـ API بتطبيق هجرات D1 البعيدة قبل نشر Worker باستخدام `CLOUDFLARE_API_TOKEN`. لا تحذف قاعدة البيانات الحالية ولا تعِد إنشاءها.


ملاحظة صلاحيات GitHub Actions: لأن النشر يشغّل D1 migrations، يجب أن يحتوي Cloudflare API Token المستخدم في `CLOUDFLARE_API_TOKEN` على صلاحية Account → D1 → Edit، بالإضافة إلى صلاحيات نشر Workers. قالب `Edit Cloudflare Workers` قد لا يضيف D1 تلقائياً؛ راجع صلاحيات الرمز قبل أول نشر بعد إضافة الهجرة الجديدة.
