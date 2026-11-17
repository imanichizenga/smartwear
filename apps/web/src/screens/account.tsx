'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showPlacePicker } from '@/components/checkout/place-picker';
import { gridCols, GridSkeleton, ProductCard } from '@/components/product/product-card';
import { AsyncBody, Avatar, ProfileRow, RowGroup, RowGroupSkeleton, SectionLabel, SubPage } from '@/components/profile/kit';
import { ALoader } from '@/components/ui/aloader';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { Ic, Icon } from '@/components/ui/icons';
import { ChoiceChip, EmptyState, Reveal, Skeleton, SkeletonAvatar, SkeletonLine, SkeletonList, Switch, SwChip, TextArea, TextField, useLocalised } from '@/components/ui/kit';
import { confirmSw, openSheet, toast } from '@/components/ui/overlay';
import { api, ApiException, errorMessage } from '@/lib/api';
import { getDelivery, initDelivery, locate, useDelivery } from '@/lib/delivery';
import { feature, toggleWishlistId, useAuthedQuery, useConfig, useT, useWishlist } from '@/lib/hooks';
import { flag, int, list, obj, str, strN, type Json } from '@/lib/json';
import { formatMoney } from '@/lib/money';
import { expectSignOut, forgetLocally, setUser, usePrefs, useSession } from '@/lib/session';
import { uploadImage } from '@/lib/upload';

const dmy = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

/* ================================================================== edit profile */

