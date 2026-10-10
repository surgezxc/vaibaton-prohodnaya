import type pg from "pg";
import { isUniqueViolation, withTx } from "../db.js";
import { compareFace, FaceNotReady, FaceResultMissing, normalizeImage, type CompareResult } from "./outbound.js";
import { decisionBody } from "../http.js";
import { writeJournal } from "../journal.js";
import type { Direction, ReasonCode } from "../types.js";

type AttemptRow = {
  id: string;
  direction: Direction;
  nonce: string;
  status: string;
  used: boolean;
  person_id: string | null;
  gate_sub: string;
  stale: boolean;
};

type ShiftRow = {
  id: string;
  started_at: Date;
  ended_at: Date | null;
};

const TEXT = {
  missing: "Попытка не найдена.",
  replay: "Этот код уже использован. Повторный проход невозможен.",
  expired: "QR устарел. Откройте новый код на планшете.",
  cancelled: "Код отменён. Откройте QR заново.",
  nonce: "Код не совпадает с этой попыткой.",
  proof: "Телефон ещё не подтвердил этот код.",
  frame: "Нет кадра с проходной.",
  inside: "Человек уже на объекте. Вторая смена не открыта.",
  outside: "Человек уже вне объекта. Открытой смены нет.",
  enrolled: "Эталон лица не сохранён. Проход невозможен.",
  notReady: "Распознавание лиц не готово. Проход невозможен.",
  noResult: "Нет результата проверки лица.",
  noFace: "В кадре нет лица.",
  manyFaces: "В кадре несколько лиц.",
  notLive: "Не удалось подтвердить живое лицо.",
  noMatch: "Лицо не совпало с эталоном.",
  allowIn: "Проход разрешён. Смена открыта.",
  allowOut: "Проход разрешён. Смена закрыта.",
} as const;

function outcome(
  decision: "allow" | "deny",
  reason: string,
  reasonCode: ReasonCode | null,
  shift?: ShiftRow,
) {
  return {
    http: 200 as const,
    body: decisionBody(
      decision,
      reason,
      reasonCode,
      shift
        ? {
            shift_id: shift.id,
            started_at: shift.started_at.toISOString(),
            ended_at: shift.ended_at ? shift.ended_at.toISOString() : null,
          }
        : undefined,
    ),
  };
}

