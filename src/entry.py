import json, re, secrets, hashlib, hmac, time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from workers import WorkerEntrypoint, Response

PBKDF2_ROUNDS = 310000
SESSION_DAYS = 14
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def json_response(data, status=200, headers=None):
    h = {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    }
    if headers:
        h.update(headers)
    return Response.json(data, status=status, headers=h)


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), PBKDF2_ROUNDS
    ).hex()


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def cookie_value(request, name):
    raw = request.headers.get("cookie", "")
    for item in raw.split(";"):
        if "=" in item:
            key, value = item.strip().split("=", 1)
            if key == name:
                return value
    return ""


async def parse_body(request):
    try:
        body = await request.json()
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


def safe_text(value, max_len=200):
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_len]


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        cors = {}
        path = ""
        try:
            path = urlsplit(request.url).path
            method = request.method.upper()
            origin = request.headers.get("origin", "")
            allowed_origins = {
                "https://saeeplus2027.github.io",
                "http://localhost:8787",
                "http://127.0.0.1:8787",
            }

            if path.startswith("/api/") and origin in allowed_origins:
                cors = {
                    "access-control-allow-origin": origin,
                    "access-control-allow-credentials": "true",
                    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
                    "access-control-allow-headers": "content-type,x-video-title,x-bootstrap-key",
                    "access-control-max-age": "86400",
                    "vary": "Origin",
                }

            # Browsers send a preflight before JSON POST requests. It must
            # succeed before /api/auth/register can be called.
            if path.startswith("/api/") and method == "OPTIONS":
                if not cors:
                    return Response("Origin not allowed", status=403)
                return Response("", status=204, headers=cors)

            if path.startswith("/api/"):
                result = await self.api(request, path, method)
                headers = dict(result.headers.items())
                headers.update(cors)
                return Response(result.body, status=result.status, headers=headers)

            # Static frontend assets remain served by the existing ASSETS binding.
            return await self.env.ASSETS.fetch(request)
        except Exception:
            return json_response(
                {"error": "حدث خطأ داخلياً في الخادم. حاول مرة أخرى."},
                500,
                headers=cors,
            )

    async def current_user(self, request):
        token = cookie_value(request, "saee_session")
        if not token:
            return None

        row = await self.env.DB.prepare(
            "SELECT u.id,u.full_name,u.email,u.role,u.is_active,s.expires_at "
            "FROM sessions s JOIN users u ON u.id=s.user_id "
            "WHERE s.token_hash=?"
        ).bind(token_digest(token)).first()

        if not row or not row["is_active"]:
            return None

        if row["expires_at"] < datetime.now(timezone.utc).isoformat():
            await self.env.DB.prepare(
                "DELETE FROM sessions WHERE token_hash=?"
            ).bind(token_digest(token)).run()
            return None

        return row

    async def require_admin(self, request):
        user = await self.current_user(request)
        return user if user and user["role"] == "admin" else None

    async def api(self, request, path, method):
        # Health-check endpoint.
        if path == "/api/health" and method == "GET":
            return json_response({"ok": True, "service": "saee-academy"})

        if path == "/api/admin/bootstrap" and method == "POST":
            # Run once after setting ADMIN_BOOTSTRAP_KEY as a Worker secret.
            supplied = request.headers.get("x-bootstrap-key", "")
            expected = getattr(self.env, "ADMIN_BOOTSTRAP_KEY", "")
            if not expected or not hmac.compare_digest(supplied, expected):
                return json_response(
                    {"error": "مفتاح التهيئة غير صحيح."}, 403
                )

            count = await self.env.DB.prepare(
                "SELECT COUNT(*) AS n FROM users WHERE role='admin'"
            ).first()
            if count and count["n"] > 0:
                return json_response(
                    {"error": "تم إنشاء حساب الأدمن مسبقاً."}, 409
                )

            body = await parse_body(request)
            name = safe_text(body.get("full_name"), 100)
            email = safe_text(body.get("email"), 190).lower()
            password = body.get("password", "")

            if (
                len(name) < 2
                or not EMAIL_RE.match(email)
                or not isinstance(password, str)
                or len(password) < 14
                or len(password) > 128
            ):
                return json_response(
                    {
                        "error": (
                            "اسم وبريد صحيحان، وكلمة مرور للأدمن "
                            "من 14 حرفاً على الأقل مطلوبة."
                        )
                    },
                    400,
                )

            salt = secrets.token_hex(16)
            uid = secrets.token_urlsafe(18)
            try:
                await self.env.DB.prepare(
                    "INSERT INTO users"
                    "(id,full_name,email,password_hash,password_salt,role) "
                    "VALUES(?,?,?,?,?,'admin')"
                ).bind(
                    uid, name, email, password_hash(password, salt), salt
                ).run()
            except Exception:
                return json_response(
                    {"error": "تعذر إنشاء الأدمن؛ تحقق من البريد."}, 409
                )

            return json_response(
                {
                    "ok": True,
                    "message": "تم إنشاء حساب الأدمن. احذف سر التهيئة بعد ذلك.",
                },
                201,
            )

        if path == "/api/auth/register" and method == "POST":
            body = await parse_body(request)
            name = safe_text(body.get("full_name"), 100)
            email = safe_text(body.get("email"), 190).lower()
            password = body.get("password", "")

            if (
                len(name) < 2
                or not EMAIL_RE.match(email)
                or not isinstance(password, str)
                or len(password) < 10
                or len(password) > 128
            ):
                return json_response(
                    {
                        "error": (
                            "تحقق من الاسم والبريد. كلمة المرور "
                            "يجب ألا تقل عن 10 أحرف."
                        )
                    },
                    400,
                )

            salt = secrets.token_hex(16)
            uid = secrets.token_urlsafe(18)
            try:
                await self.env.DB.prepare(
                    "INSERT INTO users"
                    "(id,full_name,email,password_hash,password_salt) "
                    "VALUES(?,?,?,?,?)"
                ).bind(
                    uid, name, email, password_hash(password, salt), salt
                ).run()
            except Exception:
                return json_response(
                    {"error": "البريد الإلكتروني مستخدم مسبقاً."}, 409
                )

            return json_response(
                {"ok": True, "message": "تم إنشاء الحساب. سجل الدخول للمتابعة."},
                201,
            )

        if path == "/api/auth/login" and method == "POST":
            body = await parse_body(request)
            email = safe_text(body.get("email"), 190).lower()
            password = body.get("password", "")

            row = await self.env.DB.prepare(
                "SELECT id,password_hash,password_salt,is_active "
                "FROM users WHERE email=?"
            ).bind(email).first()

            candidate = (
                password_hash(password, row["password_salt"])
                if row and isinstance(password, str)
                else ""
            )

            if (
                not row
                or not row["is_active"]
                or not hmac.compare_digest(candidate, row["password_hash"])
            ):
                return json_response(
                    {"error": "البريد الإلكتروني أو كلمة المرور غير صحيحة."},
                    401,
                )

            token = secrets.token_urlsafe(32)
            expires = (
                datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
            ).isoformat()

            await self.env.DB.prepare(
                "INSERT INTO sessions(token_hash,user_id,expires_at) "
                "VALUES(?,?,?)"
            ).bind(token_digest(token), row["id"], expires).run()

            return json_response(
                {"ok": True},
                headers={
                    "set-cookie": (
                        f"saee_session={token}; HttpOnly; Secure; "
                        f"SameSite=None; Path=/; Max-Age={SESSION_DAYS * 86400}"
                    )
                },
            )

        if path == "/api/auth/logout" and method == "POST":
            token = cookie_value(request, "saee_session")
            if token:
                await self.env.DB.prepare(
                    "DELETE FROM sessions WHERE token_hash=?"
                ).bind(token_digest(token)).run()

            return json_response(
                {"ok": True},
                headers={
                    "set-cookie": (
                        "saee_session=; HttpOnly; Secure; "
                        "SameSite=None; Path=/; Max-Age=0"
                    )
                },
            )

        if path == "/api/auth/me" and method == "GET":
            user = await self.current_user(request)
            return json_response(
                {
                    "user": (
                        {
                            "id": user["id"],
                            "full_name": user["full_name"],
                            "email": user["email"],
                            "role": user["role"],
                        }
                        if user
                        else None
                    )
                }
            )

        user = await self.current_user(request)
        if not user:
            return json_response(
                {"error": "يجب تسجيل الدخول أولاً."}, 401
            )

        if path == "/api/specializations" and method == "GET":
            rows = await self.env.DB.prepare(
                "SELECT s.id,s.name,s.description,COUNT(c.id) AS course_count "
                "FROM specializations s LEFT JOIN courses c "
                "ON c.specialization_id=s.id AND c.is_published=1 "
                "GROUP BY s.id ORDER BY s.name"
            ).all()
            return json_response({"items": rows.results})

        if path == "/api/courses" and method == "GET":
            rows = await self.env.DB.prepare(
                "SELECT c.id,c.name,c.instructor_name,c.description,"
                "c.price_jod,c.cover_key,s.id AS specialization_id,"
                "s.name AS specialization_name,"
                "(SELECT COUNT(*) FROM videos v WHERE v.course_id=c.id) "
                "AS video_count "
                "FROM courses c JOIN specializations s "
                "ON s.id=c.specialization_id "
                "WHERE c.is_published=1 ORDER BY c.created_at DESC"
            ).all()
            return json_response({"items": rows.results})

        if path == "/api/enrollments" and method == "POST":
            body = await parse_body(request)
            course_id = safe_text(body.get("course_id"), 80)

            course = await self.env.DB.prepare(
                "SELECT id FROM courses WHERE id=? AND is_published=1"
            ).bind(course_id).first()

            if not course:
                return json_response({"error": "المادة غير متاحة."}, 404)

            existing = await self.env.DB.prepare(
                "SELECT id,status FROM enrollment_requests "
                "WHERE student_id=? AND course_id=?"
            ).bind(user["id"], course_id).first()

            if existing and existing["status"] in ("pending", "approved"):
                return json_response(
                    {"error": "لديك طلب قائم أو اشتراك فعال لهذه المادة."},
                    409,
                )

            rid = secrets.token_urlsafe(18)
            await self.env.DB.prepare(
                "INSERT INTO enrollment_requests"
                "(id,student_id,course_id,status) VALUES(?,?,?,'pending') "
                "ON CONFLICT(student_id,course_id) DO UPDATE SET "
                "id=excluded.id,status='pending',"
                "requested_at=CURRENT_TIMESTAMP,decided_at=NULL,expires_at=NULL"
            ).bind(rid, user["id"], course_id).run()

            return json_response(
                {"ok": True, "message": "تم إرسال طلب الاشتراك."}, 201
            )

        if path == "/api/my/enrollments" and method == "GET":
            rows = await self.env.DB.prepare(
                "SELECT e.id,e.status,e.expires_at,c.id AS course_id,"
                "c.name AS course_name "
                "FROM enrollment_requests e JOIN courses c "
                "ON c.id=e.course_id WHERE e.student_id=? "
                "ORDER BY e.requested_at DESC"
            ).bind(user["id"]).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/watch/") and method == "GET":
            video_id = path.rsplit("/", 1)[-1]
            access = await self.env.DB.prepare(
                "SELECT v.object_key,v.title FROM videos v "
                "JOIN enrollment_requests e ON e.course_id=v.course_id "
                "WHERE v.id=? AND e.student_id=? AND e.status='approved' "
                "AND e.expires_at>?"
            ).bind(
                video_id, user["id"], datetime.now(timezone.utc).isoformat()
            ).first()

            if not access:
                return json_response(
                    {
                        "error": (
                            "لا تملك صلاحية مشاهدة هذا الفيديو "
                            "أو انتهى اشتراكك."
                        )
                    },
                    403,
                )

            obj = await self.env.MEDIA.get(access["object_key"])
            if not obj:
                return json_response({"error": "الفيديو غير موجود."}, 404)

            return Response(
                obj.body,
                headers={
                    "content-type": (
                        obj.httpMetadata.contentType or "video/mp4"
                    ),
                    "cache-control": "private, no-store",
                    "content-disposition": "inline",
                    "x-content-type-options": "nosniff",
                },
            )

        if path.startswith("/api/admin/"):
            admin = await self.require_admin(request)
            if not admin:
                return json_response(
                    {"error": "صلاحية الأدمن مطلوبة."}, 403
                )
            return await self.admin_api(request, path, method)

        return json_response({"error": "المسار غير موجود."}, 404)

    async def admin_api(self, request, path, method):
        if path == "/api/admin/specializations" and method == "POST":
            body = await parse_body(request)
            name = safe_text(body.get("name"), 100)
            desc = safe_text(body.get("description"), 500)

            if len(name) < 2:
                return json_response({"error": "اسم التخصص مطلوب."}, 400)

            sid = secrets.token_urlsafe(12)
            try:
                await self.env.DB.prepare(
                    "INSERT INTO specializations(id,name,description) "
                    "VALUES(?,?,?)"
                ).bind(sid, name, desc).run()
            except Exception:
                return json_response(
                    {"error": "التخصص موجود مسبقاً."}, 409
                )

            return json_response({"ok": True, "id": sid}, 201)

        if path == "/api/admin/courses" and method == "POST":
            body = await parse_body(request)
            name = safe_text(body.get("name"), 120)
            instructor = safe_text(body.get("instructor_name"), 100)
            sid = safe_text(body.get("specialization_id"), 80)
            desc = safe_text(body.get("description"), 1000)

            try:
                price = float(body.get("price_jod"))
            except Exception:
                price = -1

            if (
                len(name) < 2
                or len(instructor) < 2
                or price < 0
                or price > 10000
            ):
                return json_response(
                    {"error": "تحقق من بيانات المادة والسعر."}, 400
                )

            exists = await self.env.DB.prepare(
                "SELECT id FROM specializations WHERE id=?"
            ).bind(sid).first()

            if not exists:
                return json_response(
                    {"error": "التخصص غير موجود."}, 400
                )

            cid = secrets.token_urlsafe(12)
            await self.env.DB.prepare(
                "INSERT INTO courses"
                "(id,specialization_id,name,instructor_name,description,"
                "price_jod,is_published) VALUES(?,?,?,?,?,?,?)"
            ).bind(
                cid, sid, name, instructor, desc, price,
                1 if body.get("is_published") else 0
            ).run()

            return json_response({"ok": True, "id": cid}, 201)

        if path.startswith("/api/admin/videos/") and method == "POST":
            course_id = path.rsplit("/", 1)[-1]
            course = await self.env.DB.prepare(
                "SELECT id FROM courses WHERE id=?"
            ).bind(course_id).first()

            if not course:
                return json_response(
                    {"error": "المادة غير موجودة."}, 404
                )

            count = await self.env.DB.prepare(
                "SELECT COUNT(*) AS n FROM videos WHERE course_id=?"
            ).bind(course_id).first()

            if count and count["n"] >= 30:
                return json_response(
                    {"error": "الحد الأقصى 30 فيديو للمادة."}, 400
                )

            title = safe_text(
                request.headers.get("x-video-title", ""), 140
            )
            content_type = request.headers.get(
                "content-type", "application/octet-stream"
            )

            if not title or not content_type.startswith("video/"):
                return json_response(
                    {"error": "أرسل ملف فيديو وعنواناً صالحاً."}, 400
                )

            raw = await request.arrayBuffer()
            if len(raw) > 500 * 1024 * 1024:
                return json_response(
                    {"error": "حجم الفيديو يتجاوز 500 ميغابايت."}, 413
                )

            vid = secrets.token_urlsafe(12)
            key = f"courses/{course_id}/{vid}"

            await self.env.MEDIA.put(
                key, raw, httpMetadata={"contentType": content_type}
            )

            position = (count["n"] if count else 0) + 1
            await self.env.DB.prepare(
                "INSERT INTO videos"
                "(id,course_id,title,object_key,position) VALUES(?,?,?,?,?)"
            ).bind(vid, course_id, title, key, position).run()

            return json_response(
                {"ok": True, "id": vid, "position": position}, 201
            )

        if path == "/api/admin/requests" and method == "GET":
            rows = await self.env.DB.prepare(
                "SELECT e.id,e.status,e.requested_at,e.expires_at,"
                "u.full_name,u.email,c.name AS course_name,c.price_jod "
                "FROM enrollment_requests e JOIN users u "
                "ON u.id=e.student_id JOIN courses c ON c.id=e.course_id "
                "ORDER BY e.requested_at DESC"
            ).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/admin/requests/") and method == "POST":
            rid = path.rsplit("/", 1)[-1]
            body = await parse_body(request)
            action = body.get("action")

            if action not in ("approve", "reject"):
                return json_response({"error": "إجراء غير صالح."}, 400)

            if action == "approve":
                try:
                    days = int(body.get("duration_days", 30))
                except Exception:
                    days = 0

                if days < 1 or days > 3650:
                    return json_response(
                        {
                            "error": (
                                "مدة الاشتراك يجب أن تكون بين يوم "
                                "و3650 يوماً."
                            )
                        },
                        400,
                    )

                expires = (
                    datetime.now(timezone.utc) + timedelta(days=days)
                ).isoformat()

                await self.env.DB.prepare(
                    "UPDATE enrollment_requests SET status='approved',"
                    "decided_at=CURRENT_TIMESTAMP,expires_at=? "
                    "WHERE id=? AND status='pending'"
                ).bind(expires, rid).run()
            else:
                await self.env.DB.prepare(
                    "UPDATE enrollment_requests SET status='rejected',"
                    "decided_at=CURRENT_TIMESTAMP,expires_at=NULL "
                    "WHERE id=? AND status='pending'"
                ).bind(rid).run()

            return json_response({"ok": True})

        return json_response(
            {"error": "مسار إداري غير موجود."}, 404
        )
