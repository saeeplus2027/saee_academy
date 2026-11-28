const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const API_BASE = (window.SAEE_API_BASE || '').replace(/\/$/, '');
let adminUser = null;
let adminCourses = [];
let adminSpecializations = [];
let selectedQuestionLibrarySubjectId = '';

const AUTH_TOKEN_KEY = 'saee_academy_session_token_v1';
function getAuthToken() { try { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch { return ''; } }
function saveAuthToken(token) { if (typeof token === 'string' && token) { try { localStorage.setItem(AUTH_TOKEN_KEY, token); } catch {} } }
function clearAuthToken() { try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch {} }

async function api(path, options = {}) {
  if (!API_BASE) throw new Error('إعداد عنوان الخادم غير موجود.');
  const headers = {
    ...(options.body && typeof options.body === 'string' ? {'content-type': 'application/json'} : {}),
    ...(options.headers || {})
  };
  const token = getAuthToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(API_BASE + path, {credentials: 'include', cache: 'no-store', ...options, headers});
  } catch {
    throw new Error('تعذر الاتصال بخادم سعي أكاديمي.');
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (data.token) saveAuthToken(data.token);
  if (response.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) clearAuthToken();
  if (!response.ok) throw new Error(data.error || 'حدث خطأ غير متوقع.');
  return data;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function message(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text || '';
}

function toast(text) {
  const element = $('#adminToast');
  element.textContent = text;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2800);
}

async function checkAdmin() {
  try {
    const result = await api('/api/auth/me');
    adminUser = result.user;
    if (adminUser?.role === 'admin') {
      showDashboard();
      return;
    }
  } catch {}
  $('#adminLogin').classList.remove('hidden');
  $('#adminDashboard').classList.add('hidden');
}

function showDashboard() {
  $('#adminLogin').classList.add('hidden');
  $('#adminDashboard').classList.remove('hidden');
  $('#adminLogout').classList.remove('hidden');
  loadAll();
}

$('#adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  button.disabled = true;
  message('#loginError', '');
  // Do not send an old student session with the fresh admin login request.
  clearAuthToken();
  try {
    const login = await api('/api/auth/login', {method: 'POST', body: JSON.stringify(body)});
    if (!login.token) {
      throw new Error('الخادم لم يُرجع رمز تسجيل الدخول. انشر آخر نسخة من Cloudflare Worker ثم حاول مجدداً.');
    }
    saveAuthToken(login.token);
    if (login.user?.role && login.user.role !== 'admin') {
      try { await api('/api/auth/logout', {method: 'POST'}); } catch {}
      clearAuthToken();
      throw new Error('هذا الحساب ليس حساب أدمن. استخدم البريد المخصص للإدارة.');
    }
    const result = await api('/api/auth/me');
    if (result.user?.role !== 'admin') {
      try { await api('/api/auth/logout', {method: 'POST'}); } catch {}
      clearAuthToken();
      throw new Error('تم التحقق من الحساب، لكنه لا يملك صلاحية الأدمن.');
    }
    adminUser = result.user;
    showDashboard();
  } catch (error) {
    message('#loginError', error.message || 'تعذر تسجيل الدخول. تحقق من اتصال الخادم وبيانات الحساب.');
  } finally {
    button.disabled = false;
  }
});

$('#adminLogout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', {method: 'POST'}); } catch {}
  clearAuthToken();
  location.href = 'index.html';
});

$$('.admin-tabs button').forEach(button => button.addEventListener('click', () => {
  $$('.admin-tabs button').forEach(item => item.classList.toggle('active', item === button));
  $$('[id^="tab-"]').forEach(panel => panel.classList.add('hidden'));
  $('#tab-' + button.dataset.tab).classList.remove('hidden');
}));

async function loadAll() {
  await loadSpecializations();
  await Promise.all([loadRequests(), loadCourses(), loadUsers(), loadSiteContent()]);
  await loadVideos();
  await loadAdminQuestionSubjects();
}

