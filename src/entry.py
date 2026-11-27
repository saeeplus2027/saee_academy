import json, re, secrets, hashlib, hmac, time, base64
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, unquote, parse_qs, quote
from workers import WorkerEntrypoint, Response

# Cloudflare Python Workers run on Pyodide, where hashlib.pbkdf2_hmac may
# be unavailable. Use the Workers Web Crypto implementation there; retain
# the standard-library fallback for ordinary local CPython execution.
try:
    from js import crypto, Uint8Array, Object, Array
    from pyodide.ffi import to_js
except ImportError:  # pragma: no cover - used only outside Python Workers
    crypto = None
    Uint8Array = None
    Object = None
    Array = None
    to_js = None

# Cloudflare Workers Web Crypto rejects PBKDF2 iterations above 100,000.
PBKDF2_ROUNDS = 100000
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


async def password_hash(password, salt):
    """Return PBKDF2-HMAC-SHA256(password, salt, 100000, 32 bytes) as hex.

    Workers use Web Crypto because Pyodide's hashlib build does not expose
    pbkdf2_hmac. The algorithm, iteration count, salt encoding, and output
    length match hashlib.pbkdf2_hmac so hashes remain interoperable.
    """
    password_bytes = password.encode("utf-8")
    salt_bytes = salt.encode("utf-8")

    if crypto is None or Uint8Array is None:
        return hashlib.pbkdf2_hmac(
            "sha256", password_bytes, salt_bytes, PBKDF2_ROUNDS, dklen=32
        ).hex()

    password_data = Uint8Array.new(to_js(list(password_bytes)))
    salt_data = Uint8Array.new(to_js(list(salt_bytes)))
    key_usages = Array.new()
    key_usages.push("deriveBits")
    key = await crypto.subtle.importKey(
        "raw",
        password_data,
        to_js({"name": "PBKDF2"}, dict_converter=Object.fromEntries),
        False,
        key_usages,
    )
    derived = await crypto.subtle.deriveBits(
        to_js(
            {
                "name": "PBKDF2",
                "salt": salt_data,
                "iterations": PBKDF2_ROUNDS,
                "hash": "SHA-256",
            },
            dict_converter=Object.fromEntries,
        ),
        key,
        256,
    )
    output = Uint8Array.new(derived)
    return "".join(format(int(output[i]), "02x") for i in range(output.length))


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
        except Exception as exc:
            # Keep the public response generic, but retain the real exception
            # in Cloudflare Worker logs to make future diagnosis possible.
            print("[SAEE_API_ERROR]", path, type(exc).__name__, str(exc))
            return json_response(
                {"error": "حدث خطأ داخلياً في الخادم. حاول مرة أخرى."},
                500,
                headers=cors,
            )

    async def ensure_video_progress_table(self):
        """Create progress storage on demand for databases where migration 0003 was not applied."""
        await self.env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS video_progress ("
            "user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            "video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,"
            "completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"
            "PRIMARY KEY (user_id, video_id))"
        ).run()
        await self.env.DB.prepare(
            "CREATE INDEX IF NOT EXISTS idx_video_progress_user_video "
            "ON video_progress(user_id, video_id)"
        ).run()

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

    async def ensure_site_content_table(self):
        """Create editable homepage content storage if its D1 migration was not applied."""
        await self.env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS site_content ("
            "content_key TEXT PRIMARY KEY,"
            "content_value TEXT NOT NULL DEFAULT '',"
            "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        ).run()

    async def ensure_question_files_table(self):
        """Create PDF metadata storage lazily when the feature is first used."""
        await self.env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS question_files ("
            "id TEXT PRIMARY KEY,course_id TEXT NOT NULL,title TEXT NOT NULL,"
            "file_name TEXT NOT NULL,file_size INTEGER NOT NULL,"
            "object_key TEXT NOT NULL UNIQUE,created_by TEXT,"
            "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        ).run()
        await self.env.DB.prepare(
            "CREATE INDEX IF NOT EXISTS idx_question_files_course "
            "ON question_files(course_id,created_at DESC)"
        ).run()

    async def api(self, request, path, method):
        # Health-check endpoint.
        if path == "/api/health" and method == "GET":
            return json_response({"ok": True, "service": "saee-academy"})

        # Public, read-only site copy. The table is created by migration 0002.
        if path == "/api/site-content" and method == "GET":
            await self.ensure_site_content_table()
            rows = await self.env.DB.prepare(
                "SELECT content_key,content_value FROM site_content"
            ).all()
            return json_response({
                "items": {row["content_key"]: row["content_value"] for row in rows.results}
            })

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
                    uid, name, email, await password_hash(password, salt), salt
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

            # Check duplicate email explicitly. Do not turn every D1 failure
            # into a misleading "email already used" response.
            try:
                existing = await self.env.DB.prepare(
                    "SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1"
                ).bind(email).first()
            except Exception as exc:
                print(
                    "[SAEE_REGISTER_LOOKUP_ERROR]",
                    type(exc).__name__,
                    str(exc),
                )
                return json_response(
                    {
                        "error": (
                            "تعذر التحقق من البريد بسبب مشكلة في قاعدة البيانات. "
                            "لم يتم إنشاء الحساب. (SAEE_REGISTER_LOOKUP_ERROR)"
                        )
                    },
                    500,
                )

            if existing:
                return json_response(
                    {"error": "البريد الإلكتروني مسجل مسبقاً. جرّب تسجيل الدخول."},
                    409,
                )

            salt = secrets.token_hex(16)
            uid = secrets.token_urlsafe(18)
            try:
                pw_hash = await password_hash(password, salt)
            except Exception as exc:
                print("[SAEE_REGISTER_HASH_ERROR]", type(exc).__name__, str(exc))
                return json_response(
                    {
                        "error": (
                            "تعذر تشفير كلمة المرور. لم يتم إنشاء الحساب. "
                            "(SAEE_REGISTER_HASH_ERROR)"
                        )
                    },
                    500,
                )
            try:
                await self.env.DB.prepare(
                    "INSERT INTO users"
                    "(id,full_name,email,password_hash,password_salt) "
                    "VALUES(?,?,?,?,?)"
                ).bind(uid, name, email, pw_hash, salt).run()
            except Exception as exc:
                # Handle a possible concurrent registration safely, then log
                # the actual database error for diagnosis in Worker Logs.
                try:
                    existing_after_error = await self.env.DB.prepare(
                        "SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1"
                    ).bind(email).first()
                except Exception as lookup_exc:
                    existing_after_error = None
                    print(
                        "[SAEE_REGISTER_RECHECK_ERROR]",
                        type(lookup_exc).__name__,
                        str(lookup_exc),
                    )

                if existing_after_error:
                    return json_response(
                        {"error": "البريد الإلكتروني مسجل مسبقاً. جرّب تسجيل الدخول."},
                        409,
                    )

                print(
                    "[SAEE_REGISTER_DB_ERROR]",
                    type(exc).__name__,
                    str(exc),
                )
                return json_response(
                    {
                        "error": (
                            "تعذر إنشاء الحساب بسبب خطأ في قاعدة البيانات. "
                            "لم يتم إنشاء الحساب. راجع سجل Worker للرمز "
                            "SAEE_REGISTER_DB_ERROR."
                        )
                    },
                    500,
                )

            # Create a session immediately after registration so the student
            # enters the site without being asked to sign in a second time.
            token = secrets.token_urlsafe(32)
            expires = (
                datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
            ).isoformat()
            try:
                await self.env.DB.prepare(
                    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)"
                ).bind(token_digest(token), uid, expires).run()
            except Exception as exc:
                print("[SAEE_REGISTER_SESSION_ERROR]", type(exc).__name__, str(exc))
                return json_response(
                    {"error": "تم إنشاء الحساب، لكن تعذر بدء الجلسة. سجّل الدخول مرة واحدة."},
                    500,
                )
            return json_response(
                {"ok": True, "message": "تم إنشاء الحساب وتسجيل دخولك بنجاح."},
                201,
                headers={
                    "set-cookie": (
                        f"saee_session={token}; HttpOnly; Secure; "
                        f"SameSite=None; Path=/; Max-Age={SESSION_DAYS * 86400}"
                    )
                },
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
                await password_hash(password, row["password_salt"])
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

        # Current-user settings: change display name and/or password.
        if path == "/api/account" and method == "PUT":
            user = await self.current_user(request)
            if not user:
                return json_response({"error": "يجب تسجيل الدخول أولاً."}, 401)
            body = await parse_body(request)
            current_password = body.get("current_password", "")
            if not isinstance(current_password, str) or not current_password:
                return json_response({"error": "أدخل كلمة المرور الحالية لتأكيد التعديل."}, 400)

            credential = await self.env.DB.prepare(
                "SELECT password_hash,password_salt FROM users WHERE id=?"
            ).bind(user["id"]).first()
            candidate = await password_hash(current_password, credential["password_salt"])
            if not hmac.compare_digest(candidate, credential["password_hash"]):
                return json_response({"error": "كلمة المرور الحالية غير صحيحة."}, 401)

            full_name = safe_text(body.get("full_name"), 100) or user["full_name"]
            if len(full_name) < 2:
                return json_response({"error": "الاسم يجب أن يتكون من حرفين على الأقل."}, 400)

            new_password = body.get("new_password", "")
            if new_password:
                if not isinstance(new_password, str) or len(new_password) < 10 or len(new_password) > 128:
                    return json_response({"error": "كلمة المرور الجديدة يجب أن تكون بين 10 و128 حرفاً."}, 400)
                new_salt = secrets.token_hex(16)
                new_hash = await password_hash(new_password, new_salt)
                await self.env.DB.prepare(
                    "UPDATE users SET full_name=?,password_hash=?,password_salt=? WHERE id=?"
                ).bind(full_name, new_hash, new_salt, user["id"]).run()
                # Revoke other sessions after changing a password, then refresh the
                # current session expiry by preserving its current token.
                current_token = cookie_value(request, "saee_session")
                await self.env.DB.prepare(
                    "DELETE FROM sessions WHERE user_id=? AND token_hash<>?"
                ).bind(user["id"], token_digest(current_token)).run()
            else:
                await self.env.DB.prepare(
                    "UPDATE users SET full_name=? WHERE id=?"
                ).bind(full_name, user["id"]).run()

            updated = await self.env.DB.prepare(
                "SELECT id,full_name,email,role FROM users WHERE id=?"
            ).bind(user["id"]).first()
            return json_response({"ok": True, "user": updated})

        # Permanent account deletion. Verify the password and clean dependent rows.
        if path == "/api/account" and method == "DELETE":
            user = await self.current_user(request)
            if not user:
                return json_response({"error": "يجب تسجيل الدخول أولاً."}, 401)
            body = await parse_body(request)
            current_password = body.get("current_password", "")
            if not isinstance(current_password, str) or not current_password:
                return json_response({"error": "أدخل كلمة المرور لتأكيد حذف الحساب."}, 400)

            credential = await self.env.DB.prepare(
                "SELECT password_hash,password_salt FROM users WHERE id=?"
            ).bind(user["id"]).first()
            candidate = await password_hash(current_password, credential["password_salt"])
            if not hmac.compare_digest(candidate, credential["password_hash"]):
                return json_response({"error": "كلمة المرور غير صحيحة."}, 401)

            if user["role"] == "admin":
                admins = await self.env.DB.prepare(
                    "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND is_active=1"
                ).first()
                if admins and admins["n"] <= 1:
                    return json_response({
                        "error": "لا يمكن حذف آخر حساب أدمن. أنشئ أدمن آخر أولاً."
                    }, 409)

            await self.env.DB.prepare(
                "DELETE FROM enrollment_requests WHERE student_id=?"
            ).bind(user["id"]).run()
            await self.env.DB.prepare(
                "DELETE FROM sessions WHERE user_id=?"
            ).bind(user["id"]).run()
            await self.env.DB.prepare(
                "DELETE FROM users WHERE id=?"
            ).bind(user["id"]).run()
            return json_response(
                {"ok": True, "message": "تم حذف الحساب نهائياً."},
                headers={"set-cookie": "saee_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0"}
            )

        user = await self.current_user(request)
        if not user:
            return json_response(
                {"error": "يجب تسجيل الدخول أولاً."}, 401
            )

        # Student PDF library. These endpoints are inside the existing session-authenticated
        # section; no paid-course enrollment is required for these user-uploaded files.
        if path == "/api/question-files" and method == "GET":
            await self.ensure_question_files_table()
            rows = await self.env.DB.prepare(
                "SELECT c.id,c.name,c.specialization_id,s.name AS specialization_name,"
                "COUNT(qf.id) AS file_count FROM courses c "
                "JOIN specializations s ON s.id=c.specialization_id "
                "LEFT JOIN question_files qf ON qf.course_id=c.id "
                "WHERE c.is_published=1 "
                "GROUP BY c.id,c.name,c.specialization_id,s.name ORDER BY s.name,c.name"
            ).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/question-files/") and method == "GET":
            await self.ensure_question_files_table()
            course_id = path.rsplit("/", 1)[-1]
            course = await self.env.DB.prepare(
                "SELECT id FROM courses WHERE id=? AND is_published=1"
            ).bind(course_id).first()
            if not course:
                return json_response({"error": "المادة غير موجودة أو غير منشورة."}, 404)
            rows = await self.env.DB.prepare(
                "SELECT id,course_id,title,file_name,file_size,created_at "
                "FROM question_files WHERE course_id=? ORDER BY created_at DESC"
            ).bind(course_id).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/question-file/") and method == "GET":
            await self.ensure_question_files_table()
            file_id = path.rsplit("/", 1)[-1]
            row = await self.env.DB.prepare(
                "SELECT q.object_key,q.file_name FROM question_files q "
                "JOIN courses c ON c.id=q.course_id "
                "WHERE q.id=? AND c.is_published=1"
            ).bind(file_id).first()
            if not row:
                return json_response({"error": "ملف الأسئلة غير موجود."}, 404)
            obj = await self.env.MEDIA.get(row["object_key"])
            if not obj:
                return json_response({"error": "ملف PDF غير موجود في التخزين."}, 404)
            query = parse_qs(urlsplit(request.url).query)
            download = query.get("download", ["0"])[0] == "1"
            disposition = "attachment" if download else "inline"
            safe_name = (row["file_name"] or "questions.pdf").replace('"', "")
            disposition += "; filename=questions.pdf; filename*=UTF-8''" + quote(safe_name, safe="")
            return Response(obj.body, headers={
                "content-type": "application/pdf",
                "content-disposition": disposition,
                "cache-control": "private, no-store",
                "x-content-type-options": "nosniff",
            })

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
                "AS video_count,"
                "(SELECT COUNT(DISTINCT e.student_id) FROM enrollment_requests e "
                "WHERE e.course_id=c.id AND e.status IN ('pending','approved')) AS enrollment_count "
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

        # Return the video list only when the current user has an active,
        # approved subscription for this course.
        if path.startswith("/api/course-content/") and method == "GET":
            course_id = path.rsplit("/", 1)[-1]
            now = datetime.now(timezone.utc).isoformat()
            enrollment = await self.env.DB.prepare(
                "SELECT id FROM enrollment_requests "
                "WHERE student_id=? AND course_id=? AND status='approved' "
                "AND expires_at>? LIMIT 1"
            ).bind(user["id"], course_id, now).first()
            if not enrollment:
                return json_response(
                    {"error": "محتوى المادة متاح للمشتركين المقبولين فقط."}, 403
                )

            # Fetch every video attached to this course. Progress tracking was
            # introduced by migration 0003; if an existing D1 database has not
            # received that optional table yet, the video library must still
            # load instead of failing with a generic HTTP 500.
            try:
                await self.ensure_video_progress_table()
                rows = await self.env.DB.prepare(
                    "SELECT v.id,v.title,v.position,"
                    "CASE WHEN p.video_id IS NULL THEN 0 ELSE 1 END AS completed,"
                    "p.completed_at "
                    "FROM videos v LEFT JOIN video_progress p "
                    "ON p.video_id=v.id AND p.user_id=? "
                    "WHERE v.course_id=? ORDER BY v.position"
                ).bind(user["id"], course_id).all()
                return json_response({"items": rows.results})
            except Exception as progress_error:
                print(
                    "[SAEE_COURSE_CONTENT_PROGRESS_FALLBACK]",
                    type(progress_error).__name__, str(progress_error)
                )
                rows = await self.env.DB.prepare(
                    "SELECT id,title,position,0 AS completed,NULL AS completed_at "
                    "FROM videos WHERE course_id=? ORDER BY position"
                ).bind(course_id).all()
                return json_response({"items": rows.results})

        # Persist completion only for a video the student is currently
        # authorized to watch. The frontend calls this when playback ends.
        if path.startswith("/api/watch/") and path.endswith("/complete") and method in ("POST", "DELETE"):
            await self.ensure_video_progress_table()
            video_id = path.split("/")[-2]
            now = datetime.now(timezone.utc).isoformat()
            access = await self.env.DB.prepare(
                "SELECT v.id FROM videos v JOIN enrollment_requests e "
                "ON e.course_id=v.course_id "
                "WHERE v.id=? AND e.student_id=? AND e.status='approved' "
                "AND e.expires_at>? LIMIT 1"
            ).bind(video_id, user["id"], now).first()
            if not access:
                return json_response(
                    {"error": "لا تملك اشتراكاً فعالاً لهذه المادة."}, 403
                )
            if method == "DELETE":
                await self.env.DB.prepare(
                    "DELETE FROM video_progress WHERE user_id=? AND video_id=?"
                ).bind(user["id"], video_id).run()
                return json_response({"ok": True, "completed": False})
            await self.env.DB.prepare(
                "INSERT INTO video_progress(user_id,video_id,completed_at) "
                "VALUES(?,?,CURRENT_TIMESTAMP) "
                "ON CONFLICT(user_id,video_id) DO UPDATE SET "
                "completed_at=CURRENT_TIMESTAMP"
            ).bind(user["id"], video_id).run()
            return json_response({"ok": True, "completed": True})

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
        # Admin-only PDF library operations. api() only calls admin_api after require_admin.
        if path == "/api/admin/question-files" and method == "GET":
            await self.ensure_question_files_table()
            rows = await self.env.DB.prepare(
                "SELECT q.id,q.course_id,q.title,q.file_name,q.file_size,q.created_at,"
                "c.name AS course_name,s.name AS specialization_name "
                "FROM question_files q JOIN courses c ON c.id=q.course_id "
                "JOIN specializations s ON s.id=c.specialization_id ORDER BY q.created_at DESC"
            ).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/admin/question-files/item/") and method == "DELETE":
            await self.ensure_question_files_table()
            file_id = path.rsplit("/", 1)[-1]
            row = await self.env.DB.prepare(
                "SELECT object_key FROM question_files WHERE id=?"
            ).bind(file_id).first()
            if not row:
                return json_response({"error": "ملف الأسئلة غير موجود."}, 404)
            try:
                await self.env.MEDIA.delete(row["object_key"])
            except Exception as exc:
                print("[SAEE_QUESTION_R2_DELETE_WARNING]", type(exc).__name__, str(exc))
                return json_response({"error": "تعذر حذف الملف من التخزين. لم يتم حذف سجل الملف."}, 502)
            await self.env.DB.prepare(
                "DELETE FROM question_files WHERE id=?"
            ).bind(file_id).run()
            return json_response({"ok": True})

        if path.startswith("/api/admin/question-files/") and method == "POST":
            await self.ensure_question_files_table()
            course_id = path.rsplit("/", 1)[-1]
            course = await self.env.DB.prepare(
                "SELECT id FROM courses WHERE id=?"
            ).bind(course_id).first()
            if not course:
                return json_response({"error": "المادة المحددة غير موجودة."}, 404)

            query = parse_qs(urlsplit(request.url).query)
            title, file_name = "", ""
            for key, target in (("title_b64", "title"), ("filename_b64", "file_name")):
                values = query.get(key, [])
                if not values:
                    continue
                try:
                    token = values[0].replace("-", "+").replace("_", "/")
                    token += "=" * (-len(token) % 4)
                    decoded = base64.b64decode(token, validate=True).decode("utf-8")
                except Exception:
                    decoded = ""
                if target == "title":
                    title = safe_text(decoded, 140)
                else:
                    file_name = safe_text(decoded.replace("\\", "/").rsplit("/", 1)[-1], 180)

            if not title or not file_name or not file_name.lower().endswith(".pdf"):
                return json_response({"error": "أدخل عنوان الملف واختر ملف PDF صالحاً."}, 400)

            raw = await request.bytes()
            if len(raw) > 50 * 1024 * 1024:
                return json_response({"error": "حجم ملف PDF يتجاوز 50 ميغابايت."}, 413)
            if len(raw) < 5 or raw[:5] != b"%PDF-":
                return json_response({"error": "الملف المحدد ليس ملف PDF صالحاً."}, 415)

            file_id = secrets.token_urlsafe(16)
            object_key = f"question-files/{course_id}/{file_id}.pdf"
            try:
                await self.env.MEDIA.put(
                    object_key, raw, httpMetadata={"contentType": "application/pdf"}
                )
            except Exception as exc:
                print("[SAEE_QUESTION_R2_UPLOAD_ERROR]", type(exc).__name__, str(exc))
                return json_response({"error": "تعذر تخزين ملف PDF. حاول مرة أخرى."}, 502)

            try:
                current_admin = await self.current_user(request)
                await self.env.DB.prepare(
                    "INSERT INTO question_files "
                    "(id,course_id,title,file_name,file_size,object_key,created_by) VALUES(?,?,?,?,?,?,?)"
                ).bind(
                    file_id, course_id, title, file_name, len(raw), object_key, current_admin["id"]
                ).run()
            except Exception as exc:
                print("[SAEE_QUESTION_D1_INSERT_ERROR]", type(exc).__name__, str(exc))
                try:
                    await self.env.MEDIA.delete(object_key)
                except Exception as cleanup_exc:
                    print("[SAEE_QUESTION_R2_CLEANUP_WARNING]", type(cleanup_exc).__name__, str(cleanup_exc))
                return json_response({"error": "فشل حفظ بيانات الملف. لم تتم إضافته إلى المكتبة."}, 500)

            return json_response({"ok": True, "id": file_id}, 201)

        # Editable homepage text. Only known keys are accepted.
        if path == "/api/admin/site-content" and method == "PUT":
            # Do not rely solely on the GitHub Actions migration step: it may
            # have failed previously because of a Cloudflare API-token issue.
            await self.ensure_site_content_table()
            allowed_keys = {
                "site_title", "brand_name", "logo_url", "favicon_url",
                "subscription_contact_phone",
                "hero_eyebrow", "hero_title", "hero_emphasis", "hero_description",
                "how_eyebrow", "how_title", "how_description",
                "step_1_title", "step_1_text", "step_2_title", "step_2_text",
                "step_3_title", "step_3_text",
                "cta_title", "cta_description", "cta_button",
                "home_feature_1_title", "home_feature_1_text",
                "home_feature_2_title", "home_feature_2_text",
                "home_feature_3_title", "home_feature_3_text",
                "footer_text"
            }
            body = await parse_body(request)
            saved = 0
            for key, value in body.items():
                if key not in allowed_keys or not isinstance(value, str):
                    continue
                value = value.strip()[:1000]
                await self.env.DB.prepare(
                    "INSERT INTO site_content(content_key,content_value,updated_at) "
                    "VALUES(?,?,CURRENT_TIMESTAMP) "
                    "ON CONFLICT(content_key) DO UPDATE SET "
                    "content_value=excluded.content_value,updated_at=CURRENT_TIMESTAMP"
                ).bind(key, value).run()
                saved += 1
            return json_response({"ok": True, "saved": saved})

        if path == "/api/admin/courses" and method == "GET":
            rows = await self.env.DB.prepare(
                "SELECT c.id,c.name,c.instructor_name,c.description,c.price_jod,"
                "c.cover_key,c.is_published,c.specialization_id,"
                "s.name AS specialization_name,"
                "(SELECT COUNT(*) FROM videos v WHERE v.course_id=c.id) AS video_count,"
                "(SELECT COUNT(DISTINCT e.student_id) FROM enrollment_requests e "
                "WHERE e.course_id=c.id AND e.status IN ('pending','approved')) AS enrollment_count "
                "FROM courses c JOIN specializations s ON s.id=c.specialization_id "
                "ORDER BY c.created_at DESC"
            ).all()
            return json_response({"items": rows.results})

        if path == "/api/admin/specializations" and method == "GET":
            rows = await self.env.DB.prepare(
                "SELECT s.id,s.name,s.description,"
                "(SELECT COUNT(*) FROM courses c WHERE c.specialization_id=s.id) AS course_count "
                "FROM specializations s ORDER BY s.name"
            ).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/admin/specializations/") and method == "PUT":
            sid = path.rsplit("/", 1)[-1]
            body = await parse_body(request)
            name = safe_text(body.get("name"), 100)
            description = safe_text(body.get("description"), 500)
            if len(name) < 2:
                return json_response({"error": "اسم التخصص مطلوب."}, 400)
            duplicate = await self.env.DB.prepare(
                "SELECT id FROM specializations WHERE lower(trim(name))=lower(trim(?)) AND id<>? LIMIT 1"
            ).bind(name, sid).first()
            if duplicate:
                return json_response({"error": "اسم التخصص مستخدم بالفعل."}, 409)
            try:
                result = await self.env.DB.prepare(
                    "UPDATE specializations SET name=?,description=? WHERE id=?"
                ).bind(name, description, sid).run()
            except Exception as exc:
                print("[SAEE_SPECIALIZATION_UPDATE_ERROR]", type(exc).__name__, str(exc))
                return json_response({"error": "تعذر تحديث التخصص بسبب خطأ في قاعدة البيانات."}, 500)
            return json_response({"ok": True})

        if path.startswith("/api/admin/specializations/") and method == "DELETE":
            sid = path.rsplit("/", 1)[-1]
            linked = await self.env.DB.prepare(
                "SELECT COUNT(*) AS n FROM courses WHERE specialization_id=?"
            ).bind(sid).first()
            if linked and linked["n"]:
                return json_response(
                    {"error": "لا يمكن حذف التخصص قبل حذف المواد التابعة له."}, 409
                )
            await self.env.DB.prepare(
                "DELETE FROM specializations WHERE id=?"
            ).bind(sid).run()
            return json_response({"ok": True})

        if path.startswith("/api/admin/courses/") and method == "PUT":
            cid = path.rsplit("/", 1)[-1]
            body = await parse_body(request)
            name = safe_text(body.get("name"), 120)
            instructor = safe_text(body.get("instructor_name"), 100)
            sid = safe_text(body.get("specialization_id"), 80)
            description = safe_text(body.get("description"), 1000)
            try:
                price = float(body.get("price_jod"))
            except Exception:
                price = -1
            if len(name) < 2 or len(instructor) < 2 or price < 0 or price > 10000:
                return json_response({"error": "تحقق من بيانات المادة والسعر."}, 400)
            spec = await self.env.DB.prepare(
                "SELECT id FROM specializations WHERE id=?"
            ).bind(sid).first()
            if not spec:
                return json_response({"error": "التخصص المحدد غير موجود."}, 400)
            await self.env.DB.prepare(
                "UPDATE courses SET specialization_id=?,name=?,instructor_name=?,"
                "description=?,price_jod=?,is_published=? WHERE id=?"
            ).bind(
                sid, name, instructor, description, price,
                1 if body.get("is_published") else 0, cid
            ).run()
            return json_response({"ok": True})

        if path.startswith("/api/admin/courses/") and method == "DELETE":
            cid = path.rsplit("/", 1)[-1]
            video_rows = await self.env.DB.prepare(
                "SELECT object_key FROM videos WHERE course_id=?"
            ).bind(cid).all()
            await self.ensure_question_files_table()
            question_rows = await self.env.DB.prepare(
                "SELECT object_key FROM question_files WHERE course_id=?"
            ).bind(cid).all()
            for question_file in question_rows.results:
                try:
                    await self.env.MEDIA.delete(question_file["object_key"])
                except Exception as exc:
                    print("[SAEE_QUESTION_R2_COURSE_DELETE_WARNING]", type(exc).__name__, str(exc))
            await self.env.DB.prepare(
                "DELETE FROM question_files WHERE course_id=?"
            ).bind(cid).run()
            for video in video_rows.results:
                try:
                    await self.env.MEDIA.delete(video["object_key"])
                except Exception as exc:
                    print("[SAEE_ADMIN_R2_DELETE_WARNING]", type(exc).__name__, str(exc))
            await self.env.DB.prepare(
                "DELETE FROM enrollment_requests WHERE course_id=?"
            ).bind(cid).run()
            await self.env.DB.prepare(
                "DELETE FROM videos WHERE course_id=?"
            ).bind(cid).run()
            await self.env.DB.prepare(
                "DELETE FROM courses WHERE id=?"
            ).bind(cid).run()
            return json_response({"ok": True})

        if path.startswith("/api/admin/videos/item/") and method == "DELETE":
            vid = path.rsplit("/", 1)[-1]
            row = await self.env.DB.prepare(
                "SELECT object_key FROM videos WHERE id=?"
            ).bind(vid).first()
            if not row:
                return json_response({"error": "الفيديو غير موجود."}, 404)
            try:
                await self.env.MEDIA.delete(row["object_key"])
            except Exception as exc:
                print("[SAEE_ADMIN_VIDEO_DELETE_WARNING]", type(exc).__name__, str(exc))
            await self.env.DB.prepare("DELETE FROM videos WHERE id=?").bind(vid).run()
            return json_response({"ok": True})

        if path.startswith("/api/admin/videos/") and method == "GET":
            course_id = path.rsplit("/", 1)[-1]
            rows = await self.env.DB.prepare(
                "SELECT id,course_id,title,position,created_at FROM videos "
                "WHERE course_id=? ORDER BY position"
            ).bind(course_id).all()
            return json_response({"items": rows.results})

        if path == "/api/admin/users" and method == "GET":
            rows = await self.env.DB.prepare(
                "SELECT id,full_name,email,role,created_at,is_active FROM users "
                "ORDER BY created_at DESC"
            ).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/admin/users/") and method == "PUT":
            uid = path.rsplit("/", 1)[-1]
            body = await parse_body(request)
            active = 1 if body.get("is_active") else 0
            if uid == (await self.current_user(request))["id"] and not active:
                return json_response({"error": "لا يمكنك تعطيل حسابك الحالي من هذه الصفحة."}, 400)
            await self.env.DB.prepare(
                "UPDATE users SET is_active=? WHERE id=?"
            ).bind(active, uid).run()
            if not active:
                await self.env.DB.prepare(
                    "DELETE FROM sessions WHERE user_id=?"
                ).bind(uid).run()
            return json_response({"ok": True})

        if path.startswith("/api/admin/users/") and method == "DELETE":
            uid = path.rsplit("/", 1)[-1]
            target = await self.env.DB.prepare(
                "SELECT id,role FROM users WHERE id=?"
            ).bind(uid).first()
            if not target:
                return json_response({"error": "المستخدم غير موجود."}, 404)
            if target["role"] == "admin":
                admins = await self.env.DB.prepare(
                    "SELECT COUNT(*) AS n FROM users WHERE role='admin'"
                ).first()
                if admins and admins["n"] <= 1:
                    return json_response({"error": "لا يمكن حذف آخر حساب أدمن."}, 409)
            await self.env.DB.prepare("DELETE FROM enrollment_requests WHERE student_id=?").bind(uid).run()
            await self.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(uid).run()
            await self.env.DB.prepare("DELETE FROM users WHERE id=?").bind(uid).run()
            return json_response({"ok": True})

        if path == "/api/admin/specializations" and method == "POST":
            body = await parse_body(request)
            name = safe_text(body.get("name"), 100)
            desc = safe_text(body.get("description"), 500)

            if len(name) < 2:
                return json_response({"error": "اسم التخصص مطلوب."}, 400)

            # Compare normalized names so whitespace/case variants are not
            # mistaken for new specializations. Do not mask unrelated DB errors.
            duplicate = await self.env.DB.prepare(
                "SELECT id FROM specializations WHERE lower(trim(name))=lower(trim(?)) LIMIT 1"
            ).bind(name).first()
            if duplicate:
                return json_response({"error": "هذا التخصص موجود بالفعل."}, 409)

            sid = secrets.token_urlsafe(12)
            try:
                await self.env.DB.prepare(
                    "INSERT INTO specializations(id,name,description) "
                    "VALUES(?,?,?)"
                ).bind(sid, name, desc).run()
            except Exception as exc:
                print("[SAEE_SPECIALIZATION_CREATE_ERROR]", type(exc).__name__, str(exc))
                return json_response({"error": "تعذر إضافة التخصص بسبب خطأ في قاعدة البيانات."}, 500)

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

            # Video titles are supplied in the URL query string, not an HTTP
            # header. HTTP header values are restricted to Latin-1 and Arabic
            # titles can otherwise make the browser reject RequestInit before
            # the upload even reaches this Worker.
            query = parse_qs(urlsplit(request.url).query)
            title = ""
            encoded_titles = query.get("title_b64", [])
            if encoded_titles:
                try:
                    token = encoded_titles[0].replace("-", "+").replace("_", "/")
                    token += "=" * (-len(token) % 4)
                    title = base64.b64decode(token, validate=True).decode("utf-8")
                except Exception:
                    title = ""
            if not title:
                # Backward compatibility with older clients that send title directly.
                title_values = query.get("title", [""])
                title = title_values[0] if title_values else ""
            title = safe_text(title, 140)
            # Do not depend on a browser-supplied MIME header; uploads use mp4
            # as a safe default when the request has no content-type header.
            content_type = request.headers.get("content-type", "video/mp4")
            if not re.fullmatch(r"video/[A-Za-z0-9.+-]+", content_type):
                content_type = "video/mp4"

            if not title or not content_type.startswith("video/"):
                return json_response(
                    {"error": "أرسل ملف فيديو وعنواناً صالحاً."}, 400
                )

            raw = await request.bytes()
            if len(raw) > 500 * 1024 * 1024:
                return json_response(
                    {"error": "حجم الفيديو يتجاوز 500 ميغابايت."}, 413
                )

            vid = secrets.token_urlsafe(12)
            key = f"courses/{course_id}/{vid}"

            try:
                # workers.Request exposes bytes() in the Python Workers SDK;
                # calling the JavaScript arrayBuffer() method on the wrapper
                # raises an internal server error before the upload reaches R2.
                await self.env.MEDIA.put(
                    key, raw, httpMetadata={"contentType": content_type}
                )
            except Exception as exc:
                print("[SAEE_VIDEO_R2_UPLOAD_ERROR]", type(exc).__name__, str(exc))
                return json_response(
                    {"error": "تعذر تخزين الفيديو. تحقق من اتصال R2 وحجم الملف ثم حاول مجدداً."},
                    502,
                )

            last_position = await self.env.DB.prepare(
                "SELECT COALESCE(MAX(position),0) AS n FROM videos WHERE course_id=?"
            ).bind(course_id).first()
            position = (last_position["n"] if last_position else 0) + 1
            try:
                await self.env.DB.prepare(
                    "INSERT INTO videos"
                    "(id,course_id,title,object_key,position) VALUES(?,?,?,?,?)"
                ).bind(vid, course_id, title, key, position).run()
            except Exception as exc:
                print("[SAEE_VIDEO_D1_INSERT_ERROR]", type(exc).__name__, str(exc))
                try:
                    await self.env.MEDIA.delete(key)
                except Exception as cleanup_exc:
                    print("[SAEE_VIDEO_R2_CLEANUP_WARNING]", type(cleanup_exc).__name__, str(cleanup_exc))
                return json_response(
                    {"error": "تم رفع الملف إلى التخزين لكن تعذر تسجيله في قاعدة البيانات. راجع سجلات Worker."},
                    500,
                )

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
                # Every approved course subscription lasts four calendar
                # months from the approval date (not an approximate 120 days).
                now = datetime.now(timezone.utc)
                month_index = now.month - 1 + 4
                target_year = now.year + month_index // 12
                target_month = month_index % 12 + 1
                import calendar
                target_day = min(now.day, calendar.monthrange(target_year, target_month)[1])
                expires = now.replace(
                    year=target_year, month=target_month, day=target_day
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
