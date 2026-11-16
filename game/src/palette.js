// The look plan, in one place. Emberline is a dusk foundry yard: cold slate and
// concrete against one hot amber, with orange for the Ember attackers and teal for
// the Warden defenders. Six scene values plus the two team hues; the lighting makes
// every shade the game needs, so no other colour appears in the code. The same
// names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#171a20',
  surface: '#232830',
  hairline: '#333a45',
  ink: '#ece7db',
  muted: '#9aa3ad',
  accent: '#f5a524',
  ember: '#e86a2c',
  warden: '#2fa8a0',
};

export const TEAM = {
  ember: { name: 'EMBER', color: PALETTE.ember, spawn: 'south' },
  warden: { name: 'WARDEN', color: PALETTE.warden, spawn: 'north' },
};

export function shade(name) {
  return PALETTE[name];
}