async function loadSpecializations() {
  try {
    const result = await api('/api/admin/specializations');
    adminSpecializations = result.items || [];
    const options = '<option value="">اختر التخصص</option>' + adminSpecializations.map(item =>
      `<option value="${esc(item.id)}">${esc(item.name)}</option>`
    ).join('');
    if ($('#courseSpecialization')) $('#courseSpecialization').innerHTML = options;
    if ($('#videoSpecialization')) {
      const previous = $('#videoSpecialization').value;
      $('#videoSpecialization').innerHTML = options;
      if (adminSpecializations.some(item => item.id === previous)) $('#videoSpecialization').value = previous;
      renderVideoCourseOptions();
    }
    renderAdminSpecializations();
  } catch (error) {
    $('#adminSpecializationsList').textContent = error.message;
    toast(error.message);
  }
}

function renderAdminSpecializations() {
  const target = $('#adminSpecializationsList');
  if (!adminSpecializations.length) {
    target.innerHTML = '<div class="empty-state">لا توجد تخصصات حتى الآن.</div>';
    return;
  }
  target.innerHTML = adminSpecializations.map(item => `
    <article class="management-card">
      <div class="management-fields">
        <label>اسم التخصص<input data-spec-name="${esc(item.id)}" value="${esc(item.name)}"></label>
        <label>الوصف<input data-spec-description="${esc(item.id)}" value="${esc(item.description || '')}"></label>
      </div>
      <div class="management-actions">
        <span class="management-meta">${Number(item.course_count || 0)} مادة</span>
        <button class="btn btn-small btn-save" data-save-spec="${esc(item.id)}">حفظ</button>
        <button class="btn btn-small btn-delete" data-delete-spec="${esc(item.id)}">حذف</button>
      </div>
    </article>
  `).join('');
}

$('#specializationForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  button.disabled = true;
  message('#specializationMessage', '');
  try {
    await api('/api/admin/specializations', {method: 'POST', body: JSON.stringify(body)});
    event.currentTarget.reset();
    message('#specializationMessage', 'تمت إضافة التخصص بنجاح.');
    toast('تمت إضافة التخصص بنجاح.');
    await loadSpecializations();
    await loadCourses();
  } catch (error) {
    message('#specializationMessage', error.message);
  } finally {
    button.disabled = false;
  }
});

$('#adminSpecializationsList').addEventListener('click', async event => {
  const saveId = event.target.dataset.saveSpec;
  const deleteId = event.target.dataset.deleteSpec;
  if (saveId) {
    const body = {
      name: $(`[data-spec-name="${CSS.escape(saveId)}"]`).value,
      description: $(`[data-spec-description="${CSS.escape(saveId)}"]`).value
    };
    try {
      await api('/api/admin/specializations/' + encodeURIComponent(saveId), {method: 'PUT', body: JSON.stringify(body)});
      toast('تم تحديث التخصص.');
      await loadSpecializations();
      await loadCourses();
    } catch (error) { toast(error.message); }
  }
  if (deleteId) {
    if (!confirm('هل تريد حذف هذا التخصص؟')) return;
    try {
      await api('/api/admin/specializations/' + encodeURIComponent(deleteId), {method: 'DELETE'});
      toast('تم حذف التخصص.');
      await loadSpecializations();
      await loadCourses();
    } catch (error) { toast(error.message); }
  }
});

function renderVideoCourseOptions() {
  const select = $('#videoCourse');
  if (!select) return;
  const specializationId = $('#videoSpecialization')?.value || '';
  const previous = select.value;
  const filtered = specializationId
    ? adminCourses.filter(course => String(course.specialization_id) === String(specializationId))
    : [];
  select.innerHTML = '<option value="">اختر المادة</option>' + filtered.map(course =>
    `<option value="${esc(course.id)}">${esc(course.name)}</option>`
  ).join('');
  if (filtered.some(course => course.id === previous)) select.value = previous;
  if (!specializationId) $('#adminVideosList').textContent = 'اختر التخصص ثم المادة لعرض الفيديوهات.';
  else if (!filtered.length) $('#adminVideosList').textContent = 'لا توجد مواد مضافة لهذا التخصص بعد.';
  loadVideos();
}

