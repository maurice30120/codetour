import { preflightCli } from './preflight.mjs';

preflightCli().then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
