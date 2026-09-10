/**
 * The emoji set for the reaction picker.
 *
 * A hand-picked list rather than a dataset package. emoji-mart and friends
 * ship roughly a megabyte of names, keywords and skin-tone variants, and in an
 * app that keeps OpenPGP out of the entry chunk to save 350 kB it would be odd
 * to spend three times that on smileys. This is around 150 of them with Dutch
 * search terms, which is enough to react to a message and small enough to
 * search without an index.
 *
 * Dutch keywords on purpose: the rest of the interface is Dutch, so somebody
 * typing "lach" or "duim" should find something. The English word is included
 * where it is the one people actually type.
 */

export interface EmojiEntry {
  emoji: string;
  /** Words that should find this emoji. Lower case, no accents. */
  keywords: string[];
}

/**
 * The row shown before the full picker opens.
 *
 * Six, because that is what fits next to a message on a phone without
 * wrapping, and because a quick picker with twenty options is not quick.
 */
export const QUICK_REACTIONS = ['👍', '❤️', '😄', '🎉', '👀', '🙏'] as const;

export const EMOJI: EmojiEntry[] = [
  { emoji: '👍', keywords: ['duim', 'goed', 'ja', 'oke', 'thumbs', 'up'] },
  { emoji: '👎', keywords: ['duim', 'omlaag', 'nee', 'slecht', 'thumbs', 'down'] },
  { emoji: '❤️', keywords: ['hart', 'liefde', 'love', 'rood'] },
  { emoji: '🧡', keywords: ['hart', 'oranje'] },
  { emoji: '💚', keywords: ['hart', 'groen'] },
  { emoji: '💙', keywords: ['hart', 'blauw'] },
  { emoji: '💜', keywords: ['hart', 'paars'] },
  { emoji: '🖤', keywords: ['hart', 'zwart'] },
  { emoji: '💔', keywords: ['hart', 'gebroken', 'verdriet'] },
  { emoji: '😄', keywords: ['lach', 'blij', 'smile', 'happy'] },
  { emoji: '😀', keywords: ['lach', 'grijns', 'blij'] },
  { emoji: '😁', keywords: ['grijns', 'lach', 'tanden'] },
  { emoji: '😂', keywords: ['lach', 'tranen', 'huilen', 'grappig', 'lol'] },
  { emoji: '🤣', keywords: ['lach', 'rollen', 'grappig', 'rofl'] },
  { emoji: '😊', keywords: ['blij', 'lach', 'blozen', 'lief'] },
  { emoji: '😉', keywords: ['knipoog', 'wink'] },
  { emoji: '😍', keywords: ['verliefd', 'hartjes', 'ogen'] },
  { emoji: '🥰', keywords: ['verliefd', 'lief', 'hartjes'] },
  { emoji: '😘', keywords: ['kus', 'kusje'] },
  { emoji: '😎', keywords: ['cool', 'zonnebril', 'stoer'] },
  { emoji: '🤓', keywords: ['nerd', 'bril', 'slim'] },
  { emoji: '🧐', keywords: ['monocle', 'onderzoeken', 'kritisch'] },
  { emoji: '🤔', keywords: ['denken', 'nadenken', 'hmm', 'twijfel'] },
  { emoji: '🤨', keywords: ['wenkbrauw', 'twijfel', 'sceptisch'] },
  { emoji: '😐', keywords: ['neutraal', 'blank', 'geen mening'] },
  { emoji: '😑', keywords: ['uitdrukkingsloos', 'zucht'] },
  { emoji: '😶', keywords: ['stil', 'geen mond', 'zwijgen'] },
  { emoji: '🙄', keywords: ['ogen', 'rollen', 'oogrol', 'ja ja'] },
  { emoji: '😏', keywords: ['grijns', 'smirk', 'zelfvoldaan'] },
  { emoji: '😬', keywords: ['grimas', 'ongemakkelijk', 'oeps'] },
  { emoji: '😅', keywords: ['zweet', 'lach', 'net goed'] },
  { emoji: '😓', keywords: ['zweet', 'moe', 'stress'] },
  { emoji: '😪', keywords: ['slaap', 'moe'] },
  { emoji: '😴', keywords: ['slapen', 'moe', 'zzz'] },
  { emoji: '🥱', keywords: ['geeuw', 'moe', 'verveeld'] },
  { emoji: '😵', keywords: ['duizelig', 'kapot', 'overweldigd'] },
  { emoji: '🤯', keywords: ['mind blown', 'wow', 'ontploffen', 'verbaasd'] },
  { emoji: '😱', keywords: ['schrik', 'angst', 'gil'] },
  { emoji: '😨', keywords: ['bang', 'schrik'] },
  { emoji: '😰', keywords: ['bang', 'zweet', 'stress'] },
  { emoji: '😢', keywords: ['huilen', 'traan', 'verdriet'] },
  { emoji: '😭', keywords: ['huilen', 'hard', 'verdriet'] },
  { emoji: '😤', keywords: ['boos', 'stoom', 'gefrustreerd'] },
  { emoji: '😠', keywords: ['boos', 'kwaad'] },
  { emoji: '😡', keywords: ['woedend', 'boos', 'rood'] },
  { emoji: '🤬', keywords: ['vloeken', 'schelden', 'boos'] },
  { emoji: '🤗', keywords: ['knuffel', 'omhelzing', 'hug'] },
  { emoji: '🤝', keywords: ['handdruk', 'deal', 'afspraak'] },
  { emoji: '🙏', keywords: ['bedankt', 'dank', 'alsjeblieft', 'bidden', 'please'] },
  { emoji: '👏', keywords: ['applaus', 'klappen', 'bravo'] },
  { emoji: '🙌', keywords: ['hoera', 'handen', 'gelukt'] },
  { emoji: '👋', keywords: ['zwaaien', 'hoi', 'dag', 'hallo'] },
  { emoji: '🤙', keywords: ['bellen', 'shaka', 'later'] },
  { emoji: '✌️', keywords: ['peace', 'vrede', 'twee'] },
  { emoji: '🤞', keywords: ['duimen', 'hopen', 'geluk'] },
  { emoji: '👌', keywords: ['ok', 'perfect', 'prima'] },
  { emoji: '🫡', keywords: ['salueren', 'begrepen', 'aye'] },
  { emoji: '🤌', keywords: ['italiaans', 'wat', 'hand'] },
  { emoji: '💪', keywords: ['sterk', 'spier', 'kracht'] },
  { emoji: '🫶', keywords: ['hartjes', 'handen', 'liefde'] },
  { emoji: '👀', keywords: ['ogen', 'kijken', 'spannend', 'zie ik'] },
  { emoji: '👁️', keywords: ['oog', 'kijken'] },
  { emoji: '🧠', keywords: ['brein', 'hersenen', 'slim', 'idee'] },
  { emoji: '🎉', keywords: ['feest', 'hoera', 'party', 'gelukt'] },
  { emoji: '🎊', keywords: ['feest', 'confetti', 'hoera'] },
  { emoji: '🥳', keywords: ['feest', 'party', 'vieren'] },
  { emoji: '🎂', keywords: ['taart', 'verjaardag', 'feest'] },
  { emoji: '🍰', keywords: ['cake', 'taart', 'zoet'] },
  { emoji: '🍕', keywords: ['pizza', 'eten'] },
  { emoji: '🍔', keywords: ['burger', 'eten'] },
  { emoji: '🍟', keywords: ['friet', 'patat', 'eten'] },
  { emoji: '🌮', keywords: ['taco', 'eten'] },
  { emoji: '🍣', keywords: ['sushi', 'eten'] },
  { emoji: '🍜', keywords: ['noedels', 'ramen', 'eten'] },
  { emoji: '☕', keywords: ['koffie', 'thee', 'pauze'] },
  { emoji: '🍺', keywords: ['bier', 'borrel', 'drinken'] },
  { emoji: '🍻', keywords: ['proost', 'bier', 'toast'] },
  { emoji: '🥂', keywords: ['proost', 'champagne', 'vieren'] },
  { emoji: '🍷', keywords: ['wijn', 'drinken'] },
  { emoji: '🧉', keywords: ['mate', 'drinken'] },
  { emoji: '🚀', keywords: ['raket', 'launch', 'live', 'snel', 'deploy'] },
  { emoji: '🛠️', keywords: ['gereedschap', 'bouwen', 'fixen'] },
  { emoji: '🔧', keywords: ['sleutel', 'fixen', 'tool'] },
  { emoji: '🐛', keywords: ['bug', 'insect', 'fout'] },
  { emoji: '🔥', keywords: ['vuur', 'goed', 'hot', 'brand'] },
  { emoji: '💯', keywords: ['honderd', 'helemaal', 'top'] },
  { emoji: '✨', keywords: ['sparkles', 'mooi', 'nieuw', 'glans'] },
  { emoji: '⚡', keywords: ['bliksem', 'snel', 'stroom'] },
  { emoji: '💥', keywords: ['knal', 'boem', 'crash'] },
  { emoji: '🌟', keywords: ['ster', 'top', 'goed'] },
  { emoji: '⭐', keywords: ['ster', 'favoriet'] },
  { emoji: '☑️', keywords: ['vinkje', 'klaar', 'af', 'check'] },
  { emoji: '✅', keywords: ['vinkje', 'goed', 'klaar', 'gelukt', 'groen'] },
  { emoji: '❌', keywords: ['kruis', 'fout', 'nee', 'mislukt'] },
  { emoji: '⚠️', keywords: ['waarschuwing', 'let op', 'pas op'] },
  { emoji: '🚫', keywords: ['verboden', 'niet', 'stop'] },
  { emoji: '❓', keywords: ['vraag', 'vraagteken', 'hoe'] },
  { emoji: '❗', keywords: ['uitroepteken', 'let op', 'belangrijk'] },
  { emoji: '💡', keywords: ['idee', 'lamp', 'inzicht'] },
  { emoji: '📌', keywords: ['pin', 'vastzetten', 'belangrijk'] },
  { emoji: '📎', keywords: ['bijlage', 'paperclip', 'bestand'] },
  { emoji: '📝', keywords: ['notitie', 'schrijven', 'aantekening'] },
  { emoji: '📄', keywords: ['document', 'papier', 'bestand'] },
  { emoji: '📊', keywords: ['grafiek', 'cijfers', 'stats'] },
  { emoji: '📈', keywords: ['omhoog', 'groei', 'grafiek'] },
  { emoji: '📉', keywords: ['omlaag', 'daling', 'grafiek'] },
  { emoji: '🗓️', keywords: ['agenda', 'datum', 'planning'] },
  { emoji: '⏰', keywords: ['klok', 'tijd', 'alarm', 'deadline'] },
  { emoji: '⏳', keywords: ['wachten', 'tijd', 'zandloper'] },
  { emoji: '🔒', keywords: ['slot', 'dicht', 'versleuteld', 'veilig'] },
  { emoji: '🔓', keywords: ['slot', 'open', 'ontgrendeld'] },
  { emoji: '🔑', keywords: ['sleutel', 'key', 'wachtwoord'] },
  { emoji: '🗝️', keywords: ['sleutel', 'oud', 'key'] },
  { emoji: '🛡️', keywords: ['schild', 'veilig', 'beveiliging'] },
  { emoji: '👤', keywords: ['persoon', 'gebruiker', 'profiel'] },
  { emoji: '👥', keywords: ['groep', 'mensen', 'samen'] },
  { emoji: '🤖', keywords: ['bot', 'robot', 'automatisch'] },
  { emoji: '👻', keywords: ['spook', 'ghost', 'weg'] },
  { emoji: '💀', keywords: ['schedel', 'dood', 'kapot'] },
  { emoji: '🙈', keywords: ['aap', 'ogen', 'niet kijken', 'oeps'] },
  { emoji: '🙉', keywords: ['aap', 'oren', 'niet horen'] },
  { emoji: '🙊', keywords: ['aap', 'mond', 'stil'] },
  { emoji: '🐶', keywords: ['hond', 'dier'] },
  { emoji: '🐱', keywords: ['kat', 'poes', 'dier'] },
  { emoji: '🦊', keywords: ['vos', 'dier'] },
  { emoji: '🐻', keywords: ['beer', 'dier'] },
  { emoji: '🐼', keywords: ['panda', 'dier'] },
  { emoji: '🦉', keywords: ['uil', 'dier', 'wijs'] },
  { emoji: '🐧', keywords: ['pinguin', 'linux', 'dier'] },
  { emoji: '🦆', keywords: ['eend', 'dier', 'debug'] },
  { emoji: '🐙', keywords: ['octopus', 'dier'] },
  { emoji: '🌍', keywords: ['aarde', 'wereld', 'globaal'] },
  { emoji: '🌙', keywords: ['maan', 'nacht', 'donker'] },
  { emoji: '☀️', keywords: ['zon', 'licht', 'dag'] },
  { emoji: '🌧️', keywords: ['regen', 'weer'] },
  { emoji: '❄️', keywords: ['sneeuw', 'koud', 'vorst'] },
  { emoji: '🌈', keywords: ['regenboog', 'mooi'] },
  { emoji: '🎯', keywords: ['doel', 'raak', 'precies', 'target'] },
  { emoji: '🎲', keywords: ['dobbelsteen', 'gok', 'kans'] },
  { emoji: '🧩', keywords: ['puzzel', 'stuk', 'past'] },
  { emoji: '🎨', keywords: ['kunst', 'ontwerp', 'design', 'kleur'] },
  { emoji: '🎵', keywords: ['muziek', 'noot'] },
  { emoji: '📷', keywords: ['foto', 'camera'] },
  { emoji: '🖼️', keywords: ['afbeelding', 'plaatje', 'foto'] },
  { emoji: '📱', keywords: ['telefoon', 'mobiel', 'phone'] },
  { emoji: '💻', keywords: ['laptop', 'computer', 'code'] },
  { emoji: '🖥️', keywords: ['monitor', 'computer', 'desktop'] },
  { emoji: '⌨️', keywords: ['toetsenbord', 'typen'] },
  { emoji: '🔍', keywords: ['zoeken', 'loep', 'search'] },
  { emoji: '🗑️', keywords: ['prullenbak', 'verwijderen', 'weg'] },
  { emoji: '♻️', keywords: ['recycle', 'hergebruik', 'refactor'] },
  { emoji: '🆗', keywords: ['ok', 'goed'] },
  { emoji: '🔁', keywords: ['herhaal', 'opnieuw', 'retry'] },
  { emoji: '➡️', keywords: ['pijl', 'rechts', 'volgende'] },
  { emoji: '⬅️', keywords: ['pijl', 'links', 'terug'] },
];

/**
 * Filters the set by a search term.
 *
 * Matches on the emoji itself too, so pasting one finds it. An empty query
 * returns everything, which is what the picker shows when it opens.
 */
export function searchEmoji(query: string): EmojiEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') {
    return EMOJI;
  }

  return EMOJI.filter(
    (entry) =>
      entry.emoji === trimmed ||
      entry.keywords.some((keyword) => keyword.includes(trimmed)),
  );
}
