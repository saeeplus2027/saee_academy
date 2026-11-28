import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { ListMyRequestsResponse } from "@workspace/api-zod";
import {
  db,
  coursesTable,
  subscriptionRequestsTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/me/requests", async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const requests = await db
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
    .where(eq(subscriptionRequestsTable.studentUserId, userId))
    .orderBy(desc(subscriptionRequestsTable.createdAt));

  res.json(
    ListMyRequestsResponse.parse(
      requests.map((request) => ({
        ...request,
        priceJod: Number(request.priceJod),
      })),
    ),
  );
});

export default router;
