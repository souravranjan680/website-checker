/** Viewports used by the responsive checker (Module 7). */
export const VIEWPORTS = [
  { name: 'Desktop', width: 1920, height: 1080 },
  { name: 'Laptop', width: 1366, height: 768 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
  { name: 'Small mobile', width: 320, height: 568 },
] as const;

/** Most severe first. Mirrors the Prisma `Severity` enum. */
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type SeverityName = (typeof SEVERITIES)[number];
