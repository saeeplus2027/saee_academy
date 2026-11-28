import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { coursesTable } from "./courses";

export const subscriptionRequestsTable = pgTable(
  "sai_subscription_requests",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id")
      .notNull()
      .references(() => coursesTable.id, { onDelete: "cascade" }),
    studentUserId: text("student_user_id").notNull(),
    studentName: text("student_name").notNull(),
    studentEmail: text("student_email").notNull(),
    status: text("status").notNull().default("pending"),
    durationDays: integer("duration_days"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sai_subscription_requests_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("sai_subscription_requests_student_idx").on(table.studentUserId),
    uniqueIndex("sai_subscription_requests_pending_student_course_uq")
      .on(table.studentUserId, table.courseId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type SubscriptionRequest =
  typeof subscriptionRequestsTable.$inferSelect;
export type NewSubscriptionRequest =
  typeof subscriptionRequestsTable.$inferInsert;
