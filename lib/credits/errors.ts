export class InsufficientCreditsError extends Error {
  readonly code = 'insufficient_credits';
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Insufficient credits: needed ${required}, have ${available}`);
    this.name = 'InsufficientCreditsError';
  }
}

export class AccountSuspendedError extends Error {
  readonly code = 'account_suspended';
  constructor() {
    super('Account is suspended');
    this.name = 'AccountSuspendedError';
  }
}

export class LedgerIntegrityError extends Error {
  readonly code = 'ledger_integrity';
  constructor(message: string) {
    super(message);
    this.name = 'LedgerIntegrityError';
  }
}

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}
