import { and, asc, count, desc, eq, ilike, or, gt } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetCurrentUserResponse,
  GetCourseLessonsParams,
  GetCourseLessonsResponse,
  GetCourseParams,
  GetCourseResponse,
  ListCoursesQueryParams,
  ListCoursesResponse,
  ListMajorsResponse,
  RequestCourseSubscriptionParams,
  RequestCourseSubscriptionResponse,
} from "@workspace/api-zod";
import {
  db,
  coursesTable,
  courseLessonsTable,
  subscriptionRequestsTable,
} from "@workspace/db";
import {
  getClerkUser,
  getDisplayName,
  getPrimaryEmail,
  isConfiguredAdmin,
} from "../middlewares/auth";
import { formatCourse } from "../lib/courses";

const router: IRouter = Router();

router.get("/me", async (_req, res, next): Promise<void> => {
  try {
    const user = await getClerkUser(res.locals.userId as string);
    const email = getPrimaryEmail(user);
    res.json(
      GetCurrentUserResponse.parse({
        userId: user.id,
        name: getDisplayName(user),
        email: email?.emailAddress ?? null,
        isAdmin: isConfiguredAdmin(user),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/courses", async (req, res): Promise<void> => {
  const parsed = ListCoursesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const filters = [];
  const search = parsed.data.search?.trim();
  const major = parsed.data.major?.trim();
  if (search) {
    const pattern = `%${search}%`;
    filters.push(
      or(
        ilike(coursesTable.title, pattern),
        ilike(coursesTable.instructor, pattern),
        ilike(coursesTable.major, pattern),
      ),
    );
  }
  if (major) filters.push(eq(coursesTable.major, major));

  const rows = await db
    .select()
    .from(coursesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(coursesTable.updatedAt));
  const lessonCounts = await db
    .select({
      courseId: courseLessonsTable.courseId,
      total: count(),
    })
    .from(courseLessonsTable)
    .groupBy(courseLessonsTable.courseId);
  const countByCourse = new Map(
    lessonCounts.map((row) => [row.courseId, Number(row.total)]),
  );

  res.json(
    ListCoursesResponse.parse(
      rows.map((course) => ({
        ...course,
        priceJod: Number(course.priceJod),
        lessonCount: countByCourse.get(course.id) ?? 0,
      })),
    ),
  );
});

router.get("/majors", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ major: coursesTable.major })
    .from(coursesTable)
    .orderBy(asc(coursesTable.major));
  res.json(ListMajorsResponse.parse(rows.map((row) => row.major)));
});

router.get("/courses/:courseId", async (req, res): Promise<void> => {
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [course] = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, params.data.courseId));
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  res.json(await formatCourse(course));
});

router.get("/courses/:courseId/lessons", async (req, res): Promise<void> => {
  const params = GetCourseLessonsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [course] = await db
    .select({ id: coursesTable.id })
    .from(coursesTable)
    .where(eq(coursesTable.id, params.data.courseId));
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }

  const userId = res.locals.userId as string;
  const adminUser = await getClerkUser(userId);
  const isAdmin = isConfiguredAdmin(adminUser);
  if (!isAdmin) {
    const now = new Date();
    const [access] = await db
      .select({ id: subscriptionRequestsTable.id })
      .from(subscriptionRequestsTable)
      .where(
        and(
          eq(subscriptionRequestsTable.courseId, course.id),
          eq(subscriptionRequestsTable.studentUserId, userId),
          eq(subscriptionRequestsTable.status, "approved"),
          gt(subscriptionRequestsTable.expiresAt, now),
        ),
      )
      .limit(1);
    if (!access) {
      res.status(403).json({ error: "An active subscription is required." });
      return;
    }
  }

  const lessons = await db
    .select({
      id: courseLessonsTable.id,
      title: courseLessonsTable.title,
      videoUrl: courseLessonsTable.videoUrl,
      position: courseLessonsTable.position,
    })
    .from(courseLessonsTable)
    .where(eq(courseLessonsTable.courseId, course.id))
    .orderBy(asc(courseLessonsTable.position));
  res.json(GetCourseLessonsResponse.parse(lessons));
});

router.post(
  "/courses/:courseId/requests",
  async (req, res, next): Promise<void> => {
    const params = RequestCourseSubscriptionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const [course] = await db
        .select()
        .from(coursesTable)
        .where(eq(coursesTable.id, params.data.courseId));
      if (!course) {
        res.status(404).json({ error: "Course not found." });
        return;
      }

      const userId = res.locals.userId as string;
      const user = await getClerkUser(userId);
      const email = getPrimaryEmail(user);
      if (!email || email.verification?.status !== "verified") {
        res.status(403).json({
          error: "Verify your email before requesting a subscription.",
        });
        return;
      }
      const now = new Date();
      const [existing] = await db
        .select({ id: subscriptionRequestsTable.id })
        .from(subscriptionRequestsTable)
        .where(
          and(
            eq(subscriptionRequestsTable.courseId, course.id),
            eq(subscriptionRequestsTable.studentUserId, userId),
            or(
              eq(subscriptionRequestsTable.status, "pending"),
              and(
                eq(subscriptionRequestsTable.status, "approved"),
                gt(subscriptionRequestsTable.expiresAt, now),
              ),
            ),
          ),
        )
        .limit(1);
      if (existing) {
        res.status(409).json({
          error: "A pending request or active subscription already exists.",
        });
        return;
      }

      const [request] = await db
        .insert(subscriptionRequestsTable)
        .values({
          courseId: course.id,
          studentUserId: userId,
          studentName:
            getDisplayName(user) ?? email.emailAddress.toLowerCase(),
          studentEmail: email.emailAddress.toLowerCase(),
        })
        .onConflictDoNothing()
        .returning();
      if (!request) {
        res.status(409).json({ error: "A pending request already exists." });
        return;
      }

      res.status(201).json(
        RequestCourseSubscriptionResponse.parse({
          ...request,
          courseTitle: course.title,
          major: course.major,
          instructor: course.instructor,
          priceJod: Number(course.priceJod),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default router;
