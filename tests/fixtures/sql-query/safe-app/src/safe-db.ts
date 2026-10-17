export async function getSafeUser(db: any, id: string) {
  // Parameterized query using bind variables
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}

export async function getSafeSorted(db: any, isDesc: boolean) {
  if (isDesc) {
    return db.query("SELECT * FROM users ORDER BY created_at DESC");
  }
  return db.query("SELECT * FROM users ORDER BY created_at ASC");
}
