import type { ProjectRole } from '@whc/shared';
import { Crown, Eye, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const ROLE_INFO: Record<ProjectRole, { label: string; icon: typeof Crown }> = {
  OWNER: { label: 'Owner', icon: Crown },
  EDITOR: { label: 'Editor', icon: Pencil },
  VIEWER: { label: 'Viewer', icon: Eye },
};

export const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  OWNER: 'Full control, including members and deleting the project',
  EDITOR: 'Can add, edit and delete websites',
  VIEWER: 'Can view websites and reports',
};

export function RoleBadge({ role }: { role: ProjectRole }) {
  const { label, icon: Icon } = ROLE_INFO[role];
  return (
    <Badge variant="outline" className="font-normal">
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** EDITOR or OWNER: may change websites. Mirrors the API rule (UI hint only). */
export function canEdit(role: ProjectRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}
