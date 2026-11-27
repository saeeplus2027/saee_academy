from pathlib import Path
import re
import sys

ROOT = Path.cwd()
PUBLIC = ROOT / "public"
SOURCE = ROOT / "src" / "entry.py"
REQUIRED = [PUBLIC / "index.html", PUBLIC / "courses.html", PUBLIC / "admin.html", PUBLIC / "app.js", PUBLIC / "admin.js", PUBLIC / "styles.css", SOURCE]
missing = [str(p.relative_to(ROOT)) for p in REQUIRED if not p.exists()]
if missing:
    raise SystemExit("شغّل الملف من جذر مشروع Saee Academy. الملفات التالية غير موجودة: " + ", ".join(missing))


def read(path):
    return path.read_text(encoding="utf-8")


def write(path, value):
    path.write_text(value, encoding="utf-8")


def replace_once(value, old, new, label):
    if new in value:
        return value
    if old not in value:
        raise RuntimeError(f"لم أجد موضع التعديل المطلوب: {label}")
    return value.replace(old, new, 1)

changed = []

# A) Add the new navigation link without replacing or rebuilding any other page.
nav_files = [
    "index.html", "specializations.html", "courses.html", "course.html", "how.html"
]
nav_link = '    <a data-nav="questions" href="questions.html">مكتبة الأسئلة</a>\n'
for name in nav_files:
    path = PUBLIC / name
    if not path.exists():
        continue
    s = read(path)
    if 'href="questions.html"' not in s:
        marker = '    <a data-nav="how" href="how.html">كيف تعمل المنصة</a>\n'
        if marker not in s:
            raise RuntimeError(f"رابط شريط التنقل غير موجود في public/{name}")
        s = s.replace(marker, marker + nav_link, 1)
        write(path, s)
        changed.append(f"public/{name}")

# B) Create the student page from the current courses page, retaining its current
# header, login/profile modals, footer and asset paths.
question_page = PUBLIC / "questions.html"
if not question_page.exists():
    courses = read(PUBLIC / "courses.html")
    questions = courses.replace(
        "<title>سعي أكاديمي | Saee Academy</title>",
        "<title>مكتبة الأسئلة | سعي أكاديمي</title>", 1
    )
    questions = questions.replace(
        '<body data-page="courses" data-requires-auth="true">',
        '<body data-page="questions" data-requires-auth="true">', 1
    )
    old_main = '''<main class="page-shell">
  <section class="page-title"><span class="eyebrow">مكتبة الشروحات</span><h1>المواد المتاحة</h1><p id="courseHint">تصفح المواد وابحث حسب الاسم أو التخصص.</p>
    <div class="course-filters">
      <div class="search-wrap"><span>⌕</span><input id="courseSearch" type="search" placeholder="ابحث عن مادة أو شارح..."></div>
      <select id="specializationFilter"><option value="">كل التخصصات</option></select>
    </div>
  </section>
  <section id="courseGrid" class="course-grid page-grid"><div class="empty-state">جارٍ تحميل المواد...</div></section>
</main>'''
    new_main = '''<main class="page-shell">
  <section class="page-title"><span class="eyebrow">أسئلة السنوات السابقة</span><h1>مكتبة الأسئلة</h1><p>اختر المادة لعرض ملفات الميد والفاينل والملفات التي أضافتها الإدارة.</p>
    <div class="search-wrap page-search"><span>⌕</span><input id="questionSearch" type="search" placeholder="ابحث عن مادة..."></div>
  </section>
  <section id="questionCourseGrid" class="course-grid page-grid"><div class="empty-state">جارٍ تحميل المواد...</div></section>
  <section id="questionFilesPanel" class="question-files-panel hidden">
    <div class="question-files-heading"><div><span class="eyebrow">ملفات المادة</span><h2 id="questionSelectedCourse">اسم المادة</h2><p>اضغط تحميل لتنزيل الملف على جهازك.</p></div><button id="backQuestionCourses" class="btn btn-outline" type="button">العودة إلى المواد</button></div>
    <div id="questionFilesList" class="question-files-list"><div class="empty-state">جارٍ تحميل الملفات...</div></div>
  </section>
</main>'''
    if old_main not in questions:
        raise RuntimeError("لم أتمكن من إنشاء questions.html من قالب المواد الحالي.")
    questions = questions.replace(old_main, new_main, 1)
    questions = re.sub(r'src="app\.js(?:\?[^"]*)?"', 'src="app.js?v=question-library1"', questions)
    questions = re.sub(r'href="styles\.css(?:\?[^"]*)?"', 'href="styles.css?v=question-library1"', questions)
    write(question_page, questions)
    changed.append("public/questions.html")

