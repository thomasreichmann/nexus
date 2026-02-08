/**
 * Map Prism token types to Tailwind CSS color classes.
 * Used for consistent syntax highlighting across components.
 */
export function getPrismColorClass(types: string[]): string {
    // TypeScript/JavaScript keywords (const, let, function, async, await, etc.)
    if (types.includes('keyword')) return 'text-purple-400';

    // Function names
    if (types.includes('function')) return 'text-blue-400';

    // Object/JSON keys
    if (types.includes('property')) return 'text-cyan-400';

    // String literals
    if (types.includes('string')) return 'text-green-400';

    // Number literals
    if (types.includes('number')) return 'text-blue-400';

    // Boolean literals
    if (types.includes('boolean')) return 'text-purple-400';

    // Null value
    if (types.includes('null')) return 'text-orange-400';

    // Operators (+, -, =, =>, etc.)
    if (types.includes('operator')) return 'text-yellow-400';

    // Comments
    if (types.includes('comment')) return 'text-gray-500';

    // Punctuation inherits text color
    return '';
}
