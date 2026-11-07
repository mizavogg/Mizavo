/* Mizavo — why a question can be reported. Shared by the game and the admin page.
   The keys must match the database's reports_reason_check. */
export const REPORT_REASONS = {
  wrong_answer: 'The answer is wrong',
  outdated: "It's out of date",
  unclear: 'The wording is unclear',
  too_local: 'Too local (not known worldwide)',
  offensive: 'Offensive or upsetting',
  typo: 'Typo or spelling',
  other: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
