import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ErrorNotice, WarningNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { Fingerprint } from '../components/Fingerprint';
import { Modal } from '../components/Modal';
import { SegmentedControl } from '../components/SegmentedControl';
import { Toggle } from '../components/Toggle';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import { describeError } from '../lib/errorMessages';
import { removeAvatar, uploadAvatar } from '../lib/supabase/avatars';
import { MAX_FONT_SCALE, MIN_FONT_SCALE } from '../lib/settings';
import { SHORTCUTS } from '../lib/shortcuts';

type Tab = 'profiel' | 'uiterlijk' | 'sleutel' | 'meldingen' | 'privacy' | 'over';

const TABS: { id: Tab; label: string }[] = [
  { id: 'profiel', label: 'Profiel' },
  { id: 'uiterlijk', label: 'Uiterlijk' },
  { id: 'sleutel', label: 'Sleutel' },
  { id: 'meldingen', label: 'Meldingen' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'over', label: 'Over' },
];

interface SettingsDialogProps {
  onClose: () => void;
  /** Channels you can mute, so notifications can be set per channel. */
  channels: { id: string; label: string }[];
}

export function SettingsDialog({ onClose, channels }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>('profiel');

  return (
    <Modal title="Instellingen" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        {/*
         * A real tab list: role="tablist" with arrow keys, not six buttons
         * that happen to look like tabs. On a phone it scrolls horizontally
         * rather than wrapping into three rows of chips.
         */}
        <div
          role="tablist"
          aria-label="Instellingen"
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
          {tab === 'profiel' ? <ProfileTab /> : null}
          {tab === 'uiterlijk' ? <AppearanceTab /> : null}
          {tab === 'sleutel' ? <KeyTab /> : null}
          {tab === 'meldingen' ? <NotificationsTab channels={channels} /> : null}
          {tab === 'privacy' ? <PrivacyTab /> : null}
          {tab === 'over' ? <AboutTab /> : null}
        </div>
      </div>
    </Modal>
  );
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-secondary">
        {title}
      </h3>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p> : null}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function ProfileTab() {
  const { profile, user, saveProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [saved]);

  async function handleSaveName(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await saveProfile({ displayName });
      setSaved(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleAvatar(file: File): Promise<void> {
    setError(null);
    setBusy(true);
    const previous = profile?.avatarUrl ?? null;

    try {
      const url = await uploadAvatar(file);
      await saveProfile({ avatarUrl: url });
      setSaved(true);

      // Only after the profile points at the new one. The other order would
      // leave a profile pointing at a file that no longer exists if the
      // update failed.
      if (previous) {
        try {
          await removeAvatar(previous);
        } catch (caught) {
          console.error('Oude avatar bleef staan:', caught);
        }
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const name = profile?.displayName ?? profile?.username ?? '';

  return (
    <>
      <Section title="Avatar">
        <div className="flex items-center gap-4">
          <Avatar
            userId={user?.id ?? 'onbekend'}
            name={name}
            url={profile?.avatarUrl}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              aria-label="Avatar kiezen"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleAvatar(file);
                }
                event.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {profile?.avatarUrl ? 'Andere afbeelding' : 'Afbeelding kiezen'}
            </Button>
            {profile?.avatarUrl ? (
              <Button
                variant="ghost"
                disabled={busy}
                className="ml-1"
                onClick={() => {
                  const previous = profile.avatarUrl;
                  void (async () => {
                    setBusy(true);
                    try {
                      await saveProfile({ avatarUrl: null });
                      if (previous) {
                        await removeAvatar(previous).catch(() => undefined);
                      }
                    } catch (caught) {
                      setError(describeError(caught));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Weghalen
              </Button>
            ) : null}
            <p className="mt-2 text-xs leading-relaxed text-muted">PNG, JPEG, WebP of GIF, maximaal 2 MB.</p>
          </div>
        </div>

        <div className="mt-3">
          <WarningNotice>
            Je avatar wordt <strong>niet versleuteld</strong>. Hij staat in een publieke
            map en is opvraagbaar door iedereen die de link kent, ook zonder account.
            Dat kan niet anders: een avatar moet laden voor iedereen die je naam ziet,
            dus er is geen sleutel om hem mee te versleutelen. Kies dus geen foto die
            privé moet blijven.
          </WarningNotice>
        </div>
      </Section>

      <Section
        title="Weergavenaam"
        hint="Wat anderen zien in plaats van je gebruikersnaam. Laat leeg om je gebruikersnaam te gebruiken."
      >
        <div className="flex flex-col gap-2">
          <Field
            label="Weergavenaam"
            value={displayName}
            maxLength={40}
            placeholder={profile?.username ?? ''}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              disabled={busy || (profile?.displayName ?? '') === displayName.trim()}
              onClick={() => {
                void handleSaveName();
              }}
            >
              {busy ? 'Bezig…' : 'Opslaan'}
            </Button>
            {saved ? (
              <span role="status" className="text-xs text-success">
                Opgeslagen
              </span>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title="Gebruikersnaam" hint="Deze is in deze fase niet te wijzigen.">
        <p className="rounded-md border border-subtle bg-inset px-3 py-2 font-mono text-sm text-secondary">
          @{profile?.username}
        </p>
      </Section>

      <ErrorNotice message={error} />
    </>
  );
}

function AppearanceTab() {
  const { settings, update } = useSettings();
  const sliderId = useId();

  return (
    <>
      <Section title="Thema">
        <SegmentedControl
          legend="Thema"
          hideLegend
          value={settings.theme}
          onChange={(theme) => update('theme', theme)}
          options={[
            { value: 'system', label: 'Systeem' },
            { value: 'dark', label: 'Donker' },
            { value: 'light', label: 'Licht' },
          ]}
        />
      </Section>

      <Section
        title="Berichtdichtheid"
        hint="Compact zet meer berichten op een scherm; comfortabel geeft ze meer lucht."
      >
        <SegmentedControl
          legend="Berichtdichtheid"
          hideLegend
          value={settings.density}
          onChange={(density) => update('density', density)}
          options={[
            { value: 'comfortable', label: 'Comfortabel' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Section>

      <Section title="Lettergrootte">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-xs text-muted">
            A
          </span>
          <input
            id={sliderId}
            type="range"
            min={MIN_FONT_SCALE}
            max={MAX_FONT_SCALE}
            step={0.05}
            value={settings.fontScale}
            aria-label="Lettergrootte"
            onChange={(event) => update('fontScale', Number(event.target.value))}
            className="min-w-0 flex-1 accent-[var(--vault-accent)]"
          />
          <span aria-hidden="true" className="text-lg text-muted">
            A
          </span>
          <span className="w-10 shrink-0 text-right text-xs text-muted">
            {Math.round(settings.fontScale * 100)}%
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Deze instelling schaalt de hele interface mee, niet alleen de berichten.
        </p>
      </Section>
    </>
  );
}

function KeyTab() {
  const { profile, exportEncryptedKey } = useAuth();
  const [error, setError] = useState<string | null>(null);

  async function handleExport(): Promise<void> {
    setError(null);
    try {
      const armored = await exportEncryptedKey();
      const blob = new Blob([armored], { type: 'application/pgp-keys' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vault-key-${profile?.username ?? 'account'}.asc`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <>
      <Section
        title="Jouw vingerafdruk"
        hint="Lees deze reeks voor aan je gesprekspartners via een ander kanaal — bellen, of naast elkaar. Zo weten zij dat ze echt met jou praten."
      >
        <div className="rounded-md border border-subtle bg-inset p-3">
          {profile ? <Fingerprint value={profile.fingerprint} size="md" /> : null}
        </div>
      </Section>

      <Section
        title="Back-up"
        hint="Het bestand bevat je privésleutel, nog versleuteld met je wachtwoord. Bewaar het ergens waar je erbij kunt, en waar niemand anders bij hoort te kunnen."
      >
        <Button
          variant="secondary"
          onClick={() => {
            void handleExport();
          }}
        >
          Sleutel exporteren
        </Button>
      </Section>

      <Section title="Wat je kwijt bent zonder deze sleutel">
        <div className="flex flex-col gap-2">
          <WarningNotice>
            <strong>Alles.</strong> Je berichten staan versleuteld op de server en
            alleen jouw privésleutel kan ze openen. Die sleutel staat versleuteld op
            dit apparaat, en het wachtwoord dat hem opent kennen wij niet.
          </WarningNotice>
          <ul className="ml-4 list-disc text-xs leading-relaxed text-muted">
            <li>
              Wachtwoord kwijt: er is geen herstel en geen reset. Elk bericht dat je
              ooit hebt ontvangen is dan definitief onleesbaar.
            </li>
            <li>
              Apparaat kwijt zonder back-upbestand: hetzelfde, tenzij je nog een ander
              apparaat hebt waar de sleutel op staat.
            </li>
            <li>
              Back-upbestand plus wachtwoord: dan kun je op elk apparaat weer bij je
              berichten.
            </li>
          </ul>
        </div>
      </Section>

      {/*
        * Deze sectie staat er los, en niet als voetnoot onder de vorige.
        *
        * Dit is het duurste gevolg van het hele ontwerp en het staat nergens
        * anders in de app: je sleutel kwijt is niet "opnieuw instellen" maar
        * "nieuw account". Wie dat pas ontdekt op het moment dat het gebeurt,
        * heeft er niets meer aan.
        */}
      <Section title="Je sleutel hoort bij dit account en is niet te vervangen">
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed text-secondary">
            Bij dit account hoort één publieke sleutel, en die staat vast. Je kunt er
            geen nieuwe voor in de plaats zetten — ook niet met volledige toegang tot
            de database. Dat is bewust: kon iemand zijn sleutel omwisselen, dan
            versleutelt iedereen vanaf dat moment stil naar de nieuwe en merkt niemand
            het. Precies waar het vergelijken van vingerafdrukken voor bedoeld is.
          </p>
          <WarningNotice>
            <strong>
              Ben je je sleutel kwijt en heb je geen back-upbestand en geen ander
              apparaat waar hij nog op staat, dan is dit account niet meer te
              gebruiken.
            </strong>{' '}
            Je maakt dan een nieuw account met een nieuwe gebruikersnaam en begint met
            een leeg gesprek. Je oude berichten blijven versleuteld op de server
            staan; niemand kan ze nog openen, jij ook niet.
          </WarningNotice>
          <p className="text-xs leading-relaxed text-muted">
            Er is dus geen herstelpad, en dat is een keuze en geen tekortkoming: een
            noodluik voor ons zou ook een noodluik voor iemand anders zijn. Wat je nu
            kunt doen is één ding: hierboven je sleutel exporteren en dat bestand
            ergens bewaren waar jij bij kunt en niemand anders.
          </p>
        </div>
      </Section>

      <ErrorNotice message={error} />
    </>
  );
}

function NotificationsTab({ channels }: { channels: { id: string; label: string }[] }) {
  const { settings, update, setChannelMuted, isChannelMuted } = useSettings();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
  );

  async function enable(): Promise<void> {
    if (typeof Notification === 'undefined') {
      return;
    }
    // Asked here, on a click, and never at startup: a permission prompt that
    // appears before you have seen the app is a prompt everybody denies.
    const result = await Notification.requestPermission();
    setPermission(result);
    update('notifications', result === 'granted');
  }

  return (
    <>
      <Section
        title="Meldingen"
        hint="Vault laat alleen zien in welk kanaal iets nieuws staat, nooit wat er staat. De tekst is versleuteld en hoort niet in een melding van je besturingssysteem."
      >
        {permission === 'unsupported' ? (
          <p className="text-xs text-muted">
            Deze browser ondersteunt geen meldingen.
          </p>
        ) : permission === 'denied' ? (
          <WarningNotice>
            Meldingen zijn geblokkeerd voor deze site. Dat kun je alleen in de
            instellingen van je browser terugzetten; wij kunnen er niet nog een keer
            om vragen.
          </WarningNotice>
        ) : permission === 'granted' ? (
          <Toggle
            label="Meldingen tonen"
            description="Bij een nieuw bericht in een kanaal dat je niet open hebt."
            checked={settings.notifications}
            onChange={(value) => update('notifications', value)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-relaxed text-muted">
              Je browser moet hier eerst toestemming voor geven.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                void enable();
              }}
            >
              Toestemming vragen
            </Button>
          </div>
        )}
      </Section>

      <Section title="Geluid">
        <Toggle
          label="Geluid bij een melding"
          description="Standaard uit. Een geluid onderbreekt harder dan een melding."
          checked={settings.notificationSound}
          onChange={(value) => update('notificationSound', value)}
        />
      </Section>

      <Section
        title="Per kanaal"
        hint="Uitgezette kanalen geven geen melding. De ongelezen-teller blijft wel lopen."
      >
        {channels.length === 0 ? (
          <p className="text-xs text-muted">Je hebt nog geen gesprekken of kanalen.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-subtle">
            {channels.map((channel) => (
              <li key={channel.id} className="py-2 first:pt-0 last:pb-0">
                <Toggle
                  label={channel.label}
                  checked={!isChannelMuted(channel.id)}
                  onChange={(value) => setChannelMuted(channel.id, !value)}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function PrivacyTab() {
  const { settings, update } = useSettings();

  return (
    <>
      <Section title="Linkvoorbeelden">
        {/*
          * Uitgeschakeld, en dat is geen vergissing.
          *
          * De instelling staat er omdat de keuze vastligt: als
          * linkvoorbeelden er ooit komen, staan ze standaard uit. Het
          * ophalen zelf is nog niet gebouwd, en de reden staat eronder. Een
          * schuifje dat je kunt omzetten terwijl er niets gebeurt is een
          * leugen in de interface; een schuifje dat uitlegt waarom het vast
          * staat is dat niet.
          */}
        <Toggle
          label="Voorbeelden van links ophalen"
          description="Nog niet gebouwd. Blijft uit."
          checked={settings.linkPreviews}
          disabled
          onChange={(value) => update('linkPreviews', value)}
        />
        <div className="mt-2 flex flex-col gap-2">
          <WarningNotice>
            Zou dit aan staan, dan haalt je browser de gedeelde link zelf op om er een
            voorbeeld van te maken. De server aan de andere kant ziet daardoor jouw
            IP-adres en weet dat precies die link geopend is. Bij een link die iemand
            je in vertrouwen stuurde is dat een lek dat de afzender niet heeft
            afgesproken.
          </WarningNotice>
          <p className="text-xs leading-relaxed text-muted">
            Waarom het er nog niet is: een browser mag de meeste sites niet zelf
            uitlezen (CORS), dus in de praktijk lukt dit alleen via een tussenserver.
            En een tussenserver zou precies zien welke links er in gesprekken
            langskomen — het enige wat deze instelling moest voorkomen. Daarom liever
            geen voorbeelden dan voorbeelden via een omweg.
          </p>
        </div>
      </Section>

      <Section title="Typen-indicator">
        <Toggle
          label='Laten zien dat je aan het typen bent'
          description="Zet je dit uit, dan zie je ook niet meer wie er typt. Alleen versturen en toch meekijken zou een spiegel van één kant zijn."
          checked={settings.typingIndicator}
          onChange={(value) => update('typingIndicator', value)}
        />
      </Section>

      <Section title="Wat de server van je weet">
        <ul className="ml-4 list-disc text-xs leading-relaxed text-muted">
          <li>
            <strong>Niet:</strong> de inhoud van je berichten, je bestandsnamen, of je
            privésleutel. Die staan versleuteld of verlaten je browser nooit.
          </li>
          <li>
            <strong>Wel:</strong> wie er in welk kanaal zit, wanneer er berichten
            langskomen en hoe groot ze zijn, en welke emoji je onder een bericht zet.
            Dat is metadata die nodig is om berichten af te leveren.
          </li>
          <li>
            Zoeken gebeurt daarom in je browser, in wat al ontsleuteld is. Een
            zoekindex op de server zou betekenen dat de server je berichten kan lezen.
          </li>
        </ul>
      </Section>
    </>
  );
}

function AboutTab() {
  return (
    <>
      <Section title="Vault">
        <p className="text-sm leading-relaxed text-secondary">
          End-to-end versleutelde chat. De structuur van Discord, de snelheid van
          Telegram, en PGP als echte versleutelingslaag.
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Versie</dt>
          <dd className="font-mono text-secondary">{__APP_VERSION__}</dd>
          <dt className="text-muted">Crypto</dt>
          <dd className="text-secondary">OpenPGP.js, curve25519</dd>
          <dt className="text-muted">Sleutelopslag</dt>
          <dd className="text-secondary">IndexedDB, versleuteld met je wachtwoord</dd>
        </dl>
      </Section>

      <Section title="Sneltoetsen">
        <ul className="flex flex-col divide-y divide-subtle">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.keys}
              className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
            >
              <span className="text-xs text-secondary">{shortcut.description}</span>
              <kbd className="shrink-0 rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-2xs text-secondary">
                {shortcut.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Wat Vault bewust niet doet">
        <ul className="ml-4 list-disc text-xs leading-relaxed text-muted">
          <li>Geen wachtwoordherstel. Er is niets om mee te herstellen.</li>
          <li>Geen zoekindex op de server, en geen bots die overal bij kunnen.</li>
          <li>Geen analytics en geen externe fonts of trackers.</li>
          <li>
            Oudere berichten worden niet opnieuw versleuteld voor nieuwe leden. Dat is
            geen tekortkoming maar het punt.
          </li>
        </ul>
      </Section>
    </>
  );
}