export function EditProfileScreen() {
  const t = useT();
  const router = useRouter();
  const { user: u } = useSession();
  const [name, setName] = useState(str(u, 'name'));
  const [email, setEmail] = useState(str(u, 'email'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const verified = !!strN(u, 'phone') && (flag(u, 'phoneVerified') || !!strN(u, 'phoneVerifiedAt'));

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setProgress(0);
    try {
      const m = await uploadImage(f, 'avatar', setProgress, 1200);
      const nu = await api.patch<Json>('/me', { avatarMediaId: str(m, 'id') });
      setUser((nu.user as Json) ?? nu);
      toast(t('profile.edit.photoUpdated'));
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    } finally {
      setProgress(null);
      if (file.current) file.current.value = '';
    }
  };
  const photoSheet = () =>
    openSheet((close) => (
      <div className="px-5 pb-5">
        <ProfileRow icon={Ic.image} label={t('profile.edit.choosePhoto')} onPress={() => { close(); file.current?.click(); }} />
        {obj(u, 'avatar') && (
          <ProfileRow icon={Ic.trash2} label={t('profile.edit.removePhoto')} danger chevron={false} onPress={async () => {
            close();
            try {
              const nu = await api.patch<Json>('/me', { avatarMediaId: null });
              setUser((nu.user as Json) ?? nu);
            } catch (e) {
              toast(errorMessage(e, t), { error: true });
            }
          }} />
        )}
      </div>
    ), { title: t('profile.edit.photo') });

  const save = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t('checkout.manual.required');
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = t('profile.edit.emailInvalid');
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const nu = await api.patch<Json>('/me', { name: name.trim(), email: email.trim() || null });
      setUser((nu.user as Json) ?? nu);
      toast(t('profile.edit.saved'));
      router.back();
    } catch (err) {
      if (err instanceof ApiException && (err.field === 'name' || err.field === 'email')) setErrors({ [err.field]: err.message });
      else toast(errorMessage(err, t), { error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SubPage title={t('profile.edit')} bottom={<SwButton label={t('common.save')} large expand pending={saving} onPress={saving || progress != null ? null : save} />}>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <div className="flex justify-center pt-2">
        <button type="button" aria-label={t('profile.edit.photo')} onClick={progress == null ? () => void photoSheet() : undefined} className="relative">
          <Avatar
            user={u}
            size={104}
            border={0}
            overlay={
              progress != null ? (
                <span className="absolute inset-0 flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--sw-ink) 45%, transparent)' }}>
                  <ALoader size="lg" color="var(--sw-on-ink)" />
                </span>
              ) : undefined
            }
          />
          <span className="absolute -bottom-0.5 -right-0.5 flex size-9 items-center justify-center rounded-full border border-hairline bg-surface">
            <Icon icon={Ic.camera} size={18} />
          </span>
        </button>
      </div>
      <form className="mt-8 flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label={t('profile.edit.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" maxLength={120} />
        <TextField label={t('profile.edit.email')} value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} type="email" autoComplete="email" placeholder="name@example.com" />
        <div>
          <p className="t-title-s mb-2">{t('profile.edit.phone')}</p>
          <div className="flex items-center rounded-sm border border-hairline bg-canvas p-4">
            <span className="t-body-m flex-1" style={{ color: strN(u, 'phone') ? 'var(--sw-ink)' : 'var(--sw-muted)' }}>{strN(u, 'phone') ?? t('profile.edit.noPhone')}</span>
            {verified && <SwChip label={t('profile.edit.verified')} tone="success" icon={Ic.circleCheck} />}
          </div>
          <p className="t-caption mt-2 text-muted">{t('profile.edit.phoneHelp')}</p>
        </div>
      </form>
    </SubPage>
  );
}

/* ================================================================== wishlist */

export function WishlistScreen() {
  const t = useT();
  const router = useRouter();
  const ids = useWishlist().data;
  const q = useAuthedQuery<Json>(['wishlist-products'], '/wishlist', { expand: 'products' });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const items = list(q.data, 'products').filter((p) => !hidden.has(str(p, 'id')) && (!ids || ids.has(str(p, 'id'))));
  return (
    <SubPage title={t('profile.wishlist')} narrow={false}>
      {q.isPending ? (
        <GridSkeleton />
      ) : !items.length ? (
        <EmptyState title={t('wishlist.empty.title')} body={t('wishlist.empty.body')} icon={Ic.heart} action={<SwButton label={t('wishlist.empty.cta')} icon={Ic.compass} onPress={() => router.push('/discover')} />} className="min-h-[55vh] justify-center" />
      ) : (
        <div className={gridCols}>
          {items.map((p, i) => (
            <Reveal key={str(p, 'id')} index={i < 6 ? i : i % 2} className="relative">
              <ProductCard product={p} />
              <button
                type="button"
                className="absolute right-0 top-0 z-30 size-11"
                aria-label={t('wishlist.removed')}
                onClick={async () => {
                  const id = str(p, 'id');
                  setHidden((h) => new Set(h).add(id));
                  try {
                    if (ids?.has(id) ?? true) await toggleWishlistId(id);
                    toast(t('wishlist.removed'), { icon: Ic.heart, action: { label: t('common.undo'), onPress: () => { setHidden((h) => { const n = new Set(h); n.delete(id); return n; }); void toggleWishlistId(id).catch(() => undefined); } } });
                  } catch (e) {
                    setHidden((h) => { const n = new Set(h); n.delete(id); return n; });
                    toast(errorMessage(e, t), { error: true });
                  }
                }}
              />
            </Reveal>
          ))}
        </div>
      )}
    </SubPage>
  );
}

/* ================================================================== saved places */

const kindIcon = (k: string) => (k === 'home' ? Ic.house : k === 'work' ? Ic.briefcase : Ic.mapPin);

export function PlacesScreen() {
  const t = useT();
  const qc = useQueryClient();
  const cfg = useConfig().data;
  const q = useAuthedQuery<Json>(['places'], '/me/places');
  const refresh = () => qc.invalidateQueries({ queryKey: ['me', 'places'] });
  const pickKind = (current: string) =>
    openSheet<string>((close) => (
      <div className="px-5 pb-5">
        {['home', 'work', 'other'].map((k) => (
          <ProfileRow key={k} icon={kindIcon(k)} label={t(`places.kind.${k}`)} chevron={false} trailing={k === current ? <Icon icon={Ic.check} size={18} /> : undefined} onPress={() => close(k)} />
        ))}
      </div>
    ), { title: t('places.labelAs') });
  const add = async () => {
    if (str(obj(cfg, 'checkout'), 'locationMode') === 'manual') {
      await openSheet((close) => <ManualPlace close={close} onSaved={refresh} />, { title: t('places.add') });
      return;
    }
    if (!(await showPlacePicker())) return;
    const p = getDelivery().point;
    if (!p) return;
    const kind = await pickKind('other');
    if (!kind) return;
    try {
      await api.post('/me/places', { kind, lat: p.point.lat, lng: p.point.lng, address: p.label ?? p.area ?? '', area: p.area, landmarkNote: p.landmark, placeId: p.placeId });
      void refresh();
      toast(t('places.saved'));
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    }
  };
  const patch = async (id: string, body: Json, done: string) => {
    try {
      await api.patch(`/me/places/${id}`, body);
      void refresh();
      toast(done);
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    }
  };
  const menu = async (p: Json) => {
    const id = str(p, 'id');
    const action = await openSheet<string>((close) => (
      <div className="px-5 pb-5">
        <ProfileRow icon={Ic.tag} label={t('places.labelAs')} onPress={() => close('kind')} />
        <ProfileRow icon={Ic.pencil} label={t('places.rename')} onPress={() => close('rename')} />
        {!flag(p, 'isDefault') && <ProfileRow icon={Ic.star} label={t('places.makeDefault')} onPress={() => close('default')} />}
        <ProfileRow icon={Ic.trash2} label={t('places.delete')} danger chevron={false} onPress={() => close('delete')} />
      </div>
    ), { title: str(p, 'label') || str(p, 'address') });
    if (action === 'kind') {
      const k = await pickKind(str(p, 'kind'));
      if (k) await patch(id, { kind: k }, t('places.updated'));
    } else if (action === 'rename') {
      const name = await openSheet<string>((close) => <RenameSheet initial={str(p, 'label')} onSave={close} />, { title: t('places.rename') });
      if (name != null) await patch(id, { label: name }, t('places.updated'));
    } else if (action === 'default') await patch(id, { isDefault: true }, t('places.defaultSet'));
    else if (action === 'delete' && (await confirmSw({ title: t('places.deleteConfirm'), body: str(p, 'address'), confirm: t('places.delete'), danger: true }))) {
      try {
        await api.delete(`/me/places/${id}`);
        void refresh();
      } catch (e) {
        toast(errorMessage(e, t), { error: true });
      }
    }
  };
  return (
    <SubPage title={t('profile.savedPlaces')} actions={<SwIconButton icon={Ic.plus} label={t('places.add')} onPress={add} />}>
      <AsyncBody q={q} skeleton={<RowGroupSkeleton count={3} />} isEmpty={(d) => !list(d, 'saved').length} empty={<EmptyState title={t('places.empty.title')} body={t('places.empty.body')} icon={Ic.mapPin} action={<SwButton label={t('places.add')} icon={Ic.plus} onPress={add} />} />}>
        {(d) => (
          <>
            <RowGroup>
              {list(d, 'saved').map((p) => (
                <ProfileRow key={str(p, 'id')} icon={kindIcon(str(p, 'kind'))} label={str(p, 'label') || t(`places.kind.${str(p, 'kind')}`)} subtitle={[str(p, 'address'), strN(p, 'landmarkNote') ? `“${str(p, 'landmarkNote')}”` : ''].filter(Boolean).join(' · ')} trailing={flag(p, 'isDefault') ? <SwChip label={t('places.default')} tone="accent" /> : undefined} onPress={() => menu(p)} />
              ))}
            </RowGroup>
            <p className="t-caption mt-4 text-muted">{t('places.defaultHint')}</p>
          </>
        )}
      </AsyncBody>
    </SubPage>
  );
}

function RenameSheet({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const t = useT();
  const [v, setV] = useState(initial);
  return (
    <form className="flex flex-col gap-4 px-5 pb-5" onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }}>
      <TextField autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={t('places.namePlaceholder')} maxLength={60} />
      <SwButton type="submit" label={t('common.save')} large expand onPress={() => onSave(v.trim())} />
    </form>
  );
}

