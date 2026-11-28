import {
  index,
  integer,
  pgTable,
  serial,
  text,
} from "drizzle-orm/pg-core";
import { coursesTable } from "./courses";

export const courseLessonsTable = pgTable(
  "sai_course_lessons",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id")
      .notNull()
      .references(() => coursesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    videoUrl: text("video_url").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [index("sai_course_lessons_course_position_idx").on(table.courseId, table.position)],
);

export type CourseLesson = typeof courseLessonsTable.$inferSelect;
export type NewCourseLesson = typeof courseLessonsTable.$inferInsert;
