import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { arSA } from '@clerk/localizations';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  ArrowLeft, ArrowUpLeft, BookOpen, Check, ChevronDown, CircleHelp, Clock3, GraduationCap,
  Layers3, LockKeyhole, LogOut, Menu, Search, ShieldCheck, Sparkles, Users, Video, X,
} from 'lucide-react';
import {
  getGetAdminSummaryQueryKey, getGetCourseLessonsQueryKey, getGetCourseQueryKey,
  getGetCurrentUserQueryKey, getListAdminRequestsQueryKey, getListCoursesQueryKey,
  getListMajorsQueryKey, getListMyRequestsQueryKey, useCreateCourse, useGetAdminSummary,
  useGetCourse, useGetCourseLessons, useGetCurrentUser, useListAdminRequests,
  useListCourses, useListMajors, useListMyRequests, useRequestCourseSubscription,
  useReviewSubscriptionRequest, useUpdateCourse,
} from '@workspace/api-client-react';
import type { Course, CourseInput, CourseLesson, SubscriptionRequest } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 25_000 } } });
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const signInPath = `${base}/sign-in`;
const signUpPath = `${base}/sign-up`;
const signInRoute = '/sign-in';
const signUpRoute = '/sign-up';

function Logo({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="العودة إلى سعي أكاديمي">
    <img src={`${base}/logo.svg`} alt="" />
    {!compact && <span>سعي <b>أكاديمي</b></span>}
  </Link>;
}

function App() {
  const key = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  return <WouterRouter base={base}>
    <ClerkApplication publishableKey={key} />
  </WouterRouter>;
}

function ClerkApplication({ publishableKey }: { publishableKey: string }) {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={publishableKey}
    proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL}
    appearance={clerkAppearance}
    localization={arabicLocalization}
    signInUrl={signInPath}
    signUpUrl={signUpPath}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
        <div dir="rtl" className="grain min-h-[100dvh]">
          <AppShell />
        </div>
    </QueryClientProvider>
  </ClerkProvider>;
}

function stripBase(path: string): string {
  return base && path.startsWith(base) ? path.slice(base.length) || '/' : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      client.clear();
    }
    previousUserId.current = userId;
  }), [addListener, client]);

  return null;
}