function ManualPlace({ close, onSaved }: { close: () => void; onSaved: () => void }) {
  const t = useT();
  const { signedIn } = useSession();
  const d = useDelivery();
  const [kind, setKind] = useState('home');
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useState(() => void initDelivery(signedIn));
  const save = async () => {
    const p = getDelivery().point;
    if (!address.trim()) return setError(t('checkout.manual.required'));
    if (!p) return setError(t('places.needLocation'));
    setSaving(true);
    try {
      await api.post('/me/places', { kind, label: label.trim(), address: address.trim(), area: p.area, lat: p.point.lat, lng: p.point.lng });
      onSaved();
      close();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      <div className="flex gap-2">{['home', 'work', 'other'].map((k) => <ChoiceChip key={k} label={t(`places.kind.${k}`)} selected={kind === k} onPress={() => setKind(k)} />)}</div>
      <TextField label={t('places.name')} placeholder={t('places.namePlaceholder')} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      <TextArea label={t('checkout.manual.location')} value={address} onChange={(e) => { setAddress(e.target.value); setError(null); }} rows={2} maxLength={240} counter error={error} />
      <div className="flex items-center gap-2">
        {d.locating ? <ALoader size="xs" /> : <Icon icon={d.point ? Ic.mapPin : Ic.locateFixed} size={16} className={d.point ? 'text-ink' : 'text-muted'} />}
        <span className="t-caption flex-1 text-muted">{d.point ? d.point.area ?? d.point.label ?? t('checkout.manual.detected') : t('checkout.manual.notDetected')}</span>
        {!d.point && !d.locating && <SwButton label={t('checkout.manual.useLocation')} variant="ghost" onPress={() => locate()} />}
      </div>
      <SwButton label={t('common.save')} large expand pending={saving} onPress={saving ? null : save} />
    </div>
  );
}

/* ================================================================== payments */

export function PaymentsScreen() {
  const t = useT();
  const qc = useQueryClient();
  const loc = useLocalised();
  const methods = useAuthedQuery<Json>(['payment-methods'], '/me/payment-methods');
  const history = useAuthedQuery<Json>(['payments'], '/me/payments');
  const refresh = () => qc.invalidateQueries({ queryKey: ['me', 'payment-methods'] });
  const menu = async (m: Json) => {
    const a = await openSheet<string>((close) => (
      <div className="px-5 pb-5">
        {!flag(m, 'isDefault') && <ProfileRow icon={Ic.star} label={t('payments.makePreferred')} onPress={() => close('default')} />}
        <ProfileRow icon={Ic.trash2} label={t('payments.remove')} danger chevron={false} onPress={() => close('delete')} />
      </div>
    ), { title: str(m, 'label') || str(m, 'msisdn') || str(m, 'method') });
    try {
      if (a === 'default') await api.patch(`/me/payment-methods/${str(m, 'id')}`, { isDefault: true });
      else if (a === 'delete' && (await confirmSw({ title: t('payments.removeConfirm'), confirm: t('payments.remove'), danger: true }))) await api.delete(`/me/payment-methods/${str(m, 'id')}`);
      void refresh();
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    }
  };
  return (
    <SubPage title={t('profile.payments')}>
      <AsyncBody q={methods} skeleton={<><RowGroupSkeleton count={2} /><RowGroupSkeleton count={3} className="mt-8" /></>}>
        {(m) => {
          const available = list(m, 'available');
          const saved = list(m, 'saved');
          const mm = available.find((a) => str(a, 'method') === 'MOBILE_MONEY');
          return (
            <>
              <SectionLabel>{t('payments.methods')}</SectionLabel>
              <RowGroup>
                {saved.map((p) => (
                  <ProfileRow key={str(p, 'id')} icon={str(p, 'method') === 'MOBILE_MONEY' ? Ic.smartphone : Ic.banknote} label={strN(p, 'label') ?? (str(p, 'method') === 'MOBILE_MONEY' ? t('payments.mobileMoney') : t('payments.cash'))} subtitle={[str(p, 'provider').toUpperCase(), str(p, 'msisdn')].filter(Boolean).join(' · ')} trailing={flag(p, 'isDefault') ? <SwChip label={t('payments.preferred')} tone="accent" /> : undefined} onPress={() => menu(p)} />
                ))}
                {!saved.length && available.map((a) => <ProfileRow key={str(a, 'method')} icon={str(a, 'method') === 'MOBILE_MONEY' ? Ic.smartphone : Ic.banknote} label={loc(a, 'label')} subtitle={str(obj(m, 'default'), 'method') === str(a, 'method') ? t('payments.preferred') : null} chevron={false} />)}
                {mm && <ProfileRow icon={Ic.plus} label={t('payments.addNumber')} onPress={() => openSheet((close) => <AddNumber providers={((mm.providers as string[]) ?? [])} close={close} onSaved={refresh} />, { title: t('payments.addNumber') })} />}
              </RowGroup>
              {!available.length && <p className="t-caption mt-3 text-muted">{t('payments.noneAvailable')}</p>}
              <div className="mt-8">
                <SectionLabel>{t('payments.history')}</SectionLabel>
                {history.isPending ? (
                  <RowGroupSkeleton count={3} />
                ) : !list(history.data, 'items').length ? (
                  <p className="t-body-s py-4 text-muted">{t('payments.historyEmpty')}</p>
                ) : (
                  <RowGroup>
                    {list(history.data, 'items').map((p, i) => {
                      const st = str(p, 'status');
                      return <ProfileRow key={i} icon={str(p, 'method') === 'MOBILE_MONEY' ? Ic.smartphone : Ic.banknote} label={`${str(obj(p, 'order'), 'number')} · ${formatMoney(int(p, 'amount'), str(p, 'currency', 'TZS'))}`} subtitle={[dmy(str(p, 'paidAt') || str(p, 'createdAt')), str(p, 'msisdn')].filter(Boolean).join(' · ')} trailing={<SwChip label={t(`payments.status.${st}`)} tone={st === 'PAID' ? 'success' : st === 'FAILED' ? 'danger' : st === 'PENDING' ? 'warning' : 'neutral'} />} href={`/orders/${str(obj(p, 'order'), 'id')}/track`} />;
                    })}
                  </RowGroup>
                )}
              </div>
            </>
          );
        }}
      </AsyncBody>
    </SubPage>
  );
}

function AddNumber({ providers, close, onSaved }: { providers: string[]; close: () => void; onSaved: () => void }) {
  const t = useT();
  const [v, setV] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const d = v.replace(/\D/g, '').replace(/^0/, '');
    if (d.length !== 9) return setError(t('auth.phone.invalid'));
    setSaving(true);
    try {
      await api.post('/me/payment-methods', { method: 'MOBILE_MONEY', msisdn: `+255${d}`, ...(provider ? { provider } : {}), isDefault: true });
      onSaved();
      close();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="flex flex-col gap-4 px-5 pb-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {providers.length > 0 && <div className="flex flex-wrap gap-2">{providers.map((p) => <ChoiceChip key={p} label={p.toUpperCase()} selected={provider === p} onPress={() => setProvider(p)} />)}</div>}
      <TextField autoFocus label={t('payments.number')} placeholder={t('auth.phone.placeholder')} inputMode="tel" value={v} onChange={(e) => { setV(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(null); }} prefix={<span className="t-body-m ml-4 font-semibold">+255</span>} error={error} />
      <SwButton type="submit" label={t('common.save')} large expand pending={saving} onPress={saving ? null : save} />
    </form>
  );
}

/* ================================================================== wholesale */

export function WholesaleScreen() {
  const t = useT();
  const open = feature(useConfig().data, 'wholesaleApplications');
  const q = useAuthedQuery<Json>(['wholesale'], '/me/wholesale');
  return (
    <SubPage title={t('profile.wholesale')}>
      <AsyncBody q={q} skeleton={<div className="flex flex-col gap-4"><Skeleton h={96} r={12} /><SkeletonLine w={160} h={14} /><SkeletonLine h={12} /><Skeleton h={52} r={4} /></div>}>
        {(d) => {
          const app = obj(d, 'application');
          const status = flag(d, 'approved') ? 'APPROVED' : str(app, 'status', 'NONE');
          const [icon, tone, bg] = status === 'APPROVED' ? [Ic.circleCheck, 'success', 'var(--sw-success-soft)'] : status === 'PENDING' ? [Ic.clock, 'warning', 'var(--sw-warning-soft)'] : status === 'REJECTED' ? [Ic.circleAlert, 'danger', 'var(--sw-danger-soft)'] : [Ic.briefcase, 'neutral', 'var(--sw-surface)'];
          return (
            <>
              <div className="flex gap-4 rounded-md border border-hairline p-5" style={{ background: bg as string }}>
                <Icon icon={icon as typeof Ic.briefcase} size={22} />
                <div>
                  <SwChip label={t(`wholesale.status.${status}`)} tone={tone as 'neutral'} />
                  <p className="t-body-s mt-2">{t(`wholesale.status.${status}.body`, { business: str(app, 'businessName') })}</p>
                  {status === 'REJECTED' && strN(app, 'reviewNote') && <p className="t-caption mt-2 text-muted">“{str(app, 'reviewNote')}”</p>}
                </div>
              </div>
              <div className="mt-6">
                <p className="t-title-m mb-3">{t('wholesale.how.title')}</p>
                {[
                  [Ic.layoutGrid, t('wholesale.how.tiers')],
                  [Ic.tag, t('wholesale.how.prices')],
                  [Ic.package, t('wholesale.how.moq')],
                ].map(([i, s], k) => (
                  <p key={k} className="t-body-s mb-3 flex gap-3">
                    <Icon icon={i as typeof Ic.tag} size={18} className="shrink-0 text-accent" />
                    {s as string}
                  </p>
                ))}
              </div>
              {(status === 'NONE' || status === 'REJECTED') && (open ? <ApplyForm /> : <p className="t-body-s mt-6 text-muted">{t('wholesale.closed')}</p>)}
            </>
          );
        }}
      </AsyncBody>
    </SubPage>
  );
}

function ApplyForm() {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ businessName: '', tin: '', businessType: '', address: '', expectedMonthlyVolume: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [licence, setLicence] = useState<string | null>(null);
  const [up, setUp] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    const tin = f.tin.replace(/\D/g, '');
    const e: Record<string, string> = {};
    if (!f.businessName.trim()) e.businessName = t('checkout.manual.required');
    if (tin.length !== 9) e.tin = t('wholesale.tinInvalid');
    setErrors(e);
    if (Object.keys(e).length) return;
    setSending(true);
    try {
      await api.post('/me/wholesale', { businessName: f.businessName.trim(), tin, businessType: f.businessType.trim(), address: f.address.trim(), expectedMonthlyVolume: f.expectedMonthlyVolume.trim(), ...(licence ? { licenceMediaId: licence } : {}) });
      void qc.invalidateQueries({ queryKey: ['me', 'wholesale'] });
      toast(t('wholesale.submitted'));
    } catch (err) {
      if (err instanceof ApiException && err.field) setErrors({ [err.field]: err.message });
      else toast(errorMessage(err, t), { error: true });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="t-title-m">{t('wholesale.apply.title')}</p>
      <TextField label={t('wholesale.businessName')} value={f.businessName} onChange={set('businessName')} error={errors.businessName} maxLength={120} />
      <TextField label={t('wholesale.tin')} helper={t('wholesale.tinHelp')} value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value.replace(/\D/g, '').slice(0, 9) })} inputMode="numeric" error={errors.tin} />
      <TextField label={t('wholesale.businessType')} placeholder={t('wholesale.businessTypeHint')} value={f.businessType} onChange={set('businessType')} maxLength={60} />
      <TextArea label={t('wholesale.address')} value={f.address} onChange={set('address')} rows={2} maxLength={240} />
      <TextField label={t('wholesale.volume')} placeholder={t('wholesale.volumeHint')} value={f.expectedMonthlyVolume} onChange={set('expectedMonthlyVolume')} maxLength={40} />
      <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => {
        const fl = e.target.files?.[0];
        if (!fl) return;
        setUp(0);
        try {
          const m = await uploadImage(fl, 'wholesale_licence', setUp, 2400);
          setLicence(str(m, 'id'));
        } catch (err) {
          toast(errorMessage(err, t), { error: true });
        } finally {
          setUp(null);
        }
      }} />
      <RowGroup>
        <ProfileRow icon={licence ? Ic.circleCheck : Ic.camera} label={licence ? t('wholesale.licenceAdded') : t('wholesale.licence')} subtitle={up != null ? t('wholesale.uploading', { percent: Math.round(up * 100) }) : t('wholesale.licenceHelp')} onPress={up != null ? undefined : () => file.current?.click()} />
      </RowGroup>
      <div className="mt-2">
        <SwButton label={t('wholesale.submit')} large expand pending={sending} onPress={sending || up != null ? null : submit} />
      </div>
    </div>
  );
}