# C) Add the student browsing/download behavior to the existing app.js.
app_path = PUBLIC / "app.js"
app = read(app_path)
if "async function loadQuestionLibrary()" not in app:
    app = replace_once(
        app,
        "function setProtectedPageMessage(message) {\n  const target = $('#specializationGrid') || $('#courseGrid') || $('#coursePage');",
        "function setProtectedPageMessage(message) {\n  const target = $('#questionCourseGrid') || $('#specializationGrid') || $('#courseGrid') || $('#coursePage');",
        "app.js protected-page placeholder"
    )
    app = replace_once(
        app,
        "async function loadProtectedPage() {\n  if (page === 'specializations') await loadSpecializations();\n  if (page === 'courses') await loadCourses();\n  if (page === 'course') await loadCourseDetail();\n}",
        "async function loadProtectedPage() {\n  if (page === 'specializations') await loadSpecializations();\n  if (page === 'courses') await loadCourses();\n  if (page === 'course') await loadCourseDetail();\n  if (page === 'questions') await loadQuestionLibrary();\n}",
        "app.js page loader"
    )
    question_functions = r'''

// Student question library. The Worker checks the login session and streams
// each private R2 object as a download; no public R2 URL is exposed.
let questionLibraryCourses = [];

async function loadQuestionLibrary() {
  const grid = $('#questionCourseGrid');
  if (!grid) return;
  try {
    const result = await api('/api/question-library', {cache: 'no-store'});
    questionLibraryCourses = Array.isArray(result.items) ? result.items : [];
    renderQuestionLibraryCourses();
    $('#backQuestionCourses')?.addEventListener('click', () => {
      $('#questionFilesPanel')?.classList.add('hidden');
      $('#questionCourseGrid')?.classList.remove('hidden');
    });
    $('#questionSearch')?.addEventListener('input', renderQuestionLibraryCourses);
  } catch (error) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderQuestionLibraryCourses() {
  const grid = $('#questionCourseGrid');
  if (!grid) return;
  const term = ($('#questionSearch')?.value || '').trim().toLocaleLowerCase();
  const rows = questionLibraryCourses.filter(course =>
    `${course.course_name || course.name || ''} ${course.specialization_name || ''}`.toLocaleLowerCase().includes(term)
  );
  if (!rows.length) {
    grid.innerHTML = '<div class="empty-state">لا توجد مواد مطابقة للبحث.</div>';
    return;
  }
  grid.innerHTML = rows.map(course => `
    <article class="course-card question-course-card">
      <span class="tag">${escapeHtml(course.specialization_name || 'مادة جامعية')}</span>
      <h3>${escapeHtml(course.course_name || course.name)}</h3>
      <p>ملفات أسئلة السنوات السابقة للمادة.</p>
      <div class="course-meta"><span>📄 ${Number(course.file_count || 0)} ملف</span></div>
      <button type="button" class="btn btn-outline question-open-course" data-question-course="${escapeHtml(course.id)}" data-course-name="${escapeHtml(course.course_name || course.name)}">عرض الملفات ←</button>
    </article>
  `).join('');
  grid.querySelectorAll('[data-question-course]').forEach(button => {
    button.addEventListener('click', () => loadQuestionFiles(button.dataset.questionCourse, button.dataset.courseName));
  });
}

async function loadQuestionFiles(courseId, courseName) {
  const grid = $('#questionCourseGrid');
  const panel = $('#questionFilesPanel');
  const list = $('#questionFilesList');
  if (!panel || !list) return;
  grid?.classList.add('hidden');
  panel.classList.remove('hidden');
  $('#questionSelectedCourse').textContent = courseName || 'ملفات المادة';
  list.innerHTML = '<div class="empty-state">جارٍ تحميل ملفات المادة...</div>';
  try {
    const result = await api(`/api/question-library/${encodeURIComponent(courseId)}`, {cache: 'no-store'});
    $('#questionSelectedCourse').textContent = result.course?.name || courseName || 'ملفات المادة';
    const files = Array.isArray(result.items) ? result.items : [];
    if (!files.length) {
      list.innerHTML = '<div class="empty-state">لم تُضف الإدارة ملفات أسئلة لهذه المادة بعد.</div>';
      return;
    }
    list.innerHTML = files.map(file => `
      <article class="question-file-card">
        <div class="question-file-icon">FILE</div>
        <div class="question-file-info"><b>${escapeHtml(file.title)}</b><small>${escapeHtml(file.file_name)} · ${formatQuestionFileSize(file.size_bytes)}</small></div>
        <button type="button" class="btn btn-primary question-download" data-question-file="${escapeHtml(file.id)}" data-file-name="${escapeHtml(file.file_name)}">تحميل الملف ↓</button>
      </article>
    `).join('');
    list.querySelectorAll('[data-question-file]').forEach(button => {
      button.addEventListener('click', () => downloadQuestionFile(button.dataset.questionFile, button.dataset.fileName, button));
    });
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function formatQuestionFileSize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} كيلوبايت`;
  return `${(n / (1024 * 1024)).toFixed(1)} ميغابايت`;
}

async function downloadQuestionFile(fileId, fileName, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'جارٍ التحميل...';
  try {
    const response = await fetch(`${API_BASE}/api/question-files/${encodeURIComponent(fileId)}/download`, {
      method: 'GET', credentials: 'include', cache: 'no-store'
    });
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch {}
      throw new Error(data.error || 'تعذر تنزيل الملف.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName || 'question-file';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('بدأ تنزيل الملف.');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
'''
    anchor = "async function loadCourseDetail() {"
    app = replace_once(app, anchor, question_functions + "\n" + anchor, "app.js question-library functions")
    write(app_path, app)
    changed.append("public/app.js")

