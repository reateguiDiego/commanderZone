module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist/frontend/browser',
      url: [
        'http://localhost/',
        'http://localhost/en/play-commander-online/',
        'http://localhost/es/jugar-commander-online/',
        'http://localhost/en/spelltable-alternative/',
        'http://localhost/en/play-commander-online-free/',
      ],
      numberOfRuns: 1,
      settings: {
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
          disabled: false,
        },
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 1 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './dist/lhci',
    },
  },
};
