/**
 * Le logo DropForge, décrit une seule fois.
 *
 * Un logo qui existe en plusieurs versions finit par exister en plusieurs logos : le
 * fichier d'icônes, le bloc de marque de l'interface et la page d'accueil étaient trois
 * dessins différents du même symbole — un « DF » en texte dans l'application, un triangle
 * aux proportions recalculées ailleurs, un troisième tracé dans un fichier d'icône. Ce
 * module est la seule description, et tout le reste en dérive : l'icône de l'application,
 * le favicon, l'icône masquable d'Android, l'image de l'écran d'accueil iOS et la page
 * publiée.
 *
 * Le symbole : une **goutte** — un coin descendant, puis sa tige détachée par un
 * espace — en dégradé violet vers bleu, sur le noir de l'application. Le forgeage, la
 * goutte, le transfert : trois images pour la même idée.
 *
 * Pourquoi un `.mjs` au milieu de sources TypeScript : il est lu **tel quel** par les
 * scripts Node qui dessinent les images (aucune étape de compilation), et typé pour le
 * reste par `brand-mark.d.mts`. Une copie en `.ts` aurait été une seconde description.
 */

/** Le carré de référence : toutes les coordonnées ci-dessous sont dans ce repère. */
export const MARK = {
  /** Côté du repère. Les formes sont décrites en 512, puis mises à l'échelle. */
  viewBox: 512,
  /** Le noir de l'application, celui de `tokens.ts` et de `theme-color`. */
  background: '#0b0b0f',
  /** Rayon des coins du carré : un carré aux coins arrondis, jamais un rond. */
  radius: 112,
  /** Dégradé vertical, de haut en bas. */
  gradient: { from: '#7c5cff', to: '#389cff' },
  /** Le coin descendant (la pointe en bas) : trois sommets, dans l'ordre. */
  wedge: [
    [256, 112],
    [368, 272],
    [144, 272],
  ],
  /** La tige, sous la pointe, détachée par un espace. */
  stem: { x: 238, y: 312, width: 36, height: 88, radius: 10 },
};

/** Le tracé SVG du coin. */
export function wedgePath(mark = MARK) {
  const [first, ...rest] = mark.wedge;
  return `M${first[0]} ${first[1]}${rest.map(([x, y]) => ` L${x} ${y}`).join('')} Z`;
}

/** Le tracé SVG de la tige (un rectangle arrondi, décrit comme un `<rect>`). */
export function stemRect(mark = MARK) {
  return mark.stem;
}

/** Le dégradé du logo, en coordonnées 0-1 : ce que `linearGradient` attend. */
export const MARK_GRADIENT_STOPS = [
  { offset: '0', color: MARK.gradient.from },
  { offset: '1', color: MARK.gradient.to },
];

/** Identifiant de dégradé par défaut des fichiers SVG. */
export const MARK_GRADIENT_ID = 'df';

/**
 * Le logo en SVG, tel qu'il est écrit dans `apps/web/public/icons/icon.svg` et inséré
 * dans le bloc de marque de l'interface et la page d'accueil.
 *
 * @param {{ size?: number, gradientId?: string, label?: string | null }} [options]
 */
export function markSvg(options = {}) {
  const size = options.size ?? MARK.viewBox;
  const id = options.gradientId ?? MARK_GRADIENT_ID;
  const stem = stemRect();
  // `label: null` produit un SVG décoratif (celui du bloc de marque, où le nom est écrit
  // à côté) ; par défaut il est annoncé, parce qu'un logo seul doit être lisible.
  const label = options.label === undefined ? 'DropForge' : options.label;
  const accessibility = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.viewBox} ${MARK.viewBox}" width="${size}" height="${size}"${accessibility}>
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${MARK.gradient.from}" />
      <stop offset="1" stop-color="${MARK.gradient.to}" />
    </linearGradient>
  </defs>
  <rect width="${MARK.viewBox}" height="${MARK.viewBox}" rx="${MARK.radius}" fill="${MARK.background}" />
  <path d="${wedgePath()}" fill="url(#${id})" />
  <rect x="${stem.x}" y="${stem.y}" width="${stem.width}" height="${stem.height}" rx="${stem.radius}" fill="url(#${id})" />
</svg>`;
}
