import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // 인증 체크 로직 주석 처리 (로그인 없이 데이터 표시)
  // try {
  //   user = await sdk.authenticateRequest(opts.req);
  // } catch (error) {
  //   // Authentication is optional for public procedures.
  //   user = null;
  // }

  return {
    req: opts.req,
    res: opts.res,
    user,  // 항상 null (로그인 불필요)
  };
}
