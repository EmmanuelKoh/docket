'use client';

// Delete a standalone template recipe (system recipes are code and can
// only be disabled). Neutral outline per the red-usage rules; asks once.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function DeleteTemplateButton({ name }: { name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  async function doDelete() {
    try {
      const res = await fetch(`/templates?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'delete failed');
        return;
      }
      router.push('/recipes');
      router.refresh();
    } catch {
      setError('delete failed');
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span className="font-mono text-xs text-red">{error}</span>
      ) : null}
      {confirming ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-auto px-3 py-1.5 text-xs font-normal"
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-auto px-3 py-1.5 text-xs font-normal"
            onClick={doDelete}
          >
            Really delete
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-auto px-3 py-1.5 text-xs font-normal"
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      )}
    </div>
  );
}
