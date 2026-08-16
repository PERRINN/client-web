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
      // Sélecteurs Angular : on les conserve, mais sans bloquer le lint
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

      // Le projet utilise actuellement beaucoup de "any".
      // On ne veut pas devoir tout typer avant de pouvoir utiliser ESLint.
      "@typescript-eslint/no-explicit-any": "off",

      // Nettoyage du code existant : temporairement en warning.
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
      // Comparaisons historiques du projet avec == / !=
      "@angular-eslint/template/eqeqeq": "warn",

      // Accessibilité : on veut conserver ces contrôles,
      // mais ils ne doivent pas bloquer la migration du projet.
      "@angular-eslint/template/click-events-have-key-events": "warn",
      "@angular-eslint/template/interactive-supports-focus": "warn",
      "@angular-eslint/template/alt-text": "warn",
      "@angular-eslint/template/no-autofocus": "warn",
    },
  }
);
