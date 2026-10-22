/**
 * Bot callsigns — what the killfeed prints for a garrison soldier.
 *
 * Surnames rather than gamertags: these are the other side's soldiers, and a
 * feed of `Villena  <rifle>  Timnak` reads as a fight where `Bot 7` reads as a
 * test. Handed out in a fixed stride (see `botName`) so neighbouring spawns do
 * not come up alphabetical, and so a capture run names the same body the same
 * thing every boot — no random draw is involved.
 */
export const BOT_NAMES = [
  'Villena', 'Timnak', 'Englerth', 'Allaway', 'Isibor', 'Tawarotip', 'Keele', 'Okafor',
  'Brannock', 'Vasquez', 'Halloran', 'Mbeki', 'Strand', 'Kowalczyk', 'Reyes', 'Aldana',
  'Dragomir', 'Nakamura', 'Fenwick', 'Osei', 'Petrakis', 'Lindqvist', 'Marlowe', 'Haddad',
  'Rourke', 'Sokolov', 'Ibarra', 'Tennant', 'Achebe', 'Varga', 'Kincaid', 'Moreau',
  'Castellan', 'Nwosu', 'Daltrey', 'Yilmaz', 'Hartigan', 'Quillon', 'Brandt', 'Saarinen',
  'Delacroix', 'Mendez', 'Thorne', 'Abara', 'Lukashenko', 'Pryce', 'Okonkwo', 'Galloway',
  'Rasmussen', 'Ferrante', 'Vukovic', 'Ashdown', 'Kaminski', 'Zamora', 'Holcomb', 'Adeyemi',
  'Corrigan', 'Esposito', 'Malek', 'Steiner', 'Tavares', 'Oduya', 'Whitlock', 'Renshaw',
];

/** The n-th callsign: 37 is coprime with 64, so the stride visits every name. */
export function botName(n) {
  return BOT_NAMES[(n * 37) % BOT_NAMES.length];
}
