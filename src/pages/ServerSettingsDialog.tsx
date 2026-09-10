import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ErrorNotice, WarningNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { SkeletonList } from '../components/Skeleton';
import { describeError } from '../lib/errorMessages';
import { inviteLinkFor } from '../lib/invite';
import { uploadAvatar } from '../lib/supabase/avatars';
import { createInvite, listInvites, revokeInvite } from '../lib/supabase/servers';
import { normalizeChannelName } from '../lib/channelName';
import type { ChannelSummary, ServerInvite, ServerMember, ServerRole, ServerSummary } from '../types';

type Tab = 'algemeen' | 'kanalen' | 'leden' | 'uitnodigingen';

interface ServerSettingsDialogProps {
  server: ServerSummary;
  channels: readonly ChannelSummary[];
  members: readonly ServerMember[];
  currentUserId: string | null;
  canManageMembers: boolean;
  onClose: () => void;
  onUpdateServer: (input: { name?: string; iconUrl?: string | null }) => Promise<void>;
  onDeleteServer: () => Promise<void>;
  onUpdateChannel: (
    channelId: string,
    input: { name?: string; description?: string | null },
  ) => Promise<void>;
  onDeleteChannel: (channelId: string) => Promise<void>;
  onReorder: (orderedChannelIds: string[]) => Promise<void>;
  onSetRole: (userId: string, role: ServerRole) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onTransferOwnership: (userId: string) => Promise<void>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'algemeen', label: 'Algemeen' },
  { id: 'kanalen', label: 'Kanalen' },
  { id: 'leden', label: 'Leden' },
  { id: 'uitnodigingen', label: 'Uitnodigingen' },
];

export function ServerSettingsDialog(props: ServerSettingsDialogProps) {
  const [tab, setTab] = useState<Tab>('algemeen');

  return (
    <Modal title={`Instellingen van ${props.server.name}`} onClose={props.onClose} size="lg">
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        <div
          role="tablist"
          aria-label="Serverinstellingen"
          onKeyDown={(event) => {
            const index = TABS.findIndex((candidate) => candidate.id === tab);
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
              event.preventDefault();
              setTab(TABS[(index + 1) % TABS.length]?.id ?? tab);
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
              event.preventDefault();
              setTab(TABS[(index - 1 + TABS.length) % TABS.length]?.id ?? tab);
            }
          }}
          className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:w-40 md:flex-col md:overflow-visible md:px-0 md:pb-0"
        >
          {TABS.map((candidate) => (
            <button
              key={candidate.id}
              role="tab"
              type="button"
              aria-selected={tab === candidate.id}
              tabIndex={tab === candidate.id ? 0 : -1}
              onClick={() => setTab(candidate.id)}
              className={`shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors md:w-full ${
                tab === candidate.id
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-secondary hover:bg-hover hover:text-primary'
              }`}
            >
              {candidate.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="min-w-0 flex-1">
          {tab === 'algemeen' ? <GeneralTab {...props} /> : null}
          {tab === 'kanalen' ? <ChannelsTab {...props} /> : null}
          {tab === 'leden' ? <MembersTab {...props} /> : null}
          {tab === 'uitnodigingen' ? <InvitesTab {...props} /> : null}
        </div>
      </div>
    </Modal>
  );
}

function GeneralTab({
  server,
  onUpdateServer,
  onDeleteServer,
  onClose,
}: ServerSettingsDialogProps) {
  const [name, setName] = useState(server.name);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = server.role === 'owner';

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="mb-6">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-secondary">
          Icoon
        </h3>
        <div className="mt-2.5 flex items-center gap-4">
          <Avatar userId={server.id} name={server.name} url={server.iconUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <label className="inline-flex">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                aria-label="Servericoon kiezen"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) {
                    void run(async () => {
                      const url = await uploadAvatar(file);
                      await onUpdateServer({ iconUrl: url });
                    });
                  }
                }}
              />
              <span className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-subtle bg-overlay px-3 text-sm text-primary transition-colors hover:bg-hover">
                Afbeelding kiezen
              </span>
            </label>
            {server.iconUrl ? (
              <Button
                variant="ghost"
                disabled={busy}
                className="ml-1"
                onClick={() => {
                  void run(() => onUpdateServer({ iconUrl: null }));
                }}
              >
                Weghalen
              </Button>
            ) : null}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Een servericoon is net als een avatar <strong>niet versleuteld</strong> en
              staat in een publieke map.
            </p>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-secondary">
          Naam
        </h3>
        <div className="mt-2.5 flex flex-col gap-2">
          <Field
            label="Servernaam"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
          <div>
            <Button
              disabled={busy || name.trim() === '' || name.trim() === server.name}
              onClick={() => {
                void run(() => onUpdateServer({ name }));
              }}
            >
              {busy ? 'Bezig…' : 'Opslaan'}
            </Button>
          </div>
        </div>
      </section>

      {isOwner ? (
        <section className="mb-6 border-t border-subtle pt-5">
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-danger">
            Server verwijderen
          </h3>

          <div className="mt-2.5">
            <WarningNotice>
              Dit verwijdert de server, alle kanalen en alle berichten erin, voor
              iedereen. Het is niet terug te draaien, ook niet door ons: de berichten
              zijn versleuteld en er is geen kopie.
            </WarningNotice>
          </div>

          {deleting ? (
            <div className="mt-3 flex flex-col gap-2">
              <Field
                label={`Typ "${server.name}" om te bevestigen`}
                value={confirmName}
                autoComplete="off"
                onChange={(event) => setConfirmName(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  // Retyping the name is a speed bump, not a permission check.
                  // The policy is what actually restricts this to the owner.
                  disabled={busy || confirmName !== server.name}
                  className="bg-danger text-danger-on hover:bg-danger-hover"
                  onClick={() => {
                    void run(async () => {
                      await onDeleteServer();
                      onClose();
                    });
                  }}
                >
                  Definitief verwijderen
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDeleting(false);
                    setConfirmName('');
                  }}
                >
                  Annuleren
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" className="mt-3" onClick={() => setDeleting(true)}>
              Server verwijderen
            </Button>
          )}
        </section>
      ) : null}

      <ErrorNotice message={error} />
    </>
  );
}

