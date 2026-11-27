from pathlib import Path
import ast

root = Path.cwd()
source = root / 'src' / 'entry.py'
if not source.exists():
    raise SystemExit('لم أجد src/entry.py. شغّل الملف من جذر مشروع Saee Academy.')

text = source.read_text(encoding='utf-8')
original = text

# Ensure urllib.parse.quote is imported for safe Content-Disposition filenames.
lines = text.splitlines()
for index, line in enumerate(lines):
    if line.startswith('from urllib.parse import '):
        imported = [part.strip() for part in line.split('import', 1)[1].split(',')]
        if 'quote' not in imported:
            lines[index] = line + ', quote'
        break
else:
    raise SystemExit('لم أجد سطر from urllib.parse import في src/entry.py؛ لم يتم تعديل الملف.')
text = '\n'.join(lines) + ('\n' if original.endswith('\n') else '')

# Create the D1 metadata table lazily. No migration or database replacement is needed.
if 'async def ensure_question_files_table(self):' not in text:
    api_anchor = '    async def api(self, request, path, method):'
    if api_anchor not in text:
        raise SystemExit('بنية src/entry.py مختلفة: لم أجد دالة api. أوقفت التعديل.')
    helper = """    async def ensure_question_files_table(self):
        await self.env.DB.prepare(
            \"CREATE TABLE IF NOT EXISTS question_files (\"
            \"id TEXT PRIMARY KEY,\"
            \"course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,\"
            \"title TEXT NOT NULL,\"
            \"file_name TEXT NOT NULL,\"
            \"content_type TEXT NOT NULL,\"
            \"object_key TEXT NOT NULL UNIQUE,\"
            \"size_bytes INTEGER NOT NULL,\"
            \"created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)\"
        ).run()
        await self.env.DB.prepare(
            \"CREATE INDEX IF NOT EXISTS idx_question_files_course \"
            \"ON question_files(course_id, created_at)\"
        ).run()

"""
    text = text.replace(api_anchor, helper + api_anchor, 1)

# Student routes are inserted after the user session has already been checked.
if 'if path == "/api/question-library" and method == "GET":' not in text:
    student_anchor = '        if path.startswith("/api/watch/") and method == "GET":'
    if student_anchor not in text:
        raise SystemExit('بنية src/entry.py مختلفة: لم أجد مسار الفيديوهات. أوقفت التعديل.')
    student_routes = """        # Question library: accessible to signed-in users; R2 remains private.
        if path == \"/api/question-library\" and method == \"GET\":
            await self.ensure_question_files_table()
            rows = await self.env.DB.prepare(
                \"SELECT c.id,c.name AS course_name,s.name AS specialization_name,\"
                \"COUNT(q.id) AS file_count \"
                \"FROM courses c JOIN specializations s ON s.id=c.specialization_id \"
                \"JOIN question_files q ON q.course_id=c.id \"
                \"WHERE c.is_published=1 \"
                \"GROUP BY c.id,c.name,s.name ORDER BY s.name,c.name\"
            ).all()
            return json_response({\"items\": rows.results})

        if path.startswith(\"/api/question-library/\") and method == \"GET\":
            await self.ensure_question_files_table()
            course_id = path.rsplit(\"/\", 1)[-1]
            course = await self.env.DB.prepare(
                \"SELECT id,name FROM courses WHERE id=? AND is_published=1\"
            ).bind(course_id).first()
            if not course:
                return json_response({\"error\": \"المادة غير موجودة أو غير منشورة.\"}, 404)
            rows = await self.env.DB.prepare(
                \"SELECT id,title,file_name,content_type,size_bytes,created_at \"
                \"FROM question_files WHERE course_id=? ORDER BY created_at,title\"
            ).bind(course_id).all()
            return json_response({\"course\": course, \"items\": rows.results})

        if path.startswith(\"/api/question-files/\") and path.endswith((\"/open\", \"/download\")) and method == \"GET\":
            await self.ensure_question_files_table()
            file_id = path.split(\"/\")[-2]
            row = await self.env.DB.prepare(
                \"SELECT q.file_name,q.content_type,q.object_key \"
                \"FROM question_files q JOIN courses c ON c.id=q.course_id \"
                \"WHERE q.id=? AND c.is_published=1\"
            ).bind(file_id).first()
            if not row:
                return json_response({\"error\": \"ملف الأسئلة غير موجود أو المادة غير منشورة.\"}, 404)
            obj = await self.env.MEDIA.get(row[\"object_key\"])
            if not obj:
                return json_response({\"error\": \"الملف غير موجود في التخزين.\"}, 404)
            safe_name = quote(row[\"file_name\"], safe=\"\")
            disposition = \"inline\" if path.endswith(\"/open\") else \"attachment\"
            return Response(
                obj.body,
                headers={
                    \"content-type\": row[\"content_type\"] or \"application/octet-stream\",
                    \"content-disposition\": f\"{disposition}; filename=\\\"question-file\\\"; filename*=UTF-8''{safe_name}\",
                    \"cache-control\": \"private, no-store\",
                    \"x-content-type-options\": \"nosniff\",
                },
            )

"""
    text = text.replace(student_anchor, student_routes + student_anchor, 1)

