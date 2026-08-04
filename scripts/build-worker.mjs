/**
 * Bundle do Worker com esbuild.
 *
 * O GoDeploy aceita o worker já empacotado; empacotar aqui mantém o deploy
 * previsível e permite commitar o artefato, como o godocs faz.
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: 'worker.js',
  // `node:sqlite` só existe no runtime do Node (testes/dev local). No Worker o
  // banco vem de `env.DB`, então o módulo é marcado como externo — se ele fosse
  // empacotado, o bundle quebraria no boot.
  external: ['node:sqlite'],
  logLevel: 'info',
})
