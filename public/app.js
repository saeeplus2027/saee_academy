const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const API_BASE = (window.SAEE_API_BASE || '').replace(/\/$/, '');
const page = document.body.dataset.page || 'home';
let currentUser = null;
let courses = [];
let specializations = [];
let selectedCourse = null;

if ($('#year')) $('#year').textContent = new Date().getFullYear();

async function api(path, options = {}) {
  if (!API_BASE) throw new Error('إعداد الاتصال بالخادم غير موجود.');
  const headers = {
    ...(options.body && typeof options.body === 'string' ? {'content-type': 'application/json'} : {}),
    ...(options.headers || {})
  };
  let response;
  try {
    response = await fetch(API_BASE + path, {
      credentials: 'include',
      ...options,
      headers
    });
  } catch {
    throw new Error('تعذر الاتصال بخادم سعي أكاديمي. تحقق من اتصال الخادم.');
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ الطلب.');
  return data;
}

function toast(message) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function openAuth(mode = 'login') {
  const modal = $('#authModal');
  if (!modal) return;
  modal.dataset.mode = mode;
  $('#authTitle').textContent = mode === 'login' ? 'أهلاً بعودتك' : 'أنشئ حسابك';
  $('#authSubtitle').textContent = mode === 'login'
    ? 'سجّل الدخول لمتابعة رحلتك التعليمية.'
    : 'ابدأ رحلتك التعليمية مع سعي أكاديمي.';
  $('#nameField').classList.toggle('hidden', mode === 'login');
  $('#nameField input').required = mode === 'register';
  $('#authSubmit').textContent = mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب';
  $('#switchAuth').textContent = mode === 'login'
    ? 'ليس لديك حساب؟ أنشئ حساباً'
    : 'لديك حساب؟ سجّل الدخول';
  $('#authError').textContent = '';
  modal.classList.remove('hidden');
}

function closeModals() {
  $$('.modal').forEach(modal => modal.classList.add('hidden'));
}

function updateNavigation() {
  const loggedIn = Boolean(currentUser);
  $('#loginOpen')?.classList.toggle('hidden', loggedIn);
  $('#registerOpen')?.classList.toggle('hidden', loggedIn);
  $('#profileArea')?.classList.toggle('hidden', !loggedIn);
  if ($('#userLabel')) $('#userLabel').textContent = loggedIn ? `مرحباً، ${currentUser.full_name}` : '';
  if ($('#profileEmail')) $('#profileEmail').textContent = currentUser?.email || '';
  $('#adminPageLink')?.classList.toggle('hidden', currentUser?.role !== 'admin');
  $$('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === page));
}

function closeProfileDropdown() {
  $('#profileDropdown')?.classList.add('hidden');
  $('#profileMenuButton')?.setAttribute('aria-expanded', 'false');
}

function setupSharedControls() {
  $('#loginOpen')?.addEventListener('click', () => openAuth('login'));
  $('#registerOpen')?.addEventListener('click', () => openAuth('register'));
  $('#ctaRegister')?.addEventListener('click', () => openAuth('register'));
  $('#profileMenuButton')?.addEventListener('click', () => {
    const dropdown = $('#profileDropdown');
    if (!dropdown) return;
    const show = dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', !show);
    $('#profileMenuButton').setAttribute('aria-expanded', String(show));
  });
  $('#editProfileOpen')?.addEventListener('click', () => {
    closeProfileDropdown();
    if ($('#profileNameInput')) $('#profileNameInput').value = currentUser?.full_name || '';
    $('#profileError').textContent = '';
    $('#deleteAccountError').textContent = '';
    $('#profileModal')?.classList.remove('hidden');
  });
  $('#profileLogout')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', {method: 'POST'}); } catch {}
    currentUser = null;
    updateNavigation();
    closeProfileDropdown();
    toast('تم تسجيل الخروج.');
    if (document.body.dataset.requiresAuth === 'true') openAuth('login');
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.profile-area')) closeProfileDropdown();
  });
  $$('[data-close="1"]').forEach(element => element.addEventListener('click', closeModals));

  $('#switchAuth')?.addEventListener('click', () => {
    const mode = $('#authModal').dataset.mode === 'login' ? 'register' : 'login';
    openAuth(mode);
  });

  $('#authForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#authSubmit');
    const mode = $('#authModal').dataset.mode || 'login';
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    button.disabled = true;
    $('#authError').textContent = '';
    try {
      await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST', body: JSON.stringify(body)
      });
      if (mode === 'register') {
        toast('تم إنشاء الحساب بنجاح. سجّل الدخول الآن.');
        event.currentTarget.reset();
        openAuth('login');
      } else {
        closeModals();
        await refreshUser();
        toast('أهلاً بك في سعي أكاديمي.');
      }
    } catch (error) {
      $('#authError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $('#profileForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#profileSave');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    button.disabled = true;
    $('#profileError').textContent = '';
    try {
      const result = await api('/api/account', {method: 'PUT', body: JSON.stringify(body)});
      currentUser = result.user;
      updateNavigation();
      event.currentTarget.reset();
      if ($('#profileNameInput')) $('#profileNameInput').value = currentUser.full_name;
      toast('تم حفظ تعديلات الحساب.');
    } catch (error) {
      $('#profileError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $('#deleteAccountForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!confirm('هل أنت متأكد من حذف حسابك نهائياً؟ سيتم حذف طلبات اشتراكك أيضاً.')) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    button.disabled = true;
    $('#deleteAccountError').textContent = '';
    try {
      await api('/api/account', {method: 'DELETE', body: JSON.stringify(body)});
      currentUser = null;
      closeModals();
      updateNavigation();
      toast('تم حذف الحساب نهائياً.');
      location.href = 'index.html';
    } catch (error) {
      $('#deleteAccountError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function loadSiteContent() {
  try {
    const result = await api('/api/site-content');
    const values = result.items || {};
    $$('[data-content-key]').forEach(element => {
      const key = element.dataset.contentKey;
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        element.textContent = values[key];
      }
    });
    if (values.site_title) document.title = values.site_title;
    if (values.logo_url) {
      $$('[data-content-image="logo_url"]').forEach(image => { image.src = values.logo_url; });
    }
    if (values.favicon_url) {
      ['#siteFavicon', '#siteAppleIcon'].forEach(selector => {
        const icon = $(selector);
        if (icon) icon.href = values.favicon_url;
      });
    }
  } catch {
    // Static copy remains visible if the content table has not been migrated yet.
  }
}

async function refreshUser() {
  try {
    const result = await api('/api/auth/me');
    currentUser = result.user || null;
  } catch {
    currentUser = null;
  }
  updateNavigation();

  if (!currentUser && document.body.dataset.requiresAuth === 'true') {
    setProtectedPageMessage('سجّل الدخول أولاً لعرض هذا القسم.');
    openAuth('login');
    return;
  }
  if (currentUser) await loadProtectedPage();
}

function setProtectedPageMessage(message) {
  const target = $('#specializationGrid') || $('#courseGrid') || $('#coursePage');
  if (target) target.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

async function loadProtectedPage() {
  if (page === 'specializations') await loadSpecializations();
  if (page === 'courses') await loadCourses();
  if (page === 'course') await loadCourseDetail();
}

async function loadSpecializations() {
  try {
    const result = await api('/api/specializations');
    specializations = result.items || [];
    renderSpecializations();
  } catch (error) {
    $('#specializationGrid').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderSpecializations() {
  const search = ($('#specializationSearch')?.value || '').trim().toLocaleLowerCase();
  const items = specializations.filter(item =>
    `${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(search)
  );
  const grid = $('#specializationGrid');
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state">لا توجد تخصصات تطابق البحث.</div>';
    return;
  }
  grid.innerHTML = items.map((item, index) => `
    <a class="specialization-card" href="courses.html?specialization=${encodeURIComponent(item.id)}">
      <span class="spec-icon">${['⌘','⌬','⌑','✧'][index % 4]}</span>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${Number(item.course_count || 0)} مادة متاحة · افتح التخصص ←</p>
    </a>
  `).join('');
}

async function loadCourses() {
  try {
    const [courseData, specData] = await Promise.all([
      api('/api/courses'), api('/api/specializations')
    ]);
    courses = courseData.items || [];
    specializations = specData.items || [];
    const filter = $('#specializationFilter');
    if (filter) {
      filter.innerHTML = '<option value="">كل التخصصات</option>' + specializations.map(item =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
      ).join('');
      const requestedSpec = new URLSearchParams(location.search).get('specialization');
      if (requestedSpec) filter.value = requestedSpec;
    }
    renderCourses();
  } catch (error) {
    $('#courseGrid').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderCourses() {
  const term = ($('#courseSearch')?.value || '').trim().toLocaleLowerCase();
  const specId = $('#specializationFilter')?.value || '';
  const filtered = courses.filter(course =>
    (!specId || course.specialization_id === specId) &&
    (!term || `${course.name} ${course.specialization_name} ${course.instructor_name}`.toLocaleLowerCase().includes(term))
  );
  const grid = $('#courseGrid');
  if (!grid) return;
  if ($('#courseHint')) $('#courseHint').textContent = `عدد المواد المعروضة: ${filtered.length}`;
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">لا توجد مواد تطابق البحث حالياً.</div>';
    return;
  }
  grid.innerHTML = filtered.map(course => `
    <article class="course-card">
      <span class="tag">${escapeHtml(course.specialization_name)}</span>
      <h3>${escapeHtml(course.name)}</h3>
      <p>الشرح مع: ${escapeHtml(course.instructor_name)}</p>
      <div class="course-meta">
        <span>▶ ${Number(course.video_count || 0)} فيديو</span>
        <span class="course-price">${Number(course.price_jod).toFixed(2)} د.أ</span>
      </div>
      <div class="enrollment-count">👥 ${Number(course.enrollment_count || 0)} مسجل</div>
      <a class="btn btn-outline course-open" href="course.html?id=${encodeURIComponent(course.id)}">عرض صفحة المادة</a>
    </article>
  `).join('');
}

async function loadCourseDetail() {
  const courseId = new URLSearchParams(location.search).get('id');
  const target = $('#coursePage');
  if (!courseId) {
    target.innerHTML = '<div class="empty-state">لم يتم تحديد المادة.</div>';
    return;
  }
  try {
    const data = await api('/api/courses');
    courses = data.items || [];
    selectedCourse = courses.find(item => item.id === courseId);
    if (!selectedCourse) {
      target.innerHTML = '<div class="empty-state">المادة غير موجودة أو غير منشورة.</div>';
      return;
    }
    const c = selectedCourse;
    target.innerHTML = `
      <div class="course-detail-card">
        <span class="tag">${escapeHtml(c.specialization_name)}</span>
        <h1>${escapeHtml(c.name)}</h1>
        <p class="course-instructor">الشرح مع: <b>${escapeHtml(c.instructor_name)}</b></p>
        <p class="course-description">${escapeHtml(c.description || 'شرح جامعي منظم يساعدك على فهم المادة ومراجعتها.')}</p>
        <div class="detail-stats">
          <div><small>عدد الفيديوهات</small><b>${Number(c.video_count || 0)}</b></div>
          <div><small>عدد المسجلين</small><b>${Number(c.enrollment_count || 0)}</b></div>
          <div><small>السعر</small><b>${Number(c.price_jod).toFixed(2)} د.أ</b></div>
        </div>
        <button id="courseEnrollButton" class="btn btn-primary btn-lg">طلب الاشتراك في المادة</button>
        <p id="courseEnrollMessage" class="form-error" role="status"></p>
        <a class="text-link" href="courses.html">العودة إلى المواد</a>
      </div>
    `;
    $('#courseEnrollButton').addEventListener('click', requestEnrollment);
  } catch (error) {
    target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function requestEnrollment() {
  if (!selectedCourse) return;
  const button = $('#courseEnrollButton');
  const message = $('#courseEnrollMessage');
  button.disabled = true;
  message.textContent = '';
  try {
    const result = await api('/api/enrollments', {
      method: 'POST',
      body: JSON.stringify({course_id: selectedCourse.id})
    });
    toast('تم إرسال طلب الاشتراك بنجاح.');
    await loadCourseDetail();
    const refreshedMessage = $('#courseEnrollMessage');
    if (refreshedMessage) refreshedMessage.textContent = result.message || 'تم إرسال طلب الاشتراك.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    if ($('#courseEnrollButton')) $('#courseEnrollButton').disabled = false;
  }
}

function initializePage() {
  $('#specializationSearch')?.addEventListener('input', renderSpecializations);
  $('#courseSearch')?.addEventListener('input', renderCourses);
  $('#specializationFilter')?.addEventListener('change', renderCourses);
  setupSharedControls();
  loadSiteContent();
  refreshUser();
}

initializePage();
