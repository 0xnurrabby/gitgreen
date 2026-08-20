// Realistic commit messages by type. Pools are large enough that repeats are rare.
const MESSAGES = {
  create: [
    'Initial commit',
    'Project setup and initial structure',
    'Bootstrap the repository',
    'Add initial implementation',
    'Project scaffolding',
    'Initial release of the core',
    'Set up project baseline',
    'Begin implementation',
    'First working version',
    'Initial project layout'
  ],
  feat: [
    'Add {feature} support',
    'Implement {feature}',
    'Add {feature} handling',
    'Add initial {feature} version',
    'Introduce {feature} module',
    'Add {feature} flow',
    'Wire up {feature}',
    'Add {feature} to the core',
    'Add {feature} utilities',
    'Add {feature} configuration',
    'Add {feature} endpoint',
    'Add {feature} with tests',
    'Add {feature} helpers',
    'Add {feature} parsing',
    'Add {feature} validation',
    'Add {feature} retry logic',
    'Add {feature} export',
    'Add {feature} monitoring',
    'Add {feature} hooks',
    'Add {feature} schema',
    'Add {feature} adapter',
    'Add {feature} plugin support',
    'Add {feature} metrics',
    'Add {feature} notifications',
    'Add {feature} persistence'
  ],
  fix: [
    'Fix edge case in {feature}',
    'Handle null {feature} input',
    'Fix {feature} error path',
    'Correct {feature} logic',
    'Fix {feature} boundary condition',
    'Handle empty input in {feature}',
    'Fix {feature} timeout handling',
    'Fix {feature} regression',
    'Fix off-by-one in {feature}',
    'Fix {feature} race condition',
    'Fix {feature} encoding issue',
    'Fix {feature} crash on empty input',
    'Handle missing {feature} gracefully',
    'Fix {feature} exit code',
    'Fix {feature} on windows',
    'Fix {feature} stale cache',
    'Fix {feature} memory leak',
    'Fix {feature} retry backoff'
  ],
  refactor: [
    'Refactor {feature} internals',
    'Clean up {feature} code',
    'Simplify {feature} flow',
    'Extract {feature} helpers',
    'Tighten up {feature}',
    'Reorganize {feature} modules',
    'Rename {feature} for clarity',
    'Split {feature} into smaller pieces',
    'Remove dead code in {feature}',
    'Make {feature} easier to test',
    'Reduce duplication in {feature}'
  ],
  docs: [
    'Document {feature}',
    'Add usage notes for {feature}',
    'Expand {feature} docs',
    'Clarify {feature} behavior',
    'Add examples for {feature}',
    'Document {feature} options',
    'Update {feature} section',
    'Improve {feature} readme',
    'Add {feature} troubleshooting docs',
    'Document {feature} config',
    'Add FAQ entry for {feature}'
  ],
  test: [
    'Add tests for {feature}',
    'Cover {feature} edge cases',
    'Add {feature} test coverage',
    'Test {feature} failure modes',
    'Add regression tests for {feature}',
    'Add integration tests for {feature}',
    'Test {feature} with large inputs',
    'Add {feature} unit tests',
    'Cover {feature} error handling'
  ],
  chore: [
    'Bump dependencies',
    'Tidy up configuration',
    'Update ignore rules',
    'Add local tooling config',
    'Refresh lockfile',
    'Small cleanups',
    'Update build tooling',
    'Pin dependency versions',
    'Add editor settings',
    'Update project metadata'
  ],
  perf: [
    'Speed up {feature} path',
    'Reduce allocations in {feature}',
    'Cache {feature} lookups',
    'Optimize {feature} loop',
    'Cut {feature} memory usage',
    'Stream {feature} output',
    'Batch {feature} requests',
    'Lazy-load {feature}'
  ],
  style: [
    'Align formatting in {feature}',
    'Standardize {feature} style',
    'Minor formatting tweaks',
    'Consistent naming in {feature}'
  ],
  build: [
    'Add build script',
    'Improve build output',
    'Add version stamp to build',
    'Make build reproducible',
    'Add build targets'
  ],
  deps: [
    'Upgrade core dependencies',
    'Add dependency for {feature}',
    'Replace deprecated dependency',
    'Remove unused dependency'
  ]
};

module.exports = { MESSAGES };
