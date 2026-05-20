export type ValidationPlanSemanticFailure = {
  code: string;
  message: string;
};

export type ValidationPlanSemanticResult = {
  ok: boolean;
  failures: ValidationPlanSemanticFailure[];
};

function hasOwnBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function validateValidationPlanSemantics(plan: any): ValidationPlanSemanticResult {
  const failures: ValidationPlanSemanticFailure[] = [];
  const applied = plan?.apply?.applied === true;
  const verification = plan?.verification && typeof plan.verification === 'object' ? plan.verification : null;

  if (verification) {
    if (verification.applied !== applied) {
      failures.push({
        code: 'verification_applied_mismatch',
        message: 'validationPlan.verification.applied must match validationPlan.apply.applied.',
      });
    }
    if (applied && !hasOwnBoolean(verification.appliedDiffMatchesSnapshot)) {
      failures.push({
        code: 'verification_applied_diff_match_missing',
        message: 'Applied validation plans must record boolean verification.appliedDiffMatchesSnapshot.',
      });
    }
    if (!applied && verification.appliedDiffMatchesSnapshot !== null) {
      failures.push({
        code: 'verification_preview_diff_match_not_applicable',
        message: 'Preview/refused validation plans must keep verification.appliedDiffMatchesSnapshot null.',
      });
    }
  }

  return { ok: failures.length === 0, failures };
}
