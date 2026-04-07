import { createFileRoute } from '@tanstack/react-router'
import { createImageResponse } from '@takumi-rs/image-response'
import { db } from '#/db'
import { psychosisScores, user } from '#/db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import HomeOG from '#/components/og/HomeOG'
import MeterOG from '#/components/og/MeterOG'

const ogImage = createImageResponse({
  width: 2400,
  height: 1260,
  devicePixelRatio: 2,
  format: 'png',
  quality: 100,
  headers: {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Content-Type': 'image/png',
  },
})

export const Route = createFileRoute('/og/$type')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { type: string } }) => {
        const url = new URL(request.url)
        const type = params.type

        try {
          let response: Response & { ready?: Promise<void> }
          switch (type) {
            case 'home':
              response = await renderHome()
              break
            case 'meter':
              response = await renderMeter(url)
              break
            case 'droog':
              response = await renderDroog(url)
              break
            default:
              return new Response('Unknown OG type', { status: 404 })
          }
          if (response.ready) await response.ready

          return response
        } catch (e) {
          console.error('OG render error:', e)
          return new Response('OG render failed', { status: 500 })
        }
      },
    },
  },
})

async function renderHome() {
  return ogImage(<HomeOG />)
}

async function renderMeter(url: URL) {
  const scoreId = url.searchParams.get('id')
  if (!scoreId) return new Response('Missing id', { status: 400 })

  const [score] = await db
    .select({
      score: psychosisScores.score,
      zone: psychosisScores.zone,
      diagnosis: psychosisScores.diagnosis,
      userId: psychosisScores.userId,
      targetGithub: psychosisScores.targetGithub,
    })
    .from(psychosisScores)
    .where(eq(psychosisScores.id, scoreId))

  if (!score) return new Response('Score not found', { status: 404 })

  let username = score.targetGithub ?? 'Anonymous'
  if (score.userId) {
    const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, score.userId))
    if (u?.name) username = u.name
  }

  return ogImage(<MeterOG username={username} score={score.score} zone={score.zone} diagnosis={score.diagnosis} />)
}

async function renderDroog(url: URL) {
  const username = url.searchParams.get('username')
  if (!username) return new Response('Missing username', { status: 400 })

  // Try self-diagnosis first (by user name)
  const [u] = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.name, username))

  if (u) {
    const [score] = await db
      .select({
        score: psychosisScores.score,
        zone: psychosisScores.zone,
        diagnosis: psychosisScores.diagnosis,
      })
      .from(psychosisScores)
      .where(eq(psychosisScores.userId, u.id))
      .orderBy(desc(psychosisScores.createdAt))
      .limit(1)

    if (score) {
      return ogImage(<MeterOG username={u.name} score={score.score} zone={score.zone} diagnosis={score.diagnosis} />)
    }
  }

  // Fall back to report (by targetGithub or targetX)
  const [report] = await db
    .select({
      score: psychosisScores.score,
      zone: psychosisScores.zone,
      diagnosis: psychosisScores.diagnosis,
      targetGithub: psychosisScores.targetGithub,
      targetX: psychosisScores.targetX,
    })
    .from(psychosisScores)
    .where(
      sql`${psychosisScores.source} = 'reported' AND (${psychosisScores.targetGithub} = ${username} OR ${psychosisScores.targetX} = ${username})`,
    )
    .orderBy(desc(psychosisScores.createdAt))
    .limit(1)

  if (!report) return new Response('No score found', { status: 404 })

  const displayName = report.targetGithub ?? report.targetX ?? username
  return ogImage(
    <MeterOG username={displayName} score={report.score} zone={report.zone} diagnosis={report.diagnosis} />,
  )
}
