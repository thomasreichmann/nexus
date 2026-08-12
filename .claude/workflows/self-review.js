export const meta = {
    name: 'self-review',
    description:
        'Review a prepared branch diff with the conventions, code-quality, and reuse reviewers in parallel, then dedupe findings across reviewers',
    whenToUse:
        'Self-review phase of /work and standalone /self-review. Requires args: { diffPath, changedFiles[], criteria? } — the diff must already be written to a file.',
    phases: [
        {
            title: 'Review',
            detail: 'conventions, code quality, reuse — one agent each, parallel',
            model: 'opus',
        },
        {
            title: 'Aggregate',
            detail: 'merge duplicate findings, tally which reviewers reported each',
            model: 'opus',
        },
    ],
};

// args: { diffPath: string, changedFiles: string[], criteria?: string }
if (
    !args ||
    typeof args.diffPath !== 'string' ||
    !Array.isArray(args.changedFiles)
) {
    throw new Error(
        'args must be { diffPath: string, changedFiles: string[], criteria?: string }'
    );
}

const FINDINGS_SCHEMA = {
    type: 'object',
    properties: {
        findings: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    file: { type: 'string', description: 'Repo-relative path' },
                    line: {
                        type: 'number',
                        description:
                            '1-indexed line; omit for file-level findings',
                    },
                    category: {
                        type: 'string',
                        description:
                            'Short kebab-case label, e.g. "redundant-comment", "over-engineering", "duplication"',
                    },
                    description: {
                        type: 'string',
                        description: 'One-sentence statement of the issue',
                    },
                    fix: {
                        type: 'string',
                        description: 'The specific change that resolves it',
                    },
                },
                required: ['file', 'category', 'description', 'fix'],
            },
        },
        notes: {
            type: 'array',
            items: { type: 'string' },
            description:
                'Non-findings worth reporting: good patterns, searched locations, files that passed clean',
        },
    },
    required: ['findings'],
};

const AGGREGATED_SCHEMA = {
    type: 'object',
    properties: {
        findings: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    line: { type: 'number' },
                    category: { type: 'string' },
                    description: { type: 'string' },
                    fix: { type: 'string' },
                    reviewers: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Every reviewer that independently reported this finding',
                    },
                },
                required: [
                    'file',
                    'category',
                    'description',
                    'fix',
                    'reviewers',
                ],
            },
        },
    },
    required: ['findings'],
};

const task = [
    `Review the diff at ${args.diffPath}. Read it with the Read tool — read all of it, it may be long.`,
    `Changed files:\n${args.changedFiles.map((f) => `- ${f}`).join('\n')}`,
    'Report via structured output instead of the text format in your instructions: one findings entry per issue (file, line, category, description, fix). Put good patterns, searched locations, and clean files in notes.',
].join('\n\n');

const reviewers = [
    { type: 'conventions-review', extra: null },
    {
        type: 'code-quality-review',
        extra: args.criteria
            ? `Acceptance criteria — flag scope creep beyond these:\n${args.criteria}`
            : 'No acceptance criteria were provided — review for general quality only and skip scope-creep checks.',
    },
    { type: 'reuse-review', extra: null },
];

phase('Review');
const results = await parallel(
    reviewers.map(
        (r) => () =>
            agent(r.extra ? `${task}\n\n${r.extra}` : task, {
                agentType: r.type,
                label: r.type,
                model: 'opus', // matches the agent definitions' frontmatter; explicit so precedence rules can't change it
                effort: 'high',
                schema: FINDINGS_SCHEMA,
            }).then((out) => ({ reviewer: r.type, ...out }))
    )
);

const failedReviewers = reviewers
    .filter((r, i) => !results[i])
    .map((r) => r.type);
const ok = results.filter(Boolean);
const raw = ok.flatMap((r) =>
    r.findings.map((f) => ({ reviewer: r.reviewer, ...f }))
);
const notes = ok.flatMap((r) =>
    (r.notes || []).map((n) => `[${r.reviewer}] ${n}`)
);
log(
    `${raw.length} raw finding(s) across ${ok.length}/${reviewers.length} reviewers`
);

phase('Aggregate');
const asSingleton = ({ reviewer, ...f }) => ({ ...f, reviewers: [reviewer] });
let findings;
let aggregated = true;
if (raw.length < 2) {
    // nothing to merge — skip the agent
    findings = raw.map(asSingleton);
} else {
    const merged = await agent(
        [
            'Below are code-review findings from independent reviewers who each reviewed the same diff. Merge duplicates: findings describing the same underlying issue count as duplicates even when wording, category, or exact line differ slightly.',
            'For each merged finding keep the clearest description, the most specific fix, and the most precise file/line; list in `reviewers` every reviewer that reported it. Findings reported by a single reviewer pass through unchanged with that one reviewer listed.',
            'Never drop a non-duplicate finding, never invent findings, never judge whether a finding is valid — only merge.',
            JSON.stringify(raw, null, 2),
        ].join('\n\n'),
        {
            label: 'aggregate',
            model: 'opus',
            effort: 'low', // mechanical merge — needs no deep reasoning
            schema: AGGREGATED_SCHEMA,
        }
    );
    if (merged) {
        findings = merged.findings;
    } else {
        // aggregate agent died — fall back to unmerged singletons
        findings = raw.map(asSingleton);
        aggregated = false;
    }
}
findings.sort((a, b) => b.reviewers.length - a.reviewers.length);

log(
    `${findings.length} finding(s) after dedup${aggregated ? '' : ' (aggregate agent failed — unmerged)'}`
);
return { findings, notes, failedReviewers, aggregated };