/* ================================================================== notifications */

const CHANNELS = ['order', 'chat', 'drop', 'wishlist', 'marketing', 'sms'];
const notifRoute = (d: Json) => (strN(d, 'route')?.startsWith('/') ? strN(d, 'route') : strN(d, 'campaignId') && !strN(d, 'threadId') && !strN(d, 'orderId') ? `/campaign/${str(d, 'campaignId')}` : strN(d, 'threadId') ? `/chat/${str(d, 'threadId')}` : strN(d, 'orderId') ? `/orders/${str(d, 'orderId')}/track` : strN(d, 'productSlug') ? `/p/${str(d, 'productSlug')}` : null);

export function NotificationsScreen() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const [settings, setSettings] = useState(false);
  const q = useQuery({ queryKey: ['me', 'inbox'], queryFn: () => api.get<Json>('/me/notifications'), enabled: signedIn });
  const unread = int(q.data, 'unread');
  const markRead = async (ids?: string[]) => {
    const cur = q.data;
    if (cur) qc.setQueryData(['me', 'inbox'], { ...cur, items: list(cur, 'items').map((n) => (!ids || ids.includes(str(n, 'id')) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)), unread: ids ? Math.max(0, unread - ids.length) : 0 });
    try {
      await api.post('/me/notifications', ids ? { ids } : { all: true });
    } catch (e) {
      if (cur) qc.setQueryData(['me', 'inbox'], cur);
      toast(errorMessage(e, t), { error: true });
    }
  };
  const ago = (iso: string) => {
    const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return t('time.now');
    if (m < 60) return t('time.minutes', { count: m });
    if (m < 1440) return t('time.hours', { count: Math.floor(m / 60) });
    if (m < 10080) return t('time.days', { count: Math.floor(m / 1440) });
    return dmy(iso);
  };
  return (
    <SubPage
      title={t('profile.notifications')}
      actions={
        <>
          {unread > 0 && !settings && <SwButton label={t('notifications.markAll')} variant="ghost" onPress={() => markRead()} />}
          <SwIconButton icon={settings ? Ic.bell : Ic.settings} label={settings ? t('notifications.inbox') : t('notifications.settings')} onPress={() => setSettings(!settings)} />
        </>
      }
    >
      {settings ? (
        <ChannelSettings />
      ) : (
        <AsyncBody
          q={q}
          skeleton={<SkeletonList count={6} className="!px-0">{() => <div className="flex gap-3"><SkeletonAvatar size={40} /><div className="flex flex-1 flex-col gap-2"><SkeletonLine w={180} h={14} /><SkeletonLine h={10} /><SkeletonLine w={80} h={10} /></div></div>}</SkeletonList>}
          isEmpty={(d) => !list(d, 'items').length}
          empty={<EmptyState title={t('notifications.empty.title')} body={t('notifications.empty.body')} icon={Ic.bell} />}
        >
          {(d) => (
            <div>
              {list(d, 'items').map((n) => {
                const un = n.readAt == null;
                const route = notifRoute(obj(n, 'data') ?? {});
                const icon = ({ order: Ic.package, chat: Ic.messageCircle, drop: Ic.sparkles, price_drop: Ic.tag, wholesale: Ic.briefcase, rider: Ic.bike } as Record<string, typeof Ic.bell>)[str(n, 'type')] ?? Ic.bell;
                return (
                  <button key={str(n, 'id')} type="button" className="flex w-full gap-3 py-3 text-left" onClick={() => {
                      if (un) void markRead([str(n, 'id')]);
                      const cid = strN(obj(n, 'data'), 'campaignId');
                      if (cid) void api.post(`/campaigns/${cid}/opened`, { source: 'inbox', platform: 'web' }).catch(() => undefined);
                      if (route) router.push(route);
                    }}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-hairline" style={{ background: un ? 'var(--sw-accent-soft)' : 'var(--sw-surface)' }}>
                      <Icon icon={icon} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-title-s block" style={{ fontWeight: un ? 700 : 600 }}>{str(n, 'title')}</span>
                      <span className="t-body-s mt-0.5 line-clamp-3 block text-muted">{str(n, 'body')}</span>
                      <span className="t-caption mt-1 block text-subtle">{ago(str(n, 'createdAt'))}</span>
                    </span>
                    <span className="w-5">{un && <span className="ml-auto mt-1.5 block size-2 rounded-full bg-accent" />}</span>
                  </button>
                );
              })}
            </div>
          )}
        </AsyncBody>
      )}
    </SubPage>
  );
}