export async function decidePass(
  pool: pg.Pool,
  input: {
    attemptId: string;
    gateSub: string;
    nonce: string | null;
    imageBase64: string | null;
  },
): Promise<{ http: 200 | 404; body: Record<string, unknown> }> {
  return withTx(pool, async (client) => {
    // Та же транзакция, что и журнал. Строка перечитана и заблокирована:
    // не отменена, не использована, ttl жив. Обрыв websocket или wifi
    // статус не меняет — cancelled ставит только POST /cancel, пока клиент достучался.
    const locked = await client.query<AttemptRow>(
      `SELECT id, direction, nonce, status, used, person_id, gate_sub, (expires_at <= now()) AS stale
       FROM attempts WHERE id = $1 FOR UPDATE`,
      [input.attemptId],
    );
    const attempt = locked.rows[0];
    if (!attempt || attempt.gate_sub !== input.gateSub) {
      return { http: 404 as const, body: decisionBody("deny", TEXT.missing, "NO_SUCH_PERSON") };
    }

    const journal = async (
      reason: string,
      decision: "allow" | "deny",
      reasonCode: ReasonCode | null,
      factors?: Record<string, unknown>,
    ) => {
      const what = decision === "allow" ? (attempt.direction === "in" ? "вход" : "выход") : "отказ";
      await writeJournal(client, {
        personId: attempt.person_id,
        actorSub: input.gateSub,
        what,
        direction: attempt.direction,
        decision,
        reason,
        attemptId: attempt.id,
        reasonCode,
        factors,
      });
    };

    const consume = async (reason: string) => {
      await client.query(
        `UPDATE attempts
         SET status = 'decided', used = true, decision = 'deny', reason = $2, decided_at = now()
         WHERE id = $1`,
        [attempt.id, reason],
      );
    };

    if (attempt.status === "cancelled") {
      await consume(TEXT.cancelled);
      await journal(TEXT.cancelled, "deny", "EXPIRED");
      return outcome("deny", TEXT.cancelled, "EXPIRED");
    }

    if (attempt.used || attempt.status === "decided") {
      await journal(TEXT.replay, "deny", "REPLAY");
      return outcome("deny", TEXT.replay, "REPLAY");
    }

    if (attempt.stale) {
      await consume(TEXT.expired);
      await journal(TEXT.expired, "deny", "EXPIRED");
      return outcome("deny", TEXT.expired, "EXPIRED");
    }

    if (!input.nonce || input.nonce !== attempt.nonce) {
      await consume(TEXT.nonce);
      await journal(TEXT.nonce, "deny", "PROOF_MISSING");
      return outcome("deny", TEXT.nonce, "PROOF_MISSING");
    }

    if (attempt.status !== "scanned" || !attempt.person_id) {
      await consume(TEXT.proof);
      await journal(TEXT.proof, "deny", "PROOF_MISSING");
      return outcome("deny", TEXT.proof, "PROOF_MISSING");
    }

    if (!input.imageBase64) {
      await consume(TEXT.frame);
      await journal(TEXT.frame, "deny", "FACE_QUALITY");
      return outcome("deny", TEXT.frame, "FACE_QUALITY");
    }

    const image = normalizeImage(input.imageBase64);
    if (image.length < 8 || image.length > 8_000_000) {
      await consume(TEXT.frame);
      await journal(TEXT.frame, "deny", "FACE_QUALITY");
      return outcome("deny", TEXT.frame, "FACE_QUALITY");
    }

    const open = await client.query<ShiftRow>(
      `SELECT id, started_at, ended_at FROM shifts
       WHERE person_id = $1 AND ended_at IS NULL
       FOR UPDATE`,
      [attempt.person_id],
    );
    const openShift = open.rows[0] ?? null;

    if (attempt.direction === "in" && openShift) {
      await consume(TEXT.inside);
      await journal(TEXT.inside, "deny", "ALREADY_INSIDE");
      return outcome("deny", TEXT.inside, "ALREADY_INSIDE");
    }
    if (attempt.direction === "out" && !openShift) {
      await consume(TEXT.outside);
      await journal(TEXT.outside, "deny", "NOT_INSIDE");
      return outcome("deny", TEXT.outside, "NOT_INSIDE");
    }

    const person = await client.query<{ embedding: number[] | null }>(
      "SELECT embedding FROM people WHERE id = $1",
      [attempt.person_id],
    );
    const embedding = person.rows[0]?.embedding;
    if (!embedding || !Array.isArray(embedding) || embedding.length < 1) {
      await consume(TEXT.enrolled);
      await journal(TEXT.enrolled, "deny", "FACE_NOT_ENROLLED");
      return outcome("deny", TEXT.enrolled, "FACE_NOT_ENROLLED");
    }

    let compared: CompareResult;
    try {
      compared = await compareFace(embedding, image);
    } catch (error) {
      if (error instanceof FaceNotReady) {
        await consume(TEXT.notReady);
        await journal(TEXT.notReady, "deny", "SERVER_ERROR");
        return outcome("deny", TEXT.notReady, "SERVER_ERROR");
      }
      if (error instanceof FaceResultMissing) {
        await consume(TEXT.noResult);
        await journal(TEXT.noResult, "deny", "SERVER_ERROR");
        return outcome("deny", TEXT.noResult, "SERVER_ERROR");
      }
      throw error;
    }

    const factors = {
      face_count: compared.face_count,
      face_score: compared.score,
      live: compared.live,
      match: compared.match,
    };

    let faceReason: string | null = null;
    let faceCode: ReasonCode = "FACE_QUALITY";
    if (compared.face_count <= 0) {
      faceReason = TEXT.noFace;
    } else if (compared.face_count >= 2) {
      faceReason = TEXT.manyFaces;
    } else if (!compared.live) {
      faceReason = TEXT.notLive;
    } else if (!compared.match) {
      faceReason = TEXT.noMatch;
      faceCode = "FACE_NO_MATCH";
    }
    if (faceReason) {
      await consume(faceReason);
      await journal(faceReason, "deny", faceCode, factors);
      return outcome("deny", faceReason, faceCode);
    }

    let shift: ShiftRow;
    if (attempt.direction === "in") {
      try {
        await client.query("SAVEPOINT open_shift");
        const inserted = await client.query<ShiftRow>(
          `INSERT INTO shifts (person_id, opened_attempt_id)
           VALUES ($1, $2)
           RETURNING id, started_at, ended_at`,
          [attempt.person_id, attempt.id],
        );
        await client.query("RELEASE SAVEPOINT open_shift");
        shift = inserted.rows[0];
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT open_shift");
        if (!isUniqueViolation(error)) throw error;
        await consume(TEXT.inside);
        await journal(TEXT.inside, "deny", "ALREADY_INSIDE");
        return outcome("deny", TEXT.inside, "ALREADY_INSIDE");
      }
    } else {
      const closed = await client.query<ShiftRow>(
        `UPDATE shifts
         SET ended_at = now(),
             duration_seconds = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - started_at)))::int),
             closed_attempt_id = $2
         WHERE id = $1 AND ended_at IS NULL
         RETURNING id, started_at, ended_at`,
        [openShift!.id, attempt.id],
      );
      shift = closed.rows[0];
      await client.query(
        `UPDATE visits SET ended_at = now() WHERE shift_id = $1 AND ended_at IS NULL`,
        [shift.id],
      );
    }

    const reason = attempt.direction === "in" ? TEXT.allowIn : TEXT.allowOut;
    await client.query(
      `UPDATE attempts
       SET status = 'decided', used = true, decision = 'allow', reason = $2, decided_at = now()
       WHERE id = $1`,
      [attempt.id, reason],
    );
    await journal(reason, "allow", null, factors);
    return outcome("allow", reason, null, shift);
  });
}
