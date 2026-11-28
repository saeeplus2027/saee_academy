import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gt,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCourseBody,
  CreateCourseResponse,
  GetAdminSummaryResponse,
  ListAdminRequestsQueryParams,
  ListAdminRequestsResponse,
  ReviewSubscriptionRequestBody,
  ReviewSubscriptionRequestParams,
  ReviewSubscriptionRequestResponse,
  UpdateCourseBody,
  UpdateCourseParams,
  UpdateCourseResponse,
} from "@workspace/api-zod";
import {
  db,
  coursesTable,
  courseLessonsTable,
  subscriptionRequestsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { formatCourse, isSafeVideoUrl } from "../lib/courses";

const router: IRouter = Router();
router.use(requireAdmin);

router.get("/admin/summary", async (_req, res): Promise<void> => {
  const [courses] = await db.select({ value: count() }).from(coursesTable);
  const [pendingRequests] = await db
    .select({ value: count() })
    .from(subscriptionRequestsTable)
    .where(eq(subscriptionRequestsTable.status, "pending"));
  const [activeSubscriptions] = await db
    .select({ value: count() })
    .from(subscriptionRequestsTable)
    .where(
      and(
        eq(subscriptionRequestsTable.status, "approved"),
        gt(subscriptionRequestsTable.expiresAt, new Date()),
      ),
    );
  const [students] = await db
    .select({
      value: countDistinct(subscriptionRequestsTable.studentUserId),
    })
    .from(subscriptionRequestsTable);
  const [lessons] = await db
    .select({ value: count() })
    .from(courseLessonsTable);

  res.json(
    GetAdminSummaryResponse.parse({
      totalCourses: Number(courses?.value ?? 0),
      pendingRequests: Number(pendingRequests?.value ?? 0),
      activeSubscriptions: Number(activeSubscriptions?.value ?? 0),
      totalStudents: Number(students?.value ?? 0),
      totalLessons: Number(lessons?.value ?? 0),
    }),
  );
});

router.get("/admin/requests", async (req, res): Promise<void> => {
  const parsed = ListAdminRequestsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db
    .select({
      id: subscriptionRequestsTable.id,
      courseId: subscriptionRequestsTable.courseId,
      courseTitle: coursesTable.title,
      major: coursesTable.major,
      instructor: coursesTable.instructor,
      priceJod: coursesTable.priceJod,
      studentName: subscriptionRequestsTable.studentName,
      studentEmail: subscriptionRequestsTable.studentEmail,
      status: subscriptionRequestsTable.status,
      durationDays: subscriptionRequestsTable.durationDays,
      expiresAt: subscriptionRequestsTable.expiresAt,
      createdAt: subscriptionRequestsTable.createdAt,
    })
    .from(subscriptionRequestsTable)
    .innerJoin(
      coursesTable,
      eq(subscriptionRequestsTable.courseId, coursesTable.id),
    )
    .where(
      parsed.data.status
        ? eq(subscriptionRequestsTable.status, parsed.data.status)
        : undefined,
    )
    .orderBy(desc(subscriptionRequestsTable.createdAt));
  res.json(
    ListAdminRequestsResponse.parse(
      rows.map((row) => ({ ...row, priceJod: Number(row.priceJod) })),
    ),
  );
});

router.patch(
  "/admin/requests/:requestId",
  async (req, res): Promise<void> => {
    const params = ReviewSubscriptionRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = ReviewSubscriptionRequestBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (body.data.decision === "approved" && !body.data.durationDays) {
      res.status(400).json({
        error: "An access duration in days is required for approval.",
      });
      return;
    }
    const durationDays =
      body.data.decision === "approved" ? body.data.durationDays! : null;
    const expiresAt =
      durationDays === null
        ? null
        : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const [updated] = await db
      .update(subscriptionRequestsTable)
      .set({
        status: body.data.decision,
        durationDays,
        expiresAt,
      })
      .where(
        and(
          eq(subscriptionRequestsTable.id, params.data.requestId),
          eq(subscriptionRequestsTable.status, "pending"),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({
        error: "Request not found or it has already been reviewed.",
      });
      return;
    }
    const [course] = await db
      .select()
      .from(coursesTable)
      .where(eq(coursesTable.id, updated.courseId));
    if (!course) {
      res.status(404).json({ error: "Course not found." });
      return;
    }
    res.json(
      ReviewSubscriptionRequestResponse.parse({
        ...updated,
        courseTitle: course.title,
        major: course.major,
        instructor: course.instructor,
        priceJod: Number(course.priceJod),
      }),
    );
  },
);

function invalidCourseInput(
  data: {
    title: string;
    major: string;
    instructor: string;
    lessons: Array<{ title: string; videoUrl: string }>;
  },
): string | null {
  if (!data.title.trim() || !data.major.trim() || !data.instructor.trim()) {
    return "Course name, major, and instructor are required.";
  }
  if (data.lessons.length > 30) {
    return "A course can have at most 30 lessons.";
  }
  if (data.lessons.some((lesson) => !lesson.title.trim())) {
    return "Every lesson must have a title.";
  }
  if (data.lessons.some((lesson) => !isSafeVideoUrl(lesson.videoUrl))) {
    return "Lesson links must use a valid HTTPS video URL.";
  }
  return null;
}

router.post("/admin/courses", async (req, res): Promise<void> => {
  const parsed = CreateCourseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const invalidData = invalidCourseInput(parsed.data);
  if (invalidData) {
    res.status(400).json({ error: invalidData });
    return;
  }

  const data = parsed.data;
  const course = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(coursesTable)
      .values({
        title: data.title.trim(),
        major: data.major.trim(),
        instructor: data.instructor.trim(),
        description: data.description?.trim() || null,
        priceJod: String(data.priceJod),
      })
      .returning();
    if (data.lessons.length) {
      await tx.insert(courseLessonsTable).values(
        data.lessons.map((lesson, index) => ({
          courseId: created.id,
          title: lesson.title.trim(),
          videoUrl: lesson.videoUrl,
          position: index + 1,
        })),
      );
    }
    return created;
  });
  res.status(201).json(CreateCourseResponse.parse(await formatCourse(course)));
});

router.put(
  "/admin/courses/:courseId",
  async (req, res): Promise<void> => {
    const params = UpdateCourseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateCourseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const invalidData = invalidCourseInput(parsed.data);
    if (invalidData) {
      res.status(400).json({ error: invalidData });
      return;
    }

    const data = parsed.data;
    const updated = await db.transaction(async (tx) => {
      const [course] = await tx
        .update(coursesTable)
        .set({
          title: data.title.trim(),
          major: data.major.trim(),
          instructor: data.instructor.trim(),
          description: data.description?.trim() || null,
          priceJod: String(data.priceJod),
        })
        .where(eq(coursesTable.id, params.data.courseId))
        .returning();
      if (!course) return null;

      await tx
        .delete(courseLessonsTable)
        .where(eq(courseLessonsTable.courseId, course.id));
      if (data.lessons.length) {
        await tx.insert(courseLessonsTable).values(
          data.lessons.map((lesson, index) => ({
            courseId: course.id,
            title: lesson.title.trim(),
            videoUrl: lesson.videoUrl,
            position: index + 1,
          })),
        );
      }
      return course;
    });
    if (!updated) {
      res.status(404).json({ error: "Course not found." });
      return;
    }
    res.json(UpdateCourseResponse.parse(await formatCourse(updated)));
  },
);

export default router;