# D) Add the dedicated admin tab/panel.
admin_html_path = PUBLIC / "admin.html"
admin_html = read(admin_html_path)
if 'data-tab="questions"' not in admin_html:
    admin_html = replace_once(
        admin_html,
        '      <button data-tab="videos">الفيديوهات</button>\n',
        '      <button data-tab="videos">الفيديوهات</button>\n      <button data-tab="questions">مكتبة الأسئلة</button>\n',
        "admin.html question tab"
    )
    question_panel = '''
    <section id="tab-questions" class="admin-panel hidden">
      <h2>مكتبة الأسئلة والسنوات السابقة</h2>
      <p class="muted">اختر التخصص ثم المادة، واكتب عنواناً واضحاً لكل ملف مثل: أسئلة سنوات ميد أو أسئلة سنوات فاينل. يمكنك رفع ملف PDF أو Word لكل عنوان.</p>
      <form id="questionFileForm" class="admin-form">
        <label>التخصص<select id="questionSpecialization" required><option value="">جارٍ تحميل التخصصات...</option></select></label>
        <label>المادة<select id="questionCourse" required disabled><option value="">اختر التخصص أولاً</option></select></label>
        <label>عنوان الملف<input name="title" required maxlength="140" placeholder="مثال: أسئلة سنوات ميد"></label>
        <label class="wide">ملف الأسئلة<input name="file" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required></label>
        <button class="btn btn-primary" id="questionFileSubmit">رفع ملف الأسئلة</button>
        <div id="questionFileMessage" class="form-error wide"></div>
      </form>
      <div class="panel-title section-panel-title"><h2>الملفات المضافة للمادة</h2><button id="refreshQuestionFiles" class="btn btn-outline" type="button">تحديث القائمة</button></div>
      <div id="adminQuestionFilesList" class="management-list"><div class="empty-state">اختر التخصص والمادة لعرض الملفات.</div></div>
    </section>
'''
    admin_html = replace_once(
        admin_html,
        '    <section id="tab-users" class="admin-panel hidden">',
        question_panel + '\n    <section id="tab-users" class="admin-panel hidden">',
        "admin.html question panel"
    )
    # Cache-bust even when the admin script already has a version query string.
    admin_html = re.sub(r'src="admin\.js(?:\?[^"]*)?"', 'src="admin.js?v=question-library1"', admin_html)
    admin_html_path.write_text(admin_html, encoding="utf-8")
    changed.append("public/admin.html")

