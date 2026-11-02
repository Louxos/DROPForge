/**
 * Types du générateur des pages statiques du site (`scripts/build-site.mjs`).
 *
 * Le script vit en JavaScript (il est lancé par `node` sans étape de compilation) ; ce
 * fichier de déclaration permet aux tests TypeScript de l'importer sans perdre le
 * typage. Il est la contrepartie exacte des exportations du script : une fonction
 * renommée doit l'être ici aussi.
 */

export declare const REPO_URL: string;
export declare const SITE_URL: string;

/** Où vit l'application à l'intérieur du site (`app/`), toujours relatif. */
export declare const APP_PATH: string;

export declare const SOURCES: {
  template: string;
  notFound: string;
  styles: string;
  mark: string;
};

export declare const OUTPUTS: {
  page: string;
  notFound: string;
  favicon: string;
};

export declare type AppUrlVerdict =
  | { ok: true; relative: boolean; reason: string }
  | { ok: false; reason: string; relative?: undefined };

export declare function checkAppUrl(appUrl: string, siteUrl?: string): AppUrlVerdict;
export declare function inlineMark(iconSvg: string, suffix?: string): string;

export declare function renderSite(input: {
  template: string;
  styles: string;
  mark: string;
  version: string;
  appUrl?: string;
  repoUrl?: string;
  siteUrl?: string;
}): string;

export declare function renderNotFound(input: {
  template: string;
  styles: string;
  mark: string;
  base?: string;
  appUrl?: string;
  repoUrl?: string;
  siteUrl?: string;
}): string;

export declare function buildSiteFiles(input?: {
  root?: string;
  appUrl?: string;
  base?: string;
  siteUrl?: string;
  repoUrl?: string;
}): Promise<Map<string, string>>;

export declare function main(argv?: string[], root?: string): Promise<number>;

/** Vrai lorsque le site contient réellement l'application. */
export declare function appIsPresent(directory: string): Promise<boolean>;
