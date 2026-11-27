from pathlib import Path
import sys

ROOT = Path.cwd()
SOURCE = ROOT / "src" / "entry.py"
if not SOURCE.exists():
    raise SystemExit("لم أجد src/entry.py. شغّل هذا الملف من جذر مشروع Saee Academy.")

text = SOURCE.read_text(encoding="utf-8")
original = text

# The filename is URL-encoded and used in Content-Disposition.
if "from urllib.parse import urlsplit, unquote, parse_qs, quote" not in text and "from urllib.parse import urlsplit, unquote, parse_qs" in text:
    text = text.replace(
        "from urllib.parse import urlsplit, unquote, parse_qs",
        "from urllib.parse import urlsplit, unquote, parse_qs, quote",
        1,
    )
elif "from urllib.parse import urlsplit, parse_qs" in text and "quote" not in text.split("from urllib.parse import", 1)[1].split("\n", 1)[0]:
    text = text.replace(
        "from urllib.parse import urlsplit, parse_qs",
        "from urllib.parse import urlsplit, parse_qs, quote",
        1,
    )

# Add the D1 metadata table lazily. This avoids requiring a D1 API token
# migration during the normal Worker deployment. The bucket remains private.
if "async def ensure_question_files_table(self):" not in text:
    api_method = "    async def api(self, request, path, method):"
    if api_method not in text:
        raise SystemExit("لم أجد موضع إضافة دالة قاعدة البيانات في src/entry.py.")
    helper = '''    async def ensure_question_files_table(self):
        """Create the question-file index on demand; uploaded files stay private in R2."""
        await self.env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS question_files ("
            "id TEXT PRIMARY KEY,"
            "course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,"
            "title TEXT NOT NULL,"
            "file_name TEXT NOT NULL,"
            "content_type TEXT NOT NULL,"
            "object_key TEXT NOT NULL UNIQUE,"
            "size_bytes INTEGER NOT NULL,"
            "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        ).run()
        await self.env.DB.prepare(
            "CREATE INDEX IF NOT EXISTS idx_question_files_course "
            "ON question_files(course_id, created_at)"
        ).run()

'''
    text = text.replace(api_method, helper + api_method, 1)

# Student routes are placed after current_user is resolved (before video access).
if 'if path == "/api/question-library" and method == "GET":' not in text:
    student_anchor = '        if path.startswith("/api/watch/") and method == "GET":'
    if student_anchor not in text:
        raise SystemExit("لم أجد موضع مسارات الطالب في src/entry.py.")
    student_routes = '''        # Question library: registered students may browse and download files.
        # The R2 bucket is private; every download passes through this session-checked route.
        if path == "/api/question-library" and method == "GET":
            await self.ensure_question_files_table()
            rows = await self.env.DB.prepare(
                "SELECT c.id,c.name AS course_name,s.name AS specialization_name,"
                "COUNT(q.id) AS file_count "
                "FROM courses c JOIN specializations s ON s.id=c.specialization_id "
                "LEFT JOIN question_files q ON q.course_id=c.id "
                "WHERE c.is_published=1 "
                "GROUP BY c.id,c.name,s.name ORDER BY s.name,c.name"
            ).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/question-library/") and method == "GET":
            await self.ensure_question_files_table()
            course_id = path.rsplit("/", 1)[-1]
            course = await self.env.DB.prepare(
                "SELECT id,name FROM courses WHERE id=? AND is_published=1"
            ).bind(course_id).first()
            if not course:
                return json_response({"error": "المادة غير موجودة أو غير منشورة."}, 404)
            rows = await self.env.DB.prepare(
                "SELECT id,title,file_name,content_type,size_bytes,created_at "
                "FROM question_files WHERE course_id=? ORDER BY created_at,title"
            ).bind(course_id).all()
            return json_response({"course": course, "items": rows.results})

        if path.startswith("/api/question-files/") and path.endswith("/download") and method == "GET":
            await self.ensure_question_files_table()
            file_id = path.split("/")[-2]
            row = await self.env.DB.prepare(
                "SELECT q.file_name,q.content_type,q.object_key "
                "FROM question_files q JOIN courses c ON c.id=q.course_id "
                "WHERE q.id=? AND c.is_published=1"
            ).bind(file_id).first()
            if not row:
                return json_response({"error": "ملف الأسئلة غير موجود أو المادة غير منشورة."}, 404)
            obj = await self.env.MEDIA.get(row["object_key"])
            if not obj:
                return json_response({"error": "الملف غير موجود في التخزين."}, 404)
            safe_name = quote(row["file_name"], safe="")
            return Response(
                obj.body,
                headers={
                    "content-type": row["content_type"] or "application/octet-stream",
                    "content-disposition": f"attachment; filename*=UTF-8''{safe_name}",
                    "cache-control": "private, no-store",
                    "x-content-type-options": "nosniff",
                },
            )

'''
    text = text.replace(student_anchor, student_routes + student_anchor, 1)

