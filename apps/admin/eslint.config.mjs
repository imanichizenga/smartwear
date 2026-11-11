import next from 'eslint-config-next';

const config = [
  ...next,
  {
    ignores: ['.next/**', 'src/app/styles/tokens.css'],
  },
  {
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    ignores: ['src/components/ui/app-link.tsx'],
    rules: {
      // Navigation must show the A loader while pending → use AppLink, never raw next/link.
      'no-restricted-imports': ['error', { paths: [{ name: 'next/link', message: 'Use <AppLink> from @/components/ui/app-link (shows the A loader while the route loads).' }] }],
      // Design tokens only: no hex/rgb literals in className strings.
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='className'] Literal[value=/#[0-9a-fA-F]{3,8}\\b/]", message: 'Use a design token class (bg-ink, text-muted, …), not a hex colour.' },
        { selector: "JSXOpeningElement[name.name='a'] > JSXAttribute[name.name='href'] > Literal[value=/^\\//]", message: 'Internal links must use <AppLink>.' },
      ],
    },
  },
];
export default config;
