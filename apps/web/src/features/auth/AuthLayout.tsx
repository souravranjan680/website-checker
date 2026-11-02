import { Outlet } from 'react-router';

/** Centered card layout shared by the sign-in, sign-up and password pages. */
export function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex items-center gap-2 font-semibold">
        <img src="/favicon.svg" alt="" className="size-7" />
        Website Health Checker
      </div>
      <main className="w-full max-w-sm">
        <Outlet />
      </main>
    </div>
  );
}
