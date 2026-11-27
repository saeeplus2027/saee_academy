const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const API_BASE = (window.SAEE_API_BASE || '').replace(/\/$/, '');
const page = document.body.dataset.page || 'home';
let currentUser = null;
let courses = [];
let specializations = [];
let selectedCourse = null;
let myEnrollments = new Map();

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

function setMyEnrollments(items = []) {
  myEnrollments = new Map((Array.isArray(items) ? items : []).map(item => [item.course_id, item]));
}

function getEnrollmentState(courseId) {
  const item = myEnrollments.get(courseId);
  if (!item) return null;
  if (item.status === 'approved' && item.expires_at) {
    const expiry = Date.parse(item.expires_at);
    if (Number.isFinite(expiry) && expiry <= Date.now()) return {...item, display_status: 'expired'};
  }
  return {...item, display_status: item.status};
}

function formatJordanDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-JO', {dateStyle: 'medium'}).format(date);
}

function enrollmentStatusMarkup(courseId, compact = false) {
  const item = getEnrollmentState(courseId);
  if (!item) return '';
  const status = item.display_status;
  const labels = {
    pending: 'طلبك قيد المراجعة',
    approved: 'تم قبول اشتراكك',
    rejected: 'تم رفض طلب الاشتراك',
    expired: 'انتهى الاشتراك'
  };
  const classes = {pending: 'pending', approved: 'approved', rejected: 'rejected', expired: 'expired'};
  const expiryText = status === 'approved' && item.expires_at
    ? ` · صالح حتى ${formatJordanDate(item.expires_at)}`
    : '';
  return `<div class="enrollment-status ${classes[status] || ''}${compact ? ' compact' : ''}">${labels[status] || 'حالة الاشتراك غير معروفة'}${expiryText}</div>`;
}

function enrollmentActionMarkup(courseId) {
  const item = getEnrollmentState(courseId);
  const status = item?.display_status;
  if (status === 'pending') {
    return '<button class="btn btn-outline btn-lg" disabled>طلب الاشتراك قيد المراجعة</button>';
  }
  if (status === 'approved') {
    return '<a class="btn btn-primary btn-lg" href="#courseContent">عرض محتوى المادة</a>';
  }
  if (status === 'rejected') {
    return '<button id="courseEnrollButton" class="btn btn-primary btn-lg">إعادة طلب الاشتراك</button>';
  }
  if (status === 'expired') {
    return '<button id="courseEnrollButton" class="btn btn-primary btn-lg">تجديد الاشتراك</button>';
  }
  return '<button id="courseEnrollButton" class="btn btn-primary btn-lg">طلب الاشتراك في المادة</button>';
}

