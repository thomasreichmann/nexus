import { localeCookieName, resolveLocale } from '@/lib/i18n/locale';
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
    const cookieStore = await cookies();
    const headerStore = await headers();
    const locale = resolveLocale({
        cookieLocale: cookieStore.get(localeCookieName)?.value,
        acceptLanguage: headerStore.get('accept-language'),
    });

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    };
});