function AppShell() {
  const { isSignedIn, isLoaded } = useAuth();
  const { signOut } = useClerk();
  const [location, setLocation] = useLocation();
  const profile = useGetCurrentUser({ query: { enabled: Boolean(isSignedIn), queryKey: getGetCurrentUserQueryKey() } });
  const user = profile.data;
  const [mobileMenu, setMobileMenu] = useState(false);
  const isAuth = location.startsWith('/sign-in') || location.startsWith('/sign-up');
  const protectedPath = ['/courses', '/my-requests', '/admin'].some((path) => location.startsWith(path)) || location.startsWith('/course/');

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn && protectedPath) setLocation(`${signInRoute}?redirect_url=${encodeURIComponent(location)}`);
    if (isSignedIn && location === '/') setLocation('/courses');
  }, [isLoaded, isSignedIn, location, protectedPath, setLocation]);
  useEffect(() => setMobileMenu(false), [location]);
  return <div className="min-h-[100dvh]">
    {!isAuth && <header className="topbar">
      <div className="topbar-inner">
        <Logo />
        <nav className={`nav-links ${mobileMenu ? 'nav-open' : ''}`} aria-label="التنقل الرئيسي">
          <Link href="/" className={location === '/' ? 'nav-link active' : 'nav-link'}>الرئيسية</Link>
          {isSignedIn && <Link href="/courses" className={location.startsWith('/courses') || location.startsWith('/course/') ? 'nav-link active' : 'nav-link'}>المواد</Link>}
          {isSignedIn && <Link href="/my-requests" className={location.startsWith('/my-requests') ? 'nav-link active' : 'nav-link'}>طلباتي</Link>}
          {user?.isAdmin && <Link href="/admin" className={location.startsWith('/admin') ? 'nav-link active' : 'nav-link'}>لوحة الإدارة</Link>}
        </nav>
        <div className="nav-actions">
          {isLoaded && isSignedIn ? <>
            <span className="welcome-name">{user?.name || 'أهلاً بك'}</span>
            <button className="icon-button signout" type="button" onClick={() => signOut({ redirectUrl: base || '/' })} aria-label="تسجيل الخروج" data-testid="button-sign-out"><LogOut size={18}/></button>
          </> : <>
            <Link href={signInRoute} className="text-button">تسجيل الدخول</Link>
            <Link href={signUpRoute} className="button button-small">ابدأ الآن <ArrowUpLeft size={16}/></Link>
          </>}
          <button className="icon-button menu-button" type="button" aria-label="فتح القائمة" onClick={() => setMobileMenu(!mobileMenu)} data-testid="button-menu">
            {mobileMenu ? <X size={20}/> : <Menu size={20}/>}
          </button>
        </div>
      </div>
    </header>}
    <main>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/sign-in/*?" component={SignInPage}/>
        <Route path="/sign-up/*?" component={SignUpPage}/>
        <Route path="/courses" component={CatalogPage}/>
        <Route path="/course/:courseId" component={CoursePage}/>
        <Route path="/my-requests" component={RequestsPage}/>
        <Route path="/admin" component={AdminPage}/>
        <Route component={NotFound}/>
      </Switch>
    </main>
    {!isAuth && <Footer />}
  </div>;
}

function Landing() {
  return <div className="page-enter">
    <section className="hero wrap">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot"/> طريقك للفهم يبدأ من هنا</div>
        <h1>المادة الصعبة؟<br/><em>لها شرح يسهّلها.</em></h1>
        <p className="hero-lede">تعلّم على يد مدرّسين جامعيين يعرفون طريق المادة، ويشرحونها خطوة بخطوة حتى تصل للفكرة بنفسك.</p>
        <div className="hero-actions">
          <Link href={signUpRoute} className="button">اكتشف المواد <ArrowLeft size={18}/></Link>
          <Link href={signInRoute} className="quiet-link">لديك حساب؟ سجّل دخولك</Link>
        </div>
        <div className="hero-trust"><span className="trust-line"/><span>شرح واضح، من أشخاص يعرفون جامعتك</span></div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/>
        <div className="art-sun"/>
        <div className="paper-stack"><div className="paper-top"><div className="paper-lines"><i/><i/><i/><i/></div><div className="paper-diagram"><span/><span/><span/></div></div><div className="paper-page"><BookOpen size={34}/><span>ملاحظات المحاضرة</span><small>مفهوم واضح في كل مرة</small></div></div>
        <div className="art-caption"><span className="caption-mark"><Sparkles size={16}/></span><span><b>فهمك أولاً</b><small>شرح مرتب على مزاجك</small></span></div>
        <div className="art-number">١ / ٣</div>
      </div>
      <div className="hero-bottom"><span>من أول محاضرة إلى آخر فكرة</span><span className="line"/></div>
    </section>

    <section className="intro-section wrap">
      <div className="section-label">كيف تبدأ؟ <span>ثلاث خطوات بسيطة</span></div>
      <div className="steps-grid">
        <article className="step-item"><span className="step-num">٠١</span><div className="step-icon"><Search size={23}/></div><h3>اختر تخصصك</h3><p>ابحث عن مادتك من بين مواد التخصصات المتاحة.</p></article>
        <article className="step-item"><span className="step-num">٠٢</span><div className="step-icon peach"><Users size={23}/></div><h3>تعرّف على المدرّس</h3><p>اطّلع على وصف المادة واسم المدرّس قبل أن تقرر.</p></article>
        <article className="step-item"><span className="step-num">٠٣</span><div className="step-icon gold"><BookOpen size={23}/></div><h3>ابدأ رحلة الفهم</h3><p>اطلب الاشتراك، وبعد تأكيده تصلك دروسك كاملة.</p></article>
      </div>
    </section>
    <section className="feature-band">
      <div className="feature-inner wrap">
        <div className="feature-stamp"><GraduationCap size={31}/><span>تعليم<br/>أقرب إليك</span></div>
        <div><p className="eyebrow light-eyebrow">السعي يصنع الفرق</p><h2>ما تحتاجه هو<br/><em>الشرح المناسب.</em></h2></div>
        <div className="feature-note"><p>كل مادة تحمل اسم مدرّسها وتفاصيلها بوضوح. اختر ما يناسبك، وتواصل معنا لإتمام الاشتراك والدفع خارج المنصة.</p><Link href={signUpRoute} className="feature-link">ابدأ بالبحث عن مادتك <ArrowLeft size={17}/></Link></div>
        <div className="feature-decoration">سعي<br/>أكاديمي</div>
      </div>
    </section>
    <section className="closing wrap">
      <div className="closing-rule"/><span>معك خطوة بخطوة</span>
      <h2>كل فكرة واضحة،<br/><em>تقرّبك من هدفك.</em></h2>
      <Link href={signUpRoute} className="button">أنشئ حسابك وابدأ <ArrowLeft size={18}/></Link>
    </section>
  </div>;
}

function SignInPage() {
  return <AuthFrame title="أهلاً بعودتك" subtitle="سجّل دخولك لتتابع موادك وطلباتك.">
    <SignIn routing="path" path={`${base}/sign-in`} signUpUrl={signUpPath} fallbackRedirectUrl="/courses" appearance={clerkAppearance}/>
  </AuthFrame>;
}
function SignUpPage() {
  return <AuthFrame title="خطوتك الأولى تبدأ هنا" subtitle="أنشئ حساباً واكتشف شرحاً يناسبك.">
    <SignUp routing="path" path={`${base}/sign-up`} signInUrl={signInPath} fallbackRedirectUrl="/courses" appearance={clerkAppearance}/>
  </AuthFrame>;
}
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: base || '/',
    logoImageUrl: `${window.location.origin}${base}/logo.svg`,
  },
  variables: {
    colorPrimary: '#137d6c',
    colorForeground: '#23433d',
    colorMutedForeground: '#687d74',
    colorDanger: '#b65049',
    colorBackground: '#fffdf8',
    colorInput: '#ffffff',
    colorInputForeground: '#23433d',
    colorNeutral: '#23433d',
    fontFamily: "'IBM Plex Sans Arabic', sans-serif",
    borderRadius: '0.85rem',
  },
  elements: {
    rootBox: 'auth-widget', cardBox: 'auth-box', card: 'auth-card', footer: 'auth-footer', headerTitle: 'auth-clerk-title', headerSubtitle: 'auth-clerk-subtitle',
    formButtonPrimary: 'auth-submit', formFieldInput: 'auth-input', formFieldLabel: 'auth-label',
    footerActionLink: 'auth-footer-link', dividerLine: 'auth-divider', socialButtonsBlockButton: 'auth-social',
  },
};
const arabicLocalization = {
  ...arSA,
  formFieldInputPlaceholder__emailAddress: 'أدخل بريدك الإلكتروني',
  formFieldInputPlaceholder__emailAddress_username: 'أدخل بريدك الإلكتروني أو اسم المستخدم',
  formFieldInputPlaceholder__password: 'أدخل كلمة المرور',
  formFieldInputPlaceholder__signUpPassword: 'أنشئ كلمة مرور آمنة',
};
function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className="auth-page page-enter">
    <div className="auth-panel"><div className="auth-brand"><Logo/><span className="auth-label-top">مساحتك للتعلّم</span></div>
      <div className="auth-heading"><div className="eyebrow"><span className="eyebrow-dot"/> نورت سعي أكاديمي</div><h1>{title}</h1><p>{subtitle}</p></div>
      {children}
      <div className="auth-foot"><LockKeyhole size={15}/> حسابك وبياناتك في أمان</div>
    </div>
    <div className="auth-side"><div className="auth-quote-mark">“</div><p>المعرفة لا تأتي دفعة واحدة،<br/>بل بخطوة واضحة كل مرة.</p><span>سعي أكاديمي · تعلّم بفهم</span><div className="auth-side-seal"><img src={`${base}/logo.svg`} alt=""/></div></div>
  </section>;
}

function CatalogPage() {
  const [search, setSearch] = useState('');
  const [major, setMajor] = useState('');
  const params = { ...(search.trim() ? { search: search.trim() } : {}), ...(major ? { major } : {}) };
  const courses = useListCourses(params);
  const majors = useListMajors();
  return <section className="wrap page-section page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> مكتبة المواد</div><h1>أي مادة تبحث عنها؟</h1><p>اكتشف شرحاً جامعياً واضحاً من مدرّسين متخصصين.</p></div><div className="heading-note"><BookOpen size={20}/><span>اختر بتركيز،<br/>وتعلّم على مهل.</span></div></div>
    <div className="catalog-tools">
      <label className="search-box"><Search size={19}/><input aria-label="ابحث عن مادة أو مدرس" data-testid="input-course-search" placeholder="ابحث عن مادة أو مدرس..." value={search} onChange={(e) => setSearch(e.target.value)}/>{search && <button type="button" onClick={() => setSearch('')} aria-label="مسح البحث" data-testid="button-clear-search"><X size={16}/></button>}</label>
      <label className="select-wrap"><span>التخصص</span><select aria-label="تصفية حسب التخصص" data-testid="select-major" value={major} onChange={(e) => setMajor(e.target.value)}><option value="">كل التخصصات</option>{(majors.data || []).map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={17}/></label>
    </div>
    {(courses.isLoading || majors.isLoading) && <CourseSkeletons/>}
    {(courses.isError || majors.isError) && <ErrorState onRetry={() => { void courses.refetch(); void majors.refetch(); }}/>}
    {courses.data && !courses.isLoading && <>
      <div className="results-meta"><span>{courses.data.length} مادة متاحة</span><span className="results-decoration">معرفة تستحق السعي</span></div>
      {courses.data.length ? <div className="course-grid">{courses.data.map((course, index) => <CourseCard key={course.id} course={course} index={index}/>)}</div> : <EmptyState title="ما لقينا مادة بهذا البحث" detail="جرّب اسم مادة آخر أو اختر تخصصاً مختلفاً." action={search || major ? <button className="quiet-button" onClick={() => { setSearch(''); setMajor(''); }}>عرض كل المواد</button> : undefined}/>}
    </>}
  </section>;
}

function CourseCard({ course, index = 0 }: { course: Course; index?: number }) {
  return <Link href={`/course/${course.id}`} className={`course-card card-tone-${index % 4}`} data-testid={`card-course-${course.id}`}>
    <div className="course-card-top"><span className="major-tag">{course.major}</span><span className="card-arrow"><ArrowUpLeft size={18}/></span></div>
    <div className="course-symbol"><BookOpen size={26}/></div>
    <h2>{course.title}</h2><p className="instructor-line"><span className="instructor-avatar">{course.instructor.slice(0,1)}</span> شرح المدرّس <b>{course.instructor}</b></p>
    {course.description && <p className="course-description">{course.description}</p>}
    <div className="course-card-bottom"><span className="lesson-count"><Video size={16}/>{course.lessonCount} دروس</span><span className="price">{formatPrice(course.priceJod)} <small>د.أ</small></span></div>
  </Link>;
}

function CoursePage() {
  const { courseId = '' } = useParams();
  const id = Number(courseId);
  const { isSignedIn } = useAuth();
  const course = useGetCourse(id, { query: { enabled: Boolean(isSignedIn && Number.isFinite(id) && id > 0), queryKey: getGetCourseQueryKey(id) } });
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const profile = useGetCurrentUser({ query: { enabled: Boolean(isSignedIn), queryKey: getGetCurrentUserQueryKey() } });
  const requests = useListMyRequests({ query: {
    enabled: Boolean(isSignedIn),
    queryKey: getListMyRequestsQueryKey(),
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  } });
  const request = useRequestCourseSubscription();
  const currentRequest = requests.data?.find((item) => item.courseId === id);
  const hasAccess = Boolean(
    profile.data?.isAdmin ||
    (currentRequest?.status === 'approved' &&
      currentRequest.expiresAt &&
      new Date(currentRequest.expiresAt).getTime() > Date.now()),
  );
  const hasPendingRequest = currentRequest?.status === 'pending';
  const lessons = useGetCourseLessons(id, { query: {
    enabled: Boolean(isSignedIn && course.data && hasAccess),
    queryKey: getGetCourseLessonsQueryKey(id),
  } });
  const [message, setMessage] = useState('');
  const submitRequest = () => {
    if (!isSignedIn) { setLocation(signInRoute); return; }
    if (hasAccess || hasPendingRequest) return;
    request.mutate({ courseId: id }, { onSuccess: () => {
      setMessage('وصل طلبك بنجاح. سنتواصل معك لإتمام الدفع خارج المنصة.');
      void client.invalidateQueries({ queryKey: getListMyRequestsQueryKey() });
    }, onError: () => setMessage('تعذّر إرسال الطلب الآن. حاول مرة أخرى.') });
  };
  if (course.isLoading) return <div className="wrap page-section"><CourseSkeletons/></div>;
  if (course.isError || !course.data) return <div className="wrap page-section"><ErrorState onRetry={() => void course.refetch()} title="تعذّر تحميل تفاصيل المادة"/></div>;
  const item = course.data;
  return <section className="wrap page-section page-enter">
    <Link href="/courses" className="back-link"><ArrowRightIcon/> العودة إلى المواد</Link>
    <div className="course-detail">
      <div className="detail-main"><span className="major-tag">{item.major}</span><h1>{item.title}</h1><div className="detail-instructor"><span className="instructor-avatar large">{item.instructor.slice(0,1)}</span><div><small>مدرّس المادة</small><b>{item.instructor}</b></div></div>
        <div className="detail-rule"/>
        <h2>عن المادة</h2><p className="detail-description">{item.description || 'شرح منظم يساعدك على فهم المادة ومراجعة أفكارها الأساسية.'}</p>
        {message && <div className="notice" role="status" data-testid="status-request-message"><Check size={18}/>{message}</div>}
        <div className="detail-cta"><div><strong>{formatPrice(item.priceJod)} <small>د.أ</small></strong><span>اشتراك المادة</span></div><button className="button" type="button" onClick={submitRequest} disabled={request.isPending || hasAccess || hasPendingRequest} data-testid="button-request-access">{hasAccess ? 'الاشتراك مفعل' : hasPendingRequest ? 'طلبك قيد المراجعة' : request.isPending ? 'جارٍ إرسال الطلب...' : 'اطلب الاشتراك'}<ArrowLeft size={18}/></button></div>
        <p className="offline-note"><CircleHelp size={16}/> الدفع يتم بالتواصل مع إدارة المنصة بعد إرسال الطلب.</p>
      </div>
      <aside className="detail-aside"><div className="detail-illustration"><div className="illustration-disc"/><BookOpen size={58}/><span>رحلة فهم جديدة</span></div><div className="detail-facts"><div><span className="fact-icon"><Video size={18}/></span><span><b>{item.lessonCount} دروس مسجلة</b><small>متاحة بعد تفعيل اشتراكك</small></span></div><div><span className="fact-icon coral"><GraduationCap size={18}/></span><span><b>شرح من المدرّس مباشرة</b><small>تعلّم على يد {item.instructor}</small></span></div></div></aside>
    </div>
    {isSignedIn && <section className="lessons-section"><div className="section-label">محتوى المادة <span>يظهر للمشتركين النشطين</span></div>
      {!hasAccess && <EmptyState title={hasPendingRequest ? 'طلبك بانتظار المراجعة' : 'الدروس متاحة بعد تفعيل الاشتراك'} detail={hasPendingRequest ? 'سنراجع طلبك ونتواصل معك لإتمام الدفع.' : 'أرسل طلب الاشتراك، وسنرشدك لإتمام الدفع.'}/>}
      {hasAccess && lessons.isLoading && <div className="lesson-skeleton"/>}
      {hasAccess && lessons.isError && <div className="inline-error">لا يمكن عرض الدروس حالياً. <button onClick={() => void lessons.refetch()}>إعادة المحاولة</button></div>}
      {hasAccess && lessons.data && lessons.data.length > 0 && <div className="lesson-list">{lessons.data.map((lesson) => <LessonRow key={lesson.id} lesson={lesson}/>)}</div>}
      {hasAccess && lessons.data?.length === 0 && <EmptyState title="لم تتم إضافة الدروس بعد" detail="تواصل مع إدارة المنصة إذا كنت تتوقع ظهور الدروس."/>}
    </section>}
  </section>;
}
function ArrowRightIcon() { return <ArrowLeft size={17} className="back-arrow"/>; }
function LessonRow({ lesson }: { lesson: CourseLesson }) {
  return <a className="lesson-row" href={lesson.videoUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-lesson-${lesson.id}`}><span className="lesson-play"><Video size={18}/></span><span><small>الدرس {lesson.position}</small><b>{lesson.title}</b></span><ArrowUpLeft size={18}/></a>;
}

function RequestsPage() {
  const requests = useListMyRequests({ query: {
    queryKey: getListMyRequestsQueryKey(),
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  } });
  return <section className="wrap page-section page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> متابعة الطلبات</div><h1>طلبات الاشتراك</h1><p>كل تفاصيل طلباتك في مكان واحد.</p></div><div className="heading-note"><Clock3 size={20}/><span>سنكون معك<br/>في كل خطوة.</span></div></div>
    {requests.isLoading && <div className="request-skeletons"><div/><div/><div/></div>}
    {requests.isError && <ErrorState onRetry={() => void requests.refetch()} title="تعذّر تحميل طلباتك"/>}
    {requests.data && (requests.data.length ? <div className="request-list">{requests.data.map((req) => <RequestCard key={req.id} request={req}/>)}</div> : <EmptyState title="لا توجد طلبات بعد" detail="ابدأ باختيار مادة تناسب تخصصك." action={<Link href="/courses" className="button">تصفّح المواد <ArrowLeft size={17}/></Link>}/>)}
  </section>;
}
function RequestCard({ request }: { request: SubscriptionRequest }) {
  const expired = request.status === 'approved' && Boolean(
    request.expiresAt && new Date(request.expiresAt).getTime() <= Date.now(),
  );
  return <article className="request-card" data-testid={`card-request-${request.id}`}><div className="request-book"><BookOpen size={24}/></div><div className="request-info"><span className="major-tag">{request.major}</span><h2>{request.courseTitle}</h2><p>المدرّس: {request.instructor}</p><small>أُرسل في {formatDate(request.createdAt)}</small></div><div className="request-state"><StatusBadge status={request.status} expired={expired}/>{request.status === 'approved' && request.expiresAt && !expired && <small>ينتهي في {formatDate(request.expiresAt)}</small>}{expired && <small>انتهت مدة الوصول</small>}{request.status === 'pending' && <small>سيتم التواصل معك لإتمام الدفع</small>}{request.status === 'rejected' && <small>يمكنك اختيار مادة أخرى من المكتبة</small>}</div></article>;
}

function AdminPage() {
  const profile = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), refetchOnMount: 'always' } });
  if (profile.isLoading) return <div className="wrap page-section"><SkeletonBlock/></div>;
  if (profile.isError) return <div className="wrap page-section"><ErrorState onRetry={() => void profile.refetch()} title="تعذّر التحقق من صلاحيات الحساب"/></div>;
  if (!profile.data?.isAdmin) return <div className="wrap page-section"><EmptyState title="هذه الصفحة للمشرفين فقط" detail="ليس لديك صلاحية الوصول إلى لوحة الإدارة." action={<Link href="/courses" className="button">العودة إلى المواد</Link>}/></div>;
  return <AdminDashboard/>;
}
function AdminDashboard() {
  const client = useQueryClient();
  const summary = useGetAdminSummary({ query: { queryKey: getGetAdminSummaryQueryKey(), refetchInterval: 15_000 } });
  const courses = useListCourses();
  const adminRequests = useListAdminRequests({ status: 'pending' }, { query: { refetchOnMount: 'always', refetchInterval: 10_000 } });
  const [editing, setEditing] = useState<Course | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<SubscriptionRequest | null>(null);
  const create = useCreateCourse();
  const update = useUpdateCourse();
  const review = useReviewSubscriptionRequest();
  const saveCourse = (data: CourseInput) => {
    const editingId = editing?.id;
    const onSuccess = () => {
      setEditing(null);
      void client.invalidateQueries({ queryKey: getListCoursesQueryKey() });
      void client.invalidateQueries({ queryKey: getListMajorsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
      if (editingId) {
        void client.invalidateQueries({ queryKey: getGetCourseQueryKey(editingId) });
        void client.invalidateQueries({ queryKey: getGetCourseLessonsQueryKey(editingId) });
      }
    };
    if (editing) update.mutate({ courseId: editing.id, data }, { onSuccess });
    else create.mutate({ data }, { onSuccess });
  };
  const reviewRequest = (decision: 'approved' | 'rejected', durationDays?: number, target: SubscriptionRequest | null = selectedRequest) => {
    if (!target) return;
    review.mutate({ requestId: target.id, data: { decision, ...(decision === 'approved' ? { durationDays: durationDays || 30 } : {}) } }, {
      onSuccess: () => {
        setSelectedRequest(null);
        void client.invalidateQueries({ queryKey: getListAdminRequestsQueryKey({ status: 'pending' }) });
        void client.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
      },
    });
  };
  return <section className="wrap page-section page-enter">
    <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> مساحة الإدارة</div><h1>من هنا يبدأ الأثر.</h1><p>إدارة المواد ومراجعة طلبات الطلاب.</p></div><div className="admin-mark"><ShieldCheck size={23}/><span>لوحة المشرف</span></div></div>
    {summary.isLoading ? <div className="stats-grid">{[1,2,3,4,5].map((n) => <SkeletonBlock key={n}/>)}</div> : summary.isError ? <ErrorState onRetry={() => void summary.refetch()} title="تعذّر تحميل الملخص"/> : summary.data && <div className="stats-grid">
      <StatTile label="إجمالي المواد" value={summary.data.totalCourses} icon={<BookOpen size={20}/>}/>
      <StatTile label="طلبات تنتظر المراجعة" value={summary.data.pendingRequests} icon={<Clock3 size={20}/>} highlight/>
      <StatTile label="اشتراكات نشطة" value={summary.data.activeSubscriptions} icon={<Check size={20}/>}/>
      <StatTile label="الطلاب" value={summary.data.totalStudents} icon={<Users size={20}/>}/>
      <StatTile label="الدروس" value={summary.data.totalLessons} icon={<Layers3 size={20}/>}/>
    </div>}
    <div className="admin-columns">
      <section className="admin-panel course-admin"><div className="panel-heading"><div><span className="panel-kicker">المكتبة</span><h2>المواد الدراسية</h2></div><span className="panel-count">{courses.data?.length ?? '—'} مادة</span></div>
        <CourseEditor key={editing?.id ?? 'new'} editing={editing} busy={create.isPending || update.isPending} errorMessage={create.isError || update.isError ? 'تعذّر حفظ المادة. تأكد من البيانات وحاول مرة أخرى.' : ''} onSave={saveCourse} onCancel={() => setEditing(null)}/>
        <div className="admin-course-list">{courses.isLoading ? <SkeletonBlock/> : courses.isError ? <InlineRetry onRetry={() => void courses.refetch()}/> : courses.data?.length ? courses.data.map((course) => <button className={`admin-course-row ${editing?.id === course.id ? 'selected' : ''}`} type="button" key={course.id} onClick={() => setEditing(course)} data-testid={`button-edit-course-${course.id}`}><span className="admin-course-icon"><BookOpen size={18}/></span><span className="admin-course-name"><b>{course.title}</b><small>{course.major} · {course.instructor}</small></span><span className="admin-course-price">{formatPrice(course.priceJod)} د.أ</span></button>) : <p className="tiny-empty">لا توجد مواد مسجلة بعد.</p>}</div>
      </section>
      <section className="admin-panel requests-admin"><div className="panel-heading"><div><span className="panel-kicker">بانتظارك</span><h2>طلبات الاشتراك</h2></div><span className="pending-count">{adminRequests.data?.length ?? 0}</span></div>
        {review.isError && <p className="form-error" role="alert">تعذّرت مراجعة الطلب. حاول مرة أخرى.</p>}
        {adminRequests.isLoading ? <div className="request-skeletons"><div/><div/></div> : adminRequests.isError ? <InlineRetry onRetry={() => void adminRequests.refetch()}/> : adminRequests.data?.length ? <div className="admin-requests-list">{adminRequests.data.map((req) => <article className="admin-request" key={req.id} data-testid={`admin-request-${req.id}`}><div className="admin-request-top"><span className="request-initial">{req.studentName.slice(0,1)}</span><div><b>{req.studentName}</b><small>{req.studentEmail}</small></div><span className="request-date">{formatDate(req.createdAt)}</span></div><div className="admin-request-course"><b>{req.courseTitle}</b><span>{req.major} · {formatPrice(req.priceJod)} د.أ</span></div><div className="admin-request-actions"><button className="approve-button" onClick={() => setSelectedRequest(req)} type="button" data-testid={`button-approve-${req.id}`}><Check size={16}/> موافقة</button><button className="reject-button" onClick={() => reviewRequest('rejected', undefined, req)} type="button" data-testid={`button-reject-${req.id}`} disabled={review.isPending}>رفض الطلب</button></div></article>)}</div> : <div className="admin-empty"><div className="empty-icon"><Check size={23}/></div><b>لا توجد طلبات معلّقة</b><span>ستظهر هنا الطلبات الجديدة.</span></div>}
      </section>
    </div>
    {selectedRequest && <div className="modal-scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setSelectedRequest(null); }}><div className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><button className="modal-close" type="button" onClick={() => setSelectedRequest(null)} aria-label="إغلاق"><X size={19}/></button><div className="modal-symbol"><Check size={22}/></div><h2 id="review-title">تفعيل اشتراك الطالب</h2><p>حدد مدة إتاحة دروس <b>{selectedRequest.courseTitle}</b> للطالب {selectedRequest.studentName}.</p><label className="field-label">مدة الاشتراك بالأيام<input type="number" min="1" max="3650" defaultValue="30" id="duration-days" data-testid="input-duration-days"/></label>{review.isError && <p className="form-error">تعذّرت مراجعة الطلب. حاول مرة أخرى.</p>}<div className="modal-actions"><button className="button" type="button" disabled={review.isPending} onClick={() => { const val = Number((document.getElementById('duration-days') as HTMLInputElement)?.value); if (val > 0 && val <= 3650) reviewRequest('approved', val); }}>{review.isPending ? 'جارٍ الحفظ...' : 'تأكيد الموافقة'}</button><button className="quiet-button" type="button" onClick={() => setSelectedRequest(null)}>إلغاء</button></div></div></div>}
  </section>;
}

function CourseEditor({ editing, busy, errorMessage, onSave, onCancel }: { editing: Course | null; busy: boolean; errorMessage: string; onSave: (data: CourseInput) => void; onCancel: () => void }) {
  const lessonQuery = useGetCourseLessons(editing?.id ?? 0, { query: { enabled: Boolean(editing), queryKey: getGetCourseLessonsQueryKey(editing?.id ?? 0) } });
  const [lessonLines, setLessonLines] = useState('');
  const [initializedFor, setInitializedFor] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState(editing?.title || '');
  const [major, setMajor] = useState(editing?.major || '');
  const [instructor, setInstructor] = useState(editing?.instructor || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [price, setPrice] = useState(editing ? String(editing.priceJod) : '');
  if (editing && lessonQuery.data && initializedFor !== editing.id) {
    setLessonLines(lessonQuery.data.map((lesson) => `${lesson.title} | ${lesson.videoUrl}`).join('\n'));
    setInitializedFor(editing.id);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const lessons = lessonLines.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const separator = line.indexOf('|');
      return separator < 0 ? null : { title: line.slice(0, separator).trim(), videoUrl: line.slice(separator + 1).trim() };
    });
    if (!title.trim() || !major.trim() || !instructor.trim() || !Number.isFinite(Number(price)) || Number(price) < 0) { setError('أكمل اسم المادة والتخصص والمدرّس والسعر بشكل صحيح.'); return; }
    if (lessons.length > 30 || lessons.some((lesson) => !lesson?.title || !lesson.videoUrl)) { setError('اكتب كل درس بهذه الصيغة: عنوان الدرس | رابط الفيديو. الحد الأقصى ٣٠ درساً.'); return; }
    setError('');
    onSave({ title: title.trim(), major: major.trim(), instructor: instructor.trim(), description: description.trim() || null, priceJod: Number(price), lessons: lessons as {title:string;videoUrl:string}[] });
  };
  return <form className="course-editor" onSubmit={submit}>
    <div className="editor-heading"><b>{editing ? 'تعديل تفاصيل المادة' : 'إضافة مادة جديدة'}</b>{editing && <button type="button" className="reset-edit" onClick={onCancel}>إلغاء التعديل</button>}</div>
    <div className="editor-fields">
      <label className="field-label">اسم المادة<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="مثال: مبادئ الاقتصاد" required data-testid="input-course-title"/></label>
      <div className="field-pair"><label className="field-label">التخصص<input value={major} onChange={(e) => setMajor(e.target.value)} maxLength={120} placeholder="مثال: إدارة الأعمال" required data-testid="input-course-major"/></label><label className="field-label">اسم المدرّس<input value={instructor} onChange={(e) => setInstructor(e.target.value)} maxLength={120} placeholder="اسم المدرّس" required data-testid="input-course-instructor"/></label></div>
      <label className="field-label">وصف المادة<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1500} rows={2} placeholder="نبذة قصيرة عن المادة" data-testid="input-course-description"/></label>
      <label className="field-label price-field">السعر بالدينار الأردني<input type="number" min="0" max="10000" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.000" required data-testid="input-course-price"/><span>د.أ</span></label>
      <label className="field-label">روابط الدروس <small>سطر لكل درس · حتى ٣٠ رابطاً</small><textarea value={lessonLines} onChange={(e) => setLessonLines(e.target.value)} rows={3} placeholder={'مقدمة المادة | https://...\nالفصل الأول | https://...'} data-testid="input-course-lessons"/></label>
      {error && <span className="form-error" role="alert">{error}</span>}
      {errorMessage && <span className="form-error" role="alert">{errorMessage}</span>}
      <div className="editor-actions"><button className="button button-small" type="submit" disabled={busy} data-testid="button-save-course">{busy ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديلات' : 'إضافة المادة'}<Check size={16}/></button>{editing && <span className="editor-tip">اختر مادة من القائمة لتحريرها</span>}</div>
    </div>
  </form>;
}
function StatTile({ label, value, icon, highlight = false }: { label: string; value: number; icon: ReactNode; highlight?: boolean }) {
  return <article className={`stat-tile ${highlight ? 'stat-highlight' : ''}`}><span className="stat-icon">{icon}</span><span className="stat-value" data-testid={`stat-${label}`}>{value.toLocaleString('ar-JO')}</span><span className="stat-label">{label}</span></article>;
}

function StatusBadge({ status, expired = false }: { status: SubscriptionRequest['status']; expired?: boolean }) {
  const labels = { pending: 'بانتظار المراجعة', approved: 'تمت الموافقة', rejected: 'مرفوض' };
  return <span className={`status-badge ${expired ? 'status-expired' : `status-${status}`}`} data-testid={`status-${expired ? 'expired' : status}`}>{expired ? <Clock3 size={14}/> : status === 'approved' ? <Check size={14}/> : status === 'pending' ? <Clock3 size={14}/> : <X size={14}/>} {expired ? 'انتهت المدة' : labels[status]}</span>;
}
function CourseSkeletons() { return <div className="course-grid">{[0,1,2,3].map((i) => <div className="course-skeleton" key={i}><div className="skeleton sk-tag"/><div className="skeleton sk-icon"/><div className="skeleton sk-title"/><div className="skeleton sk-text"/><div className="skeleton sk-bottom"/></div>)}</div>; }
function SkeletonBlock() { return <div className="skeleton skeleton-block"/>; }
function ErrorState({ onRetry, title = 'حدث خطأ أثناء تحميل البيانات' }: { onRetry: () => void; title?: string }) {
  return <div className="error-state"><div className="error-symbol"><CircleHelp size={23}/></div><b>{title}</b><p>تحقق من اتصالك وحاول مرة أخرى.</p><button className="quiet-button" onClick={onRetry} type="button" data-testid="button-retry">إعادة المحاولة</button></div>;
}
function InlineRetry({ onRetry }: { onRetry: () => void }) { return <p className="inline-error">تعذّر تحميل البيانات. <button type="button" onClick={onRetry}>إعادة المحاولة</button></p>; }
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><BookOpen size={24}/></div><h2>{title}</h2><p>{detail}</p>{action && <div className="empty-action">{action}</div>}</div>;
}
function Footer() {
  return <footer className="site-footer"><div className="wrap footer-inner"><Logo/><span>خطوة واضحة نحو فهم أعمق.</span><span className="footer-copy">© سعي أكاديمي</span></div></footer>;
}
function formatPrice(value: number) { return new Intl.NumberFormat('ar-JO', { maximumFractionDigits: 3 }).format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat('ar-JO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }

export default App;