function ChannelSettings() {
  const t = useT();
  const { user } = useSession();
  const fromUser = obj(user, 'notificationPrefs') ?? {};
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => Object.fromEntries(CHANNELS.map((k) => [k, fromUser[k] !== false])));
  const set = async (k: string, v: boolean) => {
    const before = prefs;
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try {
      const u = await api.patch<Json>('/me', { notificationPrefs: next });
      setUser((u.user as Json) ?? u);
    } catch (e) {
      setPrefs(before);
      toast(errorMessage(e, t), { error: true });
    }
  };
  const icons: Record<string, typeof Ic.bell> = { order: Ic.package, chat: Ic.messageCircle, drop: Ic.sparkles, wishlist: Ic.tag, marketing: Ic.gift, sms: Ic.smartphone };
  return (
    <div>
      <p className="t-body-s mb-4 text-muted">{t('notifications.settings.body')}</p>
      <RowGroup>
        {CHANNELS.map((k) => (
          <ProfileRow key={k} icon={icons[k]!} label={t(`notifications.channel.${k}`)} subtitle={t(`notifications.channel.${k}.help`)} chevron={false} trailing={<Switch checked={prefs[k] ?? true} onChange={(v) => void set(k, v)} label={t(`notifications.channel.${k}`)} />} onPress={() => set(k, !(prefs[k] ?? true))} />
        ))}
      </RowGroup>
    </div>
  );
}

