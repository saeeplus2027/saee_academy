# تجهيز الدومين وظهور سعي أكاديمي في Google

## قبل النشر
1. اشترِ الدومين الذي تريده (مثلاً saeeacademy.com إن كان متاحاً).
2. ابحث واستبدل `YOUR-DOMAIN.com` في `public/robots.txt` و`public/sitemap.xml` ووسم `og:image` في `public/index.html` بالدومين الفعلي. استخدم الدومين نفسه مع https.
3. راجع نصوص `privacy.html` و`terms.html` و`refund-policy.html` واعتمدها قانونياً وتشغيلياً قبل استقبال مدفوعات أو بيانات فعلية؛ النص الحالي مسودة عامة وليس استشارة قانونية.
4. حدّث بيانات التواصل في صفحة التواصل لتتضمن وسيلة اتصال حقيقية تراقبها الإدارة.
5. راجع إعدادات النطاق في Cloudflare Pages/Workers وأضف الدومين المخصص إلى الخدمة التي تقدم الموقع، واضبط DNS وشهادة SSL.
6. اختبر تسجيل الحساب، الدخول، لوحة الإدارة، إضافة تخصص ومادة وفيديو، الاشتراك، صلاحيات الوصول، وعمل API ورفع الوسائط بعد ربط الدومين.

## Google Search Console
1. افتح https://search.google.com/search-console/ وسجّل الدخول بحساب Google الذي تملكه.
2. أضف الموقع كـ Domain property، ثم انسخ سجل TXT الذي تعرضه Google وأضفه في DNS لدى Cloudflare. لا يمكن إنشاء رمز التحقق مسبقاً؛ Google تولده لحسابك.
3. بعد نجاح التحقق، أرسل `https://YOUR-DOMAIN.com/sitemap.xml` بعد استبدال النطاق الحقيقي.
4. استخدم URL Inspection لفحص الصفحة الرئيسية واطلب الفهرسة. الفهرسة ليست فورية ولا يوجد ضمان للظهور أو الترتيب.

## ملفات أضيفت
- `public/robots.txt` و`public/sitemap.xml`
- `public/favicon.svg` و`public/manifest.webmanifest` و`public/404.html`
- صفحات `about.html`, `privacy.html`, `terms.html`, `refund-policy.html`, `contact.html`
- تحسين بيانات SEO والمشاركة في `public/index.html`

## ملاحظة مهمة
هذه الملفات لا تُرفع إلى Google Drive ولا إلى محرك بحث Google. تُنشر مع ملفات الموقع على الاستضافة، ثم تربط الدومين وتثبت ملكيته في Search Console. يلزم استبدال النطاق التجريبي قبل النشر.
