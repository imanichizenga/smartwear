'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, Check, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton } from '@/components/ui/button';
import { LoadMore, RowsSkeleton, Tabs } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { Card, Chip, EmptyState, PageHeader } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { fmtAgo, titleCase } from '@/lib/format';
import type { MediaOut } from '@/lib/types';

interface Review { id: string; rating: number; title: string | null; body: string; tags: string[]; verified: boolean; media: MediaOut[]; product: { id: string; title: string; slug: string }; author: string; createdAt: string; status: string }
type St = 'PENDING' | 'PUBLISHED' | 'REJECTED';

export function Stars({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} style={{ width: size, height: size }} className={i <= n ? 'fill-accent text-accent' : 'text-ink/15'} strokeWidth={i <= n ? 0 : 1.5} />)}
    </span>
  );
}

export function ReviewsModeration() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<St>('PENDING');
  const q = useInfiniteQuery({
    queryKey: ['reviews', status],
    queryFn: ({ pageParam }) => api<{ items: Review[]; nextCursor: string | null; counts: Record<string, number> }>('/admin/reviews', { query: { status, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = q.data?.pages[0]?.counts ?? {};
  const [gone, setGone] = useState<Set<string>>(new Set());
  const moderate = async (r: Review, to: St) => {
    try {
      await api(`/admin/reviews/${r.id}`, { body: { status: to } });
      setGone((g) => new Set(g).add(r.id));
      toast.success(to === 'PUBLISHED' ? 'Published — the rating is updated' : 'Hidden from the product page');
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['reviews'] }), 400);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  return (
    <>
      <PageHeader title="Reviews" description="Approve what customers say before it goes live. Verified buyers are marked; photos are checked like any other upload." />
      <Card className="overflow-hidden">
        <div className="border-b border-hairline px-3"><Tabs id="reviews" value={status} onChange={(s) => { setStatus(s); setGone(new Set()); }} counts={counts as Record<St, number>} tabs={[{ key: 'PENDING', label: 'To review' }, { key: 'PUBLISHED', label: 'Published' }, { key: 'REJECTED', label: 'Hidden' }]} /></div>
        {q.isPending ? <RowsSkeleton /> : rows.filter((r) => !gone.has(r.id)).length === 0 ? (
          <EmptyState icon={<Star />} title={status === 'PENDING' ? 'Nothing waiting' : 'No reviews here'} body="New reviews arrive after delivery, when customers rate their order." />
        ) : (
          <ul className="divide-y divide-hairline">
            <AnimatePresence initial={false}>
              {rows.filter((r) => !gone.has(r.id)).map((r) => (
                <motion.li key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 40, height: 0 }} transition={{ duration: 0.25 }} className="flex flex-col gap-4 px-5 py-4 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars n={r.rating} />
                      {r.verified && <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><BadgeCheck className="size-3.5" strokeWidth={1.75} /> Verified buyer</span>}
                      <span className="text-xs text-muted">{r.author} · {fmtAgo(r.createdAt)}</span>
                    </div>
                    {r.title && <div className="mt-2 font-semibold">{r.title}</div>}
                    <p className="mt-1 text-sm leading-6 text-ink/85">{r.body}</p>
                    {r.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.tags.map((t) => <Chip key={t} tone="blush">{titleCase(t)}</Chip>)}</div>}
                    {r.media.length > 0 && <div className="mt-3 flex gap-2">{r.media.map((m) => <MediaImage key={m.id} media={m} className="w-16" sizes="64px" rounded="xs" />)}</div>}
                    <AppLink href={`/products/${r.product.id}`} className="mt-2 text-xs text-muted underline-offset-2 hover:underline">{r.product.title}</AppLink>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    {r.status !== 'REJECTED' && <ActionButton size="sm" variant="ghost" icon={<X strokeWidth={1.5} />} onAction={() => moderate(r, 'REJECTED')}>Hide</ActionButton>}
                    {r.status !== 'PUBLISHED' && <ActionButton size="sm" icon={<Check strokeWidth={1.5} />} onAction={() => moderate(r, 'PUBLISHED')}>Publish</ActionButton>}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        <LoadMore hasMore={q.hasNextPage} onMore={() => q.fetchNextPage()} />
      </Card>
    </>
  );
}
