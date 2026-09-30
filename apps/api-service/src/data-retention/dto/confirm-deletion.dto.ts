import { IsIn, IsString, Length } from "class-validator";

export const CONFIRM_DELETION_TOKEN = "DELETE" as const;

/**
 * Destructive endpoints require the literal string "DELETE" in the body so a
 * stray/replayed request can't trigger irreversible deletion, mirroring the
 * explicit-approval pattern already used for destructive migrations
 * (see docs/MIGRATION_SAFETY.md).
 *
 * The confirmation token is normalized (trimmed and uppercased) before
 * comparison so casing or accidental whitespace does not bypass the guard.
 */
export class ConfirmDeletionDto {
  @IsString()
  @Length(1, 64)
  @IsIn([CONFIRM_DELETION_TOKEN])
  confirm: "DELETE";
}
