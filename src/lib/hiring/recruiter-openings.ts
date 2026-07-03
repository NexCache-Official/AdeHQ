import { departmentLabel, synthesizeBriefForHiringContext } from "./build-brief";
import { MAYA_EMPLOYEE_NAME, MAYA_EMPLOYEE_TITLE } from "./maya";
import { getRoleByKey } from "./role-library";

export function buildRecruiterOpeningMessage(opts: {
  roleSeed?: string;
  roleKey?: string | null;
  departmentId?: string | null;
}): string {
  const role = getRoleByKey(opts.roleKey ?? undefined);
  if (role?.roleKey === "software_engineer") {
    return role.questionTemplates.coreWork;
  }
  if (role) {
    return `Let's bring on a ${role.title}. ${role.questionTemplates.coreWork}`;
  }

  const roleSeed = opts.roleSeed?.trim() ?? "";
  const departmentId = opts.departmentId ?? null;

  if (roleSeed && roleSeed.split(/\s+/).length >= 3) {
    const brief = synthesizeBriefForHiringContext({
      roleSeed,
      departmentId,
      roleKey: opts.roleKey,
    });
    return `Got it — I'll treat this as a ${brief.roleTitle} role. What should they focus on day to day?`;
  }

  if (departmentId && departmentId !== "custom") {
    const dept = departmentLabel(departmentId);
    return `Hi — I'm ${MAYA_EMPLOYEE_NAME}, your AI Workforce Manager. For ${dept}, what kind of employee do you want to hire, and what should they own first?`;
  }

  return "What kind of AI employee do you want to hire, and what should they help with first?";
}
