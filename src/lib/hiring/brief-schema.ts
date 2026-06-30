import { z } from "zod";

export const briefSchema = z.object({
  roleTitle: z.string(),
  department: z.string(),
  domain: z.string(),
  mission: z.string(),
  coreResponsibilities: z.array(z.string()).min(1).max(10),
  technicalFocus: z.array(z.string()).max(8).optional().default([]),
  businessFocus: z.array(z.string()).max(8).optional().default([]),
  successMetrics: z.array(z.string()).min(1).max(8),
  communicationStyle: z.string(),
  personalityTraits: z.array(z.string()).max(8).optional().default([]),
  proactivityLevel: z.enum(["low", "balanced", "high"]),
  qualityPreference: z.enum(["speed", "balanced", "quality"]),
  seniorityLevel: z.enum(["assistant", "specialist", "manager", "director", "advisor"]),
  autonomyLevel: z.enum(["low", "balanced", "high"]),
  approvalRules: z.array(z.string()).min(1).max(8),
  toolsNeeded: z.array(z.string()).max(10).optional().default([]),
});

export const checklistSchema = z.object({
  roleKnown: z.boolean(),
  domainKnown: z.boolean(),
  coreWorkKnown: z.boolean(),
  workStyleKnown: z.boolean(),
  communicationKnown: z.boolean(),
});

export const recruiterResponseSchema = z.object({
  message: z.string(),
  chips: z.array(z.string()).max(8),
  briefReady: z.boolean(),
  brief: briefSchema.optional(),
  briefPartial: briefSchema.partial().optional(),
  checklist: checklistSchema.optional(),
});

export const applicantCopySchema = z.object({
  high_capacity: z
    .object({
      name: z.string().optional(),
      title: z.string().optional(),
      personalityTags: z.array(z.string()).optional(),
      strengths: z.array(z.string()).optional(),
      watchOuts: z.array(z.string()).optional(),
      bestFor: z.string().optional(),
      whyThisCandidate: z.string().optional(),
    })
    .optional(),
  recommended: z
    .object({
      name: z.string().optional(),
      title: z.string().optional(),
      personalityTags: z.array(z.string()).optional(),
      strengths: z.array(z.string()).optional(),
      watchOuts: z.array(z.string()).optional(),
      bestFor: z.string().optional(),
      whyThisCandidate: z.string().optional(),
    })
    .optional(),
  premium: z
    .object({
      name: z.string().optional(),
      title: z.string().optional(),
      personalityTags: z.array(z.string()).optional(),
      strengths: z.array(z.string()).optional(),
      watchOuts: z.array(z.string()).optional(),
      bestFor: z.string().optional(),
      whyThisCandidate: z.string().optional(),
    })
    .optional(),
});
