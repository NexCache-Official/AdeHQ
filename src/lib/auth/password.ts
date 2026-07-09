export type PasswordStrength = {
  hasLength: boolean;
  hasMix: boolean;
  hasNoObviousPattern: boolean;
  score: number;
  passed: boolean;
  label: string;
  percent: number;
};

export function getPasswordStrength(password: string): PasswordStrength {
  const hasLength = password.length >= 8;
  const hasMix =
    [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean)
      .length >= 3;
  const hasNoObviousPattern =
    password.length > 0 &&
    !/(.)\1{2,}/.test(password) &&
    !/(password|adehq|qwerty|123456|letmein)/i.test(password);
  const score = (hasLength ? 1 : 0) + (hasMix ? 2 : 0) + (hasNoObviousPattern ? 1 : 0);
  const passed = hasLength && score >= 3;
  const label = score >= 4 ? "Strong" : score >= 3 ? "Good" : score >= 2 ? "Getting there" : "Too weak";
  const percent = password ? Math.min(100, Math.max(18, score * 25)) : 0;
  return { hasLength, hasMix, hasNoObviousPattern, score, passed, label, percent };
}

export function passwordsMatch(password: string, confirm: string): boolean {
  return password.length > 0 && password === confirm;
}
