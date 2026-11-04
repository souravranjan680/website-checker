import type { DashboardTrendPoint } from '@whc/shared';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

/*
 * Chart conventions (see docs/12): thin bars (max 24 px) with 4 px rounded data ends,
 * 2 px lines, recessive grid, one y-axis, a legend whenever there are 2+ series,
 * and a tooltip on every mark. Colours come from CSS variables in index.css so
 * light and dark mode each get their own validated palette.
 */

const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 12 } as const;
const GRID = <CartesianGrid vertical={false} stroke="var(--chart-grid)" />;
const BAR_SIZE = 24;

/** "2026-10-14" → "Oct 14" (UTC, so the label matches the server's day bucket). */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const SEVERITY_CONFIG = {
  count: { label: 'Open issues' },
  CRITICAL: { label: 'Critical', color: 'var(--chart-critical)' },
  HIGH: { label: 'High', color: 'var(--chart-2)' },
  MEDIUM: { label: 'Medium', color: 'var(--chart-warning)' },
  LOW: { label: 'Low', color: 'var(--chart-1)' },
  INFO: { label: 'Info', color: 'var(--chart-neutral)' },
} satisfies ChartConfig;

/** Open issues per severity. Each bar is labelled on the axis, so colour is never the only cue. */
export function SeverityChart({ data }: { data: { severity: string; count: number }[] }) {
  const rows = data.map((d) => ({
    ...d,
    label: SEVERITY_CONFIG[d.severity as keyof typeof SEVERITY_CONFIG]?.label ?? d.severity,
    fill: `var(--color-${d.severity})`,
  }));
  return (
    <ChartContainer config={SEVERITY_CONFIG} className="aspect-auto h-56 w-full">
      <BarChart data={rows} accessibilityLayer>
        {GRID}
        <XAxis dataKey="label" {...AXIS} />
        <YAxis allowDecimals={false} width={32} {...AXIS} />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)' }}
          content={<ChartTooltipContent hideIndicator />}
        />
        <Bar dataKey="count" maxBarSize={BAR_SIZE} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  ACCESSIBILITY: 'Accessibility',
  UI_HEALTH: 'UI health',
  RESPONSIVE: 'Responsive',
  PERFORMANCE: 'Performance',
  SEO: 'SEO',
  SECURITY: 'Security',
  FUNCTIONAL: 'Interactions',
  COMPATIBILITY: 'Browsers',
};

const CATEGORY_CONFIG = {
  count: { label: 'Open issues', color: 'var(--chart-1)' },
} satisfies ChartConfig;

/** One series → one colour; the category names are on the axis. */
export function CategoryChart({ data }: { data: { category: string; count: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: CATEGORY_LABEL[d.category] ?? d.category }));
  return (
    <ChartContainer config={CATEGORY_CONFIG} className="aspect-auto h-56 w-full">
      <BarChart data={rows} layout="vertical" accessibilityLayer margin={{ left: 8 }}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" allowDecimals={false} {...AXIS} />
        <YAxis type="category" dataKey="label" width={96} {...AXIS} />
        <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent />} />
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          maxBarSize={BAR_SIZE}
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

const ACTIVITY_CONFIG = {
  completed: { label: 'Completed', color: 'var(--chart-good)' },
  partial: { label: 'Partly completed', color: 'var(--chart-warning)' },
  failed: { label: 'Failed', color: 'var(--chart-critical)' },
  cancelled: { label: 'Cancelled', color: 'var(--chart-neutral)' },
  other: { label: 'Queued / running', color: 'var(--chart-1)' },
} satisfies ChartConfig;

/** Scans per day, stacked by outcome. Only the top segment gets rounded corners. */
export function ScanActivityChart({ points }: { points: DashboardTrendPoint[] }) {
  const keys = Object.keys(ACTIVITY_CONFIG) as (keyof typeof ACTIVITY_CONFIG)[];
  return (
    <ChartContainer config={ACTIVITY_CONFIG} className="aspect-auto h-64 w-full">
      <BarChart data={points} accessibilityLayer>
        {GRID}
        <XAxis dataKey="date" tickFormatter={shortDay} minTickGap={24} {...AXIS} />
        <YAxis allowDecimals={false} width={32} {...AXIS} />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)' }}
          content={<ChartTooltipContent labelFormatter={(value) => shortDay(String(value))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {keys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="scans"
            fill={`var(--color-${key})`}
            maxBarSize={BAR_SIZE}
            stroke="var(--background)"
            strokeWidth={1}
            radius={index === keys.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

const SCORE_CONFIG = {
  accessibilityScore: { label: 'Accessibility', color: 'var(--chart-1)' },
  uiHealthScore: { label: 'UI health', color: 'var(--chart-2)' },
} satisfies ChartConfig;

/** Average score of the scans finished each day. Days without scans leave a gap (no invented value). */
export function ScoreTrendChart({ points }: { points: DashboardTrendPoint[] }) {
  return (
    <ChartContainer config={SCORE_CONFIG} className="aspect-auto h-64 w-full">
      <LineChart data={points} accessibilityLayer>
        {GRID}
        <XAxis dataKey="date" tickFormatter={shortDay} minTickGap={24} {...AXIS} />
        <YAxis domain={[0, 100]} width={32} {...AXIS} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(value) => shortDay(String(value))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {(Object.keys(SCORE_CONFIG) as (keyof typeof SCORE_CONFIG)[]).map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            connectNulls
            dot={{ r: 3, strokeWidth: 2, fill: 'var(--background)' }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

const ISSUE_FLOW_CONFIG = {
  newIssues: { label: 'Newly detected', color: 'var(--chart-2)' },
  resolvedIssues: { label: 'Resolved', color: 'var(--chart-1)' },
} satisfies ChartConfig;

/** New vs resolved issues per day, side by side. */
export function IssueFlowChart({ points }: { points: DashboardTrendPoint[] }) {
  return (
    <ChartContainer config={ISSUE_FLOW_CONFIG} className="aspect-auto h-64 w-full">
      <BarChart data={points} accessibilityLayer barGap={2}>
        {GRID}
        <XAxis dataKey="date" tickFormatter={shortDay} minTickGap={24} {...AXIS} />
        <YAxis allowDecimals={false} width={32} {...AXIS} />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)' }}
          content={<ChartTooltipContent labelFormatter={(value) => shortDay(String(value))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="newIssues"
          fill="var(--color-newIssues)"
          maxBarSize={12}
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="resolvedIssues"
          fill="var(--color-resolvedIssues)"
          maxBarSize={12}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}
