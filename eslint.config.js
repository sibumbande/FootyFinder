// Batch 5 brief, B2 (CEO D19): no browser pop-ups anywhere. Every confirmation uses the in-app ConfirmDialog
// (apps/web/src/components/ui/ConfirmDialog.tsx, apps/admin/src/ConfirmDialog.tsx), so window.confirm, alert and
// prompt are lint errors in the player and admin apps. Type checking stays with tsc; this config adds only this rule.
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const popups = ['confirm', 'alert', 'prompt'];

export default [
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/admin/src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    // Registered so existing `eslint-disable-next-line react-hooks/...` comments stay valid; its rules are not enabled.
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-alert': 'error',
      'no-restricted-globals': ['error', ...popups.map((name) => ({ name, message: 'Use the in-app ConfirmDialog (useConfirm) instead of a browser pop-up.' }))],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          popups.map((property) => ({ object, property, message: 'Use the in-app ConfirmDialog (useConfirm) instead of a browser pop-up.' })),
        ),
      ],
    },
  },
];
