"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { LeaderboardRow } from "@/app/actions/room"
import { Crown, Medal, ArrowUp, ArrowDown, Equal, Target, Check } from "lucide-react"

export function Leaderboard({
  rows,
  currentUserId,
}: {
  rows: LeaderboardRow[]
  currentUserId: string
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        Aún no hay jugadores en la clasificación.
      </p>
    )
  }

  const medalColor = ["text-amber-500", "text-zinc-400", "text-amber-700"]

  return (
    <ol className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const isMe = row.userId === currentUserId
        return (
          <li
            key={row.userId}
            className={cn(
              "flex items-center gap-3 rounded-2xl border border-border bg-card p-3",
              isMe && "border-primary/60 ring-1 ring-primary/30",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
              {i < 3 ? <Medal className={cn("h-4 w-4", medalColor[i])} /> : i + 1}
            </span>

            <span className="shrink-0 flex items-center justify-center" title={
              row.positionChange === "up" ? "Subió de posición esta semana" :
              row.positionChange === "down" ? "Bajó de posición esta semana" :
              "Se mantuvo en la misma posición"
            }>
              {row.positionChange === "up" && (
                <ArrowUp className="h-4 w-4 text-emerald-500 animate-bounce" style={{ animationDuration: '2.5s' }} />
              )}
              {row.positionChange === "down" && (
                <ArrowDown className="h-4 w-4 text-red-500 animate-pulse" style={{ animationDuration: '3s' }} />
              )}
              {row.positionChange === "same" && (
                <Equal className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-card-foreground">{row.userName}</span>
                {row.isAdmin && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                {isMe && (
                  <Badge variant="outline" className="ml-1 shrink-0">
                    Tú
                  </Badge>
                )}
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2.5">
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-0.5" title={`${row.clavadas} ${row.clavadas === 1 ? "clavada" : "clavadas"}`}>
                  <Target className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span>{row.clavadas}</span>
                </span>
                <span className="flex items-center gap-0.5" title={`${row.aciertos} ${row.aciertos === 1 ? "acierto" : "aciertos"} (sin clavar)`}>
                  <Check className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span>{row.aciertos}</span>
                </span>
              </div>
              <span className="text-base font-bold text-primary">
                {row.points} {row.points === 1 ? "pt" : "pts"}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
