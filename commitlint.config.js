export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 与 CONTRIBUTING 的中文提交习惯一致：放宽 subject 大小写与行长度
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
  },
};