async function refreshMyEnrollments() {
  const result = await api('/api/my/enrollments', {cache: 'no-store'});
  setMyEnrollments(result.items || []);
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
      closeModals();
      event.currentTarget.reset();
      await refreshUser();
      toast(mode === 'register' ? 'تم إنشاء حسابك وتسجيل دخولك بنجاح.' : 'أهلاً بك في سعي أكاديمي.');
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
      api('/api/courses', {cache: 'no-store'}),
      api('/api/specializations', {cache: 'no-store'})
    ]);
    courses = courseData.items || [];
    specializations = specData.items || [];
    try { await refreshMyEnrollments(); } catch { setMyEnrollments([]); }
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
      ${enrollmentStatusMarkup(course.id, true)}
      <a class="btn btn-outline course-open" href="course.html?id=${encodeURIComponent(course.id)}">${getEnrollmentState(course.id)?.display_status === 'approved' ? 'عرض محتوى المادة' : 'عرض صفحة المادة'}</a>
    </article>
  `).join('');
}

async function getSubscriptionContactMarkup() {
  let phone = '';
  try {
    const result = await api('/api/site-content', {cache: 'no-store'});
    phone = String(result.items?.subscription_contact_phone || '').trim();
  } catch {}
  if (!phone) {
    return `<div class="subscription-contact-card"><b>للاستفسار والاشتراك تواصل على الرقم التالي</b><span class="subscription-contact-missing">سيتم إضافة رقم التواصل قريباً.</span></div>`;
  }
  const safePhone = escapeHtml(phone);
  const telPhone = phone.replace(/[^+\d]/g, '');
  return `<div class="subscription-contact-card"><b>للاستفسار والاشتراك تواصل على الرقم التالي</b><a class="subscription-contact-number" href="tel:${escapeHtml(telPhone)}" dir="ltr">${safePhone}</a></div>`;
}

async function loadCourseDetail() {
  const courseId = new URLSearchParams(location.search).get('id');
  const target = $('#coursePage');
  if (!courseId) {
    target.innerHTML = '<div class="empty-state">لم يتم تحديد المادة.</div>';
    return;
  }
  try {
    const [data] = await Promise.all([
      api('/api/courses', {cache: 'no-store'}),
      refreshMyEnrollments()
    ]);
    courses = data.items || [];
    selectedCourse = courses.find(item => item.id === courseId);
    if (!selectedCourse) {
      target.innerHTML = '<div class="empty-state">المادة غير موجودة أو غير منشورة.</div>';
      return;
    }

    const c = selectedCourse;
    const enrollment = getEnrollmentState(c.id);
    const isApproved = enrollment?.display_status === 'approved';
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
        ${isApproved ? `
          <div class="enrollment-status approved">اشتراكك مقبول وفعّال${enrollment.expires_at ? ` · صالح حتى ${formatJordanDate(enrollment.expires_at)}` : ''}</div>
          <a class="btn btn-primary btn-lg course-content-jump" href="#courseContent">عرض محتوى المادة</a>
        ` : `
          ${enrollmentStatusMarkup(c.id)}
          ${await getSubscriptionContactMarkup()}
        `}
        <a class="text-link" href="courses.html">العودة إلى المواد</a>
      </div>
      ${isApproved ? `
        <section id="courseContent" class="course-content-section">
          <div class="course-content-heading">
            <div><span class="eyebrow">مكتبة المادة</span><h2>محتوى المادة</h2><p>شاهد الفيديو حتى نهايته ليُسجّل تلقائياً كفيديو مُنجز.</p></div>
            <div id="videoProgressSummary" class="video-progress-summary">جارٍ تحميل الفيديوهات...</div>
          </div>
          <div id="courseVideoWorkspace" class="course-video-workspace"><div class="empty-state">جارٍ تحميل محتوى المادة...</div></div>
        </section>
      ` : ''}
    `;
    if (isApproved) {
      await loadCourseVideos(c.id);
    }
  } catch (error) {
    target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

let courseVideos = [];
let activeVideoId = null;

async function loadCourseVideos(courseId) {
  const workspace = $('#courseVideoWorkspace');
  if (!workspace) return;
  try {
    const result = await api(`/api/course-content/${encodeURIComponent(courseId)}`, {cache: 'no-store'});
    courseVideos = result.items || [];
    activeVideoId = courseVideos[0]?.id || null;
    renderCourseVideoWorkspace();
    if (activeVideoId) selectCourseVideo(activeVideoId, false);
  } catch (error) {
    workspace.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderCourseVideoWorkspace() {
  const workspace = $('#courseVideoWorkspace');
  if (!workspace) return;
  const completedCount = courseVideos.filter(video => Number(video.completed) === 1 || video.completed === true).length;
  const total = courseVideos.length;
  const summary = $('#videoProgressSummary');
  if (summary) summary.textContent = total ? `${completedCount} من ${total} فيديو مُنجز` : 'لا توجد فيديوهات بعد';

  if (!total) {
    workspace.innerHTML = '<div class="empty-state">لم تُضف فيديوهات لهذه المادة بعد. ستظهر هنا عند رفعها من لوحة الإدارة.</div>';
    return;
  }

  workspace.innerHTML = `
    <div class="course-video-list" id="courseVideoList">
      ${courseVideos.map((video, index) => {
        const completed = Number(video.completed) === 1 || video.completed === true;
        return `
          <div class="course-video-item ${video.id === activeVideoId ? 'active' : ''}" data-video-row="${escapeHtml(video.id)}">
            <button type="button" class="course-video-select" data-play-video="${escapeHtml(video.id)}">
              <span class="course-video-number">${index + 1}</span>
              <span class="course-video-title"><b>${escapeHtml(video.title)}</b><small>فيديو ${index + 1}</small></span>
            </button>
            <button type="button" class="video-completion-button ${completed ? 'done' : ''}" data-toggle-complete="${escapeHtml(video.id)}" aria-pressed="${completed ? 'true' : 'false'}">${completed ? '✓ منجز' : 'إنجاز'}</button>
          </div>
        `;
      }).join('')}
    </div>
    <div class="course-video-player-panel">
      <div class="course-video-now" id="courseVideoNow">اختر فيديو لبدء المشاهدة</div>
      <video id="courseVideoPlayer" class="course-video-player" controls controlsList="nodownload" disablePictureInPicture playsinline crossorigin="use-credentials" preload="metadata"></video>
      <p id="courseVideoMessage" class="course-video-message" role="status">يُحتسب الفيديو مُنجزاً تلقائياً عند الوصول إلى نهايته.</p>
    </div>
  `;

  $('#courseVideoList')?.addEventListener('click', async event => {
    const completeButton = event.target.closest('[data-toggle-complete]');
    if (completeButton) {
      event.preventDefault();
      event.stopPropagation();
      await toggleCourseVideoComplete(completeButton.dataset.toggleComplete);
      return;
    }
    const button = event.target.closest('[data-play-video]');
    if (button) selectCourseVideo(button.dataset.playVideo, true);
  });
}

function selectCourseVideo(videoId, autoplay = true) {
  const video = courseVideos.find(item => item.id === videoId);
  const player = $('#courseVideoPlayer');
  if (!video || !player) return;
  activeVideoId = videoId;
  $$('#courseVideoList [data-play-video]').forEach(button => {
    button.classList.toggle('active', button.dataset.playVideo === videoId);
  });
  $('#courseVideoNow').textContent = video.title;
  const message = $('#courseVideoMessage');
  message.textContent = (Number(video.completed) === 1 || video.completed === true)
    ? '✓ هذا الفيديو مُنجز سابقاً.'
    : 'شاهد الفيديو حتى نهايته ليُسجّل كفيديو مُنجز.';
  // The media is served from the Cloudflare Worker origin; send the session cookie.
  player.crossOrigin = 'use-credentials';
  player.onended = null;
  player.setAttribute('controlsList', 'nodownload');
  player.setAttribute('disablePictureInPicture', '');
  player.oncontextmenu = event => event.preventDefault();
  player.onerror = () => {
    if ($('#courseVideoMessage')) $('#courseVideoMessage').textContent = 'تعذر تشغيل الفيديو. حدّث الصفحة أو تواصل مع الإدارة.';
  };
  player.src = `${API_BASE}/api/watch/${encodeURIComponent(videoId)}`;
  player.load();
  if (autoplay) {
    const playPromise = player.play();
    if (playPromise?.catch) playPromise.catch(() => {
      if ($('#courseVideoMessage')) $('#courseVideoMessage').textContent = 'اضغط تشغيل لبدء الفيديو.';
    });
  }
}

async function toggleCourseVideoComplete(videoId) {
  const video = courseVideos.find(item => item.id === videoId);
  if (!video) return;
  const wasCompleted = Number(video.completed) === 1 || video.completed === true;
  const button = $(`[data-toggle-complete="${CSS.escape(videoId)}"]`);
  if (button) button.disabled = true;
  try {
    await api(`/api/watch/${encodeURIComponent(videoId)}/complete`, {
      method: wasCompleted ? 'DELETE' : 'POST'
    });
    video.completed = wasCompleted ? 0 : 1;
    video.completed_at = wasCompleted ? null : new Date().toISOString();
    renderCourseVideoWorkspace();
    selectCourseVideo(activeVideoId, false);
    const message = $('#courseVideoMessage');
    if (message) message.textContent = wasCompleted ? 'تم إلغاء إنجاز الفيديو.' : '✓ تم تسجيل الفيديو كمنجز في حسابك.';
    toast(wasCompleted ? 'تم إلغاء الإنجاز.' : 'تم تسجيل إنجاز الفيديو.');
  } catch (error) {
    if (button) button.disabled = false;
    const message = $('#courseVideoMessage');
    if (message) message.textContent = `لم يتم حفظ الإنجاز: ${error.message}`;
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
    // A request may already have been accepted by the admin on another page.
    // Refresh the authoritative status before displaying a generic conflict.
    try {
      await loadCourseDetail();
      const current = getEnrollmentState(selectedCourse.id);
      if (current && ['pending', 'approved', 'expired', 'rejected'].includes(current.display_status)) {
        message.textContent = current.display_status === 'approved'
          ? 'تم قبول اشتراكك بالفعل.'
          : current.display_status === 'pending'
            ? 'طلبك ما زال قيد المراجعة.'
            : error.message;
      } else {
        message.textContent = error.message;
      }
    } catch {
      message.textContent = error.message;
    }
  } finally {
    if ($('#courseEnrollButton')) $('#courseEnrollButton').disabled = false;
  }
}

function initializePage() {
  // Refresh the student's server-side enrollment status periodically. When an
  // admin approves a pending request, the course page switches to its videos.
  window.setInterval(async () => {
    if (!currentUser || document.visibilityState !== 'visible') return;
    try {
      const previous = JSON.stringify([...myEnrollments.entries()]);
      await refreshMyEnrollments();
      const changed = previous !== JSON.stringify([...myEnrollments.entries()]);
      if (changed) {
        if (page === 'courses') renderCourses();
        if (page === 'course') await loadCourseDetail();
      }
    } catch {}
  }, 30000);

  $('#specializationSearch')?.addEventListener('input', renderSpecializations);
  $('#courseSearch')?.addEventListener('input', renderCourses);
  $('#specializationFilter')?.addEventListener('change', renderCourses);
  setupSharedControls();
  loadSiteContent();
  refreshUser();
}

initializePage();