$('#videoSpecialization')?.addEventListener('change', renderVideoCourseOptions);

async function loadCourses() {
  try {
    const result = await api('/api/admin/courses');
    adminCourses = result.items || [];
    renderVideoCourseOptions();
    renderAdminCourses();
    await loadVideos();
  } catch (error) {
    $('#adminCoursesList').textContent = error.message;
    toast(error.message);
  }
}

function renderAdminCourses() {
  const target = $('#adminCoursesList');
  if (!adminCourses.length) {
    target.innerHTML = '<div class="empty-state">لا توجد مواد حتى الآن.</div>';
    return;
  }
  const specOptions = (selected) => adminSpecializations.map(spec =>
    `<option value="${esc(spec.id)}" ${spec.id === selected ? 'selected' : ''}>${esc(spec.name)}</option>`
  ).join('');
  target.innerHTML = adminCourses.map(course => `
    <article class="management-card course-management-card">
      <div class="management-card-heading">
        <b>${esc(course.name)}</b>
        <span class="management-meta">${Number(course.enrollment_count || 0)} مسجل · ${Number(course.video_count || 0)} فيديو</span>
      </div>
      <div class="management-fields">
        <label>اسم المادة<input data-course-field="name" data-course-id="${esc(course.id)}" value="${esc(course.name)}"></label>
        <label>التخصص<select data-course-field="specialization_id" data-course-id="${esc(course.id)}">${specOptions(course.specialization_id)}</select></label>
        <label>اسم الشارح<input data-course-field="instructor_name" data-course-id="${esc(course.id)}" value="${esc(course.instructor_name)}"></label>
        <label>السعر بالدينار<input type="number" min="0" step="0.01" data-course-field="price_jod" data-course-id="${esc(course.id)}" value="${Number(course.price_jod).toFixed(2)}"></label>
        <label class="field-wide">الوصف<textarea rows="2" data-course-field="description" data-course-id="${esc(course.id)}">${esc(course.description || '')}</textarea></label>
        <label class="inline-check"><input type="checkbox" data-course-field="is_published" data-course-id="${esc(course.id)}" ${course.is_published ? 'checked' : ''}> المادة منشورة للطلاب</label>
      </div>
      <div class="management-actions">
        <button class="btn btn-small btn-save" data-save-course="${esc(course.id)}">حفظ التعديلات</button>
        <button class="btn btn-small btn-delete" data-delete-course="${esc(course.id)}">حذف المادة</button>
      </div>
    </article>
  `).join('');
}

$('#courseForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  body.is_published = form.has('is_published');
  button.disabled = true;
  message('#courseMessage', '');
  try {
    await api('/api/admin/courses', {method: 'POST', body: JSON.stringify(body)});
    event.currentTarget.reset();
    message('#courseMessage', 'تمت إضافة المادة بنجاح.');
    toast('تمت إضافة المادة بنجاح.');
    await loadCourses();
  } catch (error) {
    message('#courseMessage', error.message);
  } finally {
    button.disabled = false;
  }
});

$('#adminCoursesList').addEventListener('click', async event => {
  const saveId = event.target.dataset.saveCourse;
  const deleteId = event.target.dataset.deleteCourse;
  if (saveId) {
    const fields = $$(`[data-course-id="${CSS.escape(saveId)}"]`);
    const body = {};
    fields.forEach(field => {
      const key = field.dataset.courseField;
      body[key] = field.type === 'checkbox' ? field.checked : field.value;
    });
    body.price_jod = Number(body.price_jod);
    try {
      await api('/api/admin/courses/' + encodeURIComponent(saveId), {method: 'PUT', body: JSON.stringify(body)});
      toast('تم تحديث المادة.');
      await loadCourses();
    } catch (error) { toast(error.message); }
  }
  if (deleteId) {
    if (!confirm('سيتم حذف المادة وطلبات الاشتراك وفيديوهاتها وملفات PDF التابعة لها. هل تريد المتابعة؟')) return;
    try {
      await api('/api/admin/courses/' + encodeURIComponent(deleteId), {method: 'DELETE'});
      toast('تم حذف المادة وملفات فيديوهاتها.');
      await loadCourses();
      await loadRequests();
      await loadAdminQuestionFiles();
    } catch (error) { toast(error.message); }
  }
});

