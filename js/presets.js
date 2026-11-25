export const SYMBOLS = ['★', '♥', '✿', '✦', '♪', '❄', '♡', '☆', '❀', '✨'];

export const PRESETS = [
  {
    id: 'sapin',
    label: '🎄 Sapin de Noël',
    command: 'python3 sapin_noel.py',
    message: 'Joyeux Noël ! ★',
    art: [
      '         ★',
      '        / \\',
      '       /*o\\',
      '      /o*+\\',
      '     /+o*o\\',
      '    /o*+o*o\\',
      '   /*o+o*o+\\',
      '  /o+o*o+o*o\\',
      ' /*o+o*o+o*o+\\',
      '/o*+o*o+o*o*o\\',
      '¯¯¯¯¯¯¯| |¯¯¯¯¯¯¯',
      '       | |',
      '    [+*]   [*+]',
    ].join('\n'),
  },
  {
    id: 'chat',
    label: '🐱 Chat mignon',
    command: 'python3 chat_mignon.py',
    message: 'Miaou ~ passe une belle journée ♥',
    art: [
      '     /\\_____/\\',
      '    /  o   o  \\',
      '   ( ==  ^  == )',
      '    )         (',
      '   (           )',
      '  ( (  )   (  ) )',
      ' (__(__)___(__)__)',
      '     ♡   ✦   ♡',
    ].join('\n'),
  },
  {
    id: 'coeur',
    label: '❤️ Cœur',
    command: 'python3 coeur.py',
    message: 'Pour toi ♥',
    art: [
      '    ♥♥♥♥     ♥♥♥♥',
      '  ♥♥♥♥♥♥♥   ♥♥♥♥♥♥♥',
      ' ♥♥♥♥♥♥♥♥♥ ♥♥♥♥♥♥♥♥♥',
      ' ♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥',
      '  ♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥♥',
      '    ♥♥♥♥♥♥♥♥♥♥♥♥♥',
      '      ♥♥♥♥♥♥♥♥♥',
      '        ♥♥♥♥♥',
      '          ♥',
    ].join('\n'),
  },
  {
    id: 'bouquet',
    label: '💐 Bouquet de fleurs',
    command: 'python3 bouquet.py',
    message: 'Un petit bouquet pour toi ✿',
    art: [
      '      ✿   ❀   ✿',
      '    ❀  \\  |  /  ❀',
      '      ✿ \\ | / ✿',
      '         \\|/',
      '        \\ | /',
      '         \\|/',
      '         /|\\',
      '        / ♥ \\',
      '       /_____\\',
    ].join('\n'),
  },
  {
    id: 'libre',
    label: '✨ Libre',
    command: 'python3 ascii_art.py',
    message: 'Mon ASCII Art ★',
    art: [
      '  ✦  .  *  .  ✦',
      '   Colle ton',
      '   ASCII art',
      '     ici !',
      '  ✦  .  *  .  ✦',
    ].join('\n'),
  },
];

export const ANIMATIONS = [
  { id: 'twinkle', label: '✨ Scintillement' },
  { id: 'rainbow', label: '🌈 Vague Arc-en-ciel' },
  { id: 'reveal', label: '⌨️ Apparition + Scintillement' },
  { id: 'pulse', label: '💫 Pulsation douce' },
];

export function getPresetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}
