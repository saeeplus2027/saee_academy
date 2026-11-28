import { pgTable, serial, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const coursesTable = pgTable("sai_courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  major: text("major").notNull(),
  instructor: text("instructor").notNull(),
  description: text("description"),
  priceJod: numeric("price_jod", { precision: 10, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Course = typeof coursesTable.$inferSelect;
export type NewCourse = typeof coursesTable.$inferInsert;