async function loadRequests() {
  try {
    const result = await api('/api/admin/requests');
    const target = $('#requestsList');
    if (!result.items?.length) {
      target.innerHTML = '<div class="empty-state">لا توجد طلبات اشتراك حتى الآن.</div>';
      return;
    }
    target.innerHTML = '';
    result.items.forEach(request => {
      const card = document.createElement('article');
      card.className = 'request-item';
      card.innerHTML = `
        <div><h3>${esc(request.full_name)} — ${esc(request.course_name)}</h3>
        <p>${esc(request.email)}<br>تاريخ الطلب: ${new Date(request.requested_at + 'Z').toLocaleString('ar-JO')}<br>
        السعر: ${Number(request.price_jod).toFixed(2)} د.أ
        ${request.expires_at ? ' · ينتهي: ' + new Date(request.expires_at).toLocaleDateString('ar-JO') : ''}</p></div>
        <div class="request-actions">
          <span class="status ${esc(request.status)}">${({pending:'قيد المراجعة',approved:'مقبول',rejected:'مرفوض',expired:'منتهي'})[request.status] || esc(request.status)}</span>
          ${request.status === 'pending' ? `<small class="subscription-duration">مدة الاشتراك بعد القبول: 4 أشهر</small><button class="btn btn-small btn-accept">قبول الاشتراك</button><button class="btn btn-small btn-reject">رفض</button>` : ''}
        </div>`;
      if (request.status === 'pending') {
        card.querySelector('.btn-accept').addEventListener('click', () => decideRequest(request.id, 'approve'));
        card.querySelector('.btn-reject').addEventListener('click', () => decideRequest(request.id, 'reject'));
      }
      target.append(card);
    });
  } catch (error) {
    $('#requestsList').textContent = error.message;
  }
}

async function decideRequest(id, action) {
  try {
    await api('/api/admin/requests/' + encodeURIComponent(id), {
      method: 'POST', body: JSON.stringify({action})
    });
    toast(action === 'approve' ? 'تم قبول الطلب وتفعيل الاشتراك لمدة 4 أشهر.' : 'تم رفض الطلب.');
    await loadRequests();
    await loadCourses();
  } catch (error) { toast(error.message); }
}

async function loadVideos() {
  const courseId = $('#videoCourse')?.value;
  const target = $('#adminVideosList');
  if (!courseId) {
    if (target) target.innerHTML = '<div class="empty-state">أضف مادة أولاً لعرض فيديوهاتها.</div>';
    return;
  }
  try {
    const result = await api('/api/admin/videos/' + encodeURIComponent(courseId));
    if (!result.items?.length) {
      target.innerHTML = '<div class="empty-state">لا توجد فيديوهات لهذه المادة.</div>';
      return;
    }
    target.innerHTML = result.items.map(video => `
      <article class="management-card video-row">
        <div><b>${esc(video.position)}. ${esc(video.title)}</b><small>${esc(video.id)}</small></div>
        <button class="btn btn-small btn-delete" data-delete-video="${esc(video.id)}">حذف الفيديو</button>
      </article>
    `).join('');
  } catch (error) {
    target.textContent = error.message;
  }
}

