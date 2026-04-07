import { RPCHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin } from '@orpc/server/plugins'
import { onError } from '@orpc/server'
import { createFileRoute } from '@tanstack/react-router'
import router from '#/orpc/router'

const handler = new RPCHandler(router, {
  plugins: [new BatchHandlerPlugin()],
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: { headers: request.headers },
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      ANY: handle,
    },
  },
})
