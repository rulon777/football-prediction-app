"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { room, roomMember, match, prediction } from "@/lib/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { calcularPuntos } from "@/lib/scoring"

async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("No autorizado")
  return session.user
}

// Verifica que el usuario es miembro de la sala; devuelve sala + rol.
async function requireMembership(roomId: number, userId: string) {
  const [r] = await db.select().from(room).where(eq(room.id, roomId)).limit(1)
  if (!r) throw new Error("La sala no existe")
  const [membership] = await db
    .select({ id: roomMember.id })
    .from(roomMember)
    .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, userId)))
    .limit(1)
  if (!membership) throw new Error("No perteneces a esta sala")
  return { room: r, isAdmin: r.adminId === userId }
}

export type MatchWithPrediction = {
  id: number
  week: number
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  finished: boolean
  startTime: string | null
  myPrediction: { homeScore: number; awayScore: number; points: number } | null
  allPredictions: { userId: string; userName: string; homeScore: number; awayScore: number; points: number }[]
}

export type LeaderboardRow = {
  userId: string
  userName: string
  points: number
  clavadas: number
  isAdmin: boolean
}

export type RoomData = {
  id: number
  name: string
  code: string
  isAdmin: boolean
  matches: MatchWithPrediction[]
  leaderboard: LeaderboardRow[]
  weeks: number[]
}

export async function getRoomData(roomId: number): Promise<RoomData> {
  const user = await getUser()
  const { room: r, isAdmin } = await requireMembership(roomId, user.id)

  const matches = await db
    .select()
    .from(match)
    .where(eq(match.roomId, roomId))
    .orderBy(desc(match.week), asc(match.startTime), asc(match.id))

  const myPredictions = await db
    .select()
    .from(prediction)
    .where(and(eq(prediction.roomId, roomId), eq(prediction.userId, user.id)))

  const predByMatch = new Map(myPredictions.map((p) => [p.matchId, p]))

  // Clasificación: suma de puntos por miembro.
  const members = await db.select().from(roomMember).where(eq(roomMember.roomId, roomId))
  const allPredictions = await db.select().from(prediction).where(eq(prediction.roomId, roomId))

  const predsByMatchId = new Map<number, { userId: string; userName: string; homeScore: number; awayScore: number; points: number }[]>()
  for (const p of allPredictions) {
    const list = predsByMatchId.get(p.matchId) ?? []
    list.push({
      userId: p.userId,
      userName: p.userName,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      points: p.points,
    })
    predsByMatchId.set(p.matchId, list)
  }

  const matchesWithPred: MatchWithPrediction[] = matches.map((m) => {
    const p = predByMatch.get(m.id)
    return {
      id: m.id,
      week: m.week,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      finished: m.finished,
      startTime: m.startTime ? m.startTime.toISOString() : null,
      myPrediction: p ? { homeScore: p.homeScore, awayScore: p.awayScore, points: p.points } : null,
      allPredictions: predsByMatchId.get(m.id) ?? [],
    }
  })

  const pointsByUser = new Map<string, number>()
  const clavadasByUser = new Map<string, number>()
  for (const p of allPredictions) {
    pointsByUser.set(p.userId, (pointsByUser.get(p.userId) ?? 0) + p.points)
    if (p.points === 4) {
      clavadasByUser.set(p.userId, (clavadasByUser.get(p.userId) ?? 0) + 1)
    }
  }

  const leaderboard: LeaderboardRow[] = members
    .map((m) => ({
      userId: m.userId,
      userName: m.userName,
      points: pointsByUser.get(m.userId) ?? 0,
      clavadas: clavadasByUser.get(m.userId) ?? 0,
      isAdmin: m.userId === r.adminId,
    }))
    .sort((a, b) => b.points - a.points || b.clavadas - a.clavadas || a.userName.localeCompare(b.userName))

  const weeks = Array.from(new Set(matches.map((m) => m.week))).sort((a, b) => b - a)

  return {
    id: r.id,
    name: r.name,
    code: r.code,
    isAdmin,
    matches: matchesWithPred,
    leaderboard,
    weeks,
  }
}

