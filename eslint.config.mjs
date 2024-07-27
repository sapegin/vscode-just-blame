import tamiaTypeScript from 'eslint-config-tamia/typescript';

const config = [
  ...tamiaTypeScript,
  {
    ignores: ['out/'],
  },
];

export default config;
