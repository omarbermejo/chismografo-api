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

  const ids = (chismes ?? []).map(c => c.id)

  const [{ data: likes }, { data: reposts }, { data: comentarios }] = await Promise.all([
    db.from('likes').select('chisme_id'),
    db.from('reposts').select('chisme_id'),
    db.from('comentarios').select('chisme_id'),
  ])

  // Enriquecer con polls (secuencial porque opcion_ids dependen de polls)
  const pollByChismeId = new Map<string, object>()
  if (ids.length > 0) {
    const { data: polls } = await db.from('polls').select('*').in('chisme_id', ids)
    const pollIds = (polls ?? []).map(p => p.id)
    if (pollIds.length > 0) {
      const { data: opciones } = await db.from('poll_opciones').select('*').in('poll_id', pollIds).order('orden', { ascending: true })
      const opcionIds = (opciones ?? []).map(o => o.id)
      const { data: votos } = opcionIds.length > 0
        ? await db.from('poll_votos').select('opcion_id').in('opcion_id', opcionIds)
        : { data: [] }
      for (const p of polls ?? []) {
        const pOpciones = (opciones ?? [])
          .filter(o => o.poll_id === p.id)
          .map(o => ({ id: o.id, texto: o.texto, orden: o.orden, voto_count: (votos ?? []).filter(v => v.opcion_id === o.id).length }))
        pollByChismeId.set(p.chisme_id, { id: p.id, pregunta: p.pregunta, opciones: pOpciones })
      }
    }
  }

  const count = (rows: { chisme_id: string }[] | null, id: string) =>
    (rows ?? []).filter(r => r.chisme_id === id).length

  const data = (chismes ?? []).map(c => ({
    ...c,
    like_count: count(likes, c.id),
    repost_count: count(reposts, c.id),
    comment_count: count(comentarios, c.id),
    poll: pollByChismeId.get(c.id) ?? null,
  }))

  return res.json({ data, hasMore: data.length === limit })
})

