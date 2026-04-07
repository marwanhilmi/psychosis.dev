import { defineConfig } from 'vite-plus'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

const config = defineConfig({
  lint: { ignorePatterns: ['routeTree.gen.ts'], options: { typeAware: true, typeCheck: true } },
  fmt: {
    ignorePatterns: ['routeTree.gen.ts'],
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 120,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    process.env.VITEST
      ? cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })
      : cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
})

export default config