/* ================================================================== privacy + delete */

export function PrivacyScreen() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useAuthedQuery<Json>(['sessions'], '/me/sessions');
  const refresh = () => qc.invalidateQueries({ queryKey: ['me', 'sessions'] });
  const exportData = async () => {
    try {
      const data = await api.get<Json>('/me/export');
      const pretty = JSON.stringify(data, null, 2);
      await openSheet((close) => (
        <div className="flex flex-col gap-2 px-5 pb-5">
          <p className="t-body-s mb-3 text-muted">{t('privacy.export.body', { size: Math.ceil(pretty.length / 1024) })}</p>
          <SwButton label={t('privacy.export.copy')} icon={Ic.copy} large expand onPress={async () => { await navigator.clipboard.writeText(pretty); close(); toast(t('privacy.export.copied')); }} />
          <SwButton label="JSON" icon={Ic.download} large expand variant="secondary" onPress={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pretty], { type: 'application/json' })); a.download = 'smartwear-data.json'; a.click(); close(); }} />
        </div>
      ), { title: t('privacy.export.ready') });
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    }
  };
  return (
    <SubPage title={t('profile.privacy')}>
      <AsyncBody q={q} skeleton={<><RowGroupSkeleton count={2} /><RowGroupSkeleton count={2} className="mt-8" /></>}>
        {(d) => {
          const rows = list(d, 'items');
          const others = rows.filter((x) => !flag(x, 'current'));
          return (
            <>
              <SectionLabel>{t('privacy.devices')}</SectionLabel>
              <RowGroup>
                {rows.map((x) => {
                  const device = str(x, 'platform') === 'ios' ? 'iPhone' : str(x, 'platform') === 'android' ? 'Android' : str(x, 'platform') === 'web' ? 'Web browser' : t('privacy.device');
                  return (
                    <ProfileRow
                      key={str(x, 'id')}
                      icon={str(x, 'platform') === 'web' ? Ic.globe : Ic.smartphone}
                      label={`${device}${strN(x, 'appVersion') ? ` · v${str(x, 'appVersion')}` : ''}`}
                      subtitle={flag(x, 'current') ? t('privacy.thisDevice') : t('privacy.lastActive', { date: dmy(str(x, 'lastUsedAt')) })}
                      chevron={false}
                      trailing={flag(x, 'current') ? <SwChip label={t('privacy.thisDevice')} tone="success" /> : <SwButton label={t('privacy.signOut')} variant="ghost" onPress={async () => { try { await api.delete(`/me/sessions/${str(x, 'id')}`); void refresh(); } catch (e) { toast(errorMessage(e, t), { error: true }); } }} />}
                    />
                  );
                })}
              </RowGroup>
              {others.length > 0 && (
                <div className="mt-3">
                  <SwButton label={t('privacy.signOutOthers')} icon={Ic.logOut} variant="secondary" expand onPress={async () => {
                    if (!(await confirmSw({ title: t('privacy.signOutOthers'), body: t('privacy.signOutOthers.body', { count: others.length }), confirm: t('privacy.signOutOthers') }))) return;
                    try {
                      for (const o of others) await api.delete(`/me/sessions/${str(o, 'id')}`);
                      void refresh();
                      toast(t('privacy.signedOutOthers'));
                    } catch (e) {
                      toast(errorMessage(e, t), { error: true });
                    }
                  }} />
                </div>
              )}
              <div className="mt-8">
                <SectionLabel>{t('privacy.yourData')}</SectionLabel>
                <RowGroup>
                  <ProfileRow icon={Ic.download} label={t('privacy.export')} subtitle={t('privacy.export.help')} onPress={exportData} />
                  <ProfileRow icon={Ic.trash2} label={t('privacy.delete')} subtitle={t('privacy.delete.help')} danger onPress={() => router.push('/privacy/delete')} />
                </RowGroup>
              </div>
            </>
          );
        }}
      </AsyncBody>
    </SubPage>
  );
}

