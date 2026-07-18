"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { savePrediction, type MatchWithPrediction } from "@/app/actions/room"
import { CalendarDays, ChevronDown, ChevronRight } from "lucide-react"

export function MatchList({
  roomId,
  matches,
  isAdmin,
  userId,
}: {
  roomId: number
  matches: MatchWithPrediction[]
  isAdmin: boolean
  userId: string
}) {
  const byWeek = useMemo(() => {
    const map = new Map<number, MatchWithPrediction[]>()
    for (const m of matches) {
      const arr = map.get(m.week) ?? []
      arr.push(m)
      map.set(m.week, arr)
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0])
  }, [matches])

  if (matches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarDays className="h-6 w-6" />
        </span>
        <p className="text-sm font-medium text-foreground">Todavía no hay partidos</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? "Añade los partidos de la semana en la pestaña Admin." : "El admin aún no ha añadido partidos."}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {byWeek.map(([week, weekMatches]) => (
        <WeekSection
          key={week}
          week={week}
          weekMatches={weekMatches}
          roomId={roomId}
          userId={userId}
        />
      ))}
    </div>
  )
}

function WeekSection({
  week,
  weekMatches,
  roomId,
  userId,
}: {
  week: number
  weekMatches: MatchWithPrediction[]
  roomId: number
  userId: string
}) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <section>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="mb-2 flex items-center justify-between w-full text-left text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors py-1 rounded-lg outline-none"
      >
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" /> Jornada {week}
        </span>
        <span className="text-xs font-normal text-muted-foreground/80 flex items-center gap-1 select-none">
          {weekMatches.length} {weekMatches.length === 1 ? "partido" : "partidos"}
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
          {weekMatches.map((m) => (
            <MatchCard key={m.id} roomId={roomId} match={m} userId={userId} />
          ))}
        </div>
      )}
    </section>
  )
}

function MatchCard({ roomId, match, userId }: { roomId: number; match: MatchWithPrediction; userId: string }) {
  const [home, setHome] = useState(match.myPrediction ? String(match.myPrediction.homeScore) : "")
  const [away, setAway] = useState(match.myPrediction ? String(match.myPrediction.awayScore) : "")
  const [pending, startTransition] = useTransition()
  const [showBets, setShowBets] = useState(false)

  const isPastStartTime = match.startTime ? new Date() >= new Date(match.startTime) : false
  const isLocked = match.finished || isPastStartTime

  const save = () => {
    if (isLocked) {
      toast.error("Las apuestas están cerradas para este partido.")
      return
    }
    const h = Number(home)
    const a = Number(away)
    if (home === "" || away === "" || !Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
      toast.error("Introduce un marcador válido")
      return
    }
    startTransition(async () => {
      const res = await savePrediction(roomId, match.id, h, a)
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo guardar")
        return
      }
      toast.success("Predicción guardada")
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {match.startTime && (
        <div className="mb-3 flex justify-center">
          <span className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider bg-secondary/40 px-2.5 py-0.5 rounded-full">
            {new Date(match.startTime).toLocaleString("es-ES", {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center justify-end gap-2 text-right">
          <span className="text-sm font-semibold text-card-foreground text-balance">{match.homeTeam}</span>
        </div>

        {match.finished ? (
          <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted px-3 py-1.5">
            <span className="text-lg font-bold text-foreground">{match.homeScore}</span>
            <span className="text-muted-foreground">-</span>
            <span className="text-lg font-bold text-foreground">{match.awayScore}</span>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <ScoreInput value={home} onChange={setHome} label={`Goles ${match.homeTeam}`} disabled={isLocked} />
            <span className="text-muted-foreground">-</span>
            <ScoreInput value={away} onChange={setAway} label={`Goles ${match.awayTeam}`} disabled={isLocked} />
          </div>
        )}

        <div className="flex flex-1 items-center gap-2">
          <span className="text-sm font-semibold text-card-foreground text-balance">{match.awayTeam}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {match.finished ? (
              match.myPrediction
                ? `Tu predicción: ${match.myPrediction.homeScore} - ${match.myPrediction.awayScore}`
                : "No participaste"
            ) : isPastStartTime ? (
              match.myPrediction
                ? `Tu predicción: ${match.myPrediction.homeScore} - ${match.myPrediction.awayScore}`
                : "No participaste"
            ) : (
              match.myPrediction
                ? `Tu predicción: ${match.myPrediction.homeScore} - ${match.myPrediction.awayScore}`
                : "Sin predicción todavía"
            )}
          </span>
          <button
            onClick={() => setShowBets(!showBets)}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary transition-colors hover:text-primary/80 w-fit"
          >
            Ver todas las predicciones {showBets ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>

        {match.finished ? (
          match.myPrediction ? (
            <Badge variant={match.myPrediction.points === 4 ? "default" : match.myPrediction.points === 2 ? "secondary" : "outline"}>
              {match.myPrediction.points > 0 ? `+${match.myPrediction.points} ${match.myPrediction.points === 1 ? "punto" : "puntos"}` : "0 puntos"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 bg-muted/40 font-normal">
              Finalizado
            </Badge>
          )
        ) : isPastStartTime ? (
          <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 bg-muted/40 font-normal">
            Apuestas cerradas
          </Badge>
        ) : (
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Guardando..." : match.myPrediction ? "Actualizar" : "Predecir"}
          </Button>
        )}
      </div>

      {showBets && (
        <div className="mt-3 border-t border-border pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="text-[11px] font-bold text-muted-foreground mb-2 uppercase tracking-wider">Pronósticos de la liga:</p>
          {match.allPredictions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nadie ha apostado todavía.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {match.allPredictions.map((p, idx) => {
                const isOwn = p.userId === userId
                const showDetails = isOwn || isLocked
                return (
                  <div key={idx} className="flex items-center justify-between gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs border border-border/20">
                    <span className="truncate font-medium text-muted-foreground max-w-[120px]" title={p.userName}>
                      {p.userName} {isOwn && <span className="text-[10px] text-primary">(Tú)</span>}
                    </span>
                    <span className="font-bold font-mono shrink-0">
                      {showDetails ? (
                        `${p.homeScore} - ${p.awayScore}`
                      ) : (
                        <span className="text-[10px] text-muted-foreground font-normal" title="Disponible al comenzar el partido">🔒 Oculto</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreInput({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  disabled?: boolean
}) {
  return (
    <Input
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
      className="h-11 w-11 text-center text-lg font-bold"
      placeholder="0"
      disabled={disabled}
    />
  )
}
