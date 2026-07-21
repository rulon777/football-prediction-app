import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { room, match, prediction } from "@/lib/db/schema"
import { calcularPuntos } from "@/lib/scoring"
import { eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

function getNormalizedTeamName(name: string): string {
  const lower = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  if (lower.includes("madrid")) {
    return lower.includes("atletico") ? "Atletico" : "Real Madrid";
  }
  if (lower.includes("barcelona")) return "Barcelona";
  if (lower.includes("celta")) return "Celta";
  if (lower.includes("alaves")) return "Alaves";
  if (lower.includes("sevilla")) return "Sevilla";
  if (lower.includes("betis")) return "Betis";
  if (lower.includes("sociedad")) return "Real Sociedad";
  if (lower.includes("valencia")) return "Valencia";
  if (lower.includes("villarreal")) return "Villarreal";
  if (lower.includes("athletic")) return "Athletic";
  if (lower.includes("osasuna")) return "Osasuna";
  if (lower.includes("girona")) return "Girona";
  if (lower.includes("getafe")) return "Getafe";
  if (lower.includes("espanyol")) return "Espanyol";
  if (lower.includes("mallorca")) return "Mallorca";
  if (lower.includes("vallecano") || lower.includes("rayo")) return "Rayo Vallecano";
  if (lower.includes("las palmas")) return "Las Palmas";
  if (lower.includes("leganes")) return "Leganes";
  if (lower.includes("valladolid")) return "Valladolid";
  return name;
}

export async function GET(request: Request) {
  // Protection: check that the Authorization header matches Bearer laquinielapp2005
  const authHeader = request.headers.get("Authorization")
  if (authHeader !== "Bearer laquinielapp2005") {
    return new NextResponse("No autorizado", { status: 401 })
  }

  const apiKey = process.env.FOOTBALL_API_KEY
  if (!apiKey) {
    console.error("FOOTBALL_API_KEY no está configurada")
    return NextResponse.json({ ok: false, error: "FOOTBALL_API_KEY no está configurada en el servidor" }, { status: 500 })
  }

  try {
    const res = await fetch("https://api.football-data.org/v4/competitions/PD/matches", {
      headers: {
        "X-Auth-Token": apiKey,
      },
      next: { revalidate: 0 }, // do not cache the fetch
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error("Error fetching matches from football-data:", res.status, errText)
      return NextResponse.json({ ok: false, error: `API status: ${res.status} - ${errText}` }, { status: 500 })
    }

    const data = await res.json()
    if (!data.matches || !Array.isArray(data.matches)) {
      return NextResponse.json({ ok: false, error: "Invalid API response structure" }, { status: 500 })
    }

    // 1. Bulk read: get all rooms and all existing matches
    const allRooms = await db.select().from(room)
    const allDbMatches = await db.select().from(match)

    // 2. Hash map indexing
    const matchesMap = new Map<string, typeof allDbMatches[0]>()
    for (const m of allDbMatches) {
      if (m.externalId) {
        matchesMap.set(`${m.roomId}_ext_${m.externalId}`, m)
      }
      const keyTeams = `${m.roomId}_teams_${getNormalizedTeamName(m.homeTeam)}_${getNormalizedTeamName(m.awayTeam)}_${m.week}`
      matchesMap.set(keyTeams, m)
    }

    const matchesToInsert: (typeof match.$inferInsert)[] = []
    const matchesToUpdatePromises: any[] = []
    
    // Track matches that transitioned to finished during this sync to recalculate prediction points in batch
    const finishedMatchIds: number[] = []
    const finishedMatchScores = new Map<number, { homeScore: number; awayScore: number }>()

    // 3. Process matches in memory
    for (const currentRoom of allRooms) {
      for (const apiMatch of data.matches) {
        const apiHomeClean = getNormalizedTeamName(apiMatch.homeTeam.name || apiMatch.homeTeam.shortName || "")
        const apiAwayClean = getNormalizedTeamName(apiMatch.awayTeam.name || apiMatch.awayTeam.shortName || "")
        const matchday = apiMatch.matchday
        const startTime = apiMatch.utcDate ? new Date(apiMatch.utcDate) : null
        const status = apiMatch.status
        const scoreHome = apiMatch.score?.fullTime?.home ?? null
        const scoreAway = apiMatch.score?.fullTime?.away ?? null
        const finished = status === "FINISHED"

        const keyByExternalId = `${currentRoom.id}_ext_${apiMatch.id}`
        const keyByTeams = `${currentRoom.id}_teams_${apiHomeClean}_${apiAwayClean}_${matchday}`
        const existing = matchesMap.get(keyByExternalId) || matchesMap.get(keyByTeams)

        if (existing) {
          const existingStartTime = existing.startTime ? new Date(existing.startTime) : null
          const startTimeChanged = startTime && existingStartTime
            ? startTime.getTime() !== existingStartTime.getTime()
            : (startTime || existingStartTime ? true : false)

          // Only trigger updates if something has actually changed
          const needsUpdate =
            existing.homeScore !== scoreHome ||
            existing.awayScore !== scoreAway ||
            existing.finished !== finished ||
            existing.status !== status ||
            startTimeChanged ||
            existing.externalId !== apiMatch.id.toString() ||
            existing.matchday !== matchday

          if (needsUpdate) {
            const isNewlyFinished = finished && !existing.finished

            matchesToUpdatePromises.push(
              db
                .update(match)
                .set({
                  homeScore: scoreHome,
                  awayScore: scoreAway,
                  finished,
                  startTime,
                  externalId: apiMatch.id.toString(),
                  matchday,
                  status,
                  scoreHome,
                  scoreAway,
                })
                .where(eq(match.id, existing.id))
            )

            if (isNewlyFinished && scoreHome !== null && scoreAway !== null) {
              finishedMatchIds.push(existing.id)
              finishedMatchScores.set(existing.id, { homeScore: scoreHome, awayScore: scoreAway })
            }
          }
        } else {
          // Push new match for bulk insert
          matchesToInsert.push({
            roomId: currentRoom.id,
            week: matchday,
            homeTeam: apiMatch.homeTeam.name || apiMatch.homeTeam.shortName || "",
            awayTeam: apiMatch.awayTeam.name || apiMatch.awayTeam.shortName || "",
            homeScore: scoreHome,
            awayScore: scoreAway,
            finished,
            startTime,
            externalId: apiMatch.id.toString(),
            matchday,
            status,
            scoreHome,
            scoreAway,
          })
        }
      }
    }

    // 4. Batch DB insertions (chunks of 100)
    let totalInserted = 0
    if (matchesToInsert.length > 0) {
      const chunkSize = 100
      for (let i = 0; i < matchesToInsert.length; i += chunkSize) {
        const chunk = matchesToInsert.slice(i, i + chunkSize)
        await db.insert(match).values(chunk)
      }
      totalInserted = matchesToInsert.length
    }

    // 5. Batch DB updates in parallel
    if (matchesToUpdatePromises.length > 0) {
      await Promise.all(matchesToUpdatePromises)
    }

    // 6. Batch predictions recalculation
    if (finishedMatchIds.length > 0) {
      const preds = await db
        .select()
        .from(prediction)
        .where(inArray(prediction.matchId, finishedMatchIds))

      const predUpdatePromises: any[] = []
      for (const p of preds) {
        const scoreInfo = finishedMatchScores.get(p.matchId)
        if (scoreInfo) {
          const points = calcularPuntos(p.homeScore, p.awayScore, scoreInfo.homeScore, scoreInfo.awayScore)
          if (p.points !== points) {
            predUpdatePromises.push(
              db.update(prediction).set({ points }).where(eq(prediction.id, p.id))
            )
          }
        }
      }

      if (predUpdatePromises.length > 0) {
        await Promise.all(predUpdatePromises)
      }
    }

    revalidatePath("/", "layout")

    return NextResponse.json({
      ok: true,
      roomsSynced: allRooms.length,
      inserted: totalInserted,
      updated: matchesToUpdatePromises.length,
      predictionsRecalculated: finishedMatchIds.length,
    })
  } catch (error: any) {
    console.error("Cron sync matches error:", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
