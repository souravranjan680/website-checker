import { Download, FileJson, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { downloadFromApi } from '@/lib/download';
import { errorMessage } from '@/lib/form-errors';
import { toQueryString } from '@/lib/api-client';

type Format = 'pdf' | 'csv' | 'json';

/**
 * Downloads a real export of this scan from GET /api/reports/:id/export.
 * `category` limits it to one report (accessibility, UI health, responsive).
 */
export function ExportMenu({ scanId, category }: { scanId: string; category?: string }) {
  const [busy, setBusy] = useState<Format | null>(null);

  const run = async (format: Format) => {
    setBusy(format);
    const pending =
      format === 'pdf'
        ? toast.loading('Generating the PDF… this can take a few seconds.')
        : undefined;
    try {
      await downloadFromApi(
        `/api/reports/${scanId}/export${toQueryString({ format, category })}`,
        `scan-${scanId}.${format}`,
      );
      toast.success(`${format.toUpperCase()} downloaded.`, { id: pending });
    } catch (error) {
      toast.error(errorMessage(error), { id: pending });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy !== null}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {category ? 'This report only' : 'All categories'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run('pdf')}>
          <FileText aria-hidden="true" /> PDF report (with screenshots)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('csv')}>
          <FileSpreadsheet aria-hidden="true" /> CSV (every issue, for Excel)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('json')}>
          <FileJson aria-hidden="true" /> JSON (machine-readable)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
