import { pgTable, text, timestamp, boolean, serial, integer } from "drizzle-orm/pg-core"

// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
})

// --- App tables ------------------------------------------------------------

// A prediction room. Whoever creates it (adminId) is the admin.
export const room = pgTable("room", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  adminId: text("adminId").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Membership of a user in a room.
export const roomMember = pgTable("room_member", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  userId: text("userId").notNull(),
  userName: text("userName").notNull(),
  joinedAt: timestamp("joinedAt").notNull().defaultNow(),
})

// A match added by the admin for a given week.
export const match = pgTable("match", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  week: integer("week").notNull(),
  homeTeam: text("homeTeam").notNull(),
  awayTeam: text("awayTeam").notNull(),
  homeScore: integer("homeScore"),
  awayScore: integer("awayScore"),
  finished: boolean("finished").notNull().default(false),
  startTime: timestamp("startTime"),
  externalId: text("externalId"),
  matchday: integer("matchday"),
  status: text("status"),
  scoreHome: integer("scoreHome"),
  scoreAway: integer("scoreAway"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// A user's exact-score prediction for a match.
export const prediction = pgTable("prediction", {
  id: serial("id").primaryKey(),
  matchId: integer("matchId").notNull(),
  roomId: integer("roomId").notNull(),
  userId: text("userId").notNull(),
  userName: text("userName").notNull(),
  homeScore: integer("homeScore").notNull(),
  awayScore: integer("awayScore").notNull(),
  points: integer("points").notNull().default(0),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})