# Admin routes are inside the existing admin_api() method, which is called only after require_admin().
if 'if path == "/api/admin/question-files" and method == "GET":' not in text:
    admin_anchor = '        if path == "/api/admin/site-content" and method == "PUT":'
    if admin_anchor not in text:
        raise SystemExit('بنية src/entry.py مختلفة: لم أجد موضع مسارات الأدمن. أوقفت التعديل.')
    admin_routes = """        # Admin-only question library: upload, list, and delete files.
        if path == \"/api/admin/question-files\" and method == \"GET\":
            await self.ensure_question_files_table()
            query = parse_qs(urlsplit(request.url).query)
            course_id = query.get(\"course_id\", [\"\"])[0]
            if course_id:
                rows = await self.env.DB.prepare(
                    \"SELECT id,course_id,title,file_name,content_type,size_bytes,created_at \"
                    \"FROM question_files WHERE course_id=? ORDER BY created_at DESC\"
                ).bind(course_id).all()
            else:
                rows = await self.env.DB.prepare(
                    \"SELECT q.id,q.course_id,q.title,q.file_name,q.content_type,\"
                    \"q.size_bytes,q.created_at,c.name AS course_name \"
                    \"FROM question_files q JOIN courses c ON c.id=q.course_id \"
                    \"ORDER BY c.name,q.created_at DESC\"
                ).all()
            return json_response({\"items\": rows.results})

        if path.startswith(\"/api/admin/question-files/\") and method == \"POST\":
            await self.ensure_question_files_table()
            course_id = path.rsplit(\"/\", 1)[-1]
            course = await self.env.DB.prepare(
                \"SELECT id FROM courses WHERE id=?\"
            ).bind(course_id).first()
            if not course:
                return json_response({\"error\": \"المادة المحددة غير موجودة.\"}, 404)

            query = parse_qs(urlsplit(request.url).query)
            title = safe_text(query.get(\"title\", [\"\"])[0], 140)
            file_name = safe_text(query.get(\"file_name\", [\"\"])[0], 180)
            file_name = file_name.replace(\"\\\\\", \"/\").split(\"/\")[-1]
            content_type = request.headers.get(\"content-type\", \"application/octet-stream\").split(\";\")[0].lower()
            allowed_types = {
                \"application/pdf\": \".pdf\",
                \"application/msword\": \".doc\",
                \"application/vnd.openxmlformats-officedocument.wordprocessingml.document\": \".docx\",
            }
            if not title or not file_name or content_type not in allowed_types:
                return json_response({\"error\": \"اكتب عنواناً وارفع ملف PDF أو Word.\"}, 400)
            if not file_name.lower().endswith(allowed_types[content_type]):
                return json_response({\"error\": \"امتداد الملف لا يطابق نوعه.\"}, 400)

            raw = await request.bytes()
            if not raw:
                return json_response({\"error\": \"الملف فارغ.\"}, 400)
            if len(raw) > 50 * 1024 * 1024:
                return json_response({\"error\": \"الحد الأقصى لحجم ملف الأسئلة 50 ميغابايت.\"}, 413)

            file_id = secrets.token_urlsafe(14)
            object_key = f\"question-files/{course_id}/{file_id}\"
            try:
                await self.env.MEDIA.put(
                    object_key, raw, httpMetadata={\"contentType\": content_type}
                )
            except Exception as exc:
                print(\"[SAEE_QUESTION_R2_UPLOAD_ERROR]\", type(exc).__name__, str(exc))
                return json_response({\"error\": \"تعذر رفع الملف إلى التخزين.\"}, 502)

            try:
                await self.env.DB.prepare(
                    \"INSERT INTO question_files\"
                    \"(id,course_id,title,file_name,content_type,object_key,size_bytes) \"
                    \"VALUES(?,?,?,?,?,?,?)\"
                ).bind(file_id, course_id, title, file_name, content_type, object_key, len(raw)).run()
            except Exception as exc:
                print(\"[SAEE_QUESTION_D1_INSERT_ERROR]\", type(exc).__name__, str(exc))
                try:
                    await self.env.MEDIA.delete(object_key)
                except Exception as cleanup_exc:
                    print(\"[SAEE_QUESTION_R2_CLEANUP_WARNING]\", type(cleanup_exc).__name__, str(cleanup_exc))
                return json_response({\"error\": \"تعذر تسجيل الملف في قاعدة البيانات.\"}, 500)
            return json_response({\"ok\": True, \"id\": file_id}, 201)

        if path.startswith(\"/api/admin/question-files/\") and method == \"DELETE\":
            await self.ensure_question_files_table()
            file_id = path.rsplit(\"/\", 1)[-1]
            row = await self.env.DB.prepare(
                \"SELECT object_key FROM question_files WHERE id=?\"
            ).bind(file_id).first()
            if not row:
                return json_response({\"error\": \"ملف الأسئلة غير موجود.\"}, 404)
            try:
                await self.env.MEDIA.delete(row[\"object_key\"])
            except Exception as exc:
                print(\"[SAEE_QUESTION_R2_DELETE_ERROR]\", type(exc).__name__, str(exc))
                return json_response({\"error\": \"تعذر حذف الملف من التخزين. لم يتم حذف سجله.\"}, 502)
            await self.env.DB.prepare(
                \"DELETE FROM question_files WHERE id=?\"
            ).bind(file_id).run()
            return json_response({\"ok\": True})

"""
    text = text.replace(admin_anchor, admin_routes + admin_anchor, 1)

# Validate before touching the source file.
ast.parse(text)
if text == original:
    print('مكتبة الأسئلة موجودة مسبقاً؛ لم يتم تكرار المسارات.')
else:
    source.write_text(text, encoding='utf-8')
    print('تم تعديل src/entry.py. لم تتغير إعدادات D1 أو R2 أو بقية مسارات الحسابات.')
