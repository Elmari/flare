import { z } from 'zod';

const ChangeSetSchema = z.object({
  items: z.array(z.object({
    authorEmail: z.string().optional(),
    timestamp: z.number().optional(),
  })).optional(),
});

export const JenkinsBuildSchema = z.object({
  number: z.number(),
  url: z.url(),
  result: z.enum(['SUCCESS', 'FAILURE', 'UNSTABLE', 'ABORTED']).nullable(),
  timestamp: z.number(),
  actions: z.array(z.object({
    causes: z.array(z.object({
      userId: z.string().optional(),
      userName: z.string().optional(),
      shortDescription: z.string().optional(),
    })).optional(),
  })).optional(),
  // Freestyle jobs expose a single `changeSet`; Pipeline (and most modern
  // multibranch jobs with a Jenkinsfile) exposes a plural `changeSets[]`.
  // Accept both so commit authors surface in either shape.
  changeSet: ChangeSetSchema.optional(),
  changeSets: z.array(ChangeSetSchema).optional(),
});

export const JenkinsBranchSchema = z.object({
  name: z.string(),
  url: z.url(),
  builds: z.array(JenkinsBuildSchema).optional(),
});

export const JenkinsJobResponseSchema = z.object({
  builds: z.array(JenkinsBuildSchema).optional(),
  jobs: z.array(JenkinsBranchSchema).optional(),
});

// Status values returned by Jenkins workflow-api-plugin (wfapi/describe).
// See: https://github.com/jenkinsci/workflow-api-plugin
const WorkflowStageStatusSchema = z.enum([
  'SUCCESS',
  'FAILED',
  'IN_PROGRESS',
  'PAUSED_PENDING_INPUT',
  'ABORTED',
  'UNSTABLE',
  'NOT_EXECUTED',
  'QUEUED',
  'SKIPPED',
]);

export const WorkflowStageSchema = z.object({
  name: z.string().optional(),
  status: WorkflowStageStatusSchema,
});

export const WorkflowRunSchema = z.object({
  status: WorkflowStageStatusSchema.optional(),
  stages: z.array(WorkflowStageSchema).optional(),
});

export type JenkinsBuild = z.infer<typeof JenkinsBuildSchema>;
export type JenkinsJobResponse = z.infer<typeof JenkinsJobResponseSchema>;
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
