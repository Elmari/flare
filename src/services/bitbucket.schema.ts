import { z } from 'zod';

export const BitbucketPRSchema = z.object({
  id: z.number(),
  title: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'DECLINED']),
  updatedDate: z.number(),
  links: z.object({
    self: z.array(z.object({ href: z.string() })).optional(),
  }).optional(),
  author: z.object({
    user: z.object({
      name: z.string(),
      displayName: z.string().optional(),
      slug: z.string(),
    }),
  }),
  fromRef: z.object({
    displayId: z.string(),
  }).optional(),
  toRef: z.object({
    repository: z.object({
      slug: z.string(),
      project: z.object({ key: z.string() }),
    }),
  }),
  reviewers: z.array(z.object({
    user: z.object({
      name: z.string(),
      slug: z.string(),
    }),
    status: z.enum(['APPROVED', 'NEEDS_WORK', 'UNAPPROVED']).optional(),
  })).optional(),
});

export const BitbucketDashboardResponseSchema = z.object({
  values: z.array(BitbucketPRSchema),
});

export type BitbucketPR = z.infer<typeof BitbucketPRSchema>;
