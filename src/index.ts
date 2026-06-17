import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import chismesRouter from './routes/chismes'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json())

app.use('/chismes', chismesRouter)

app.listen(PORT, () => {
  console.log(`chismografo-api corriendo en http://localhost:${PORT}`)
})
