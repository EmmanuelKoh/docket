// Sign in (design spec: pages, Login and Invite): the DOCKET wordmark
// printed on the ground and one module with the email and password
// fields and a full-width Sign in key. Nothing else on the page. A
// signed-in visitor goes to Home.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { Module } from '@/components/hardware/module';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getCaller()) redirect('/');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <h1 className="hw-wordmark hw-ink m-0 text-[48px]">DOCKET</h1>
      <Module number="01" title="Sign in" className="w-full max-w-[400px]">
        <LoginForm />
      </Module>
    </main>
  );
}