# E) Add admin chained dropdowns, upload/list/delete behavior to the current admin.js.
admin_js_path = PUBLIC / "admin.js"
admin_js = read(admin_js_path)
if "async function loadQuestionFilesAdmin()" not in admin_js:
    question_select_helpers = '''
function populateQuestionSpecializationSelect() {
  const select = $('#questionSpecialization');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '<option value="">اختر التخصص</option>' + adminSpecializations.map(item =>
    `<option value="${esc(item.id)}">${esc(item.name)}</option>`
  ).join('');
  select.disabled = !adminSpecializations.length;
  if (adminSpecializations.some(item => String(item.id) === String(previous))) select.value = previous;
  populateQuestionCourseSelect();
}

function populateQuestionCourseSelect() {
  const select = $('#questionCourse');
  if (!select) return;
  const specializationId = $('#questionSpecialization')?.value || '';
  const previous = select.value;
  const courses = specializationId ? adminCourses.filter(item => String(item.specialization_id) === String(specializationId)) : [];
  select.innerHTML = '<option value="">' + (specializationId ? 'اختر المادة' : 'اختر التخصص أولاً') + '</option>' + courses.map(item =>
    `<option value="${esc(item.id)}">${esc(item.name)}</option>`
  ).join('');
  select.disabled = !courses.length;
  if (courses.some(item => String(item.id) === String(previous))) select.value = previous;
}

'''
    admin_js = replace_once(admin_js, "async function loadSpecializations() {", question_select_helpers + "async function loadSpecializations() {", "admin.js question select helpers")
    # Populate the question selectors after specialization and course data is loaded.
    if "populateQuestionSpecializationSelect();" not in admin_js:
        if "renderAdminSpecializations();" not in admin_js:
            raise RuntimeError("لم أجد نهاية loadSpecializations")
        admin_js = admin_js.replace("    renderAdminSpecializations();", "    populateQuestionSpecializationSelect();\n    renderAdminSpecializations();", 1)
    if "populateQuestionCourseSelect();\n    renderAdminCourses();" not in admin_js:
        admin_js = admin_js.replace("    renderAdminCourses();", "    populateQuestionCourseSelect();\n    renderAdminCourses();", 1)

    admin_functions = r'''

async function loadQuestionFilesAdmin() {
  const courseId = $('#questionCourse')?.value || '';
  const target = $('#adminQuestionFilesList');
  if (!target) return;
  if (!courseId) {
    target.innerHTML = '<div class="empty-state">اختر التخصص ثم المادة لعرض الملفات المضافة.</div>';
    return;
  }
  try {
    const result = await api(`/api/admin/question-files?course_id=${encodeURIComponent(courseId)}`);
    const items = Array.isArray(result.items) ? result.items : [];
    if (!items.length) {
      target.innerHTML = '<div class="empty-state">لا توجد ملفات أسئلة لهذه المادة بعد.</div>';
      return;
    }
    target.innerHTML = items.map(file => `
      <article class="management-card question-admin-row">
        <div><b>${esc(file.title)}</b><small>${esc(file.file_name)} · ${(Number(file.size_bytes || 0) / (1024 * 1024)).toFixed(2)} MB</small></div>
        <button type="button" class="btn btn-small btn-delete" data-delete-question-file="${esc(file.id)}">حذف الملف</button>
      </article>
    `).join('');
  } catch (error) {
    target.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`;
  }
}

$('#questionSpecialization')?.addEventListener('change', () => {
  populateQuestionCourseSelect();
  loadQuestionFilesAdmin();
});
$('#questionCourse')?.addEventListener('change', loadQuestionFilesAdmin);
$('#refreshQuestionFiles')?.addEventListener('click', loadQuestionFilesAdmin);

$('#questionFileForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const courseId = $('#questionCourse')?.value || '';
  const title = String(data.get('title') || '').trim();
  const file = data.get('file');
  if (!courseId) { message('#questionFileMessage', 'اختر المادة أولاً.'); return; }
  if (!title) { message('#questionFileMessage', 'اكتب عنواناً يوضح محتوى الملف.'); return; }
  if (!(file instanceof File) || !file.size) { message('#questionFileMessage', 'اختر ملفاً قبل الرفع.'); return; }
  if (file.size > 50 * 1024 * 1024) { message('#questionFileMessage', 'الحد الأقصى لحجم الملف 50 ميغابايت.'); return; }
  if (!/\.(pdf|doc|docx)$/i.test(file.name)) { message('#questionFileMessage', 'الملفات المقبولة هي PDF أو DOC أو DOCX.'); return; }
  const button = $('#questionFileSubmit');
  button.disabled = true;
  message('#questionFileMessage', 'جارٍ رفع الملف...');
  try {
    const query = new URLSearchParams({title, file_name: file.name});
    const mimeFallback = /\.pdf$/i.test(file.name) ? 'application/pdf' : /\.docx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword';
    const response = await fetch(`${API_BASE}/api/admin/question-files/${encodeURIComponent(courseId)}?${query.toString()}`, {
      method: 'POST', credentials: 'include',
      headers: {'content-type': file.type || mimeFallback},
      body: file
    });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) throw new Error(result.error || 'تعذر رفع الملف.');
    form.elements.namedItem('title').value = '';
    form.elements.namedItem('file').value = '';
    message('#questionFileMessage', 'تم رفع الملف وإضافته إلى مكتبة المادة.');
    toast('تمت إضافة ملف الأسئلة بنجاح.');
    await loadQuestionFilesAdmin();
  } catch (error) {
    message('#questionFileMessage', error.message);
  } finally {
    button.disabled = false;
  }
});

$('#adminQuestionFilesList')?.addEventListener('click', async event => {
  const fileId = event.target.closest('[data-delete-question-file]')?.dataset.deleteQuestionFile;
  if (!fileId) return;
  if (!confirm('هل تريد حذف ملف الأسئلة نهائياً؟')) return;
  try {
    await api('/api/admin/question-files/' + encodeURIComponent(fileId), {method: 'DELETE'});
    toast('تم حذف ملف الأسئلة.');
    await loadQuestionFilesAdmin();
  } catch (error) {
    toast(error.message);
  }
});

// Refresh the catalogue as soon as the admin opens the question-library tab.
document.querySelector('.admin-tabs')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-tab="questions"]');
  if (!button) return;
  await loadSpecializations();
  await loadCourses();
  await loadQuestionFilesAdmin();
});
'''
    admin_js = replace_once(admin_js, "checkAdmin();", admin_functions + "\ncheckAdmin();", "admin.js question management functions")
    admin_js_path.write_text(admin_js, encoding="utf-8")
    changed.append("public/admin.js")

