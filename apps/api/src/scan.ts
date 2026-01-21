type ProgressCb = (p: number) => Promise<void> | void

export async function performScan(input: any, onProgress: ProgressCb) {
  await onProgress(25)
  await sleep(500)
  await onProgress(50)
  await sleep(500)
  await onProgress(75)
  await sleep(500)
  const result = { summary: 'ok', issues: [], inputSize: JSON.stringify(input || {}).length }
  await onProgress(100)
  return result
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}