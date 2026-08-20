const { sanitizeText } = require('../server/sanitize');

// Builds a colorful, professional README with shields.io badges.
function readme(proj, { usage, features, install = null, extraSections = [], logo = 'github' } = {}) {
  const badges = [
    `![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)`,
    `![License](https://img.shields.io/badge/license-MIT-green.svg)`,
    `![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)`,
    `![PRs](https://img.shields.io/badge/PRs-welcome-orange.svg)`,
    `![Maintained](https://img.shields.io/badge/maintained-yes-cyan.svg)`,
    `![Platform](https://img.shields.io/badge/platform-${encodeURIComponent(proj.platform || 'cross-platform')}-purple.svg)`
  ];
  const sections = [];
  if (proj.blurb) {
    sections.push(`## About

${proj.blurb}`);
  }
  sections.push(`## Features

${features || '- Simple, focused implementation\n- No external service required\n- Works offline'}`);
  sections.push(`## Install

\`\`\`bash
${proj.repoCloneUrl ? 'git clone ' + proj.repoCloneUrl + '\ncd ' + proj.slug : 'git clone https://github.com/USERNAME/' + proj.slug + '.git\ncd ' + proj.slug + '\n# then follow the setup below'}
\`\`\``);
  sections.push(`## Usage

\`\`\`bash
${usage}
\`\`\``);
  for (const [title, body] of extraSections) {
    sections.push(`## ${title}

${body}`);
  }
  sections.push(`## License

MIT. See [LICENSE](LICENSE) for details.`);
  sections.push(`## Support

Found a bug or have an idea? Open an issue. Pull requests are always welcome.`);
  return sanitizeText(`# ${proj.title}

${badges.join(' ')}

${proj.tagline || 'A focused, practical tool built to be useful and easy to extend.'}

${sections.join('\n\n')}`);
}

const PYTHON_SRC = `"""${'{{NAME}}'} - ${'{{BLURB}}'}

A self-contained implementation with a small, testable core.
"""

__version__ = "1.0.0"

${'{{BODY}}'}`;

module.exports = {
  readme,
  PYTHON_SRC
};
