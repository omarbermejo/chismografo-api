import { Router, Request, Response } from 'express'
import { db } from '../db'

const router = Router()

// GET /cuestionarios — list with participant count
router.get('/', async (_req: Request, res: Response) => {
  const { data: cuestionarios, error } = await db
    .from('cuestionarios')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })

  const [{ data: preguntas }, { data: respuestas }] = await Promise.all([
    db.from('preguntas').select('cuestionario_id'),
    db.from('respuestas').select('cuestionario_id, username'),
  ])

  const result = (cuestionarios ?? []).map(c => {
    const preguntaCount = (preguntas ?? []).filter(p => p.cuestionario_id === c.id).length
    const participantCount = new Set(
      (respuestas ?? []).filter(r => r.cuestionario_id === c.id).map(r => r.username)
    ).size
    return { ...c, pregunta_count: preguntaCount, participant_count: participantCount }
  })

  return res.json(result)
})

// POST /cuestionarios — create with questions
router.post('/', async (req: Request, res: Response) => {
  const { titulo, preguntas, username, avatar_seed } = req.body

  if (!titulo?.trim()) return res.status(400).json({ error: 'Necesita un título' })
  if (!Array.isArray(preguntas) || preguntas.length < 1) {
    return res.status(400).json({ error: 'Necesita al menos una pregunta' })
  }

  const { data: cuestionario, error: cError } = await db
    .from('cuestionarios')
    .insert({
      titulo: titulo.trim(),
      username: username?.trim() || 'anónimo',
      avatar_seed: avatar_seed?.trim() || 'anon',
    })
    .select()
    .single()

  if (cError || !cuestionario) return res.status(500).json({ error: cError?.message })

  const preguntasData = (preguntas as string[]).map((texto, orden) => ({
    cuestionario_id: cuestionario.id,
    texto: texto.trim(),
    orden,
  }))

  const { data: preguntasResult, error: pError } = await db
    .from('preguntas')
    .insert(preguntasData)
    .select()

  if (pError) return res.status(500).json({ error: pError.message })

  return res.status(201).json({
    ...cuestionario,
    preguntas: preguntasResult ?? [],
    pregunta_count: preguntasResult?.length ?? 0,
    participant_count: 0,
  })
})

// GET /cuestionarios/:id — detail with questions and grouped answers
router.get('/:id', async (req: Request, res: Response) => {
  const { data: cuestionario, error: cError } = await db
    .from('cuestionarios')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (cError || !cuestionario) return res.status(404).json({ error: 'No encontrado' })

  const [{ data: preguntas }, { data: respuestas }] = await Promise.all([
    db.from('preguntas').select('*').eq('cuestionario_id', req.params.id).order('orden'),
    db.from('respuestas').select('*').eq('cuestionario_id', req.params.id).order('created_at', { ascending: true }),
  ])

  const preguntasConRespuestas = (preguntas ?? []).map(p => ({
    ...p,
    respuestas: (respuestas ?? []).filter(r => r.pregunta_id === p.id),
  }))

  const participantCount = new Set((respuestas ?? []).map(r => r.username)).size

  return res.json({
    ...cuestionario,
    preguntas: preguntasConRespuestas,
    participant_count: participantCount,
    pregunta_count: (preguntas ?? []).length,
  })
})

// POST /cuestionarios/:id/responder — submit answers
router.post('/:id/responder', async (req: Request, res: Response) => {
  const { respuestas, username, avatar_seed } = req.body

  if (!Array.isArray(respuestas) || respuestas.length === 0) {
    return res.status(400).json({ error: 'Sin respuestas' })
  }

  const data = (respuestas as { pregunta_id: string; texto: string }[]).map(r => ({
    pregunta_id: r.pregunta_id,
    cuestionario_id: req.params.id,
    username: username?.trim() || 'anónimo',
    avatar_seed: avatar_seed?.trim() || 'anon',
    texto: r.texto.trim(),
  }))

  const { error } = await db.from('respuestas').insert(data)
  if (error) return res.status(500).json({ error: error.message })

  return res.status(201).json({ ok: true })
})

export default router
