import { resourceScope, scopeResourceRead, normalizeLegacyFindings } from "./resource-visibility.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient, type Prisma } from "@prisma/client";

// Existing callers retain the singleton API. Only explicitly guarded governance
// handlers use the transaction-scoped client; unrelated callers are unchanged.
export const databaseClient = new PrismaClient();
databaseClient.$use(async (params, next) => {
  const tenantId = resourceScope.getStore()?.tenantId;
  if (tenantId && params.model && ["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"].includes(params.action)) {
    params.args ??= {};
    params.args = scopeResourceRead(params.model, params.args, tenantId, true, params.action.startsWith("find"));
  }
  const result = await next(params);
  return tenantId ? normalizeLegacyFindings(result, params.model ?? "") : result;
});
export interface GovernanceTransaction {
  client: Prisma.TransactionClient;
  tenantId: string;
  retirementApproval: boolean;
  retiredSystemIds: Set<string>;
  records: Record<string, Record<string, unknown>[]>;
  conflict?: { statusCode: number; message: string };
  deniedAudits?: Prisma.AuditEventUncheckedCreateInput[];
}
export const governanceTransaction =
  new AsyncLocalStorage<GovernanceTransaction>();
export const prisma: PrismaClient = new Proxy(databaseClient, {
  get(target, property) {
    const context = governanceTransaction.getStore();
    if (context && property === "$transaction") {
      return async (operation: unknown) => {
        if (typeof operation === "function") return operation(context.client);
        throw new Error(
          "Array transactions cannot be nested in a governance handler",
        );
      };
    }
    const source = context?.client ?? target;
    const value = Reflect.get(source, property);
    return typeof value === "function" ? value.bind(source) : value;
  },
});

export * from "@prisma/client";
