import { generateAiReply } from '@echo/shared'
import type { AiChatResult, EchoFilePatch, EchoMobileProject, MobileSettings } from './mobileTypes'

const SAFETY_SYSTEM =
  'You are the ECHO Studio Mobile assistant. Generate only public ECHO contracts. Keep content namespaced to the creator. Return optional files inside an echo-files JSON array with objects { "path": string, "content": string }.'

function fallbackFiles(prompt: string, project: EchoMobileProject | null): EchoFilePatch[] {
  const namespace = project?.manifest.namespace ?? 'teamnova'
  const lower = prompt.toLowerCase()
  if (lower.includes('recipe')) {
    return [
      {
        path: 'recipes/mobile_generated_recipe.json',
        content: JSON.stringify({
          id: `${namespace}:mobile_generated_recipe`,
          type: 'machine_recipe',
          machine: `${namespace}:field_fabricator`,
          inputs: [{ item: `${namespace}:scrap`, count: 3 }],
          output: { item: `${namespace}:field_plate`, count: 1 },
          time: 160,
          energy: 80
        }, null, 2)
      }
    ]
  }
  if (lower.includes('dialogue')) {
    return [
      {
        path: 'content/dialogue/mobile_generated_dialogue.json',
        content: JSON.stringify({
          id: `${namespace}:mobile_generated_dialogue`,
          npc: `${namespace}:field_contact`,
          lines: [
            { speaker: 'npc', text: 'I marked the route. Move when the signal clears.' },
            { speaker: 'player', text: 'Understood.', next: `${namespace}:route_acknowledged` }
          ]
        }, null, 2)
      }
    ]
  }
  return [
    {
      path: 'missions/mobile_generated_mission.json',
      content: JSON.stringify({
        id: `${namespace}:mobile_generated_mission`,
        title: 'Mobile Generated Mission',
        description: 'A field-authored mission drafted in ECHO Studio Mobile.',
        objective: { type: 'visit_location', target: `${namespace}:field_site` },
        rewards: [{ item: `${namespace}:field_plate`, count: 1 }],
        repeatable: false,
        hidden: false,
        timed: false
      }, null, 2)
    }
  ]
}

function parseEchoFiles(text: string): EchoFilePatch[] {
  const directMatch = text.match(/echo-files\s*:\s*(\[[\s\S]*?\])/i)
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [directMatch?.[1], fencedMatch?.[1], text].filter(Boolean) as string[]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      const files = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.['echo-files'])
          ? parsed['echo-files']
          : Array.isArray(parsed?.files)
            ? parsed.files
            : []
      return files
        .filter((file: unknown): file is EchoFilePatch => {
          const value = file as EchoFilePatch
          return typeof value?.path === 'string' && typeof value?.content === 'string'
        })
        .map((file: EchoFilePatch) => ({ path: file.path, content: file.content }))
    } catch {
      // Try the next likely JSON location.
    }
  }
  return []
}

export async function runMobileAiChat(
  prompt: string,
  project: EchoMobileProject | null,
  settings: MobileSettings
): Promise<AiChatResult> {
  if (!settings.openAiApiKey.trim()) {
    const reply = generateAiReply(prompt)
    return {
      text: reply.text,
      files: fallbackFiles(prompt, project),
      usedModel: false
    }
  }

  const context = project
    ? {
        manifest: project.manifest,
        contentCounts: Object.fromEntries(Object.entries(project.content).map(([key, value]) => [key, value.length]))
      }
    : { manifest: null }
  const response = await fetch(`${settings.openAiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.openAiApiKey.trim()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.openAiModel,
      messages: [
        { role: 'system', content: SAFETY_SYSTEM },
        { role: 'user', content: `Context:\n${JSON.stringify(context, null, 2)}\n\nRequest:\n${prompt}` }
      ],
      temperature: 0.4
    })
  })
  if (!response.ok) throw new Error(`AI ${response.status}: ${await response.text()}`)
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = payload.choices?.[0]?.message?.content ?? 'No response text returned.'
  const files = parseEchoFiles(text)
  return {
    text,
    files: files.length > 0 ? files : fallbackFiles(prompt, project),
    usedModel: true
  }
}
