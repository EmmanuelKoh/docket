// Sign in (design spec: pages, Login and Invite): one small unit on the
// mat, the DOCKET wordmark engraved in its top plate, the Email and
// Password fields, and the Sign in key in the front plate. Nothing else on
// the page. A signed-in visitor goes to Home.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { AuthUnit } from '@/components/auth-unit';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getCaller()) redirect('/');

  return (
    <AuthUnit title="Sign in">
      <LoginForm />
    </AuthUnit>
  );
}
