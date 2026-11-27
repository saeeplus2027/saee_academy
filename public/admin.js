const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const API_BASE = (window.SAEE_API_BASE || '').replace(/\/$/, '');
let adminUser = null;
let adminCourses = [];
let adminSpecializations = [];

async function api(path, options = {}) {
  if (!API_BASE) throw new Error('إعداد عنوان الخادم غير موجود.');
  const headers = {
    ...(options.body && typeof options.body === 'string' ? {'content-type': 'application/json'} : {}),
    ...(options.headers || {})
  };
  let response;
  try {
    response = await fetch(API_BASE + path, {credentials: 'include', ...options, headers});
  } catch {
    throw new Error('تعذر الاتصال بخادم سعي أكاديمي.');
  }
  let data = {};
  try { data = await response.json(); } catch {}
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
  try {
    await api('/api/auth/login', {method: 'POST', body: JSON.stringify(body)});
    const result = await api('/api/auth/me');
    if (result.user?.role !== 'admin') {
      await api('/api/auth/logout', {method: 'POST'});
      throw new Error('هذا الحساب ليس حساب أدمن.');
    }
    adminUser = result.user;
    showDashboard();
  } catch (error) {
    message('#loginError', error.message);
  } finally {
    button.disabled = false;
  }
});

$('#adminLogout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', {method: 'POST'}); } catch {}
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
    message('#specializationMessage', 'تمت إضافة التخصص.');
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
    message('#courseMessage', 'تمت إضافة المادة.');
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
    if (!confirm('سيتم حذف المادة وطلبات الاشتراك وفيديوهاتها من التخزين. هل تريد المتابعة؟')) return;
    try {
      await api('/api/admin/courses/' + encodeURIComponent(deleteId), {method: 'DELETE'});
      toast('تم حذف المادة وملفات فيديوهاتها.');
      await loadCourses();
      await loadRequests();
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
          ${request.status === 'pending' ? `<input type="number" min="1" max="3650" value="30" aria-label="مدة الاشتراك بالأيام"><button class="btn btn-small btn-accept">قبول</button><button class="btn btn-small btn-reject">رفض</button>` : ''}
        </div>`;
      if (request.status === 'pending') {
        card.querySelector('.btn-accept').addEventListener('click', () => decideRequest(request.id, 'approve', Number(card.querySelector('input').value)));
        card.querySelector('.btn-reject').addEventListener('click', () => decideRequest(request.id, 'reject'));
      }
      target.append(card);
    });
  } catch (error) {
    $('#requestsList').textContent = error.message;
  }
}

async function decideRequest(id, action, days = 30) {
  try {
    await api('/api/admin/requests/' + encodeURIComponent(id), {
      method: 'POST', body: JSON.stringify({action, duration_days: days})
    });
    toast(action === 'approve' ? 'تم قبول الطلب وتفعيل الاشتراك.' : 'تم رفض الطلب.');
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
    const response = await fetch(API_BASE + '/api/admin/videos/' + encodeURIComponent(form.get('course_id')), {
      method: 'POST', credentials: 'include',
      headers: {'content-type': file.type || 'video/mp4', 'x-video-title': encodeURIComponent(String(form.get('title') || '').trim())},
      body: file
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'تعذر رفع الفيديو.');
    message('#videoMessage', `تم رفع الفيديو بنجاح. ترتيبه: ${data.position}.`);
    event.currentTarget.reset();
    await loadVideos();
    await loadCourses();
  } catch (error) {
    message('#videoMessage', error.message);
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
    message('#siteContentMessage', `تم حفظ ${result.saved} حقلاً. حدّث الموقع لرؤية التعديلات.`);
    toast('تم تحديث محتوى الموقع.');
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
