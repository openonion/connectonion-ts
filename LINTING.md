# Linting baseline

Run the supported ESLint flat configuration with:

```bash
npm run lint
```

Before 0.3.3 the repository declared ESLint but had no configuration, so the
command always failed before checking source. The first working run exposed
120 pre-existing errors. `eslint.config.mjs` records those by exact file and
rule instead of disabling recommended rules globally.

The baseline is shrink-only. When a listed file is corrected, remove it from
the corresponding array. Do not add new files merely to make lint pass; new
source must satisfy the recommended ESLint and typescript-eslint rules.