$('#videoCourse').addEventListener('change', loadVideos);
$('#adminVideosList').addEventListener('click', async event => {
  const id = event.target.dataset.deleteVideo;
  if (!id) return;
  if (!confirm('هل تريد حذف هذا الفيديو نهائياً؟')) return;
  try {
    await api('/api/admin/videos/item/' + encodeURIComponent(id), {method: 'DELETE'});
    toast('تم حذف الفيديو.');
    await loadVideos();
    await loadCourses();
  } catch (error) { toast(error.message); }
});

$('#videoForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get('file');
  if (!file || !file.size) return;
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  message('#videoMessage', '');
  try {
    const videoTitle = String(form.get('title') || '').trim();
    const uploadUrl = new URL(API_BASE + '/api/admin/videos/' + encodeURIComponent(form.get('course_id')));
    // Keep all Arabic text out of HTTP headers. Base64url encodes the title
    // as ASCII in the query string; the raw video remains the request body.
    const titleBytes = new TextEncoder().encode(videoTitle);
    let binaryTitle = '';
    titleBytes.forEach(byte => { binaryTitle += String.fromCharCode(byte); });
    const titleBase64Url = btoa(binaryTitle).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    uploadUrl.searchParams.set('title_b64', titleBase64Url);
    const response = await fetch(uploadUrl.toString(), {
      method: 'POST', credentials: 'include',
      headers: getAuthToken() ? {authorization: `Bearer ${getAuthToken()}`} : {},
      // No custom content-type header: the Worker defaults the stored MIME type to video/mp4.
      body: file
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'تعذر رفع الفيديو.');
    message('#videoMessage', `تم رفع الفيديو بنجاح. ترتيبه: ${data.position}.`);
    toast('تم رفع الفيديو بنجاح.');
    event.currentTarget.reset();
    await loadVideos();
    await loadCourses();
  } catch (error) {
    message('#videoMessage', error.message);
  } finally {
    button.disabled = false;
  }
});


async function loadAdminQuestionSubjects() {
  const target = $('#adminQuestionSubjectsList');
  if (!target) return;
  try {
    const result = await api('/api/admin/question-library-subjects', {cache: 'no-store'});
    const items = Array.isArray(result.items) ? result.items : [];
    if (selectedQuestionLibrarySubjectId && !items.some(item => item.id === selectedQuestionLibrarySubjectId)) {
      closeQuestionSubjectManager();
    }
    if (!items.length) {
      target.innerHTML = '<div class="empty-state">لم تتم إضافة مواد إلى مكتبة الأسئلة بعد.</div>';
      return;
    }
    target.innerHTML = items.map(item => `
      <article class="management-card question-admin-subject-row">
        <div class="question-admin-subject-info">
          <b>${esc(item.name)}</b>
          <small>${Number(item.file_count || 0)} ملف PDF مضاف</small>
        </div>
        <div class="management-actions">
          <button type="button" class="btn btn-small btn-save" data-manage-question-subject="${esc(item.id)}">إدارة الملفات</button>
          <button type="button" class="btn btn-small btn-delete" data-delete-question-subject="${esc(item.id)}">حذف المادة</button>
        </div>
      </article>
    `).join('');
    if (selectedQuestionLibrarySubjectId) {
      const selected = items.find(item => item.id === selectedQuestionLibrarySubjectId);
      if (selected) $('#questionSubjectManagerName').textContent = selected.name;
    }
  } catch (error) {
    target.textContent = error.message;
  }
}

async function openQuestionSubjectManager(subjectId) {
  const result = await api('/api/admin/question-library-subjects', {cache: 'no-store'});
  const subject = (result.items || []).find(item => item.id === subjectId);
  if (!subject) throw new Error('المادة غير موجودة في مكتبة الأسئلة.');
  selectedQuestionLibrarySubjectId = subject.id;
  $('#questionSubjectManagerName').textContent = subject.name;
  $('#questionSubjectManager').classList.remove('hidden');
  $('#questionSubjectManager').scrollIntoView({behavior: 'smooth', block: 'start'});
  message('#questionFileMessage', '');
  await loadAdminQuestionFiles();
}

