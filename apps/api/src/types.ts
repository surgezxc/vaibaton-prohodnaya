import type { Hono } from "hono";

export type Role = "worker" | "gate" | "admin" | "manager";

export type AuthUser = {
  sub: string;
  roles: string[];
};

export type AppEnv = {
  Variables: {
    user: AuthUser;
  };
};

export type ApiApp = Hono<AppEnv>;

export type Direction = "in" | "out";

export type ReasonCode =
  | "NO_SUCH_PERSON"
  | "EXPIRED"
  | "ALREADY_INSIDE"
  | "NOT_INSIDE"
  | "PROOF_MISSING"
  | "PROOF_REPLAY"
  | "PROOF_FOREIGN"
  | "FACE_NO_MATCH"
  | "FACE_QUALITY"
  | "FACE_NOT_ENROLLED"
  | "MIXED_IDENTITY"
  | "REPLAY"
  | "SERVER_ERROR";
