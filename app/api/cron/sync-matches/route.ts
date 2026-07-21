import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { room, match, prediction } from "@/lib/db/schema"
import { calcularPuntos } from "@/lib/scoring"
import { eq } from "drizzle-orm"
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

    // Get all rooms in the database
    const allRooms = await db.select().from(room)

    let totalInserted = 0
    let totalUpdated = 0

    for (const currentRoom of allRooms) {
      // Get all existing matches in this room
      const dbMatches = await db
        .select()
        .from(match)
        .where(eq(match.roomId, currentRoom.id))

      for (const apiMatch of data.matches) {
        const apiHomeClean = getNormalizedTeamName(apiMatch.homeTeam.name || apiMatch.homeTeam.shortName || "")
        const apiAwayClean = getNormalizedTeamName(apiMatch.awayTeam.name || apiMatch.awayTeam.shortName || "")
        const matchday = apiMatch.matchday
        const startTime = apiMatch.utcDate ? new Date(apiMatch.utcDate) : null
        const status = apiMatch.status
        const scoreHome = apiMatch.score?.fullTime?.home ?? null
        const scoreAway = apiMatch.score?.fullTime?.away ?? null
        const finished = status === "FINISHED"

        // Search for existing match in this room with matching teams and matchday/week
        const existing = dbMatches.find((m) => {
          const dbHomeClean = getNormalizedTeamName(m.homeTeam)
          const dbAwayClean = getNormalizedTeamName(m.awayTeam)
          return dbHomeClean === apiHomeClean && dbAwayClean === apiAwayClean && m.week === matchday
        })

        if (existing) {
          const isNewlyFinished = finished && !existing.finished

          await db
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

          totalUpdated++

          // Recalculate prediction points if the match has transitioned to finished
          if (isNewlyFinished && scoreHome !== null && scoreAway !== null) {
            const preds = await db.select().from(prediction).where(eq(prediction.matchId, existing.id))
            for (const p of preds) {
              const points = calcularPuntos(p.homeScore, p.awayScore, scoreHome, scoreAway)
              if (p.points !== points) {
                await db.update(prediction).set({ points }).where(eq(prediction.id, p.id))
              }
            }
          }
        } else {
          // Insert new match for this room
          const [inserted] = await db
            .insert(match)
            .values({
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
            .returning()

          totalInserted++

          // Recalculate prediction points just in case the newly inserted match is already finished
          if (inserted && finished && scoreHome !== null && scoreAway !== null) {
            const preds = await db.select().from(prediction).where(eq(prediction.matchId, inserted.id))
            for (const p of preds) {
              const points = calcularPuntos(p.homeScore, p.awayScore, scoreHome, scoreAway)
              if (p.points !== points) {
                await db.update(prediction).set({ points }).where(eq(prediction.id, p.id))
              }
            }
          }
        }
      }
    }

    revalidatePath("/", "layout")

    return NextResponse.json({
      ok: true,
      roomsSynced: allRooms.length,
      inserted: totalInserted,
      updated: totalUpdated,
    })
  } catch (error: any) {
    console.error("Cron sync matches error:", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
