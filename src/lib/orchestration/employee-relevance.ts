import type { AIEmployeeProfile } from "./types";

export type RankedEmployee = {
  employeeId: string;
  score: number;
  reason: string;
  matchedRoleSignals: string[];
};

type SignalRule = {
  pattern: RegExp;
  roleKeys: string[];
  signals: string[];
  boost: number;
};

const SIGNAL_RULES: SignalRule[] = [
  {
    pattern: /\b(market|industry|competitor|landscape|research|segment|trend)\b/i,
    roleKeys: ["research", "business_analyst", "market_research"],
    signals: ["market", "research"],
    boost: 14,
  },
  {
    pattern: /\b(sales|outreach|leads?|pipeline|prospect|sdr|cold email)\b/i,
    roleKeys: ["sales"],
    signals: ["sales", "outreach"],
    boost: 14,
  },
  {
    pattern: /\b(bug|build|code|ship|feature|api|deploy|engineering|software)\b/i,
    roleKeys: ["engineering", "gamedev", "full_stack"],
    signals: ["engineering"],
    boost: 14,
  },
  {
    pattern: /\b(test|qa|regression|quality assurance)\b/i,
    roleKeys: ["qa", "engineering"],
    signals: ["qa"],
    boost: 12,
  },
  {
    pattern: /\b(copy|landing page|campaign|content|marketing|brand)\b/i,
    roleKeys: ["marketing", "copywriter", "content"],
    signals: ["marketing"],
    boost: 12,
  },
  {
    pattern: /\b(customer|ticket|support|helpdesk|success)\b/i,
    roleKeys: ["support", "customer_success"],
    signals: ["support"],
    boost: 12,
  },
  {
    pattern: /\b(task|timeline|coordinate|project|roadmap|plan)\b/i,
    roleKeys: ["pm", "operations"],
    signals: ["operations"],
    boost: 11,
  },
  {
    pattern: /\b(budget|forecast|pricing|margin|revenue|financial)\b/i,
    roleKeys: ["finance", "business_analyst", "operations"],
    signals: ["finance"],
    boost: 12,
  },
  {
    pattern: /\b(product|prd|roadmap|user story)\b/i,
    roleKeys: ["pm", "product"],
    signals: ["product"],
    boost: 12,
  },
  {
    pattern: /\b(design|ui|ux|wireframe|prototype)\b/i,
    roleKeys: ["design"],
    signals: ["design"],
    boost: 11,
  },
];

function roleKeyMatches(employee: AIEmployeeProfile, keys: string[]): boolean {
  const roleKey = (employee.roleKey ?? "").toLowerCase();
  const role = employee.role.toLowerCase();
  return keys.some(
    (key) => roleKey.includes(key) || role.includes(key.replace("_", " ")),
  );
}

export function rankEmployeesForMessage(
  messageText: string,
  employees: AIEmployeeProfile[],
): RankedEmployee[] {
  const lower = messageText.toLowerCase();
  const scores = new Map<string, RankedEmployee>();

  for (const employee of employees) {
    let score = 0;
    const matchedRoleSignals: string[] = [];

    if (lower.includes(employee.name.toLowerCase())) {
      score += 20;
      matchedRoleSignals.push("name_mention");
    }

    for (const rule of SIGNAL_RULES) {
      if (!rule.pattern.test(messageText)) continue;
      if (roleKeyMatches(employee, rule.roleKeys)) {
        score += rule.boost;
        matchedRoleSignals.push(...rule.signals);
      }
    }

    const instructionBlob = `${employee.role} ${employee.instructions ?? ""}`.toLowerCase();
    for (const rule of SIGNAL_RULES) {
      if (!rule.pattern.test(messageText)) continue;
      for (const signal of rule.signals) {
        if (instructionBlob.includes(signal)) {
          score += 4;
          if (!matchedRoleSignals.includes(signal)) matchedRoleSignals.push(signal);
        }
      }
    }

    if (score > 0) {
      scores.set(employee.id, {
        employeeId: employee.id,
        score,
        reason:
          matchedRoleSignals.length > 0
            ? `Matched ${matchedRoleSignals.slice(0, 3).join(", ")}`
            : "Role relevance",
        matchedRoleSignals,
      });
    }
  }

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

export function topEmployeesForMessage(
  messageText: string,
  employees: AIEmployeeProfile[],
  limit = 3,
): RankedEmployee[] {
  return rankEmployeesForMessage(messageText, employees).slice(0, limit);
}
