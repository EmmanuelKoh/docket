// The one small unit Login and Invite stand on the mat (design spec:
// pages, Login and Invite): a body with the DOCKET wordmark engraved in
// its top plate and the unit's function engraved at the right ("Sign in",
// "Create account"), then the page's own plates. There is no nav: these
// pages are outside the dashboard shell.

import type { ReactNode } from 'react';
import { Body, Plate } from '@/components/hardware/kit/body';
import { Lamp } from '@/components/hardware/kit/led';

export function AuthUnit({
  title,
  dead = false,
  children,
}: {
  /** Engraved at the top plate's right; the page's h2. */
  title: string;
  /** A dead invite: the red lamp lights beside the title. */
  dead?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-14">
      <Body
        as="section"
        aria-labelledby="auth-title"
        className="w-full max-w-[400px]"
      >
        <Plate head className="min-h-[80px] items-end pb-[21px]">
          <h1 className="pk-mark m-0 text-[42px]">DOCKET</h1>
          <h2 id="auth-title" className="m-0">
            {dead ? (
              <Lamp state="error">{title}</Lamp>
            ) : (
              <span className="pk-engr">{title}</span>
            )}
          </h2>
        </Plate>
        {children}
      </Body>
    </main>
  );
}
