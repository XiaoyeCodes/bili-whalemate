/** Run an existing CLI command and retain machine-readable delivery failures. */
import { pathToFileURL } from 'node:url'

const file = process.argv[2]
process.argv.splice(1, 1)
try {
  await import(pathToFileURL(file).href)
} catch (error) {
  const failure = {
    code: error.code || 'BILI_COMMAND_FAILED',
    reason: error.reason || 'command',
    submission: error.submission || 'unknown',
    message: error.message || String(error),
  }
  for (const key of ['retryAt', 'platformCode', 'operationId']) {
    if (error[key] !== undefined) failure[key] = error[key]
  }
  console.error('BILI_FAILURE_JSON=' + JSON.stringify(failure))
  process.exitCode = 1
}