# F) Add small responsive styles; keep existing styles intact.
styles_path = PUBLIC / "styles.css"
styles = read(styles_path)
if "/* Question library */" not in styles:
    styles = styles.replace(".topbar nav{display:flex;gap:34px;", ".topbar nav{display:flex;gap:20px;")
    styles += r'''

/* Question library */
.question-files-panel{max-width:1180px;margin:30px auto 70px;padding:26px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow)}
.question-files-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px}
.question-files-heading h2{margin:10px 0 4px;font-size:25px}
.question-files-heading p{margin:0;color:var(--muted);line-height:1.8}
.question-files-list{display:grid;gap:12px}
.question-file-card,.question-admin-row{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid var(--line);border-radius:16px;background:#fff}
.question-file-icon{width:48px;height:48px;flex:0 0 48px;display:grid;place-items:center;border-radius:14px;background:#fff0ef;color:#d94b4b;font-size:11px;font-weight:800}
.question-file-info,.question-admin-row>div{display:grid;gap:5px;flex:1;min-width:0}
.question-file-info b,.question-admin-row b{font-size:14px;color:var(--ink)}
.question-file-info small,.question-admin-row small{display:block;color:var(--muted);font-size:11px;overflow-wrap:anywhere}
.question-download{white-space:nowrap}
.question-course-card .question-open-course{margin-top:12px}
.question-admin-row{margin-bottom:10px}
@media(max-width:1100px){.topbar{gap:12px}.topbar nav{gap:12px;font-size:12px}.nav-actions{gap:6px}.nav-actions .btn{padding:10px 12px}}
@media(max-width:850px){.topbar{height:auto;min-height:76px;padding:12px 4%;flex-wrap:wrap}.topbar nav{order:3;width:100%;justify-content:center;flex-wrap:wrap;gap:10px 17px}.nav-actions{margin-right:auto}.question-files-panel{margin:20px 4%;padding:18px}}
@media(max-width:560px){.question-files-heading{align-items:stretch;flex-direction:column}.question-file-card{align-items:flex-start;flex-wrap:wrap}.question-download{width:100%}.topbar nav{justify-content:flex-start;overflow-x:auto;flex-wrap:nowrap;padding:6px 0;white-space:nowrap}.topbar nav a{flex:0 0 auto}}
'''
    write(styles_path, styles)
    changed.append("public/styles.css")

# G) Apply the backend change against the exact src/entry.py already in this checkout.
# The patcher inserts API routes into the existing source, preserving newer auth,
# enrollment, progress, CORS, upload, and subscription code that may be present.
backend_patcher = ROOT / "apply_question_library_backend.py"
if not backend_patcher.exists():
    raise SystemExit("ملف apply_question_library_backend.py غير موجود بجانب هذا السكربت.")
exec(compile(read(backend_patcher), str(backend_patcher), "exec"), {"__name__": "__main__"})

print("اكتمل تطبيق مكتبة الأسئلة.")
if changed:
    print("الملفات التي تم تعديلها أو إنشاؤها:")
    for name in changed:
        print(" -", name)
else:
    print("لا توجد تغييرات جديدة؛ التعديل مطبّق مسبقاً.")
print("ملاحظة: تم تعديل src/entry.py أيضاً فقط إذا أُضيفت مسارات API لأول مرة.")