function closeQuestionSubjectManager() {
  selectedQuestionLibrarySubjectId = '';
  $('#questionSubjectManager')?.classList.add('hidden');
  $('#questionFileForm')?.reset();
  message('#questionFileMessage', '');
  const target = $('#adminQuestionFilesList');
  if (target) target.innerHTML = 'اختر مادة لعرض ملفاتها.';
}

$('#questionLibrarySubjectForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get('name') || '').trim();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  message('#questionLibrarySubjectMessage', '');
  try {
    const result = await api('/api/admin/question-library-subjects', {
      method: 'POST', body: JSON.stringify({name})
    });
    event.currentTarget.reset();
    await loadAdminQuestionSubjects();
    await openQuestionSubjectManager(result.id);
    message('#questionLibrarySubjectMessage', 'تمت إضافة المادة إلى مكتبة الأسئلة فقط.');
    toast('تمت إضافة المادة إلى المكتبة.');
  } catch (error) {
    message('#questionLibrarySubjectMessage', error.message);
  } finally {
    button.disabled = false;
  }
});

$('#adminQuestionSubjectsList')?.addEventListener('click', async event => {
  const manageButton = event.target.closest('[data-manage-question-subject]');
  const deleteButton = event.target.closest('[data-delete-question-subject]');
  if (manageButton) {
    manageButton.disabled = true;
    try {
      await openQuestionSubjectManager(manageButton.dataset.manageQuestionSubject);
    } catch (error) { toast(error.message); }
    finally { manageButton.disabled = false; }
    return;
  }
  if (!deleteButton || !confirm('سيتم حذف المادة وكل ملفات PDF التابعة لها. هل تريد المتابعة؟')) return;
  deleteButton.disabled = true;
  try {
    await api('/api/admin/question-library-subjects/' + encodeURIComponent(deleteButton.dataset.deleteQuestionSubject), {
      method: 'DELETE'
    });
    if (selectedQuestionLibrarySubjectId === deleteButton.dataset.deleteQuestionSubject) closeQuestionSubjectManager();
    toast('تم حذف المادة وملفاتها.');
    await loadAdminQuestionSubjects();
  } catch (error) {
    toast(error.message);
    deleteButton.disabled = false;
  }
});

async function loadAdminQuestionFiles() {
  const target = $('#adminQuestionFilesList');
  if (!target) return;
  if (!selectedQuestionLibrarySubjectId) {
    target.innerHTML = '<div class="empty-state">اختر مادة لعرض ملفاتها.</div>';
    return;
  }
  try {
    const result = await api('/api/admin/question-files', {cache: 'no-store'});
    const items = (Array.isArray(result.items) ? result.items : []).filter(file =>
      file.course_id === 'library:' + selectedQuestionLibrarySubjectId
    );
    if (!items.length) {
      target.innerHTML = '<div class="empty-state">لم تتم إضافة ملفات لهذه المادة بعد.</div>';
      return;
    }
    target.innerHTML = items.map(file => `
      <article class="management-card question-admin-file-row">
        <div><b>${esc(file.title)}</b><small>${esc(file.file_name)} · ${formatAdminQuestionFileSize(file.file_size)}</small></div>
        <button type="button" class="btn btn-small btn-delete" data-delete-question-file="${esc(file.id)}">حذف الملف</button>
      </article>
    `).join('');
  } catch (error) {
    target.textContent = error.message;
  }
}

function formatAdminQuestionFileSize(value) {
  const size = Number(value || 0);
  return size < 1024 * 1024
    ? Math.max(1, Math.round(size / 1024)) + ' KB'
    : (size / (1024 * 1024)).toFixed(1) + ' MB';
}

function adminBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

$('#refreshQuestionSubjects')?.addEventListener('click', loadAdminQuestionSubjects);
$('#refreshQuestionFiles')?.addEventListener('click', loadAdminQuestionFiles);
$('#closeQuestionSubjectManager')?.addEventListener('click', closeQuestionSubjectManager);

