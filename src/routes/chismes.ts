import { Router, Request, Response } from 'express'
import { db } from '../db'

const router = Router()

// GET /chismes — feed con conteos de likes, reposts y comentarios
router.get('/', async (_req: Request, res: Response) => {
  const { data: chismes, error } = await db
    .from('chismes')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const [{ data: likes }, { data: reposts }, { data: comentarios }] = await Promise.all([
    db.from('likes').select('chisme_id'),
    db.from('reposts').select('chisme_id'),
    db.from('comentarios').select('chisme_id'),
  ])

  const count = (rows: { chisme_id: string }[] | null, id: string) =>
    (rows ?? []).filter(r => r.chisme_id === id).length

  const result = (chismes ?? []).map(c => ({
    ...c,
    like_count: count(likes, c.id),
    repost_count: count(reposts, c.id),
    comment_count: count(comentarios, c.id),
  }))

  return res.json(result)
})

// POST /chismes — publicar chisme
router.post('/', async (req: Request, res: Response) => {
  const { texto, username, avatar_seed } = req.body

  if (!texto?.trim()) {
    return res.status(400).json({ error: 'El texto no puede estar vacío' })
  }

  const { data, error } = await db
    .from('chismes')
    .insert({
      texto: texto.trim(),
      username: username?.trim() || 'anónimo',
      avatar_seed: avatar_seed?.trim() || 'anon',
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(201).json({ ...data, like_count: 0, repost_count: 0, comment_count: 0 })
})

// POST /chismes/:id/likes
router.post('/:id/likes', async (req: Request, res: Response) => {
  const { error } = await db.from('likes').insert({ chisme_id: req.params.id })
  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json({ ok: true })
})

// POST /chismes/:id/reposts
router.post('/:id/reposts', async (req: Request, res: Response) => {
  const { error } = await db.from('reposts').insert({ chisme_id: req.params.id })
  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json({ ok: true })
})

// GET /chismes/:id/comentarios
router.get('/:id/comentarios', async (req: Request, res: Response) => {
  const { data, error } = await db
    .from('comentarios')
    .select('*')
    .eq('chisme_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  return res.json(data)
})

// POST /chismes/:id/comentarios
router.post('/:id/comentarios', async (req: Request, res: Response) => {
  const { texto, username, avatar_seed } = req.body

  if (!texto?.trim()) {
    return res.status(400).json({ error: 'El comentario no puede estar vacío' })
  }

  const { data, error } = await db
    .from('comentarios')
    .insert({
      chisme_id: req.params.id,
      texto: texto.trim(),
      username: username?.trim() || 'anónimo',
      avatar_seed: avatar_seed?.trim() || 'anon',
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json(data)
})

export default router
