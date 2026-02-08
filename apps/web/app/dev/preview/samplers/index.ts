import type { ComponentType } from 'react';

import { BadgeVariants } from './BadgeVariants';
import { ButtonVariants } from './ButtonVariants';
import { ColorSwatches } from './ColorSwatches';
import { ComposedComponents } from './ComposedComponents';
import { TextColors } from './TextColors';

interface SamplerEntry {
    name: string;
    component: ComponentType;
}

export const allSamplers: SamplerEntry[] = [
    { name: 'colors', component: ColorSwatches },
    { name: 'buttons', component: ButtonVariants },
    { name: 'badges', component: BadgeVariants },
    { name: 'text', component: TextColors },
    { name: 'composed', component: ComposedComponents },
];

export function getSamplers(names?: string[]): SamplerEntry[] {
    if (!names || names.length === 0) return allSamplers;
    return allSamplers.filter((s) => names.includes(s.name));
}
