import { Router, Request, Response } from 'express'
import { db } from '../db'

const router = Router()

// GET /chismes — feed paginado
router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 15))
  const offset = (page - 1) * limit

  const { data: chismes, error } = await db
    .from('chismes')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return res.status(500).json({ error: error.message })

  const [{ data: likes }, { data: reposts }, { data: comentarios }] = await Promise.all([
    db.from('likes').select('chisme_id'),
    db.from('reposts').select('chisme_id'),
    db.from('comentarios').select('chisme_id'),
  ])

  const count = (rows: { chisme_id: string }[] | null, id: string) =>
    (rows ?? []).filter(r => r.chisme_id === id).length

  const data = (chismes ?? []).map(c => ({
    ...c,
    like_count: count(likes, c.id),
    repost_count: count(reposts, c.id),
    comment_count: count(comentarios, c.id),
  }))

  return res.json({ data, hasMore: data.length === limit })
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

// GET /chismes/search?q=... — búsqueda por texto (debe ir ANTES de /:id)
router.get('/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string ?? '').trim()
  if (!q) return res.json([])

  const { data: chismes, error } = await db
    .from('chismes')
    .select('*')
    .ilike('texto', `%${q}%`)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return res.status(500).json({ error: error.message })

  const ids = (chismes ?? []).map(c => c.id)
  if (ids.length === 0) return res.json([])

  const [{ data: likes }, { data: reposts }, { data: comentarios }] = await Promise.all([
    db.from('likes').select('chisme_id').in('chisme_id', ids),
    db.from('reposts').select('chisme_id').in('chisme_id', ids),
    db.from('comentarios').select('chisme_id').in('chisme_id', ids),
  ])

  const count = (rows: { chisme_id: string }[] | null, id: string) =>
    (rows ?? []).filter(r => r.chisme_id === id).length

  return res.json((chismes ?? []).map(c => ({
    ...c,
    like_count: count(likes, c.id),
    repost_count: count(reposts, c.id),
    comment_count: count(comentarios, c.id),
  })))
})

// GET /chismes/trending — top chismes por likes (debe ir ANTES de /:id)
router.get('/trending', async (_req: Request, res: Response) => {
  const { data: chismes, error } = await db
    .from('chismes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return res.status(500).json({ error: error.message })

  const [{ data: likes }, { data: reposts }, { data: comentarios }] = await Promise.all([
    db.from('likes').select('chisme_id'),
    db.from('reposts').select('chisme_id'),
    db.from('comentarios').select('chisme_id'),
  ])

  const count = (rows: { chisme_id: string }[] | null, id: string) =>
    (rows ?? []).filter(r => r.chisme_id === id).length

  const result = (chismes ?? [])
    .map(c => ({
      ...c,
      like_count: count(likes, c.id),
      repost_count: count(reposts, c.id),
      comment_count: count(comentarios, c.id),
    }))
    .sort((a, b) => (b.like_count + b.comment_count + b.repost_count) - (a.like_count + a.comment_count + a.repost_count))
    .slice(0, 20)

  return res.json(result)
})

// GET /chismes/:id — chisme individual con conteos
router.get('/:id', async (req: Request, res: Response) => {
  const { data: chisme, error } = await db
    .from('chismes')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error || !chisme) return res.status(404).json({ error: 'No encontrado' })

  const [{ data: likes }, { data: reposts }, { data: comentarios }] = await Promise.all([
    db.from('likes').select('chisme_id').eq('chisme_id', req.params.id),
    db.from('reposts').select('chisme_id').eq('chisme_id', req.params.id),
    db.from('comentarios').select('chisme_id').eq('chisme_id', req.params.id),
  ])

  return res.json({
    ...chisme,
    like_count: (likes ?? []).length,
    repost_count: (reposts ?? []).length,
    comment_count: (comentarios ?? []).length,
  })
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

export default router
