import { z } from "zod";

export const reviewContentSchema = z.object({
  displayName: z.string().trim().min(1).max(40).default("Guest"),
  body: z.string().trim().min(20, "Write at least 20 characters.").max(4000, "Keep reviews under 4000 characters."),
  rating: z.number().int().min(1).max(10),
});

export const reviewUpdateSchema = z.object({
  body: z.string().trim().min(20).max(4000).optional(),
  rating: z.number().int().min(1).max(10).optional(),
}).refine((value) => value.body !== undefined || value.rating !== undefined, "Change the review text or rating.");

export const reviewListQuerySchema = z.object({
  sort: z.enum(["recent", "helpful", "controversial"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(6),
});

export const reviewFlagSchema = z.object({
  reason: z.enum(["spam", "abuse", "spoiler", "other"]),
});

export const reviewVoteSchema = z.object({ helpful: z.boolean() });

export type ReviewContentInput = z.infer<typeof reviewContentSchema>;
export type ReviewUpdateInput = z.infer<typeof reviewUpdateSchema>;
export type ReviewSort = z.infer<typeof reviewListQuerySchema>["sort"];