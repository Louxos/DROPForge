/**
 * Types du générateur de la page publiée (`scripts/build-site.mjs`).
 *
 * Le script vit en JavaScript (il est lancé par `node` sans étape de
 * compilation) ; ce fichier de déclaration permet aux tests TypeScript de
 * l'importer sans perdre le typage. Il est la contrepartie exacte des
 * exportations du script : une fonction renommée doit l'être ici aussi.
 */

export declare const REPO_URL: string;
export declare const SITE_URL: string;

export declare const SOURCES: {
  template: string;
  styles: string;
  appUrl: string;
  mark: string;
};

export declare const OUTPUTS: {
  page: string;
  favicon: string;
  noJekyll: string;
};

export declare function parseAppUrl(text: string): string;
export declare function checkAppUrl(appUrl: string): { ok: boolean; reason: string };
export declare function selectGateway(html: string, appUrl: string): string;
export declare function inlineMark(iconSvg: string, suffix?: string): string;

export declare function renderSite(input: {
  template: string;
  styles: string;
  mark: string;
  version: string;
  appUrl: string;
  repoUrl?: string;
  siteUrl?: string;
}): string;

export declare function buildOutputs(root: string): Promise<Map<string, string>>;
export declare function main(argv?: string[], root?: string): Promise<number>;
