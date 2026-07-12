export const locales = ['en', 'pt-BR'] as const;
export const defaultLocale = 'en';
export const localeCookieName = 'NEXT_LOCALE';

export type AppLocale = (typeof locales)[number];

export function isAppLocale(locale: string | undefined): locale is AppLocale {
    return locales.includes(locale as AppLocale);
}

export function resolveLocale({
    cookieLocale,
    acceptLanguage,
}: {
    cookieLocale?: string;
    acceptLanguage?: string | null;
}): AppLocale {
    if (isAppLocale(cookieLocale)) return cookieLocale;

    return resolveAcceptLanguage(acceptLanguage) ?? defaultLocale;
}

function resolveAcceptLanguage(
    header: string | null | undefined
): AppLocale | null {
    if (!header) return null;

    return (
        header
            .split(',')
            .map(parseAcceptLanguageEntry)
            .filter(
                (entry): entry is { tag: string; q: number; index: number } =>
                    entry !== null && entry.q > 0
            )
            .sort((a, b) => b.q - a.q || a.index - b.index)
            .map((entry) => matchLocale(entry.tag))
            .find((locale): locale is AppLocale => Boolean(locale)) ?? null
    );
}

function parseAcceptLanguageEntry(
    entry: string,
    index: number
): { tag: string; q: number; index: number } | null {
    const [rawTag, ...params] = entry.trim().split(';');
    const tag = rawTag?.trim();
    if (!tag) return null;

    const qParam = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='));
    const parsedQ = qParam ? Number(qParam.slice(2)) : 1;
    const q = parsedQ >= 0 && parsedQ <= 1 ? parsedQ : 0;

    return {
        tag,
        q: Number.isFinite(q) ? q : 0,
        index,
    };
}

function matchLocale(tag: string): AppLocale | null {
    const normalized = tag.toLowerCase();

    if (normalized === 'pt-br' || normalized === 'pt') return 'pt-BR';
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';

    return null;
}
