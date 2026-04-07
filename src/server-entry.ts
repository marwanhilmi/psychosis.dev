import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

export { AnalysisWorkflow } from '#/workflows/analysis'

const startHandler = createStartHandler(defaultStreamHandler)

export default {
  async fetch(request: Request): Promise<Response> {
    return startHandler(request)
  },
}
