import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Fingerprint } from './Fingerprint';
import { Modal } from './Modal';
import { OnlineDot } from './OnlineDot';
import { VerifiedBadge } from './VerifiedBadge';
import { usePresence } from '../hooks/usePresence';
import { useVerification } from '../hooks/useVerification';
import { getProfile } from '../lib/supabase/profiles';
import { describeError } from '../lib/errorMessages';
import type { Profile } from '../types';

interface ProfileCardProps {
  userId: string;
  /** True for your own card, which hides the DM button. */
  isSelf: boolean;
  onClose: () => void;
  /** Starts a conversation with this person. */
  onStartDm?: (username: string) => void;
}

function formatMemberSince(iso: string | null): string {
  if (!iso) {
    return 'onbekend';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'onbekend'
    : date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Somebody's profile, and the place where a key gets verified.
 *
 * The verification block is the reason this screen exists at all. Everything
 * else on it (a name, a date, a button) is convenience; comparing two
 * fingerprints out of band is the only thing in Vault that tells you whether
 * you are talking to who you think you are talking to.
 */
export function ProfileCard({ userId, isSelf, onClose, onStartDm }: ProfileCardProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { isOnline } = usePresence();
  const { statusFor, verifiedFingerprint, verify, unverify } = useVerification();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const found = await getProfile(userId);
        if (!cancelled) {
          setProfile(found);
          setError(found ? null : 'Dit profiel bestaat niet meer.');
        }
      } catch (caught) {
        if (!cancelled) {
          setError(describeError(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const name = profile?.displayName ?? profile?.username ?? '';
  const status = statusFor(userId, profile?.fingerprint ?? null);
  const previous = verifiedFingerprint(userId);

  return (
    <Modal title="Profiel" onClose={onClose} size="md">
      {loading ? (
        <p className="text-sm text-muted">Profiel laden…</p>
      ) : !profile ? (
        <ErrorNotice message={error} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <Avatar userId={profile.id} name={name} url={profile.avatarUrl} size="lg" />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-primary">{name}</h3>
                <VerifiedBadge status={status} name={name} />
                {isOnline(profile.id) ? <OnlineDot label={`${name} is online`} /> : null}
              </div>

              {profile.displayName ? (
                <p className="text-sm text-muted">@{profile.username}</p>
              ) : null}

              <p className="mt-1 text-xs text-muted">
                Lid sinds {formatMemberSince(profile.createdAt)}
              </p>

              {!isSelf && onStartDm ? (
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => onStartDm(profile.username)}
                >
                  Gesprek beginnen
                </Button>
              ) : null}
            </div>
          </div>

          <div className="border-t border-subtle pt-4">
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-secondary">
              Vingerafdruk
            </h4>

            <div className="mt-2 rounded-md border border-subtle bg-inset p-3">
              <Fingerprint value={profile.fingerprint} size="md" />
            </div>

            {status === 'changed' ? (
              <div className="mt-3 flex flex-col gap-2">
                <VerifiedBadge status="changed" name={name} variant="block" />
                {previous ? (
                  <div className="rounded-md border border-subtle bg-inset p-3">
                    <p className="mb-1 text-2xs uppercase tracking-wider text-muted">
                      Wat je eerder verifieerde
                    </p>
                    <Fingerprint value={previous} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {status === 'verified' ? (
              <div className="mt-3">
                <VerifiedBadge status="verified" name={name} variant="block" />
              </div>
            ) : null}

            {isSelf ? (
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Dit is jouw eigen vingerafdruk. Lees hem voor aan je gesprekspartners
                via een ander kanaal — bellen, of in dezelfde kamer — zodat zij kunnen
                controleren dat ze echt met jou praten.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs leading-relaxed text-muted">
                  Vergelijk deze reeks met wat {name} zelf ziet, via een kanaal buiten
                  Vault: bellen, videobellen, of naast elkaar op een scherm. Doe het
                  niet via Vault zelf — wie berichten kan onderscheppen, kan ook een
                  vingerafdruk onderscheppen.
                </p>

                {confirming ? (
                  <div className="rounded-md border border-warning-border bg-warning-soft p-3">
                    <p className="text-xs leading-relaxed text-warning">
                      Bevestig alleen als je de vingerafdruk daadwerkelijk hebt
                      vergeleken buiten Vault om. Een vinkje dat je zomaar zet, maakt
                      de waarschuwing die er later hoort te komen waardeloos.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        onClick={() => {
                          void verify(profile.id, profile.fingerprint);
                          setConfirming(false);
                        }}
                      >
                        Ja, ze zijn gelijk
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(false)}>
                        Annuleren
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setConfirming(true)}>
                      {status === 'changed'
                        ? 'Nieuwe vingerafdruk bevestigen'
                        : 'Vingerafdruk bevestigen'}
                    </Button>
                    {status !== 'unverified' ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void unverify(profile.id);
                        }}
                      >
                        Verificatie intrekken
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="border-t border-subtle pt-4 text-2xs leading-relaxed text-muted">
            Verificaties staan alleen op dit apparaat, in IndexedDB. Ze gaan niet naar
            de server: wie je vertrouwt is niets waar een server over hoort mee te
            beslissen. Op een ander apparaat begin je dus opnieuw.
          </p>
        </div>
      )}
    </Modal>
  );
}
