// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Angular selectors: we keep them, but without blocking lint.
      "@angular-eslint/directive-selector": [
        "warn",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],

      "@angular-eslint/component-selector": [
        "warn",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],

      "@angular-eslint/prefer-standalone": "off",

      // The project currently uses a lot of "any".
      // We don't want to have to type everything before we can use ESLint.
      "@typescript-eslint/no-explicit-any": "off",

      // Existing code cleanup: temporarily set to warning.
      "@typescript-eslint/no-unused-vars": "warn",

      "no-var": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // Historical project comparisons using == / !=
      "@angular-eslint/template/eqeqeq": "warn",

      // Accessibility: we want to keep these checks,
      // but they should not block the project migration.
      "@angular-eslint/template/click-events-have-key-events": "warn",
      "@angular-eslint/template/interactive-supports-focus": "warn",
      "@angular-eslint/template/alt-text": "warn",
      "@angular-eslint/template/no-autofocus": "warn",
    },
  }
);
