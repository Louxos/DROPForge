/**
 * Types de la description du logo (`brand-mark.mjs`).
 *
 * Le module est en JavaScript pour être lu sans compilation par les scripts Node qui
 * dessinent les icônes de l'application ; ces types le rendent utilisable
 * depuis le TypeScript de l'application, sans en dupliquer la moindre coordonnée.
 */

/** Un point du repère 512×512. */
export type MarkPoint = readonly [number, number];

export interface MarkGeometry {
  /** Côté du repère de référence. */
  readonly viewBox: number;
  /** Fond du carré. */
  readonly background: string;
  /** Rayon des coins arrondis. */
  readonly radius: number;
  /** Dégradé vertical du symbole. */
  readonly gradient: { readonly from: string; readonly to: string };
  /** Les trois sommets du coin descendant. */
  readonly wedge: readonly MarkPoint[];
  /** La tige détachée, sous la pointe. */
  readonly stem: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly radius: number };
}

/** La description du logo, seule source de toutes ses représentations. */
export declare const MARK: MarkGeometry;

/** Le tracé SVG du coin. */
export declare function wedgePath(mark?: MarkGeometry): string;

/** Le rectangle arrondi de la tige. */
export declare function stemRect(mark?: MarkGeometry): MarkGeometry['stem'];

/** Les deux arrêts du dégradé. */
export declare const MARK_GRADIENT_STOPS: ReadonlyArray<{ readonly offset: string; readonly color: string }>;

/** Identifiant de dégradé des fichiers SVG. */
export declare const MARK_GRADIENT_ID: string;

/**
 * Le logo en SVG. `label: null` produit un SVG décoratif, pour les endroits où le nom
 * est écrit à côté du symbole.
 */
export declare function markSvg(options?: { size?: number; gradientId?: string; label?: string | null }): string;
