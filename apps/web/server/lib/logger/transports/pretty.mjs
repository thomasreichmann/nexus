import pinoPretty from 'pino-pretty';

// pino-pretty expands \n in "stack" fields but not "message" fields,
// so multi-line Zod summaries render as a single escaped line. This
// prettifier fixes that.
function formatErrorProp(value) {
    if (!value || typeof value !== 'object') {
        return typeof value === 'string' ? value : JSON.stringify(value);
    }
    const json = JSON.stringify(value, null, 2);
    if (!json) return '';
    // /gm handles nested cause objects that also contain "message" keys
    return json.replace(
        /^(\s*"message":\s*")((?:[^"\\]|\\.)*)("(?:,)?)$/gm,
        (match, prefix, content, suffix) => {
            if (!content.includes('\\n')) return match;
            const messageIndent = ' '.repeat(prefix.length);
            return (
                prefix + content.replace(/\\n/g, '\n' + messageIndent) + suffix
            );
        }
    );
}

export default function prettyTransport(opts) {
    return pinoPretty({
        ...opts,
        customPrettifiers: {
            ...opts.customPrettifiers,
            error: formatErrorProp,
        },
    });
}
