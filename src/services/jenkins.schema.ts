import { z } from 'zod';

export const JenkinsBuildSchema = z.object({
  number: z.number(),
  url: z.string().url(),
  result: z.enum(['SUCCESS', 'FAILURE', 'UNSTABLE', 'ABORTED']).nullable(),
  timestamp: z.number(),
  actions: z.array(z.object({
    causes: z.array(z.object({
      userId: z.string().optional(),
      userName: z.string().optional(),
      shortDescription: z.string().optional(),
    })).optional(),
  })).optional(),
  changeSet: z.object({
    items: z.array(z.object({
      authorEmail: z.string().optional(),
    })).optional(),
  }).optional(),
});

export const JenkinsBranchSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  builds: z.array(JenkinsBuildSchema).optional(),
});

export const JenkinsJobResponseSchema = z.object({
  builds: z.array(JenkinsBuildSchema).optional(),
  jobs: z.array(JenkinsBranchSchema).optional(),
});

export type JenkinsBuild = z.infer<typeof JenkinsBuildSchema>;
export type JenkinsJobResponse = z.infer<typeof JenkinsJobResponseSchema>;