# Admin routes are behind the existing /api/admin/* require_admin check.
if 'if path == "/api/admin/question-files" and method == "GET":' not in text:
    admin_anchor = '        if path == "/api/admin/site-content" and method == "PUT":'
    if admin_anchor not in text:
        raise SystemExit("لم أجد موضع مسارات الأدمن في src/entry.py.")
    admin_routes = '''        # Admin-only question library management.
        if path == "/api/admin/question-files" and method == "GET":
            await self.ensure_question_files_table()
            query = parse_qs(urlsplit(request.url).query)
            course_id = query.get("course_id", [""])[0]
            if course_id:
                rows = await self.env.DB.prepare(
                    "SELECT id,course_id,title,file_name,content_type,size_bytes,created_at "
                    "FROM question_files WHERE course_id=? ORDER BY created_at DESC"
                ).bind(course_id).all()
            else:
                rows = await self.env.DB.prepare(
                    "SELECT q.id,q.course_id,q.title,q.file_name,q.content_type,"
                    "q.size_bytes,q.created_at,c.name AS course_name "
                    "FROM question_files q JOIN courses c ON c.id=q.course_id "
                    "ORDER BY c.name,q.created_at DESC"
                ).all()
            return json_response({"items": rows.results})

        if path.startswith("/api/admin/question-files/") and method == "POST":
            await self.ensure_question_files_table()
            course_id = path.rsplit("/", 1)[-1]
            course = await self.env.DB.prepare(
                "SELECT id FROM courses WHERE id=?"
            ).bind(course_id).first()
            if not course:
                return json_response({"error": "المادة المحددة غير موجودة."}, 404)

            query = parse_qs(urlsplit(request.url).query)
            title = safe_text(query.get("title", [""])[0], 140)
            file_name = safe_text(query.get("file_name", [""])[0], 180)
            file_name = file_name.replace("\\\\", "/").split("/")[-1]
            content_type = request.headers.get("content-type", "application/octet-stream").split(";")[0].lower()
            allowed_types = {
                "application/pdf": ".pdf",
                "application/msword": ".doc",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
            }
            if not title or not file_name or content_type not in allowed_types:
                return json_response({"error": "أدخل عنواناً للملف وارفع PDF أو Word فقط."}, 400)
            if not file_name.lower().endswith(allowed_types[content_type]):
                return json_response({"error": "امتداد الملف لا يطابق نوعه."}, 400)

            raw = await request.bytes()
            if not raw:
                return json_response({"error": "الملف فارغ."}, 400)
            if len(raw) > 50 * 1024 * 1024:
                return json_response({"error": "الحد الأقصى لحجم ملف الأسئلة 50 ميغابايت."}, 413)

            file_id = secrets.token_urlsafe(14)
            object_key = f"question-files/{course_id}/{file_id}"
            try:
                await self.env.MEDIA.put(
                    object_key, raw, httpMetadata={"contentType": content_type}
                )
            except Exception as exc:
                print("[SAEE_QUESTION_R2_UPLOAD_ERROR]", type(exc).__name__, str(exc))
                return json_response({"error": "تعذر رفع الملف إلى التخزين."}, 502)

            try:
                await self.env.DB.prepare(
                    "INSERT INTO question_files"
                    "(id,course_id,title,file_name,content_type,object_key,size_bytes) "
                    "VALUES(?,?,?,?,?,?,?)"
                ).bind(
                    file_id, course_id, title, file_name, content_type,
                    object_key, len(raw)
                ).run()
            except Exception as exc:
                print("[SAEE_QUESTION_D1_INSERT_ERROR]", type(exc).__name__, str(exc))
                try:
                    await self.env.MEDIA.delete(object_key)
                except Exception as cleanup_exc:
                    print("[SAEE_QUESTION_R2_CLEANUP_WARNING]", type(cleanup_exc).__name__, str(cleanup_exc))
                return json_response({"error": "تم رفع الملف لكن تعذر تسجيله في قاعدة البيانات."}, 500)

            return json_response({"ok": True, "id": file_id}, 201)

        if path.startswith("/api/admin/question-files/") and method == "DELETE":
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
            await self.env.DB.prepare(
                "DELETE FROM question_files WHERE id=?"
            ).bind(file_id).run()
            return json_response({"ok": True})

'''
    text = text.replace(admin_anchor, admin_routes + admin_anchor, 1)

# Remove R2 objects associated with a course when the admin deletes that course.
course_delete = '        if path.startswith("/api/admin/courses/") and method == "DELETE":'
if course_delete in text:
    begin = text.index(course_delete)
    next_section = text.find('        if path.startswith("/api/admin/videos/', begin + len(course_delete))
    if next_section < 0:
        next_section = text.find('        if path == "/api/admin/requests"', begin + len(course_delete))
    block = text[begin:next_section if next_section > begin else len(text)]
    if 'SELECT object_key FROM question_files WHERE course_id=?' not in block:
        anchor = '            await self.env.DB.prepare(\n                "DELETE FROM courses WHERE id=?"'
        position = text.find(anchor, begin)
        if position < 0 or (next_section > 0 and position > next_section):
            raise SystemExit("لم أجد موضع حذف المادة لتنظيف ملفات الأسئلة التابعة لها.")
        cleanup = '''            await self.ensure_question_files_table()
            question_rows = await self.env.DB.prepare(
                "SELECT object_key FROM question_files WHERE course_id=?"
            ).bind(cid).all()
            for question_file in question_rows.results:
                try:
                    await self.env.MEDIA.delete(question_file["object_key"])
                except Exception as exc:
                    print("[SAEE_QUESTION_COURSE_DELETE_WARNING]", type(exc).__name__, str(exc))
            await self.env.DB.prepare(
                "DELETE FROM question_files WHERE course_id=?"
            ).bind(cid).run()
'''
        text = text[:position] + cleanup + text[position:]

if text == original:
    print("Question library backend patch already applied; no changes needed.")
else:
    SOURCE.write_text(text, encoding="utf-8")
    print("تم تحديث src/entry.py وإضافة API مكتبة الأسئلة دون استبدال بقية كود الخادم.")