function ChannelsTab({
  channels,
  onUpdateChannel,
  onDeleteChannel,
  onReorder,
}: ServerSettingsDialogProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The channel being dragged, so a drop knows what to move. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>(() => channels.map((channel) => channel.id));

  // The list can change under us (somebody else adds a channel), so the local
  // order follows the server whenever the set of ids changes.
  useEffect(() => {
    setOrder(channels.map((channel) => channel.id));
  }, [channels]);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function move(from: number, to: number): void {
    if (from === to) {
      return;
    }
    const next = [...order];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      return;
    }
    next.splice(to, 0, moved);
    setOrder(next);
    void run(() => onReorder(next));
  }

  const ordered = order
    .map((id) => channels.find((channel) => channel.id === id))
    .filter((channel): channel is ChannelSummary => channel !== undefined);

  return (
    <>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Sleep om de volgorde te veranderen, of gebruik de pijltjes — die werken ook
        met een toetsenbord en op een telefoon, waar slepen in een scrollende lijst
        vrijwel niet lukt.
      </p>

      {ordered.length === 0 ? (
        <p className="text-sm text-muted">Deze server heeft nog geen kanalen.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {ordered.map((channel, index) => (
            <li
              key={channel.id}
              draggable
              onDragStart={() => setDragging(channel.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = order.indexOf(dragging ?? '');
                if (from !== -1) {
                  move(from, index);
                }
                setDragging(null);
              }}
              className={`rounded-md border border-subtle bg-overlay p-2 transition-opacity ${
                dragging === channel.id ? 'opacity-50' : ''
              }`}
            >
              {editing === channel.id ? (
                <div className="flex flex-col gap-2">
                  <Field
                    label="Naam"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    hint={
                      normalizeChannelName(name) === name.trim().toLowerCase()
                        ? undefined
                        : `Wordt opgeslagen als #${normalizeChannelName(name)}`
                    }
                  />
                  <Field
                    label="Omschrijving"
                    value={description}
                    maxLength={140}
                    placeholder="Waar gaat dit kanaal over?"
                    onChange={(event) => setDescription(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy}
                      onClick={() => {
                        void run(async () => {
                          await onUpdateChannel(channel.id, { name, description });
                          setEditing(null);
                        });
                      }}
                    >
                      Opslaan
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>
                      Annuleren
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="cursor-grab px-1 text-muted"
                    title="Versleep om te ordenen"
                  >
                    ⠿
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-primary">
                      #{channel.displayName}
                    </span>
                    {channel.description ? (
                      <span className="block truncate text-2xs text-muted">
                        {channel.description}
                      </span>
                    ) : null}
                  </span>

                  <IconButton
                    label={`${channel.displayName} omhoog`}
                    size="sm"
                    disabled={index === 0 || busy}
                    onClick={() => move(index, index - 1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label={`${channel.displayName} omlaag`}
                    size="sm"
                    disabled={index === ordered.length - 1 || busy}
                    onClick={() => move(index, index + 1)}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    label={`${channel.displayName} hernoemen`}
                    size="sm"
                    onClick={() => {
                      setEditing(channel.id);
                      setName(channel.displayName);
                      setDescription(channel.description ?? '');
                      setConfirmDelete(null);
                    }}
                  >
                    ✎
                  </IconButton>
                  <IconButton
                    label={`${channel.displayName} verwijderen`}
                    size="sm"
                    onClick={() => setConfirmDelete(channel.id)}
                  >
                    🗑
                  </IconButton>
                </div>
              )}

              {confirmDelete === channel.id ? (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-danger">
                  #{channel.displayName} en alle berichten erin verwijderen?
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        await onDeleteChannel(channel.id);
                        setConfirmDelete(null);
                      });
                    }}
                    className="font-medium underline"
                  >
                    Verwijderen
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(null)}
                    className="text-muted underline"
                  >
                    Annuleren
                  </button>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <ErrorNotice message={error} />
      </div>
    </>
  );
}

const ROLE_LABELS: Record<ServerRole, string> = {
  owner: 'Eigenaar',
  admin: 'Admin',
  member: 'Lid',
};

const ROLE_ORDER: ServerRole[] = ['owner', 'admin', 'member'];

function MembersTab({
  members,
  currentUserId,
  canManageMembers,
  onSetRole,
  onRemoveMember,
  onTransferOwnership,
}: ServerSettingsDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!canManageMembers ? (
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Alleen de eigenaar kan rollen aanpassen of leden verwijderen.
        </p>
      ) : null}

      {/* Grouped by role, like Discord: in a server of thirty you look for
          "who can do something about this" before you look for a name. */}
      {ROLE_ORDER.map((role) => {
        const inRole = members.filter((member) => member.role === role);
        if (inRole.length === 0) {
          return null;
        }

        return (
          <section key={role} className="mb-5 last:mb-0">
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-secondary">
              {ROLE_LABELS[role]} — {inRole.length}
            </h3>

            <ul className="mt-2 flex flex-col divide-y divide-subtle">
              {inRole.map((member) => {
                const name = member.displayName ?? member.username;
                const isSelf = member.userId === currentUserId;

                return (
                  <li key={member.userId} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <Avatar
                        userId={member.userId}
                        name={name}
                        url={member.avatarUrl}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-primary">
                          {name}
                          {isSelf ? (
                            <span className="ml-1 text-2xs text-muted">(jij)</span>
                          ) : null}
                        </span>
                        {member.displayName ? (
                          <span className="block truncate text-2xs text-muted">
                            @{member.username}
                          </span>
                        ) : null}
                      </span>

                      {canManageMembers && !isSelf ? (
                        <div className="flex shrink-0 flex-wrap gap-1">
                          {member.role === 'member' ? (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                void run(() => onSetRole(member.userId, 'admin'));
                              }}
                            >
                              Admin maken
                            </Button>
                          ) : null}
                          {member.role === 'admin' ? (
                            <>
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  void run(() => onSetRole(member.userId, 'member'));
                                }}
                              >
                                Admin afnemen
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => setConfirmTransfer(member.userId)}
                              >
                                Eigendom overdragen
                              </Button>
                            </>
                          ) : null}
                          {member.role !== 'owner' ? (
                            <Button
                              variant="danger"
                              disabled={busy}
                              onClick={() => setConfirmRemove(member.userId)}
                            >
                              Verwijderen
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {confirmRemove === member.userId ? (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-danger">
                        {name} uit de server en uit alle kanalen verwijderen?
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              await onRemoveMember(member.userId);
                              setConfirmRemove(null);
                            });
                          }}
                          className="font-medium underline"
                        >
                          Verwijderen
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(null)}
                          className="text-muted underline"
                        >
                          Annuleren
                        </button>
                      </p>
                    ) : null}

                    {confirmTransfer === member.userId ? (
                      <div className="mt-1.5">
                        <WarningNotice>
                          {name} wordt eigenaar en jij wordt admin. Alleen de eigenaar
                          kan dat terugdraaien, dus dit is niet iets wat je zelf
                          ongedaan maakt.
                        </WarningNotice>
                        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void run(async () => {
                                await onTransferOwnership(member.userId);
                                setConfirmTransfer(null);
                              });
                            }}
                            className="font-medium text-danger underline"
                          >
                            Ja, {name} wordt eigenaar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmTransfer(null)}
                            className="text-muted underline"
                          >
                            Annuleren
                          </button>
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="mt-3">
        <ErrorNotice message={error} />
      </div>
    </>
  );
}

function InvitesTab({ server }: ServerSettingsDialogProps) {
  const [invites, setInvites] = useState<ServerInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(7);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const canManage = server.role === 'owner' || server.role === 'admin';

  useEffect(() => {
    if (!canManage) {
      setInvites([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const found = await listInvites(server.id);
        if (!cancelled) {
          setInvites(found);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(describeError(caught));
          setInvites([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server.id, canManage]);

  useEffect(() => {
    if (copied === null) {
      return;
    }
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  async function reload(): Promise<void> {
    setInvites(await listInvites(server.id));
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function describeInvite(invite: ServerInvite): string {
    const parts: string[] = [];

    if (invite.expiresAt) {
      const expires = new Date(invite.expiresAt);
      parts.push(
        expires.getTime() < Date.now()
          ? 'verlopen'
          : `verloopt ${expires.toLocaleDateString('nl-NL', {
              day: 'numeric',
              month: 'short',
            })}`,
      );
    } else {
      parts.push('geen einddatum');
    }

    if (invite.maxUses === null) {
      parts.push(`${invite.uses}x gebruikt, onbeperkt`);
    } else {
      parts.push(`${invite.uses} van ${invite.maxUses} gebruikt`);
    }

    return parts.join(' · ');
  }

  if (!canManage) {
    return (
      <p className="text-xs leading-relaxed text-muted">
        Alleen de eigenaar of een admin kan uitnodigingen zien en aanmaken. Dat is met
        opzet: wie de lijst met codes kan lezen, kan iedereen in de server zetten.
      </p>
    );
  }

  return (
    <>
      <section className="mb-6">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-secondary">
          Nieuwe uitnodiging
        </h3>

        <div className="mt-2.5 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wider text-secondary">
              Geldig
            </span>
            <select
              value={expiresInDays === null ? 'nooit' : String(expiresInDays)}
              onChange={(event) =>
                setExpiresInDays(
                  event.target.value === 'nooit' ? null : Number(event.target.value),
                )
              }
              className="min-h-11 rounded-md border border-subtle bg-inset px-3 text-sm text-primary outline-none focus:border-accent"
            >
              <option value="1">1 dag</option>
              <option value="7">7 dagen</option>
              <option value="30">30 dagen</option>
              <option value="nooit">Geen einddatum</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wider text-secondary">
              Maximaal aantal keer
            </span>
            <select
              value={maxUses === null ? 'onbeperkt' : String(maxUses)}
              onChange={(event) =>
                setMaxUses(
                  event.target.value === 'onbeperkt' ? null : Number(event.target.value),
                )
              }
              className="min-h-11 rounded-md border border-subtle bg-inset px-3 text-sm text-primary outline-none focus:border-accent"
            >
              <option value="1">1 keer</option>
              <option value="5">5 keer</option>
              <option value="25">25 keer</option>
              <option value="onbeperkt">Onbeperkt</option>
            </select>
          </label>

          <div>
            <Button
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await createInvite(server.id, { expiresInDays, maxUses });
                  await reload();
                });
              }}
            >
              {busy ? 'Bezig…' : 'Uitnodiging aanmaken'}
            </Button>
          </div>
        </div>
      </section>

      <section className="border-t border-subtle pt-5">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-secondary">
          Bestaande uitnodigingen
        </h3>

        <div className="mt-2.5">
          {invites === null ? (
            <SkeletonList rows={2} />
          ) : invites.length === 0 ? (
            <p className="text-xs text-muted">Er zijn nog geen uitnodigingen.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-subtle">
              {invites.map((invite) => {
                const link = inviteLinkFor(invite.code, window.location.origin);
                const spent =
                  (invite.expiresAt !== null &&
                    new Date(invite.expiresAt).getTime() < Date.now()) ||
                  (invite.maxUses !== null && invite.uses >= invite.maxUses);

                return (
                  <li key={invite.code} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <code
                          className={`block font-mono text-sm select-all ${
                            spent ? 'text-muted line-through' : 'text-primary'
                          }`}
                        >
                          {invite.code}
                        </code>
                        <span className="block text-2xs text-muted">
                          {describeInvite(invite)}
                        </span>
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(link)
                            .then(() => setCopied(invite.code))
                            .catch(() => undefined);
                        }}
                        className="shrink-0 rounded px-2 py-1 text-2xs font-medium text-accent transition-colors hover:bg-accent-soft"
                      >
                        {copied === invite.code ? 'Gekopieerd' : 'Link kopiëren'}
                      </button>

                      <IconButton
                        label={`Uitnodiging ${invite.code} intrekken`}
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            await revokeInvite(invite.code);
                            await reload();
                          });
                        }}
                      >
                        🗑
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="mt-3 text-2xs leading-relaxed text-muted">
          Wie een link opent en inlogt, komt in de server en in alle bestaande
          kanalen. Berichten van vóór dat moment blijven onleesbaar voor hem: die zijn
          versleuteld voor de leden van toen, en dat is niet achteraf te veranderen.
        </p>
      </section>

      <div className="mt-3">
        <ErrorNotice message={error} />
      </div>
    </>
  );
}