$('#adminQuestionFilesList')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-question-file]');
  if (!button || !confirm('هل تريد حذف ملف PDF هذا نهائياً؟')) return;
  button.disabled = true;
  try {
    await api('/api/admin/question-files/item/' + encodeURIComponent(button.dataset.deleteQuestionFile), {
      method: 'DELETE'
    });
    toast('تم حذف ملف PDF.');
    await Promise.all([loadAdminQuestionFiles(), loadAdminQuestionSubjects()]);
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
});

$('#questionFileForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get('file');
  const title = String(form.get('title') || '').trim();
  const subjectId = selectedQuestionLibrarySubjectId;
  if (!subjectId || !title || !file || !file.size) {
    message('#questionFileMessage', 'اكتب عنوان الملف وحدد ملف PDF.');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    message('#questionFileMessage', 'يسمح برفع ملفات PDF فقط.');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    message('#questionFileMessage', 'حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).');
    return;
  }
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  message('#questionFileMessage', 'جارٍ رفع ملف PDF...');
  try {
    const uploadUrl = new URL(API_BASE + '/api/admin/question-files/library/' + encodeURIComponent(subjectId));
    uploadUrl.searchParams.set('title_b64', adminBase64Url(title));
    uploadUrl.searchParams.set('filename_b64', adminBase64Url(file.name));
    const response = await fetch(uploadUrl.toString(), {
      method: 'POST', credentials: 'include',
      headers: {'content-type': 'application/pdf', ...(getAuthToken() ? {authorization: `Bearer ${getAuthToken()}`} : {})}, body: file
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'تعذر رفع ملف PDF.');
    message('#questionFileMessage', 'تمت إضافة ملف PDF بنجاح.');
    toast('تمت إضافة الملف إلى المادة.');
    event.currentTarget.reset();
    await Promise.all([loadAdminQuestionFiles(), loadAdminQuestionSubjects()]);
  } catch (error) {
    message('#questionFileMessage', error.message);
  } finally {
    button.disabled = false;
  }
});

async function loadUsers() {
  try {
    const result = await api('/api/admin/users');
    const target = $('#adminUsersList');
    if (!result.items?.length) {
      target.innerHTML = '<div class="empty-state">لا يوجد مستخدمون.</div>';
      return;
    }
    target.innerHTML = result.items.map(user => `
      <article class="management-card user-row">
        <div><b>${esc(user.full_name)}</b><small>${esc(user.email)} · ${user.role === 'admin' ? 'أدمن' : 'طالب'}</small></div>
        <div class="management-actions">
          <span class="status ${user.is_active ? 'approved' : 'rejected'}">${user.is_active ? 'نشط' : 'معطّل'}</span>
          <button class="btn btn-small btn-save" data-toggle-user="${esc(user.id)}" data-active="${user.is_active ? '1' : '0'}">${user.is_active ? 'تعطيل' : 'تفعيل'}</button>
          ${user.id === adminUser.id ? '' : `<button class="btn btn-small btn-delete" data-delete-user="${esc(user.id)}">حذف</button>`}
        </div>
      </article>
    `).join('');
  } catch (error) {
    $('#adminUsersList').textContent = error.message;
  }
}

$('#adminUsersList').addEventListener('click', async event => {
  const toggleId = event.target.dataset.toggleUser;
  const deleteId = event.target.dataset.deleteUser;
  if (toggleId) {
    const currentlyActive = event.target.dataset.active === '1';
    try {
      await api('/api/admin/users/' + encodeURIComponent(toggleId), {
        method: 'PUT', body: JSON.stringify({is_active: !currentlyActive})
      });
      toast(currentlyActive ? 'تم تعطيل الحساب.' : 'تم تفعيل الحساب.');
      await loadUsers();
    } catch (error) { toast(error.message); }
  }
  if (deleteId) {
    if (!confirm('سيتم حذف المستخدم وطلبات اشتراكه نهائياً. هل تريد المتابعة؟')) return;
    try {
      await api('/api/admin/users/' + encodeURIComponent(deleteId), {method: 'DELETE'});
      toast('تم حذف المستخدم.');
      await loadUsers();
      await loadRequests();
      await loadCourses();
    } catch (error) { toast(error.message); }
  }
});

