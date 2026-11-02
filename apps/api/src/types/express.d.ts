import type { UserRole } from '@whc/shared';

/** The signed-in user, attached to the request by requireAuth. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

declare global {
  // Adds `req.user` to Express's Request type.
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