// --- Admin: gestión de partidos -------------------------------------------

export async function addMatch(
  roomId: number,
  data: { week: number; homeTeam: string; awayTeam: string; startTime: string },
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  const { isAdmin } = await requireMembership(roomId, user.id)
  if (!isAdmin) return { ok: false, error: "Solo el admin puede añadir partidos." }

  const home = data.homeTeam.trim()
  const away = data.awayTeam.trim()
  if (!home || !away) return { ok: false, error: "Debes indicar ambos equipos." }
  if (!Number.isInteger(data.week) || data.week < 1) return { ok: false, error: "La jornada no es válida." }
  if (!data.startTime) return { ok: false, error: "Debes indicar la fecha y hora del partido." }

  const parsedStartTime = new Date(data.startTime)
  if (isNaN(parsedStartTime.getTime())) {
    return { ok: false, error: "La fecha y hora indicada no es válida." }
  }

  await db.insert(match).values({
    roomId,
    week: data.week,
    homeTeam: home,
    awayTeam: away,
    startTime: parsedStartTime,
  })
  revalidatePath(`/room/${roomId}`)
  return { ok: true }
}

export async function deleteMatch(roomId: number, matchId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  const { isAdmin } = await requireMembership(roomId, user.id)
  if (!isAdmin) return { ok: false, error: "Solo el admin puede eliminar partidos." }

  await db.delete(prediction).where(and(eq(prediction.matchId, matchId), eq(prediction.roomId, roomId)))
  await db.delete(match).where(and(eq(match.id, matchId), eq(match.roomId, roomId)))
  revalidatePath(`/room/${roomId}`)
  return { ok: true }
}

// Admin introduce el resultado real y se recalculan los puntos de todos.
export async function setMatchResult(
  roomId: number,
  matchId: number,
  homeScore: number,
  awayScore: number,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  const { isAdmin } = await requireMembership(roomId, user.id)
  if (!isAdmin) return { ok: false, error: "Solo el admin puede introducir resultados." }
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return { ok: false, error: "El marcador no es válido." }
  }

  const [m] = await db
    .select()
    .from(match)
    .where(and(eq(match.id, matchId), eq(match.roomId, roomId)))
    .limit(1)
  if (!m) return { ok: false, error: "El partido no existe." }

  await db.update(match).set({ homeScore, awayScore, finished: true }).where(eq(match.id, matchId))

  // Recalcula los puntos de cada predicción de este partido.
  const preds = await db.select().from(prediction).where(eq(prediction.matchId, matchId))
  for (const p of preds) {
    const points = calcularPuntos(p.homeScore, p.awayScore, homeScore, awayScore)
    await db.update(prediction).set({ points }).where(eq(prediction.id, p.id))
  }

  revalidatePath(`/room/${roomId}`)
  return { ok: true }
}

// --- Predicciones de los miembros -----------------------------------------

export async function savePrediction(
  roomId: number,
  matchId: number,
  homeScore: number,
  awayScore: number,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  await requireMembership(roomId, user.id)
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return { ok: false, error: "El marcador no es válido." }
  }

  const [m] = await db
    .select()
    .from(match)
    .where(and(eq(match.id, matchId), eq(match.roomId, roomId)))
    .limit(1)
  if (!m) return { ok: false, error: "El partido no existe." }
  if (m.finished) return { ok: false, error: "Este partido ya tiene resultado, no puedes predecir." }

  if (m.startTime && new Date() >= new Date(m.startTime)) {
    return { ok: false, error: "El partido ya ha comenzado, las apuestas están cerradas." }
  }

  const [existing] = await db
    .select()
    .from(prediction)
    .where(and(eq(prediction.matchId, matchId), eq(prediction.userId, user.id)))
    .limit(1)

  if (existing) {
    await db.update(prediction).set({ homeScore, awayScore }).where(eq(prediction.id, existing.id))
  } else {
    await db.insert(prediction).values({
      matchId,
      roomId,
      userId: user.id,
      userName: user.name,
      homeScore,
      awayScore,
    })
  }

  revalidatePath(`/room/${roomId}`)
  return { ok: true }
}
