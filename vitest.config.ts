import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'programmer',
          environment: 'node',
          globals: true,
          include: ['tests/programmer/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'learning',
          environment: 'node',
          globals: true,
          include: ['tests/learning/**/*.test.ts'],
          exclude: ['tests/learning/**/*.llm.test.ts'],
        },
      },
      {
        test: {
          name: 'learning-llm',
          environment: 'node',
          globals: true,
          include: ['tests/learning/**/*.llm.test.ts'],
        },
      },
      {
        test: {
          name: 'application',
          environment: 'node',
          globals: true,
          include: ['tests/application/**/*.test.ts'],
          exclude: ['tests/application/**/*.llm.test.ts'],
        },
      },
      {
        test: {
          name: 'application-llm',
          environment: 'node',
          globals: true,
          include: ['tests/application/**/*.llm.test.ts'],
        },
      },
    ],
  },
})