const SITE_CONTENT_DEFAULTS = {
  site_title: 'سعي أكاديمي | Saee Academy',
  brand_name: 'سعي أكاديمي',
  subscription_contact_phone: '',
  logo_url: '',
  favicon_url: '',
  hero_eyebrow: 'تعلم بذكاء • تقدّم بثقة',
  hero_title: 'شرح موادك الجامعية،',
  hero_emphasis: 'بطريقة أوضح وأسهل.',
  hero_description: 'سعي أكاديمي يجمع شروحات المواد الجامعية في مكان واحد، لتتعلم على وقتك وبالطريقة التي تناسبك.',
  home_feature_1_title: 'تعلم أسهل', home_feature_1_text: 'شرح واضح ومنظم',
  home_feature_2_title: 'تخصصات متعددة', home_feature_2_text: 'كل المواد في مكان واحد',
  home_feature_3_title: 'اشتراك مباشر', home_feature_3_text: 'تواصل وتأكيد مع الإدارة',
  cta_title: 'خلّي دراستك أكثر ترتيباً.',
  cta_description: 'أنشئ حسابك واكتشف الشروحات المتاحة لموادك الجامعية.',
  cta_button: 'أنشئ حسابك الآن ←',
  how_title: 'كيف تبدأ مع سعي أكاديمي؟',
  how_eyebrow: 'خطوات بسيطة',
  how_description: 'ثلاث خطوات تفصلك عن الوصول إلى الشرح الذي تحتاجه.',
  step_1_title: 'أنشئ حسابك', step_1_text: 'سجّل دخولك لتصفح التخصصات والمواد المتاحة.',
  step_2_title: 'اختر المادة', step_2_text: 'ابحث عن المادة، وتعرّف على الشارح وعدد الفيديوهات والسعر وعدد المسجلين.',
  step_3_title: 'اطلب الاشتراك', step_3_text: 'أرسل طلبك، وبعد تأكيد الدفع وتفعيل الاشتراك ابدأ المشاهدة.',
  footer_text: 'جميع الحقوق محفوظة.'
};

async function loadSiteContent() {
  const form = $('#siteContentForm');
  Object.entries(SITE_CONTENT_DEFAULTS).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (input) input.value = value;
  });
  try {
    const result = await api('/api/site-content');
    const values = result.items || {};
    Object.entries(values).forEach(([key, value]) => {
      const input = form.elements.namedItem(key);
      if (input) input.value = value;
    });
  } catch (error) {
    message('#siteContentMessage', 'تعذر تحميل نصوص الموقع: ' + error.message);
  }
}

$('#siteContentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  button.disabled = true;
  message('#siteContentMessage', '');
  try {
    const result = await api('/api/admin/site-content', {method: 'PUT', body: JSON.stringify(data)});
    if (!result || result.ok !== true || Number(result.saved) < 1) {
      throw new Error('لم يتم حفظ أي حقل. تحقق من البيانات ثم حاول مرة أخرى.');
    }
    message('#siteContentMessage', `تم حفظ محتوى الموقع بنجاح (${result.saved} حقلاً).`);
    toast('تم حفظ محتوى الموقع بنجاح.');
  } catch (error) {
    message('#siteContentMessage', error.message);
  } finally {
    button.disabled = false;
  }
});

$('#refreshRequests').addEventListener('click', loadRequests);
$('#refreshCourses').addEventListener('click', loadCourses);
$('#refreshSpecializations').addEventListener('click', loadSpecializations);
$('#refreshVideos').addEventListener('click', loadVideos);
$('#refreshUsers').addEventListener('click', loadUsers);

checkAdmin();
