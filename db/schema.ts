import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  avatar: text("avatar"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [index("idx_sessions_user_id").on(table.userId)]);

export const bookings = sqliteTable("bookings", {
  id: text("id").primaryKey(),
  standId: text("stand_id").notNull(),
  date: text("date").notNull(),
  duty: text("duty", { enum: ["aufsicht", "karten"] }).notNull(),
  discipline: text("discipline", { enum: ["rollhase", "trap", "langwaffe", "keller", "kurzwaffe"] }).notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_bookings_unique_slot").on(table.standId, table.date, table.duty, table.discipline),
  index("idx_bookings_month_stand").on(table.standId, table.date),
  index("idx_bookings_user_id").on(table.userId),
]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["booking.created", "booking.deleted"] }).notNull(),
  actorUserId: text("actor_user_id"),
  actorName: text("actor_name").notNull(),
  standId: text("stand_id").notNull(),
  date: text("date").notNull(),
  duty: text("duty", { enum: ["aufsicht", "karten"] }).notNull(),
  discipline: text("discipline", { enum: ["rollhase", "trap", "langwaffe", "keller", "kurzwaffe"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_events_stand_id_id").on(table.standId, table.id)]);
