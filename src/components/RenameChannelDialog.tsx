import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { Modal } from './Modal';
import { normalizeChannelName } from '../lib/channelName';
import { describeError } from '../lib/errorMessages';
import type { ChannelSummary } from '../types';

interface RenameChannelDialogProps {
  channel: ChannelSummary;
  onClose: () => void;
  onSave: (input: { name: string; description?: string | null }) => Promise<void>;
}

/**
 * Renames a channel, and for a server channel also sets its description.
 *
 * A group has no description because there is nowhere to show one: the header
 * of a group already lists its members, which is the thing you want to see.
 */
export function RenameChannelDialog({
  channel,
  onClose,
  onSave,
}: RenameChannelDialogProps) {
  const isServerChannel = channel.type === 'text';
  const [name, setName] = useState(channel.displayName);
  const [description, setDescription] = useState(channel.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server channel names are normalised, so the preview shows what will
  // actually be stored. The same function does the storing, which is why the
  // two cannot disagree. A group name is a free-form label and is left alone.
  const normalized = isServerChannel ? normalizeChannelName(name) : name.trim();
  const willChange = isServerChannel && normalized !== name.trim().toLowerCase();

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await onSave(
        isServerChannel ? { name, description } : { name },
      );
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isServerChannel ? `#${channel.displayName} aanpassen` : 'Groep hernoemen'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="Naam"
          value={name}
          required
          maxLength={60}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          hint={willChange ? `Wordt opgeslagen als #${normalized}` : undefined}
        />

        {isServerChannel ? (
          <Field
            label="Omschrijving"
            value={description}
            maxLength={140}
            autoComplete="off"
            placeholder="Waar gaat dit kanaal over?"
            onChange={(event) => setDescription(event.target.value)}
            hint="Staat in de header van het kanaal. Laat leeg om hem weg te halen."
          />
        ) : null}

        <ErrorNotice message={error} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || normalized === ''}>
            {busy ? 'Bezig…' : 'Opslaan'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Annuleren
          </Button>
        </div>
      </form>
    </Modal>
  );
}