// POST /chismes — publicar chisme
router.post('/', async (req: Request, res: Response) => {
  const { texto, username, avatar_seed, secreto } = req.body

  if (!texto?.trim()) {
    return res.status(400).json({ error: 'El texto no puede estar vacío' })
  }

  const { data, error } = await db
    .from('chismes')
    .insert({
      texto: texto.trim(),
      username: username?.trim() || 'anónimo',
      avatar_seed: avatar_seed?.trim() || 'anon',
      secreto: secreto === true,
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

// GET /chismes/reposts — reposts recientes con el chisme original embebido (antes de /:id)
router.get('/reposts', async (_req: Request, res: Response) => {
  const { data: reposts, error } = await db
    .from('reposts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return res.status(500).json({ error: error.message })

  const list = reposts ?? []
  const ids = [...new Set(list.map(r => r.chisme_id))]
  if (ids.length === 0) return res.json([])

  const [{ data: chismes }, { data: likes }, { data: repostRows }, { data: comentarios }] = await Promise.all([
    db.from('chismes').select('*').in('id', ids),
    db.from('likes').select('chisme_id').in('chisme_id', ids),
    db.from('reposts').select('chisme_id').in('chisme_id', ids),
    db.from('comentarios').select('chisme_id').in('chisme_id', ids),
  ])

  const count = (rows: { chisme_id: string }[] | null, id: string) =>
    (rows ?? []).filter(r => r.chisme_id === id).length

  const byId = new Map((chismes ?? []).map(c => [c.id, c]))

  const result = list
    .map(r => {
      const original = byId.get(r.chisme_id)
      if (!original) return null
      return {
        id: r.id ?? `${r.chisme_id}-${r.created_at}`,
        created_at: r.created_at,
        username: r.username || 'anónimo',
        avatar_seed: r.avatar_seed || 'anon',
        texto: r.texto || null,
        chisme: {
          ...original,
          like_count: count(likes, original.id),
          repost_count: count(repostRows, original.id),
          comment_count: count(comentarios, original.id),
        },
      }
    })
    .filter(Boolean)

  return res.json(result)
})

// GET /chismes/user/:username — chismes de un usuario (debe ir ANTES de /:id)
router.get('/user/:username', async (req: Request, res: Response) => {
  const { data: chismes, error } = await db
    .from('chismes')
    .select('*')
    .eq('username', req.params.username)
    .order('created_at', { ascending: false })
    .limit(50)

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

// GET /chismes/hashtag/:tag — chismes con un hashtag (debe ir ANTES de /:id)
router.get('/hashtag/:tag', async (req: Request, res: Response) => {
  const tag = req.params.tag.toLowerCase()
  const { data: chismes, error } = await db
    .from('chismes')
    .select('*')
    .ilike('texto', `%#${tag}%`)
    .order('created_at', { ascending: false })
    .limit(50)

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

// GET /chismes/:id/poll — encuesta del chisme (antes de /:id para que no colisione)
router.get('/:id/poll', async (req: Request, res: Response) => {
  const { data: poll } = await db
    .from('polls')
    .select('*')
    .eq('chisme_id', req.params.id)
    .single()

  if (!poll) return res.json(null)

  const { data: opciones } = await db
    .from('poll_opciones')
    .select('*')
    .eq('poll_id', poll.id)
    .order('orden', { ascending: true })

  const { data: votos } = await db
    .from('poll_votos')
    .select('opcion_id')
    .in('opcion_id', (opciones ?? []).map(o => o.id))

  const votoCount = (rows: { opcion_id: string }[] | null, id: string) =>
    (rows ?? []).filter(v => v.opcion_id === id).length

  return res.json({
    id: poll.id,
    pregunta: poll.pregunta,
    opciones: (opciones ?? []).map(o => ({
      id: o.id,
      texto: o.texto,
      orden: o.orden,
      voto_count: votoCount(votos, o.id),
    })),
  })
})

// POST /chismes/:id/poll — crea la encuesta del chisme
router.post('/:id/poll', async (req: Request, res: Response) => {
  const { pregunta, opciones } = req.body

  if (!pregunta?.trim()) return res.status(400).json({ error: 'La pregunta es requerida' })
  if (!Array.isArray(opciones) || opciones.length < 2 || opciones.length > 4) {
    return res.status(400).json({ error: 'Se requieren entre 2 y 4 opciones' })
  }

  const { data: poll, error } = await db
    .from('polls')
    .insert({ chisme_id: req.params.id, pregunta: pregunta.trim() })
    .select()
    .single()

  if (error || !poll) return res.status(500).json({ error: error?.message })

  const { data: creadas } = await db
    .from('poll_opciones')
    .insert(opciones.map((texto: string, orden: number) => ({
      poll_id: poll.id,
      texto: texto.trim(),
      orden,
    })))
    .select()

  return res.status(201).json({
    id: poll.id,
    pregunta: poll.pregunta,
    opciones: (creadas ?? []).map(o => ({ id: o.id, texto: o.texto, orden: o.orden, voto_count: 0 })),
  })
})

// POST /chismes/:id/poll/votar — registra un voto
router.post('/:id/poll/votar', async (req: Request, res: Response) => {
  const { opcion_id } = req.body
  if (!opcion_id) return res.status(400).json({ error: 'opcion_id requerido' })

  const { error } = await db.from('poll_votos').insert({ opcion_id })
  if (error) return res.status(500).json({ error: error.message })

  // Devuelve los conteos actualizados
  const { data: opcion } = await db.from('poll_opciones').select('poll_id').eq('id', opcion_id).single()
  if (!opcion) return res.status(404).json({ error: 'Opción no encontrada' })

  const { data: opciones } = await db
    .from('poll_opciones')
    .select('*')
    .eq('poll_id', opcion.poll_id)
    .order('orden', { ascending: true })

  const { data: votos } = await db
    .from('poll_votos')
    .select('opcion_id')
    .in('opcion_id', (opciones ?? []).map(o => o.id))

  const votoCount = (rows: { opcion_id: string }[] | null, id: string) =>
    (rows ?? []).filter(v => v.opcion_id === id).length

  return res.json((opciones ?? []).map(o => ({
    id: o.id,
    texto: o.texto,
    orden: o.orden,
    voto_count: votoCount(votos, o.id),
  })))
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
  const { username, avatar_seed, texto } = req.body
  const { error } = await db.from('reposts').insert({
    chisme_id: req.params.id,
    username: username?.trim() || 'anónimo',
    avatar_seed: avatar_seed?.trim() || 'anon',
    texto: texto?.trim() || null,
  })
  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json({ ok: true })
})

export default router
