export async function getUser(db: any, req: any) {
  const userId = req.query.id;

  // Incomplete sanitization
  const cleaned = userId.replace(/'/g, "''");

  // Dynamic concatenation in query
  const result = await db.query("SELECT * FROM users WHERE id = " + cleaned);
  return result;
}

export async function runPrismaRaw(prisma: any, userQuery: string) {
  // Unsafe raw API without parameter bindings
  return prisma.$queryRawUnsafe(userQuery);
}

export function buildSortedQuery(sortCol: string) {
  // Dynamic identifier interpolation
  return "SELECT * FROM logs ORDER BY " + sortCol;
}
