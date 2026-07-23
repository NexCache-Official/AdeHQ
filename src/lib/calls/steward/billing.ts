export type AiContributionCharge = {
  employeeId: string;
  workHours: number;
  contribution: "specialist" | "lead_synthesis" | "single_turn";
};

export type CallBillingMetadata = {
  schema: "call_steward_billing_v1";
  callMinutes: {
    streamCount: 1;
    multipliedByInvitedAi: false;
  };
  workHours: {
    basis: "actual_ai_contributions";
    contributions: AiContributionCharge[];
    total: number;
  };
};

export function createCallBillingMetadata(
  contributions: AiContributionCharge[],
): CallBillingMetadata {
  const actual = contributions
    .filter(
      (contribution) =>
        contribution.employeeId.trim() &&
        Number.isFinite(contribution.workHours) &&
        contribution.workHours >= 0,
    )
    .map((contribution) => ({
      ...contribution,
      workHours: Number(contribution.workHours),
    }));
  return {
    schema: "call_steward_billing_v1",
    callMinutes: {
      streamCount: 1,
      multipliedByInvitedAi: false,
    },
    workHours: {
      basis: "actual_ai_contributions",
      contributions: actual,
      total: actual.reduce((total, contribution) => total + contribution.workHours, 0),
    },
  };
}
