import { count, eq } from "drizzle-orm";
import { db, courseLessonsTable, type Course } from "@workspace/db";
import { GetCourseResponse } from "@workspace/api-zod";

export async function formatCourse(course: Course) {
  const [lessonTotal] = await db
    .select({ value: count() })
    .from(courseLessonsTable)
    .where(eq(courseLessonsTable.courseId, course.id));

  return GetCourseResponse.parse({
    ...course,
    priceJod: Number(course.priceJod),
    lessonCount: Number(lessonTotal?.value ?? 0),
  });
}

export function isSafeVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}