export function DeleteAccountScreen() {
  const t = useT();
  const router = useRouter();
  const { locale } = usePrefs();
  const word = locale === 'sw' ? 'FUTA' : 'DELETE';
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = v.trim().toUpperCase() === word;
  const del = async () => {
    if (!ready || busy) return;
    setBusy(true);
    expectSignOut(true);
    try {
      await api.delete('/me');
      forgetLocally();
      router.replace('/');
      toast(t('privacy.deleted'));
    } catch (e) {
      expectSignOut(false);
      toast(errorMessage(e, t), { error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SubPage title={t('privacy.delete')} back="/privacy">
      <h2 className="t-display-s">{t('privacy.delete.title')}</h2>
      <div className="mt-3">
        {['privacy.delete.point1', 'privacy.delete.point2', 'privacy.delete.point3'].map((k) => (
          <p key={k} className="t-body-s mb-3 flex gap-3">
            <Icon icon={Ic.circleAlert} size={16} className="mt-0.5 shrink-0 text-danger" />
            {t(k)}
          </p>
        ))}
      </div>
      <form className="mt-4 flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); void del(); }}>
        <TextField label={t('privacy.delete.type', { word })} placeholder={word} value={v} onChange={(e) => setV(e.target.value)} autoCapitalize="characters" />
        <SwButton label={t('privacy.delete.confirm')} icon={Ic.trash2} variant="danger" large expand pending={busy} onPress={ready && !busy ? del : null} />
      </form>
    </SubPage>
  );
}
