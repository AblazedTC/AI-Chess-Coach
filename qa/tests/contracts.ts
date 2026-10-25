import { z } from "zod";

const nonempty = z.string().min(1);
const integer = z.number().int().nonnegative();
const position = z.looseObject({
  ply: integer,
  fen: nonempty,
  position_key: nonempty,
});

export const gameSchema = z.looseObject({
  id: nonempty,
  pgn: nonempty,
  positions: z.array(position).min(1),
  moves: z.array(z.looseObject({ ply: integer, san: nonempty, uci: nonempty })),
});

export const healthSchema = z.object({
  status: z.literal("ok"),
  engine_mode: z.enum(["demo", "stockfish"]),
  coach_mode: z.enum(["deterministic", "anthropic"]),
});

export const errorSchema = z.looseObject({
  error: z.looseObject({ code: nonempty, message: nonempty }),
  request_id: nonempty,
});

export const analysisSchema = z.looseObject({
  game_id: nonempty,
  ply: integer,
  position_key: nonempty,
  source: z.enum(["demo", "stockfish"]),
  score: z.object({ kind: z.enum(["cp", "mate"]), value: z.number().finite() }),
  depth: integer.nullable(),
  classification: z.string().nullable(),
  loss_cp: z.number().finite().nullable(),
});

export const jobSchema = z.looseObject({
  id: nonempty,
  game_id: nonempty,
  status: z.enum(["queued", "running", "completed", "cancelled", "failed"]),
  completed: integer,
  total: integer,
  analyses: z.array(analysisSchema),
});

export const coachSchema = z.looseObject({
  game_id: nonempty,
  ply: integer,
  position_key: nonempty,
  mode: z.enum(["deterministic", "anthropic"]),
  message: nonempty,
  citations: z.array(nonempty),
  suggested_moves: z.array(
    z.object({ san: nonempty, uci: nonempty, engine_verified: z.boolean() }),
  ),
});

export const practiceSchema = z.looseObject({
  fen: nonempty,
  position_key: nonempty,
  moves: z.array(nonempty),
  legal_moves: z.array(nonempty),
  is_game_over: z.boolean(),
});

export const insightsSchema = z.looseObject({
  games_analyzed: integer,
  summary: nonempty,
  limitations: z.union([nonempty, z.array(nonempty)]),
  themes: z.array(
    z.looseObject({
      name: nonempty,
      description: nonempty,
      count: integer,
      supporting_positions: z.array(
        z.object({ game_id: nonempty, ply: integer, position_key: nonempty }),
      ),
    }),
  ),
});

export type Game = z.infer<typeof gameSchema>;

export async function readJson<S extends z.ZodType>(
  response: { json(): Promise<unknown> },
  schema: S,
): Promise<z.output<S>> {
  return schema.parse(await response.json());
}

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Missing fixture item at index ${index}`);
  return item;
}

export function positionAt(game: Game, ply: number) {
  const position = at(game.positions, ply);
  if (position.ply !== ply) throw new Error(`Position ${ply} has incorrect ply ${position.ply}`);
  return position;
}
